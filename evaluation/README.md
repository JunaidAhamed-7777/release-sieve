# Release Sieve: frozen synthetic evaluation

This diagnostic evaluation tests correspondence and review decisions on **48 author-constructed English synthetic mini-releases**. Labels are specifications with readable rationales, not independent human annotations. The proportions were deliberately chosen; these are not estimates of deployed error rates, customer savings, or business demand.

The protocol, exact input bytes, scoring code and existing product/model state were frozen before inference in commit **c23a14b7112c73168661ea46d97cfe646d43ccf0**, at 2026-10-13T18:53:30.088Z. Evaluation SHA-256: `390e59e5f65b76fcc0944b5881f0613508afbf03cf1720d6dbf04ce03e3763c1`. [Freeze inventory](freeze.json), [full protocol](PROTOCOL.md), [fixture specifications](FIXTURES.md), [all labels](fixtures.json).

## Operating points

The semantic policy remains the production default: cosine ≥0.48, top-two gap ≥0.06, all breaking changes reviewed, conventional internal types handled separately. No weights, model revision, defaults or fixtures were altered after scoring.

The lexical baseline uses lowercase Unicode alphanumeric term counts and cosine similarity, without stemming, stopword removal, IDF fitting or learned weights. Sharing numeric gates is not a claim that lexical and embedding score scales are equivalent. Therefore both fixed gates and a separately selected lexical operating point are shown.

A disjoint **12-case calibration set** supplied six safe and six ordinary must-review cases. The predeclared 60-point grid maximized correct acceptance subject to zero unsafe calibration accepts, breaking ties toward stricter gates. It selected **0.6 / 0.2**, accepting **3/6** safe cases and **0/6** must-review cases. That finite selection condition does not establish zero future risk. [Calibration labels](calibration.json) and all grid outcomes in [native results](results/native.json).

## Ordinary-case outcomes

The primary denominator is **38 ordinary cases: 16 safe unique matches and 22 cases requiring review**. Six mandatory breaking and four internal cases are reported separately below.

| Matcher / policy | Correct acceptance /16 safe | Review /38 ordinary | Accepted precision | False reassurance /all accepts | Must-review escapes /22 | Top-1 /16 | Top-2 /16 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Semantic, fixed 0.48 / 0.06 | 16/16 (100.0%) | 12/38 (31.6%) | 16/26 (61.5%) | 10/26 (38.5%) | 10/22 (45.5%) | 16/16 (100.0%) | 16/16 (100.0%) |
| Lexical, fixed 0.48 / 0.06 | 8/16 (50.0%) | 20/38 (52.6%) | 8/18 (44.4%) | 10/18 (55.6%) | 10/22 (45.5%) | 13/16 (81.3%) | 15/16 (93.8%) |
| Lexical, calibration-selected 0.6 / 0.2 | 8/16 (50.0%) | 23/38 (60.5%) | 8/15 (53.3%) | 7/15 (46.7%) | 7/22 (31.8%) | 13/16 (81.3%) | 15/16 (93.8%) |

“False reassurance” means accepting a labeled must-review case or accepting the wrong note on a safe case. Ambiguity is a conservative specification/review-policy choice: accepting a plausible candidate there is not necessarily a factual contradiction. Must-review escape has a different denominator and excludes wrong-note accepts on safe cases. There were no wrong-note accepts on the 16 safe cases in these observations.

**The semantic matcher accepted all eight contradictory hard negatives.** Its ten unsafe accepts consist of those eight contradictions plus two ambiguity-policy violations. It reviewed all eight omissions. It found all eight paraphrases as accepted correspondences; both lexical operating points sent all eight paraphrases to review. The useful paraphrase behavior does not make the matcher a contradiction detector or proof of coverage.

| Category | Cases | Semantic accepted/review/internal | Fixed lexical accepted/review/internal | Calibrated lexical accepted/review/internal |
| --- | ---: | --- | --- | --- |
| literal | 8 | 8/0/0 | 8/0/0 | 8/0/0 |
| paraphrase | 8 | 8/0/0 | 0/8/0 | 0/8/0 |
| omitted | 8 | 0/8/0 | 0/8/0 | 0/8/0 |
| hard_negative | 8 | 8/0/0 | 8/0/0 | 7/1/0 |
| ambiguous | 6 | 2/4/0 | 2/4/0 | 0/6/0 |
| breaking | 6 | 0/6/0 | 0/6/0 | 0/6/0 |
| internal | 4 | 0/0/4 | 0/0/4 | 0/0/4 |

