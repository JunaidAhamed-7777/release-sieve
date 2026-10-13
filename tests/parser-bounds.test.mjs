import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { LIMITS, parseNotes } from '../src/audit.mjs';

// A worker deadline can stop a synchronous parser regression; an ordinary test
// timeout cannot interrupt regex backtracking on the test runner's own thread.
async function timedParse(markdown) {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { parseNotes } = await import(workerData.moduleUrl);
      const started = performance.now();
      try {
        const notes = parseNotes(workerData.markdown);
        parentPort.postMessage({ notes, durationMs: performance.now() - started });
      } catch (error) {
        parentPort.postMessage({ error: { name: error.name, message: error.message }, durationMs: performance.now() - started });
      }
    })().catch(error => { throw error; });
  `, { eval: true, workerData: { markdown, moduleUrl: new URL('../src/audit.mjs', import.meta.url).href } });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Bounded Markdown parsing exceeded the 5-second worker deadline.')), 5_000);
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => { if (code !== 0) reject(new Error(`Parser worker exited ${code}.`)); });
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}

for (const character of ['[', '<', '`']) {
  test(`raw-cap input with unmatched ${character} is rejected promptly`, async () => {
    const prefix = character === '`' ? 'Evidence ' : '';
    const markdown = prefix + character.repeat(LIMITS.markdownCharacters - prefix.length);
    const result = await timedParse(markdown);
    assert.equal(result.error?.name, 'TypeError');
    assert.match(result.error?.message ?? '', /Note exceeds.*raw characters/);
    assert.ok(result.durationMs < 2_500, `Parser took ${result.durationMs} ms for bounded invalid input.`);
  });
}

test('raw paragraph and bullet limits apply before markup is removed', () => {
  const oversizedMarkup = `<${'a'.repeat(LIMITS.noteCharacters)}>`;
  assert.throws(() => parseNotes(oversizedMarkup), /Note exceeds.*raw characters/);
  assert.throws(() => parseNotes(`- ${oversizedMarkup}`), /Note exceeds.*raw characters/);
  assert.throws(() => parseNotes(`- Label [short](https://example.invalid/${'a'.repeat(LIMITS.noteCharacters)})`), /Note exceeds.*raw characters/);
  assert.throws(() => parseNotes(`- ${'x'.repeat(6_000)}\n  <${'y'.repeat(6_000)}>`), /Note exceeds.*raw characters/);
});

test('the exact raw note cap is accepted and one extra character is rejected', () => {
  const exact = 'x'.repeat(LIMITS.noteCharacters);
  assert.equal(parseNotes(`- ${exact}`)[0].text, exact);
  assert.throws(() => parseNotes(`- ${exact}x`), /Note exceeds/);
  const removable = '<a>'.repeat(LIMITS.noteCharacters / 3);
  assert.deepEqual(parseNotes(removable), []);
  assert.throws(() => parseNotes(removable + '<a>'), /Note exceeds.*raw characters/);
});

test('many long valid notes stay bounded and retain all evidence', async () => {
  const bodies = Array.from({ length: LIMITS.notes }, (_, index) => `Release item ${index}: ${'a'.repeat(900)}`);
  const markdown = bodies.map(body => `- ${body}`).join('\n');
  assert.ok(markdown.length < LIMITS.markdownCharacters);
  const result = await timedParse(markdown);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.notes.map(note => note.text), bodies);
  assert.ok(result.durationMs < 2_500, `Parser took ${result.durationMs} ms for valid long notes.`);
});

test('long notes with unmatched delimiters use bounded cleanup scans', async () => {
  const body = `Evidence ${'['.repeat(4_700)}${'<'.repeat(4_700)}\``;
  const markdown = Array.from({ length: 20 }, () => `- ${body}`).join('\n');
  assert.ok(body.length < LIMITS.noteCharacters);
  assert.ok(markdown.length < LIMITS.markdownCharacters);
  const result = await timedParse(markdown);
  assert.equal(result.error, undefined);
  assert.equal(result.notes.length, 20);
  assert.ok(result.notes.every(note => note.text === body));
  assert.ok(result.durationMs < 2_500, `Parser took ${result.durationMs} ms for long unmatched delimiters.`);
});
