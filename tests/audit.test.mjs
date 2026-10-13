import test from 'node:test';
import assert from 'node:assert/strict';
import { audit, embeddingText, isBreaking, LIMITS, parseNotes, validateInputs } from '../src/audit.mjs';

const change = (id, subject, extra = {}) => ({ id, subject, ...extra });
const note = (id, text) => ({ id, text });
const noEmbedding = async () => { throw new Error('embed should not be called'); };

test('semantic ranking links distinct changes without relying on shared words', async () => {
  const changes = [change('a', 'feat: let users undo a mistaken import'), change('b', 'fix: avoid stale session tokens')];
  const notes = [note('n1', 'Imported records can now be rolled back.'), note('n2', 'Signing in stays reliable after refreshing credentials.')];
  const inputs = structuredClone({ changes, notes });
  let embedded;
  const report = await audit({ changes, notes, embed: async (texts) => { embedded = texts; return [[5, 0], [0, 5], [1, 0], [0, 1]]; } });
  assert.deepEqual(embedded, ['let users undo a mistaken import', 'avoid stale session tokens', ...notes.map((row) => row.text)]);
  assert.deepEqual(report.summary, { changes: 2, notes: 2, needsReview: 0, matched: 2, internal: 0 });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.changes[0].match.noteId, 'n1');
  assert.equal(report.changes[0].match.score, 1);
  assert.equal(report.changes[0].match.margin, 1);
  assert.deepEqual(report.notes.map((row) => row.matches), [['a'], ['b']]);
  assert.deepEqual({ changes, notes }, inputs, 'audit must not mutate caller data');
});

test('an omitted change is flagged and its weak closest note is retained', async () => {
  const report = await audit({ changes: [change('a', 'feat: add encrypted backups')], notes: [note('n', 'Faster search results.')], embed: async () => [[1, 0], [0, 1]] });
  assert.equal(report.changes[0].status, 'review');
  assert.equal(report.changes[0].match.score, 0);
  assert.match(report.changes[0].reason, /below/);
  assert.equal(report.notes[0].status, 'unlinked');
  assert.deepEqual(report.notes[0].matches, []);
});

test('two plausible notes require human review despite a high best similarity', async () => {
  const report = await audit({ changes: [change('a', 'feat: add export filters')], notes: [note('n1', 'Filter exported reports.'), note('n2', 'Customize exported reports.')], embed: async () => [[1, 0], [1, 0], [0.999, 0.02]] });
  assert.equal(report.changes[0].status, 'review');
  assert.equal(report.changes[0].match.noteId, 'n1');
  assert.ok(report.changes[0].match.margin < report.margin);
  assert.match(report.changes[0].reason, /similar scores/);
  assert.ok(report.notes.every((row) => row.status === 'unlinked'));
});

test('exact score ties choose the first note deterministically and remain review', async () => {
  const report = await audit({ changes: [change('a', 'feat: improve reports')], notes: [note('z', 'Reports are improved.'), note('a', 'Better reports.')], embed: async () => [[1, 0], [1, 0], [1, 0]] });
  assert.equal(report.changes[0].match.noteId, 'z');
  assert.equal(report.changes[0].match.margin, 0);
  assert.equal(report.changes[0].status, 'review');
});

test('breaking changes require review even with an exact semantic match', async () => {
  const changes = [change('a', 'refactor(api)!: drop v1 routes'), change('b', 'feat: change account IDs', { body: 'BREAKING CHANGE: Account IDs are now strings.' }), change('c', 'chore: remove old config', { breaking: true })];
  const report = await audit({ changes, notes: [note('n', 'These changes require migration.')], embed: async () => [[1], [1], [1], [1]] });
  assert.equal(report.summary.needsReview, 3);
  assert.equal(report.summary.internal, 0);
  assert.ok(report.changes.every((row) => row.status === 'review' && row.priority === 'high' && row.match.score === 1));
  assert.deepEqual(report.notes[0].matches, []);
});

test('conventional internal types are excluded from embeddings and explicitly explained', async () => {
  const changes = ['docs', 'test', 'build', 'chore', 'ci', 'style', 'refactor'].map((type) => change(type, `${type}(core): maintain internals`));
  const report = await audit({ changes, notes: [note('n', 'A release note.')], embed: noEmbedding });
  assert.equal(report.summary.internal, 7);
  assert.ok(report.changes.every((row) => row.status === 'internal' && row.match === null && /heuristic/.test(row.reason)));
  assert.equal(report.notes[0].status, 'unlinked');
  assert.equal(isBreaking(change('x', 'docs: describe migration', { breaking: true })), true);
  assert.equal(isBreaking(change('x', 'fix(api)!: change protocol')), true);
  assert.equal(isBreaking(change('x', 'fix: change protocol', { body: 'Details\nBREAKING-CHANGE: upgrade clients' })), true);
});

test('nonconventional commits and performance changes remain eligible', async () => {
  const report = await audit({ changes: [change('a', 'Add a new editor'), change('b', 'perf: speed up search')], notes: [], embed: noEmbedding });
  assert.equal(report.summary.needsReview, 2);
  assert.equal(report.summary.internal, 0);
  assert.ok(report.changes.every((row) => row.match === null));
});

test('empty inputs skip inference and return a valid report', async () => {
  const report = await audit({ changes: [], notes: [], embed: noEmbedding });
  assert.deepEqual(report.summary, { changes: 0, notes: 0, needsReview: 0, matched: 0, internal: 0 });
  assert.deepEqual(report.changes, []);
  assert.deepEqual(report.notes, []);
});

