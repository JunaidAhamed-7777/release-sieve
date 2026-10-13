# Release Sieve audit

3 need review · 1 semantic matches · 2 internal suggestions

Similarity is advisory, not confidence or proof. Breaking changes always need review.

| Change | Status | Closest note | Similarity | Reason |
| --- | --- | --- | --- | --- |
| demo-export: feat(export): download invoices as CSV | review | Save your billing records as a spreadsheet-friendly file. | 0.591 | Several notes have similar scores; inspect the closest candidates. |
| demo-payment: fix(payments): prevent duplicate charges on webhook retries | matched | A repeated payment notification will no longer bill you twice. | 0.543 | Closest note passed similarity and separation checks; inspect its wording before publishing. |
| demo-timezon: fix(reminders): send invoice reminders in the customer's timezone | review | The old invoice API has been retired. Integrations must switch to version 2. | 0.314 | Closest note is below the semantic similarity threshold. |
| demo-api: feat(api)!: remove legacy v1 invoice endpoint | review | The old invoice API has been retired. Integrations must switch to version 2. | 0.647 | Breaking change requires human review, even when a note looks related. |
| demo-tests: test(export): cover empty invoice CSV | internal | — | — | Conventional commit type "test" is treated as internal; confirm this heuristic fits the change. |
| demo-docs: docs: explain local development setup | internal | — | — | Conventional commit type "docs" is treated as internal; confirm this heuristic fits the change. |

Model: Xenova/all-MiniLM-L6-v2@751bff37182d3f1213fa05d7196b954e230abad9; q8 CPU; local files only.