Node CPU and browser WASM agreed on all **48** dispositions and candidate rankings (0 differences). Scores were not identical: the largest observed top-score absolute difference was **0.014245**. Small numerical differences can matter near a gate; this observation does not guarantee backend equivalence on other inputs.

All three operating points kept **6/6 breaking changes in review** and **4/4 internal cases as internal suggestions**. These check deterministic policy gates and are excluded from the primary model results. The fixtures do not validate internal heuristics on deceptive real commit types.

## Inspect every error

Every unsafe accept and missed safe acceptance is retained below. Scores are the observed native values, not probabilities. Each ID identifies the same frozen scenario in fixtures.json; use the browser raw results for its numerical values.

### Semantic, fixed 0.48 / 0.06

- **hard-negative-cli-timeout-direction**: expected review; observed matched. Closest `note-a`, score 0.815701, gap 0.771384.
  - Change: fix: raise the default request timeout from 10 seconds to 30 seconds
  - Candidate: Lower the default request timeout from 10 seconds to 3 seconds.
  - Label rationale: The timeout note has overlapping words but states the opposite direction and a different new value; treating it as coverage would give false reassurance.
- **hard-negative-sdk-status-code**: expected review; observed matched. Closest `note-b`, score 0.846628, gap 0.592716.
  - Change: fix: stop retrying requests that receive HTTP 400
  - Candidate: Requests that receive HTTP 400 are now retried automatically before failing.
  - Label rationale: The retry note reverses the change: it promises automatic retries where the commit removes them.
- **hard-negative-cache-read-only**: expected review; observed matched. Closest `note-a`, score 0.887778, gap 0.752597.
  - Change: fix: prevent cache writes while read-only mode is enabled
  - Candidate: Cache writes remain enabled while read-only mode is active.
  - Label rationale: The read-only note states that writes remain possible, contradicting the fix that prevents them.
- **hard-negative-editor-rename-scope**: expected review; observed matched. Closest `note-b`, score 0.956845, gap 1.014009.
  - Change: fix: update import paths when renaming a single source file
  - Candidate: Update import paths when renaming an entire source directory; single-file renames are unchanged.
  - Label rationale: The apparent rename match covers directories and explicitly excludes the single-file behavior changed by the commit.
- **hard-negative-build-platform**: expected review; observed matched. Closest `note-a`, score 0.844777, gap 0.74088.
  - Change: feat: provide a native Windows ARM64 compiler package
  - Candidate: Provide a native Linux ARM64 compiler package.
  - Label rationale: The same architecture and artifact do not make a Linux package announcement evidence for a Windows package.
- **hard-negative-test-suite-scope**: expected review; observed matched. Closest `note-b`, score 0.926941, gap 0.774021.
  - Change: feat: rerun only failed snapshot tests
  - Candidate: Rerun only failed unit tests; snapshot tests are not included in this shortcut.
  - Label rationale: The rerun note targets the explicitly excluded unit-test suite instead of snapshots.
- **hard-negative-mobile-foreground-condition**: expected review; observed matched. Closest `note-a`, score 0.835903, gap 0.768389.
  - Change: fix: retry queued uploads only while the app is in the foreground
  - Candidate: Queued uploads are retried while the app is in the background.
  - Label rationale: Background retrying violates the foreground-only precondition stated in the commit and its body.
- **hard-negative-observability-limit**: expected review; observed matched. Closest `note-b`, score 0.951089, gap 0.593154.
  - Change: feat: limit each exported stack trace to 64 frames
  - Candidate: Limit each exported stack trace to 128 frames.
  - Label rationale: The near-identical stack-trace note gives a different frame limit; numerical disagreement makes it inadequate evidence.
