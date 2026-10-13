import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit.mjs';
import { renderReport } from '../src/report.mjs';
import { renderMarkdown } from '../src/cli.mjs';

const change = { id: 'change-a', subject: 'feat: improve exported reports' };
const note = (id, text = id) => ({ id, text });
const vector = (similarity) => [similarity, Math.sqrt(1 - similarity ** 2)];
const noEmbedding = async () => { throw new Error('Inference must be skipped.'); };

async function ranked(notes, similarities, options = {}) {
  return audit({
    changes: [change], notes,
    embed: async () => [[1, 0], ...similarities.map(vector)],
    ...options,
  });
}

function reportData(html) {
  const json = /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(json, 'Export must contain searchable evidence metadata.');
  return JSON.parse(json);
}

test('tied note scores preserve stable first and second evidence without associations', async () => {
  const report = await ranked([note('first'), note('second'), note('third')], [1, 1, 1]);
  const row = report.changes[0];
  assert.equal(row.status, 'review');
  assert.equal(row.match.noteId, 'first');
  assert.deepEqual(row.match.runnerUp, { noteId: 'second', text: 'second', score: 1 });
  assert.equal(row.match.margin, 0);
  assert.equal(row.match.ambiguous, true);
  assert.ok(report.notes.every((entry) => entry.matches.length === 0));
});

test('runner-up is the true second-highest note and remains evidence on a passed match', async () => {
  const report = await ranked([note('third'), note('best'), note('second')], [0.3, 0.95, 0.7]);
  const row = report.changes[0];
  assert.equal(row.status, 'matched');
  assert.equal(row.match.noteId, 'best');
  assert.deepEqual(row.match.runnerUp, { noteId: 'second', text: 'second', score: 0.7 });
  assert.equal(row.match.margin, 0.25);
  assert.equal(row.match.ambiguous, false);
  assert.deepEqual(report.notes.map((entry) => entry.matches), [[], ['change-a'], []]);
});

test('negative runner-up similarity is preserved rather than replaced by the one-note baseline', async () => {
  const report = await ranked([note('last'), note('best'), note('second')], [-0.9, 0.1, -0.2]);
  const row = report.changes[0];
  assert.equal(row.status, 'review');
  assert.equal(row.match.noteId, 'best');
  assert.equal(row.match.runnerUp.noteId, 'second');
  assert.equal(row.match.runnerUp.score, -0.2);
  assert.equal(row.match.margin, 0.3);
  assert.equal(row.match.ambiguous, false);
});

test('single-note scoring has no runner-up and explains a failed zero-baseline policy', async () => {
  const report = await ranked([note('only')], [0.6], { threshold: 0.48, margin: 0.8 });
  const row = report.changes[0];
  assert.equal(row.status, 'review');
  assert.equal(row.match.runnerUp, null);
  assert.equal(row.match.ambiguous, false);
  assert.equal(row.match.margin, 0.6);
  assert.match(row.reason, /zero-similarity baseline/);
  assert.doesNotMatch(row.reason, /Several notes/);
});

test('no-note and internal changes never invent scored runner-up evidence', async () => {
  const withoutNotes = await audit({ changes: [change], notes: [], embed: noEmbedding });
  assert.equal(withoutNotes.changes[0].match, null);
  const internal = await audit({ changes: [{ id: 'internal', subject: 'docs: clarify examples' }], notes: [note('unused')], embed: noEmbedding });
  assert.equal(internal.changes[0].status, 'internal');
  assert.equal(internal.changes[0].match, null);
});

test('ambiguity uses raw separation even when rounded gaps fall on the same boundary', async () => {
  const below = await ranked([note('best'), note('second')], [1, 0.9400002]);
  const above = await ranked([note('best'), note('second')], [1, 0.9399998]);
  assert.equal(below.changes[0].match.margin, 0.06);
  assert.equal(above.changes[0].match.margin, 0.06);
  assert.equal(below.changes[0].match.ambiguous, true);
  assert.equal(above.changes[0].match.ambiguous, false);
  assert.equal(below.changes[0].status, 'review');
  assert.equal(above.changes[0].status, 'matched');
});

test('breaking changes retain both close candidates without accepting either association', async () => {
  const report = await ranked([note('best'), note('second')], [1, 0.98], { changes: [{ ...change, subject: 'feat(api)!: change export format' }] });
  const row = report.changes[0];
  assert.equal(row.status, 'review');
  assert.equal(row.priority, 'high');
  assert.equal(row.match.runnerUp.noteId, 'second');
  assert.equal(row.match.runnerUp.score, 0.98);
  assert.equal(row.match.ambiguous, true);
  assert.ok(report.notes.every((entry) => entry.matches.length === 0));
  assert.ok(report.notes.every((entry) => entry.reviewMatches.length === 0 && entry.status === 'unlinked'));
});

test('a strong breaking candidate is related note evidence requiring review', async () => {
  const report = await ranked([note('best'), note('second')], [1, 0.5], { changes: [{ ...change, subject: 'feat(api)!: change export format' }] });
  assert.equal(report.changes[0].status, 'review');
  assert.deepEqual(report.notes[0].matches, []);
  assert.deepEqual(report.notes[0].reviewMatches, ['change-a']);
  assert.equal(report.notes[0].status, 'review');
  assert.deepEqual(report.notes[1].reviewMatches, []);
  assert.equal(report.notes[1].status, 'unlinked');
  assert.deepEqual(JSON.parse(JSON.stringify(report)).notes[0].reviewMatches, ['change-a']);
});

