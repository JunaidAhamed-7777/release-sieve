import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { audit, parseNotes } from '../src/audit.mjs';
import { EXAMPLES, LIMITS, MAX_CHANGES_INPUT_CHARACTERS, parseChangesInput, parseNoteInput, validateInputs } from '../web/input.mjs';

test('plain commit lines ignore blanks and receive stable sequential IDs', () => {
  const input = '  feat: add CSV export\r\n\r\n  fix: avoid duplicate charges \n  \n';
  assert.deepEqual(parseChangesInput(input), [
    { id: 'change-1', subject: 'feat: add CSV export' },
    { id: 'change-2', subject: 'fix: avoid duplicate charges' },
  ]);
  assert.deepEqual(parseChangesInput(' \n\r\n '), []);
});

test('canonical JSON preserves flat evidence while dropping untrusted result and nested fields', () => {
  const input = String.raw`[{"id":"commit-1","subject":"  feat: export invoices  ","body":"Keep this evidence.\n","files":["src/export.ts"],"breaking":false,"change":{"id":"forged","subject":"forged"},"status":"matched","match":{"score":1},"__proto__":{"polluted":true}}]`;
  assert.deepEqual(parseChangesInput(input), [{
    id: 'commit-1', subject: '  feat: export invoices  ', body: 'Keep this evidence.\n', files: ['src/export.ts'], breaking: false,
  }]);
  assert.equal({}.polluted, undefined);
});

test('hostile strings stay inert canonical evidence', () => {
  const subject = 'feat: <img src=x onerror=alert(1)> ${globalThis.pwned=true}';
  const rows = parseChangesInput(JSON.stringify([{ id: '__proto__', subject, files: ['</script>'] }]));
  assert.equal(rows[0].subject, subject);
  assert.equal(rows[0].id, '__proto__');
  assert.deepEqual(rows[0].files, ['</script>']);
  assert.equal(globalThis.pwned, undefined);
});

test('malformed JSON and noncanonical rows produce actionable input errors', () => {
  for (const [input, expected] of [
    ['[{"id":"a","subject":"feat: x",}]', /Changes input: Invalid JSON/],
    ['{"changes":[]}', /Changes input: JSON must be an array/],
    ['[null]', /changes\[0\] must be an object/],
    ['[[]]', /changes\[0\] must be an object/],
    ['["feat: x"]', /changes\[0\] must be an object/],
    ['[{"change":{"id":"a","subject":"feat: x"}}]', /changes\[0\]\.id/],
    ['[{"id":"a","subject":{"text":"feat: x"}}]', /changes\[0\]\.subject/],
    ['[{"id":"a","subject":"feat: x","breaking":"false"}]', /breaking must be a boolean/],
    ['[{"id":"a","subject":"feat: x","files":[{"path":"src/a"}]}]', /files entry/],
    ['[{"id":"a","subject":"feat: x"},{"id":"a","subject":"fix: y"}]', /duplicate id/],
  ]) assert.throws(() => parseChangesInput(input), expected);
  assert.throws(() => parseChangesInput(null), /Changes input must be text/);
});

test('raw input, row count, subject, and total evidence limits are enforced before worker use', () => {
  assert.throws(() => parseChangesInput('x'.repeat(MAX_CHANGES_INPUT_CHARACTERS + 1)), /Changes input exceeds/);
  assert.throws(() => parseChangesInput('feat: x\n'.repeat(LIMITS.changes + 1)), /at most 500 nonempty commit lines/);
  assert.throws(() => parseChangesInput(JSON.stringify(Array.from({ length: LIMITS.changes + 1 }, (_, i) => ({ id: String(i), subject: 'feat: x' })))), /at most 500 changes/);
  assert.throws(() => parseChangesInput('x'.repeat(LIMITS.subjectCharacters + 1)), /changes\[0\]\.subject/);
  const changes = parseChangesInput(JSON.stringify(Array.from({ length: 27 }, (_, i) => ({ id: String(i), subject: 'feat: x', body: 'c'.repeat(LIMITS.bodyCharacters) }))));
  const notes = parseNoteInput(Array.from({ length: 16 }, () => `- ${'n'.repeat(11_400)}`).join('\n'));
  assert.throws(() => validateInputs({ changes, notes }), /total characters/);
  assert.throws(() => validateInputs({ changes: [], notes: [], threshold: Infinity }), /threshold/);
});

test('release-note parsing is shared with core and rejects oversized or malformed inputs', () => {
  const markdown = '# 0.2\n\n- **Download CSV** using [Export](https://example.invalid).\n\n```text\n- ignore this example\n```\n';
  assert.deepEqual(parseNoteInput(markdown), parseNotes(markdown));
  assert.deepEqual(parseNoteInput(''), []);
  assert.throws(() => parseNoteInput(null), /Release notes input: markdown/);
  assert.throws(() => parseNoteInput('x'.repeat(LIMITS.markdownCharacters + 1)), /Release notes input: markdown/);
  assert.throws(() => parseNoteInput('- note\n'.repeat(LIMITS.notes + 1)), /Release notes input: Markdown exceeds/);
});

test('Ledger Finch example content stays aligned with the checked-in synthetic fixtures', async () => {
  const changes = await readFile(new URL('../demo/changes.json', import.meta.url), 'utf8');
  const notes = await readFile(new URL('../demo/notes.md', import.meta.url), 'utf8');
  const lf = (text) => text.replace(/\r\n/g, '\n');
  assert.equal(lf(EXAMPLES.ledgerfinch.changesText), lf(changes));
  assert.equal(lf(EXAMPLES.ledgerfinch.notesText), lf(notes));
  assert.equal(parseChangesInput(EXAMPLES.ledgerfinch.changesText).length, 6);
  assert.equal(parseNoteInput(EXAMPLES.ledgerfinch.notesText).length, 4);
});

test('missing-note example supplies a valid append-only repair and reaches matching with explicit test vectors', async () => {
  const example = EXAMPLES['missing-note'];
  const changes = parseChangesInput(example.changesText);
  const initialNotes = parseNoteInput(example.notesText);
  const repairedNotes = parseNoteInput(`${example.notesText}\n${example.suggestedNote}\n`);
  assert.equal(initialNotes.length, 1);
  assert.equal(repairedNotes.length, 2);
  assert.equal(repairedNotes[1].text, changes[0].subject.replace(/^feat: /, ''));
  // These vectors test the repair workflow; actual model behavior is verified separately.
  const initial = await audit({ changes, notes: initialNotes, embed: async () => [[1, 0], [0, 1]] });
  const repaired = await audit({ changes, notes: repairedNotes, embed: async () => [[1, 0], [0, 1], [1, 0]] });
  assert.equal(initial.changes[0].status, 'review');
  assert.equal(repaired.changes[0].status, 'matched');
  assert.equal(repaired.changes[0].match.noteId, 'note-2');
});
