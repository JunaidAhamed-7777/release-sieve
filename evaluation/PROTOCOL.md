# Frozen synthetic evaluation protocol

This is a diagnostic comparison of release-note correspondence on author-constructed synthetic cases. Labels are readable specifications created before inference, not independent human annotations or a representative production sample. No customer data, private repositories, measured user savings, demand, or revenue is involved.

## Freeze and separation

- `fixtures.json`: 48 one-change mini-releases held out from threshold selection, with literal matches, paraphrases, omissions, hard negatives, competing notes, breaking changes, and internal suggestions.
- `calibration.json`: a disjoint set of 12 mini-releases, six uniquely covered ordinary changes and six ordinary changes requiring review. No breaking/internal case can satisfy calibration risk constraints trivially.
- Each split has explicit acceptable note IDs, expected disposition, category/domain and rationale. A related note on a breaking or ambiguous case is evidence, not permission to accept that change.
- Freeze exact data bytes, hashes, protocol and evaluator source in Git before the first scoring run. Do not remove cases, rewrite labels, tune the semantic policy, or change the model after viewing these results. Any future changed dataset requires a new version and fresh evaluation.

## Matchers and operating points

The semantic matcher uses the existing unmodified pinned MiniLM q8 model, 256-wordpiece cap, and production defaults: cosine similarity at least **0.48**, top-two separation at least **0.06**. Existing breaking and conventional internal-type gates remain intact.

The lexical baseline lowercases text and counts Unicode alphanumeric tokens. It applies cosine similarity to term-frequency vectors, without stemming, stopword removal, IDF fitting or model weights. It uses the same subject/body preprocessing and candidate ranking/audit gates. This is a transparent word-overlap baseline, not a comprehensive best lexical system.

Report three operating points:

1. Semantic matcher at unchanged defaults.
2. Lexical matcher at the same numeric gates, clearly labelled a fixed-gate comparison because score scales differ.
3. Lexical matcher with gates selected only on the separate calibration split. Threshold grid: `0.1, 0.2, 0.3, 0.4, 0.48, 0.5, 0.6, 0.7, 0.8, 0.9`; gap grid: `0, 0.03, 0.06, 0.1, 0.15, 0.2`. Require zero unsafe calibration accepts; maximize correctly accepted safe cases; ties choose the higher threshold, then the higher gap. If no grid point meets the constraint, explicitly use an always-review baseline. Calibration's finite zero-error condition is not a general safety guarantee.

## Metrics and denominators

For the **38 ordinary cases** (16 safe unique matches and 22 must-review cases), report raw counts and fractions:

- Useful correct acceptance: safe cases accepted against their unique labelled note / 16 safe cases.
- Review burden: changes returned for review / 38 ordinary cases. Unexpected internal suppression is counted separately.
- Accepted precision: correctly accepted safe cases / all accepted ordinary cases.
- False reassurance share: any accepted ordinary case that is unsafe or links the wrong note / all accepted ordinary cases. Report N/A when none are accepted.
- Must-review escape: accepted cases labelled review / 22 must-review cases. A wrong accepted link on a safe case is false reassurance, but is not in this denominator.
- Top-1 and top-2 retrieval: labelled note present among the top candidate(s) / 16 safe unique cases, regardless of acceptance. These do not establish code correctness.

Show category-specific counts. Report six breaking and four internal cases separately; mandatory gates are not credited as model accuracy. Do not present a blended accuracy number, confidence interval, general zero-risk claim, or tiny-fixture score as production performance. Publish every case outcome and inspect every unsafe accept and missed safe match.

## Timing protocol

Use one frozen 20-change / 12-note synthetic workload. Report eligible/encoded text counts, truncation, runtime versions, coarse OS/architecture, native two intra-op/one inter-op threads and browser single-threaded WASM.

- Native: five fresh processes initializing the local model, and ten audits reusing a loaded model. Separate setup/hash/loading from audit and process wall time.
- Browser: five fresh isolated contexts with empty model asset caches, five fresh-worker runs reusing verified assets, and ten audits reusing an initialized worker. Browser-process code/OS file caches are not flushed; call these context/model cold rather than cold disk.
- Each cohort reports sample count, median, minimum and maximum; retain individual samples. Browser asset transfer uses a loopback server and is not public-network download speed. Report downloaded bytes only from measured worker diagnostics. Memory is not measured and must not be claimed.

Model/fixture provenance and descriptive results belong with the reproducible commands. Article claims must include negative outcomes and the lack of genuine commercial validation. AI-assisted.
