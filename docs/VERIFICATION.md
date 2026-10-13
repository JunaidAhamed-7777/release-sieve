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

Bootstrap fetched only the four revision-pinned, public, ungated Hugging Face model files and verified each hash. npm packages came from the official registry with install scripts disabled. The browser distribution includes the pinned model weights and WASM runtime; the CLI cache and native binaries are not committed. The optional browser check used an already-installed browser with a temporary profile and Chromium sandbox enabled.

Tests use OS temporary paths by default. Set `RELEASE_SIEVE_TEST_TMP` to a writable temporary directory if the default is unavailable. Browser checks use a temporary profile and do not require an existing profile.

The synthetic CSV match is intentionally left as the observed near-threshold review result. No threshold was adjusted to force a prettier demo. Scores identify candidate relationships and do not establish that notes accurately describe code. No external user trial, measured time savings, payment, revenue, or broad accuracy evaluation has been performed.

## Browser workbench verification

The expanded `npm test` suite passes **65/65** with no skips; the real CLI Git-to-report check also passes.

`npm run build:web` creates a self-hosted browser distribution with a pinned model, single-threaded WASM runtime, artifact hash inventory, and preserved licenses. The inference assets total **37,974,266 bytes**. The browser bundle excludes native Node and image-processing dependencies.

`npm run test:web` starts its own loopback server and runs a real browser with real WASM inference. It checks the Ledger Finch **3 review / 1 matched / 2 internal** result, loaded-model reuse with networking disabled, a missing-note edit that changes the result, local JSON/Markdown file loading, three export formats, keyboard filters/search, desktop/mobile overflow, malformed input rejection before model requests, Clear, worker cancellation/restart, and recovery from a fixed-asset HTTP error. It also delays a real file read to verify that Review waits and Clear invalidates the pending read.

Network checks inspect HTTP requests separately from local Blob download events. Only fixed same-origin asset GETs are allowed; a unique synthetic input marker is absent from request URLs and bodies. No draft entries appear in localStorage or sessionStorage; CacheStorage contains only the six public model/runtime assets.

The [browser workflow record](../demo/web-verification.json) contains actual run diagnostics and assertions. [Desktop](../demo/web-desktop.png) and [mobile](../demo/web-mobile.png) screenshots show only the synthetic example. Browser WASM and native CPU numerical scores can differ; both keep similarity and separation as advisory review policies. These checks establish the tested workflows, not general accuracy or a performance benchmark.

## Deployed app verification

A fresh Edge browser profile loaded the public GitHub Pages app with HTTP 200 and ran the default synthetic example through the actual WASM model. It downloaded exactly 37,974,266 bytes of model/runtime assets and exported the expected 3 review / 1 matched / 2 internal result. The run had no JavaScript errors and used only same-origin HTTP GET requests. The [deployed-site record](../demo/public-verification.json) identifies the tested commit and diagnostic timing; it is one observed run, not an accuracy or speed benchmark.

The [CI run for the browser upgrade](https://github.com/JunaidAhamed-7777/release-sieve/actions/runs/38440982762) passed on Windows and Ubuntu with Node 22 and 26. Each job ran unit tests, model bootstrap, browser build, fetch-forbidden native model verification, and Git end-to-end verification. The [Pages deployment](https://github.com/JunaidAhamed-7777/release-sieve/actions/runs/38440980697) also succeeded. Browser workflow checks were run locally against the same built app; the CI matrix does not itself run browser automation.

## Evidence and parser regression verification

The latest `npm test` run passes **100/100**, with no failures or skips. New regressions cover real runner-up ranking and deterministic ties, unrounded policy boundaries, strong breaking-change related evidence without accepting the change, literal inline-code preservation, nested fence exclusion, and multiline Markdown metadata that cannot forge report status. Parser deadline tests run in terminable workers and check both malformed 200,000-character input and valid long notes; they are regression bounds rather than product performance claims.

`npm run demo` and `npm run test:e2e` pass with real native model inference. The regenerated synthetic reports retain the 3 review / 1 matched / 2 internal result and now include candidate comparisons and related breaking-change evidence. `npm run test:browser` passes keyboard/search and 1280/390px layout checks on the regenerated standalone HTML.

`npm run test:web` passes against the rebuilt browser app with actual WASM inference. The [workflow record](../demo/web-verification.json) includes expanded runner-up evidence, related breaking-change note labels, export contents, singular counts, policy-field focus, generic types preserved through encoding, Markdown status-spoofing prevention, responsive malformed-input preview, concurrent/latest/edit-during-upload races, plus the existing model/network/cancellation/error-recovery checks. Updated screenshots use a synthetic release at 1440px and 390px widths; a narrow viewport is not physical mobile-device certification.

`npm run test:web:cache` passes four actual inference runs: cold loading, a fresh worker after page reload using six independently hash-checked cached assets with zero download bytes, same-length config corruption replaced with only the pinned 650-byte config download, and a controlled worker-only CacheStorage-open denial using verified assets in memory. No drafts were found in localStorage, sessionStorage, IndexedDB, or CacheStorage. HTTP requests were same-origin GETs without bodies and no JavaScript errors were observed. The [cache record](../demo/web-cache-verification.json) describes the controlled failure and its scope; it does not certify every browser storage failure mode.
