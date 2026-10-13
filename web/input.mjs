import { LIMITS, parseNotes, validateInputs } from '../src/audit.mjs';

export { LIMITS, validateInputs };

// JSON syntax and escaped strings need room beyond the canonical evidence budget.
// Bound raw input too, so parsing does not accept an arbitrarily large document.
export const MAX_CHANGES_INPUT_CHARACTERS = LIMITS.totalCharacters * 4;
const CHANGE_FIELDS = ['id', 'subject', 'body', 'files', 'breaking'];

function canonicalChange(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError(`changes[${index}] must be an object with id and subject strings.`);
  }
  const change = {};
  for (const field of CHANGE_FIELDS) {
    if (Object.hasOwn(row, field)) change[field] = row[field];
  }
  return change;
}

/** JSON canonical change rows, or one commit subject per nonempty line. */
export function parseChangesInput(text) {
  if (typeof text !== 'string') throw new TypeError('Changes input must be text. Paste JSON or one commit subject per line.');
  if (text.length > MAX_CHANGES_INPUT_CHARACTERS) {
    throw new TypeError(`Changes input exceeds ${MAX_CHANGES_INPUT_CHARACTERS} characters. Use a smaller release range.`);
  }
  const input = text.trim();
  let changes;
  try {
    if (input.startsWith('[') || input.startsWith('{')) {
      let rows;
      try { rows = JSON.parse(input); }
      catch {
        throw new TypeError('Invalid JSON. Use a JSON array with double-quoted field names and no trailing commas.');
      }
      if (!Array.isArray(rows)) throw new TypeError('JSON must be an array of changes, such as [{"id":"change-1","subject":"feat: add CSV export"}].');
      if (rows.length > LIMITS.changes) throw new TypeError(`Use at most ${LIMITS.changes} changes; choose a smaller release range.`);
      changes = rows.map(canonicalChange);
    } else {
      const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length > LIMITS.changes) throw new TypeError(`Use at most ${LIMITS.changes} nonempty commit lines; choose a smaller release range.`);
      changes = lines.map((subject, index) => ({ id: `change-${index + 1}`, subject }));
    }
    validateInputs({ changes, notes: [] });
    return changes;
  } catch (error) {
    throw new TypeError(`Changes input: ${error.message}`, { cause: error });
  }
}

/** Release-note Markdown uses exactly the same parser as the CLI audit. */
export function parseNoteInput(text) {
  try {
    const notes = parseNotes(text);
    validateInputs({ changes: [], notes });
    return notes;
  } catch (error) {
    throw new TypeError(`Release notes input: ${error.message}`, { cause: error });
  }
}

export const EXAMPLES = Object.freeze({
  ledgerfinch: Object.freeze({
    id: 'ledgerfinch',
    label: 'Ledger Finch release',
    description: 'Synthetic invoice app: paraphrased notes, an omitted reminder fix, a breaking API change, and an unrelated announcement.',
    changesText: `[
  {"id":"demo-export", "subject":"feat(export): download invoices as CSV", "body":"Customers can export invoice records to a CSV file for spreadsheet bookkeeping.", "files":["src/invoices/export.ts","tests/export.test.ts"]},
  {"id":"demo-payments", "subject":"fix(payments): prevent duplicate charges on webhook retries", "body":"Repeated payment provider callbacks now reuse the same transaction rather than creating a second charge.", "files":["src/payments/webhooks.ts"]},
  {"id":"demo-timezone", "subject":"fix(reminders): send invoice reminders in the customer's timezone", "body":"Scheduled email reminders respect the account's selected time zone instead of UTC.", "files":["src/reminders/scheduler.ts"]},
  {"id":"demo-api", "subject":"feat(api)!: remove legacy v1 invoice endpoint", "body":"BREAKING CHANGE: /api/v1/invoices is removed. Clients must migrate to /api/v2/invoices.", "files":["src/api/routes.ts"], "breaking":true},
  {"id":"demo-tests", "subject":"test(export): cover empty invoice CSV", "files":["tests/export.test.ts"]},
  {"id":"demo-docs", "subject":"docs: explain local development setup", "files":["CONTRIBUTING.md"]}
]
`,
    notesText: `# Ledger Finch 1.4 — synthetic release notes

## Added
- Save your billing records as a spreadsheet-friendly file.

## Fixed
- A repeated payment notification will no longer bill you twice.

## Changed
- The old invoice API has been retired. Integrations must switch to version 2.

## Also announced
- A new dark theme makes the dashboard easier to read at night.
`,
    suggestedNote: '- Invoice reminders now use the account\'s selected time zone instead of UTC.',
  }),
  'missing-note': Object.freeze({
    id: 'missing-note',
    label: 'Repair a missing note',
    description: 'Synthetic workspace app: add the omitted restoration note, then rerun to inspect the changed correspondence.',
    changesText: 'feat: Deleted workspaces can now be restored.\n',
    notesText: '# Workspace Pad 0.2 - synthetic release notes\n\n- You can enlarge editor text with a keyboard shortcut.\n',
    suggestedNote: '- Deleted workspaces can now be restored.',
  }),
});