- **ambiguous-editor-expand-shortcut**: expected review; observed matched. Closest `note-b`, score 0.762002, gap 0.105411.
  - Change: feat: add a shortcut to expand folded sections
  - Candidate: A keyboard shortcut expands folded sections in Markdown files.
  - Label rationale: The same fold-expansion action exists in two document modes; the broad summary does not identify which mode changed.
- **ambiguous-test-failure-selection**: expected review; observed matched. Closest `note-a`, score 0.81084, gap 0.064019.
  - Change: feat: remember the failed-test selection
  - Candidate: The failed-test selection is remembered when retrying within the current run.
  - Label rationale: Both notes concern remembering the same selection, but current-run retry and persistence across sessions are different claims that the commit cannot distinguish.

### Lexical, fixed 0.48 / 0.06

- **paraphrase-cli-streams**: expected match; observed review. Closest `note-a`, score 0.19868, gap 0.105021.
  - Change: fix: route progress chatter to stderr when stdout is piped
  - Candidate: Pipelines receive clean data output; progress messages use the error stream instead.
  - Label rationale: Clean piped data and progress on the error stream paraphrase the stdout/stderr separation in the commit.
- **paraphrase-sdk-cancellation**: expected match; observed review. Closest `note-a`, score 0.19803, gap 0.130762.
  - Change: feat: let AbortSignal stop an in-flight batch request
  - Candidate: Response metadata exposes the request identifier.
  - Label rationale: Interrupting bulk calls with a cancellation signal is the same operation as aborting an in-flight batch.
- **paraphrase-cache-offline-expiry**: expected match; observed review. Closest `note-a`, score 0.125988, gap 0.
  - Change: feat: reuse expired downloads only while the network is unavailable
  - Candidate: Cache cleanup prints the space it recovered.
  - Label rationale: The third note preserves both stale-download reuse and its offline-only condition.
- **paraphrase-editor-import-folding**: expected match; observed review. Closest `note-a`, score 0.18334, gap 0.18334.
  - Change: feat: collapse import declarations when opening source files
  - Candidate: Source files open with their dependency statements tucked away so the main code is easier to scan.
  - Label rationale: Tucking away dependency statements on open describes folding import declarations.
- **paraphrase-build-affected-targets**: expected match; observed review. Closest `note-b`, score 0.104828, gap 0.104828.
  - Change: feat: rebuild only targets whose dependency graph changed
  - Candidate: Incremental builds skip unaffected outputs and regenerate the ones touched by dependency changes.
  - Label rationale: Skipping unaffected outputs and rebuilding those with changed dependencies restates selective target rebuilding.
- **paraphrase-test-quarantine**: expected match; observed review. Closest `note-c`, score 0.280976, gap 0.280976.
  - Change: feat: keep quarantined flaky tests out of the default suite
  - Candidate: Unstable tests marked for isolation no longer run in normal checks; use the separate quarantine command to execute them.
  - Label rationale: The note preserves exclusion from ordinary runs and availability through a separate command.
- **paraphrase-mobile-upload-resume**: expected match; observed review. Closest `note-a`, score 0.113961, gap 0.113961.
  - Change: fix: persist unfinished upload jobs across app restarts
  - Candidate: Closing and reopening the app no longer loses pending file transfers.
  - Label rationale: Keeping pending transfers after reopening is equivalent to persisting unfinished uploads across restarts.
- **paraphrase-observability-error-grouping**: expected match; observed review. Closest `note-a`, score 0, gap 0.
  - Change: feat: group identical error events with an occurrence counter
  - Candidate: Span details link to their parent trace.
  - Label rationale: A single failure row with its repetition count describes grouping identical error events.
- **hard-negative-cli-timeout-direction**: expected review; observed matched. Closest `note-a`, score 0.846154, gap 0.670742.
  - Change: fix: raise the default request timeout from 10 seconds to 30 seconds
  - Candidate: Lower the default request timeout from 10 seconds to 3 seconds.
  - Label rationale: The timeout note has overlapping words but states the opposite direction and a different new value; treating it as coverage would give false reassurance.