test('weak breaking candidates remain unlinked', async () => {
  const report = await ranked([note('best'), note('second')], [0.2, 0.1], { changes: [{ ...change, breaking: true }] });
  assert.equal(report.changes[0].status, 'review');
  assert.ok(report.notes.every((entry) => entry.matches.length === 0 && entry.reviewMatches.length === 0 && entry.status === 'unlinked'));
});

test('breaking note evidence uses raw policy separation before scores are rounded', async () => {
  const options = { changes: [{ ...change, breaking: true }] };
  const below = await ranked([note('best'), note('second')], [1, 0.9400002], options);
  const above = await ranked([note('best'), note('second')], [1, 0.9399998], options);
  assert.equal(below.changes[0].match.margin, 0.06);
  assert.equal(above.changes[0].match.margin, 0.06);
  assert.deepEqual(below.notes[0].reviewMatches, []);
  assert.deepEqual(above.notes[0].reviewMatches, ['change-a']);
  assert.equal(below.notes[0].status, 'unlinked');
  assert.equal(above.notes[0].status, 'review');
});

test('a note can retain accepted associations and strong breaking evidence separately', async () => {
  const report = await audit({
    changes: [{ ...change, id: 'accepted' }, { ...change, id: 'breaking', breaking: true }],
    notes: [note('best'), note('second')],
    embed: async () => [[1, 0], [1, 0], [1, 0], [0, 1]],
  });
  assert.equal(report.notes[0].status, 'matched');
  assert.deepEqual(report.notes[0].matches, ['accepted']);
  assert.deepEqual(report.notes[0].reviewMatches, ['breaking']);
  assert.equal(report.changes[0].status, 'matched');
  assert.equal(report.changes[1].status, 'review');
});

test('HTML escapes related breaking-change IDs within note review evidence', async () => {
  const hostileId = 'breaking-<img src=x onerror="alert(1)">';
  const report = await ranked([note('only', 'A strong related release note.')], [1], { changes: [{ ...change, id: hostileId, breaking: true }] });
  const html = renderReport(report);
  const noteCard = [...html.matchAll(/<article\b[^>]*\bclass="note-card[^"]*"[^>]*>[\s\S]*?<\/article>/g)]
    .map((entry) => entry[0]).find((block) => block.includes('A strong related release note.'));
  assert.ok(noteCard);
  assert.match(noteCard, /breaking-&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(noteCard, /review/i);
  assert.doesNotMatch(noteCard, /<img\b/);
  assert.match(html, /1 release note(?:s)?[^<]*[·-]\s*0 unlinked/);
});

test('CLI Markdown preserves and escapes related breaking-change IDs in note evidence', async () => {
  const hostileId = 'breaking-<img src=x onerror="alert(1)">';
  const report = await ranked([note('only', 'A strong related release note.')], [1], { changes: [{ ...change, id: hostileId, breaking: true }] });
  report.model = { id: 'test-model', revision: 'test-revision' };
  const markdown = renderMarkdown(report);
  assert.ok(markdown.includes('breaking-\\<img src=x onerror="alert(1)"\\>'));
  assert.equal(markdown.includes(hostileId), false);
});

test('HTML escapes hostile runner-up evidence and makes that evidence searchable', async () => {
  const hostileId = 'runner-<img src=x onerror="alert(1)">';
  const hostileText = '</script><script>globalThis.pwned=true</script> & runner-only evidence';
  const report = await ranked([note('best', 'Closest report note.'), note(hostileId, hostileText)], [1, 0.98]);
  const html = renderReport(report);
  const candidateDetails = [...html.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)]
    .map((entry) => entry[0]).find((block) => block.includes('runner-only evidence'));
  assert.ok(candidateDetails, 'Runner-up evidence must be shown in its own disclosure.');
  assert.match(candidateDetails, /^<details\b[^>]*\bopen(?:\s|>)/);
  assert.match(candidateDetails, /runner-&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(candidateDetails, /&lt;\/script&gt;&lt;script&gt;globalThis\.pwned=true&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>globalThis\.pwned=true<\/script>/);
  assert.equal([...html.matchAll(/<script\b/g)].length, 2);
  const search = reportData(html)[0].search;
  assert.ok(search.includes(hostileId.toLocaleLowerCase('en-US')));
  assert.ok(search.includes(hostileText.toLocaleLowerCase('en-US')));
});

test('HTML keeps a separated runner-up available in a collapsed disclosure', async () => {
  const report = await ranked([note('best', 'Closest report note.'), note('second', 'Unique separated runner-up evidence.')], [1, 0.7]);
  const html = renderReport(report);
  const candidateDetails = [...html.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)]
    .map((entry) => entry[0]).find((block) => block.includes('Unique separated runner-up evidence.'));
  assert.ok(candidateDetails);
  assert.doesNotMatch(candidateDetails.split('>')[0], /\bopen\b/);
  assert.ok(reportData(html)[0].search.includes('unique separated runner-up evidence.'));
});

test('CLI Markdown preserves the runner-up ID, text, similarity, and gap', async () => {
  const report = await ranked([note('best', 'Closest report note.'), note('second', 'Separate runner evidence')], [0.9, 0.82]);
  report.model = { id: 'test-model', revision: 'test-revision' };
  const markdown = renderMarkdown(report);
  assert.match(markdown, /second/);
  assert.match(markdown, /Separate runner evidence/);
  assert.match(markdown, /0\.82(?:0)?/);
  assert.match(markdown, /0\.08(?:0)?/);
});