test('body context is embedded but filenames are evidence only', async () => {
  let embedded;
  await audit({ changes: [change('a', 'fix: retry failed requests', { body: 'Only retry transient failures.', files: ['src/network.js'] })], notes: [note('n', 'Transient errors now recover automatically.')], embed: async (texts) => { embedded = texts; return [[1], [1]]; } });
  assert.equal(embedded[0], 'retry failed requests\n\nOnly retry transient failures.');
  assert.equal(embedded.some((text) => text.includes('src/network.js')), false);
});

test('single-note margin uses zero baseline and thresholds are configurable', async () => {
  const report = await audit({ changes: [change('a', 'feat: editor')], notes: [note('n', 'Editor.')], threshold: 0.7, margin: 0.6, embed: async () => [[1, 0], [3, 4]] });
  assert.equal(report.changes[0].match.score, 0.6);
  assert.equal(report.changes[0].match.margin, 0.6);
  assert.equal(report.changes[0].status, 'review');
  assert.equal(report.threshold, 0.7);
  assert.equal(report.margin, 0.6);
});

test('typed vectors with extreme finite values normalize safely', async () => {
  const report = await audit({ changes: [change('a', 'feat: editor')], notes: [note('n', 'Editor.')], embed: async () => [new Float64Array([1e300, 1e300]), new Float64Array([1e-300, 1e-300])] });
  assert.equal(report.changes[0].match.score, 1);
  assert.equal(report.changes[0].status, 'matched');
});

for (const [name, vectors] of [
  ['wrong count', [[1]]],
  ['mismatched dimensions', [[1], [1, 2]]],
  ['zero magnitude', [[0, 0], [1, 0]]],
  ['nonfinite number', [[Infinity], [1]]],
  ['numeric strings', [['1'], [1]]],
  ['empty vector', [[], []]],
]) {
  test(`invalid embedding: ${name}`, async () => {
    await assert.rejects(audit({ changes: [change('a', 'feat: editor')], notes: [note('n', 'Editor.')], embed: async () => vectors }), TypeError);
  });
}

test('invalid rows, options, and duplicate IDs are rejected before inference', async () => {
  const valid = { changes: [change('a', 'feat: editor')], notes: [note('n', 'Editor.')], embed: noEmbedding };
  for (const overrides of [
    { changes: null }, { notes: {} }, { changes: [null] }, { changes: [change('a', ' ')] },
    { changes: [change('a', 'feat: editor', { breaking: 'yes' })] },
    { changes: [change('a', 'feat: editor', { files: [''] })] },
    { changes: [change('a', 'feat: editor'), change('a', 'fix: editor')] },
    { notes: [note('n', 'Editor.'), note('n', 'Duplicate.')] },
    { threshold: -0.1 }, { threshold: NaN }, { margin: 2 }, { embed: null },
  ]) await assert.rejects(audit({ ...valid, ...overrides }), TypeError);
});

test('input counts, text size, and aggregate budget are bounded', async () => {
  await assert.rejects(audit({ changes: Array.from({ length: LIMITS.changes + 1 }, (_, i) => change(String(i), 'fix: x')), notes: [], embed: noEmbedding }), /at most/);
  await assert.rejects(audit({ changes: [], notes: [note('n', 'x'.repeat(LIMITS.noteCharacters + 1))], embed: noEmbedding }), /at most/);
  await assert.rejects(audit({ changes: [], notes: Array.from({ length: 43 }, (_, i) => note(String(i), 'x'.repeat(LIMITS.noteCharacters))), embed: noEmbedding }), /total characters/);
});

test('input preflight needs no embedding backend and conventional prefixes do not affect semantic text', () => {
  assert.deepEqual(validateInputs({ changes: [], notes: [] }), { changes: [], notes: [], threshold: 0.48, margin: 0.06 });
  assert.throws(() => validateInputs({ changes: [], notes: [], threshold: Infinity }), /threshold/);
  assert.equal(embeddingText(change('a', 'feat(api)!: change protocol', { body: 'Migrate clients.' })), 'change protocol\n\nMigrate clients.');
  assert.equal(embeddingText(change('b', 'A regular commit subject')), 'A regular commit subject');
});

test('markdown parsing strips headings, markup, links, tasks and fenced examples', () => {
  const notes = parseNotes('# 1.2.0\n\n## Added\n- **Undo imports** with [one click](https://example.invalid/undo).\n  Works for CSV too.\n- [x] Keep `session tokens` fresh.\n\n```js\n- this example is not a release note\n```\n\n## Fixed\n1. _Faster search_ after refreshing.\n\nA standalone release note.\n\n[ref]: https://example.invalid');
  assert.deepEqual(notes, [
    note('note-1', 'Undo imports with one click. Works for CSV too.'),
    note('note-2', 'Keep session tokens fresh.'),
    note('note-3', 'Faster search after refreshing.'),
    note('note-4', 'A standalone release note.'),
  ]);
});

test('markdown note and text limits are enforced', () => {
  assert.deepEqual(parseNotes('## Empty\n\n'), []);
  assert.throws(() => parseNotes(null), TypeError);
  assert.throws(() => parseNotes('x'.repeat(LIMITS.markdownCharacters + 1)), /at most/);
  assert.throws(() => parseNotes('- x\n'.repeat(LIMITS.notes + 1)), /notes/);
  assert.throws(() => parseNotes(`- ${'x'.repeat(LIMITS.noteCharacters + 1)}`), /Note exceeds/);
});