- **hard-negative-sdk-status-code**: expected review; observed matched. Closest `note-b`, score 0.511891, gap 0.511891.
  - Change: fix: stop retrying requests that receive HTTP 400
  - Candidate: Requests that receive HTTP 400 are now retried automatically before failing.
  - Label rationale: The retry note reverses the change: it promises automatic retries where the commit removes them.
- **hard-negative-cache-read-only**: expected review; observed matched. Closest `note-a`, score 0.843274, gap 0.843274.
  - Change: fix: prevent cache writes while read-only mode is enabled
  - Candidate: Cache writes remain enabled while read-only mode is active.
  - Label rationale: The read-only note states that writes remain possible, contradicting the fix that prevents them.
- **hard-negative-editor-rename-scope**: expected review; observed matched. Closest `note-b`, score 0.668153, gap 0.668153.
  - Change: fix: update import paths when renaming a single source file
  - Candidate: Update import paths when renaming an entire source directory; single-file renames are unchanged.
  - Label rationale: The apparent rename match covers directories and explicitly excludes the single-file behavior changed by the commit.
- **hard-negative-build-platform**: expected review; observed matched. Closest `note-a`, score 0.857143, gap 0.857143.
  - Change: feat: provide a native Windows ARM64 compiler package
  - Candidate: Provide a native Linux ARM64 compiler package.
  - Label rationale: The same architecture and artifact do not make a Linux package announcement evidence for a Windows package.
- **hard-negative-test-suite-scope**: expected review; observed matched. Closest `note-b`, score 0.751469, gap 0.659799.
  - Change: feat: rerun only failed snapshot tests
  - Candidate: Rerun only failed unit tests; snapshot tests are not included in this shortcut.
  - Label rationale: The rerun note targets the explicitly excluded unit-test suite instead of snapshots.
- **hard-negative-mobile-foreground-condition**: expected review; observed matched. Closest `note-a`, score 0.636146, gap 0.497137.
  - Change: fix: retry queued uploads only while the app is in the foreground
  - Candidate: Queued uploads are retried while the app is in the background.
  - Label rationale: Background retrying violates the foreground-only precondition stated in the commit and its body.
- **hard-negative-observability-limit**: expected review; observed matched. Closest `note-b`, score 0.875, gap 0.730662.
  - Change: feat: limit each exported stack trace to 64 frames
  - Candidate: Limit each exported stack trace to 128 frames.
  - Label rationale: The near-identical stack-trace note gives a different frame limit; numerical disagreement makes it inadequate evidence.
- **ambiguous-sdk-date-filter**: expected review; observed matched. Closest `note-a`, score 0.67082, gap 0.111803.
  - Change: feat: add a date boundary filter to event queries
  - Candidate: Event queries can filter results using a start-date boundary.
  - Label rationale: The commit omits whether the new boundary is a start or end date; each note is relevant and choosing one would require source inspection.
- **ambiguous-cache-bypass**: expected review; observed matched. Closest `note-b`, score 0.589256, gap 0.117851.
  - Change: feat: add an option to bypass the response cache
  - Candidate: A bypass option skips writing responses to the cache.
  - Label rationale: Bypassing a cache could mean avoiding reads or writes; the commit provides no behavior-level basis to select either plausible note.

### Lexical, calibration-selected 0.6 / 0.2

- **paraphrase-cli-streams**: expected match; observed review. Closest `note-a`, score 0.19868, gap 0.105021.
  - Change: fix: route progress chatter to stderr when stdout is piped
  - Candidate: Pipelines receive clean data output; progress messages use the error stream instead.
  - Label rationale: Clean piped data and progress on the error stream paraphrase the stdout/stderr separation in the commit.
- **paraphrase-sdk-cancellation**: expected match; observed review. Closest `note-a`, score 0.19803, gap 0.130762.
  - Change: feat: let AbortSignal stop an in-flight batch request
  - Candidate: Response metadata exposes the request identifier.
  - Label rationale: Interrupting bulk calls with a cancellation signal is the same operation as aborting an in-flight batch.
- **paraphrase-cache-offline-expiry**: expected match; observed review. Closest `note-a`, score 0.125988, gap 0.
  - Change: feat: reuse expired downloads only while the network is unavailable
  - Candidate: Cache cleanup prints the space it recovered.
  - Label rationale: The third note preserves both stale-download reuse and its offline-only condition.
