# Release Sieve audit

3 need review · 1 semantic matches · 2 internal suggestions

Similarity is advisory, not confidence or proof. Breaking changes always need review.

| Change | Status | Closest note | Similarity | Reason |
| --- | --- | --- | --- | --- |
| demo-export: feat(export): download invoices as CSV | review | Save your billing records as a spreadsheet-friendly file. | 0.591101 | Several notes have similar scores; compare the closest and runner-up candidates. |
| demo-payment: fix(payments): prevent duplicate charges on webhook retries | matched | A repeated payment notification will no longer bill you twice. | 0.543327 | Closest note passed similarity and separation checks; inspect its wording before publishing. |
| demo-timezon: fix(reminders): send invoice reminders in the customer's timezone | review | The old invoice API has been retired. Integrations must switch to version 2. | 0.31419 | Closest note is below the semantic similarity threshold. |
| demo-api: feat(api)!: remove legacy v1 invoice endpoint | review | The old invoice API has been retired. Integrations must switch to version 2. | 0.647449 | Breaking change requires human review, even when a note looks related. |
| demo-tests: test(export): cover empty invoice CSV | internal | — | — | Conventional commit type "test" is treated as internal; confirm this heuristic fits the change. |
| demo-docs: docs: explain local development setup | internal | — | — | Conventional commit type "docs" is treated as internal; confirm this heuristic fits the change. |

## Candidate comparisons

### demo-export

Closest note (note-1): Save your billing records as a spreadsheet-friendly file.

Similarity: 0.591101. Top-two gap: 0.058622.

Runner-up note (note-3): The old invoice API has been retired. Integrations must switch to version 2.

Runner-up similarity: 0.532479. The top-two gap is below the review policy; neither candidate is an accepted association.

### demo-payments

Closest note (note-2): A repeated payment notification will no longer bill you twice.

Similarity: 0.543327. Top-two gap: 0.275476.

Runner-up note (note-3): The old invoice API has been retired. Integrations must switch to version 2.

Runner-up similarity: 0.267851.

### demo-timezone

Closest note (note-3): The old invoice API has been retired. Integrations must switch to version 2.

Similarity: 0.31419. Top-two gap: 0.090025.

Runner-up note (note-2): A repeated payment notification will no longer bill you twice.

Runner-up similarity: 0.224165.

### demo-api

Closest note (note-3): The old invoice API has been retired. Integrations must switch to version 2.

Similarity: 0.647449. Top-two gap: 0.459894.

Runner-up note (note-2): A repeated payment notification will no longer bill you twice.

Runner-up similarity: 0.187555.

## Release notes

- note-1: Save your billing records as a spreadsheet-friendly file. (unlinked)
- note-2: A repeated payment notification will no longer bill you twice. (Associated changes: demo-payments)
- note-3: The old invoice API has been retired. Integrations must switch to version 2. (Related evidence, still requires review: demo-api)
- note-4: A new dark theme makes the dashboard easier to read at night. (unlinked)

Model: Xenova/all-MiniLM-L6-v2@751bff37182d3f1213fa05d7196b954e230abad9; q8 CPU; local files only.
