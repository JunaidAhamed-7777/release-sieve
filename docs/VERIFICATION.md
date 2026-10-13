# Verification record — 2026-10-13

The recorded environment ran Windows x64, Node **26.8.1**, npm **11.19.0**, and Git **2.56.0.windows.2**. The test inputs were synthetic. These are actual local verification results, not production accuracy or performance claims.

| Command | Observed result |
| --- | --- |
| `npm test` | **49/49 pass**, no skips |
| `npm run test:model` | 384-dimensional finite normalized vectors; paraphrase similarity 0.752506 versus unrelated 0.006754; one overlong input detected; `fetch` forbidden during inference |
| `npm run demo` | 6 synthetic changes / 4 notes; **3 review, 1 matched, 2 internal**; no truncation |
| `npm run test:e2e` | Real synthetic Git range → local model → HTML/JSON/Markdown; review exit 2; source status unchanged; output overwrite refused |
| `npm run test:browser` | Real Edge keyboard filters, search, empty state, 1280/390px widths without horizontal overflow; zero page requests and JavaScript errors |

Evidence: [model verification](../demo/model-verification.json), [Git e2e](../demo/git-e2e-verification.json), [browser verification](../demo/browser-verification.json), [synthetic audit](../demo/output/audit.json), [desktop](../demo/report-desktop.png), [mobile](../demo/report-mobile.png).

Unit tests include malformed vectors, bounded inputs, ambiguity, breaking markers, inherited Git directory settings, a configured GPG-helper regression, partial-clone missing objects with no fetch, oversized Git messages rejected during collection, Unicode preservation, canonical HTML evidence, hostile script delimiters, and CLI preflight errors.

Bootstrap fetched only the four revision-pinned, public, ungated Hugging Face model files and verified each hash. npm packages came from the official registry with install scripts disabled. Model weights/native binaries are not included in the source repository. The optional browser check used an already-installed browser with a temporary profile and Chromium sandbox enabled.

Tests use OS temporary paths by default. Set `RELEASE_SIEVE_TEST_TMP` to a writable temporary directory if the default is unavailable. Browser checks use a temporary profile and do not require an existing profile.

The synthetic CSV match is intentionally left as the observed near-threshold review result. No threshold was adjusted to force a prettier demo. Scores identify candidate relationships and do not establish that notes accurately describe code. No external user trial, measured time savings, payment, revenue, or broad accuracy evaluation has been performed.