- **paraphrase-editor-import-folding**: expected match; observed review. Closest `note-a`, score 0.18334, gap 0.18334.
  - Change: feat: collapse import declarations when opening source files
  - Candidate: Source files open with their dependency statements tucked away so the main code is easier to scan.
  - Label rationale: Tucking away dependency statements on open describes folding import declarations.
- **paraphrase-build-affected-targets**: expected match; observed review. Closest `note-b`, score 0.104828, gap 0.104828.
  - Change: feat: rebuild only targets whose dependency graph changed
  - Candidate: Incremental builds skip unaffected outputs and regenerate the ones touched by dependency changes.
  - Label rationale: Skipping unaffected outputs and rebuilding those with changed dependencies restates selective target rebuilding.
- **paraphrase-test-quarantine**: expected match; observed review. Closest `note-c`, score 0.280976, gap 0.280976.
  - Change: feat: keep quarantined flaky tests out of the default suite
  - Candidate: Unstable tests marked for isolation no longer run in normal checks; use the separate quarantine command to execute them.
  - Label rationale: The note preserves exclusion from ordinary runs and availability through a separate command.
- **paraphrase-mobile-upload-resume**: expected match; observed review. Closest `note-a`, score 0.113961, gap 0.113961.
  - Change: fix: persist unfinished upload jobs across app restarts
  - Candidate: Closing and reopening the app no longer loses pending file transfers.
  - Label rationale: Keeping pending transfers after reopening is equivalent to persisting unfinished uploads across restarts.
- **paraphrase-observability-error-grouping**: expected match; observed review. Closest `note-a`, score 0, gap 0.
  - Change: feat: group identical error events with an occurrence counter
  - Candidate: Span details link to their parent trace.
  - Label rationale: A single failure row with its repetition count describes grouping identical error events.
- **hard-negative-cli-timeout-direction**: expected review; observed matched. Closest `note-a`, score 0.846154, gap 0.670742.
  - Change: fix: raise the default request timeout from 10 seconds to 30 seconds
  - Candidate: Lower the default request timeout from 10 seconds to 3 seconds.
  - Label rationale: The timeout note has overlapping words but states the opposite direction and a different new value; treating it as coverage would give false reassurance.
- **hard-negative-cache-read-only**: expected review; observed matched. Closest `note-a`, score 0.843274, gap 0.843274.
  - Change: fix: prevent cache writes while read-only mode is enabled
  - Candidate: Cache writes remain enabled while read-only mode is active.
  - Label rationale: The read-only note states that writes remain possible, contradicting the fix that prevents them.
- **hard-negative-editor-rename-scope**: expected review; observed matched. Closest `note-b`, score 0.668153, gap 0.668153.
  - Change: fix: update import paths when renaming a single source file
  - Candidate: Update import paths when renaming an entire source directory; single-file renames are unchanged.
  - Label rationale: The apparent rename match covers directories and explicitly excludes the single-file behavior changed by the commit.
- **hard-negative-build-platform**: expected review; observed matched. Closest `note-a`, score 0.857143, gap 0.857143.
  - Change: feat: provide a native Windows ARM64 compiler package
  - Candidate: Provide a native Linux ARM64 compiler package.
  - Label rationale: The same architecture and artifact do not make a Linux package announcement evidence for a Windows package.
- **hard-negative-test-suite-scope**: expected review; observed matched. Closest `note-b`, score 0.751469, gap 0.659799.
  - Change: feat: rerun only failed snapshot tests
  - Candidate: Rerun only failed unit tests; snapshot tests are not included in this shortcut.
  - Label rationale: The rerun note targets the explicitly excluded unit-test suite instead of snapshots.
- **hard-negative-mobile-foreground-condition**: expected review; observed matched. Closest `note-a`, score 0.636146, gap 0.497137.
  - Change: fix: retry queued uploads only while the app is in the foreground
  - Candidate: Queued uploads are retried while the app is in the background.
  - Label rationale: Background retrying violates the foreground-only precondition stated in the commit and its body.
- **hard-negative-observability-limit**: expected review; observed matched. Closest `note-b`, score 0.875, gap 0.730662.
  - Change: feat: limit each exported stack trace to 64 frames
  - Candidate: Limit each exported stack trace to 128 frames.
  - Label rationale: The near-identical stack-trace note gives a different frame limit; numerical disagreement makes it inadequate evidence.

## Measured timings

One fixed **20-change /12-note synthetic workload** encoded **28 texts** (16 non-internal changes plus 12 notes), with **0 truncated inputs**. Native recorded 2,415 encoded characters. Windows x64, Node 26.8.1, ONNX Runtime Node 1.30.0 (two intra-op/one inter-op threads); headless Edge 153.0.4234.32 and single-threaded ONNX Runtime WASM. This is one coarse environment, not a cross-device benchmark. Memory was not measured.

| Cohort | Observed median (minimum–maximum), sample count | Included work |
| --- | --- | --- |
| Native fresh-process model setup + audit | 471.0 ms (452.4–517.0), n=5 | Local model hashes/imports/tokenizer/model initialization and audit; excludes Node startup/disposal |
| Native fresh-process total wall time | 609.0 ms (589.5–657.2), n=5 | Also includes process launch, freeze validation and disposal |
| Native loaded-model audit | 59.0 ms (52.1–85.6), n=10 | Audit in an existing model; no setup |
| Browser empty-cache context/model cold | 840.2 ms (801.2–947.3), n=5 | Worker startup, loopback asset transfer/hash checks, model load, audit and result messaging |
| Browser verified-cache fresh worker | 656.9 ms (621.4–672.5), n=5 | Cache reads/hash checks, model initialization, audit and messaging |
| Browser reused worker | 214.0 ms (211.9–219.7), n=10 | Audit and result messaging; no asset/model setup |

Each browser cold sample downloaded **37,974,266 bytes** of model/runtime files. Cached and reused-worker samples downloaded **zero** model/runtime bytes. Six cache assets were SHA-256 checked. Browser timings exclude server/browser launch, page creation and UI rendering. They share a browser process and use loopback; OS disk/code caches were not flushed. They do not measure public-hosting download speed. Cohorts were run sequentially, not deliberately in contention; background machine activity was not isolated. Every sample is retained without discarding warm observations.

## Reproduce and retain observations

Install the exact lockfile dependencies and bootstrap the pinned public model once. Use an installed Edge (or set RELEASE_SIEVE_BROWSER=chrome); no browser download is needed. The committed distribution supplies the browser worker/assets.

```sh
npm ci --ignore-scripts
npm run bootstrap
npm test
npm run benchmark:native -- --out evaluation/results/my-native.json
npm run benchmark:browser -- --out evaluation/results/my-browser.json
```

Both runners verify frozen hashes before inference and refuse to overwrite an existing result file. Do not regenerate the freeze to make changed source appear comparable. To change a protocol or model, preserve this version and use a new evaluation set. Native inference explicitly forbids fetch. Browser inference uses unchanged shipped worker bytes and fixed same-origin asset GETs with no request bodies. This test did not detect evidence uploads or persistent drafts.

[Native raw reports, calibration grid and individual timing samples](results/native.json) · [Browser case outcomes, asset checks and samples](results/browser.json) · [Timing input](timing-workload.json) · [Metric definitions](metrics.mjs).

## Limits and practical implication

This balanced, small, author-written suite is diagnostic, not a randomly sampled release corpus. It contains easy literal controls and deliberately difficult contradictions. No confidence intervals or general accuracy claim follow from it. Labels reflect the stated synthetic behavior, not inspected code diffs or independently adjudicated maintainer feedback. English short-text results do not cover multilingual releases, long-input truncation, multiple changes per note, large candidate collections, physical mobile devices, Firefox or Safari.

The observed value is finding differently phrased candidate relationships while keeping evidence visible. The observed risk is that similarity preserves related vocabulary while missing numbers, direction, scope and preconditions. A maintainer must read apparently matched notes as well as the review queue. The next commercial step is a willing maintainer trial; this project has no validated willingness to pay, measured user time savings, customers or revenue. AI-assisted.
