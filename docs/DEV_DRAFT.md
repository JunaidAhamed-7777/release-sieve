---
title: "Release Sieve: a local AI second look at your release notes"
published: false
tags: devchallenge, hf26challenge, opensource, ai
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).*

## What I Built

A developer writes **"prevent duplicate charges on webhook retries."** The customer sees **"a repeated payment notification will no longer bill you twice."** Different words, the same fix—and one relationship a release reviewer needs to find.

**Release Sieve** compares commit evidence with the planned notes for one release. An open-weight sentence model runs on your device, ranking candidate notes and flagging weak or ambiguous associations. The report keeps source messages, filenames, and scores visible. Breaking changes always require review. Export HTML, JSON, or Markdown to keep the evidence with the release.

The hypothetical buyer is a freelance maintainer preparing a client's release. They could export the chosen Git range, compare it with the customer-facing draft, investigate gaps, and include the evidence report in the handoff. The paid deliverable I would test is configuring that Git export and local review check for the client's release process.

**Willingness to pay is unvalidated.** I have no customer, payment, external user trial, or measured time saving to report. The prototype establishes working mechanics and a reproducible way to inspect errors.

## Demo

**[Try the browser app](https://junaidahamed-7777.github.io/release-sieve/)** and choose **Review release**. It runs the real model on the preloaded synthetic example. No account, installation, API key, or repository access is required. The first audit downloads approximately **38 MB** of model and WebAssembly assets, plus the smaller app bundles. Release evidence is processed locally.

![Release Sieve reviewing a synthetic Ledger Finch release](https://raw.githubusercontent.com/JunaidAhamed-7777/release-sieve/main/demo/web-desktop.png)

The invented **Ledger Finch** release starts with six changes and four notes. The result is **three review items, one semantic match, and two internal suggestions**:

| Evidence | Reviewer sees |
| --- | --- |
| Duplicate-payment fix | Association with its customer-friendly note. |
| Timezone reminder fix | Possible omission needing review. |
| Old invoice API removal | High-priority review, retaining the related migration note as evidence. |
| CSV export | Two plausible notes whose gap falls below the ambiguity policy. |
| Dark-theme announcement | No accepted change link; something to investigate. |

Filter **Needs review**, search "timezone," choose **Add the missing note**, and review again. The queue becomes **two review items, two matches, and two internal suggestions**. The API removal and CSV ambiguity remain. One added sentence addresses one gap; it does not certify the release.

Replace the examples with commit lines or local JSON/Markdown files. Edits invalidate old results. Cancel stops the worker and preserves the draft. Later reviews reuse the loaded model, even without network access in that open page. Only public model/runtime assets may be cached; drafts remain in memory. Offline page reload is not guaranteed.

### Measuring the second look

I froze **48 author-constructed synthetic cases and their expected decisions before scoring**, holding them out from threshold selection. The model and its **0.48/0.06** defaults stayed unchanged. The transparent baseline uses cosine similarity over word counts; its second operating point selects gates using **12 separate calibration cases**. These are diagnostic specifications, not independent annotations or representative production data. [Fixtures, protocol, and reproduction](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/evaluation/README.md).

The [native results](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/evaluation/results/native.json) separate **38 ordinary cases**: 16 with a unique adequate note, 22 requiring review.

| Matcher: score/gap | Correctly accepted / 16 | Sent to review / 38 | Unsafe / all accepted | Must-review cases accepted / 22 |
| --- | ---: | ---: | ---: | ---: |
| MiniLM: 0.48/0.06 | 16/16 | 12/38 | 10/26 | 10/22 |
| Word counts: 0.48/0.06 | 8/16 | 20/38 | 10/18 | 10/22 |
| Word counts, calibrated: 0.60/0.20 | 8/16 | 23/38 | 7/15 | 7/22 |

MiniLM accepted associations for all eight paraphrases; both lexical variants sent them to review. **It also accepted all eight hard negatives and two of six ambiguous cases.** The eight hard negatives contradict the specified behavior, value, scope, or condition. The two ambiguity failures violate a conservative review policy; they are not necessarily factual errors. A change raising a timeout from 10 to 30 seconds matched a note lowering it from 10 to 3, at score **0.816**. Ten of 26 accepted associations were unsafe under these labels (**38.5%**). Fewer review rows did not mean fewer mistakes. Treat its output as candidate evidence for a maintainer to inspect, never an automatic release approval.

The six breaking changes all stayed in review and four internal cases followed the label heuristic. Those are separate policy checks, not model-accuracy credit. [Browser WASM decisions](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/evaluation/results/browser.json) agreed with Node on all 48 cases. Every outcome is retained; this small deliberately constructed set cannot estimate a real-world error rate.

For a **20-change/12-note workload** (28 encoded texts), native median setup-plus-audit time was **471 ms** (range 452–517; five fresh processes); model reuse was **59 ms** (52–86; ten runs). Browser worker round-trip medians were **840 ms** (801–947; five empty-cache contexts), **657 ms** (621–673; five cached fresh workers), and **214 ms** (212–220; ten reused-worker runs). Measurements used Windows x64, Node 26.8.1 with two intra-op threads, and headless Edge 153 with one WASM thread. Native setup-plus-audit excludes Node startup. Browser timings run from immediately before postMessage until the result event. They exclude worker construction and startup already completed, but may include remaining startup. Browser launch, page loading, and rendering are excluded. The [timing-definition correction](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/evaluation/README.md#timing-definition-correction) documents the earlier wording error while preserving the frozen script and observations. OS caches were not flushed; asset delivery used loopback. These are local timings, not public download-speed claims.

## Code

{% github JunaidAhamed-7777/release-sieve %}

The repository includes the browser workbench, CLI, model-free Git exporter, synthetic fixtures, reports, tests, and license notices. Try the CLI example:

```sh
git clone https://github.com/JunaidAhamed-7777/release-sieve.git
cd release-sieve
npm ci --ignore-scripts
npm run bootstrap
npm run demo
```

Open `demo/output/audit.html`. Setup requires network access; later CLI audits use verified local weights with remote loading disabled. [The README](https://github.com/JunaidAhamed-7777/release-sieve#readme) covers Git ranges, browser imports, requirements, and an optional review exit code for automation.

## How I Built It

The central AI component is the **Apache-2.0 all-MiniLM-L6-v2** sentence encoder. **Transformers.js and ONNX Runtime** run the same pinned Xenova q8 export through local CPU inference or browser WebAssembly. Its normalized **384-dimensional** vectors relate developer wording to customer wording.

The process is small:

1. Read a selected Git range or supplied JSON, then extract bounded notes for one release.
2. Suggest conventional `docs`, `test`, and similar labels as internal changes. Inspect these suggestions too.
3. Encode remaining messages and notes; rank candidates by cosine similarity.
4. Accept an advisory association at score **0.48** or above, with a runner-up gap of at least **0.06**. Keep every breaking change in review.

The app compares text; it neither examines patches nor generates release claims. A strong similarity score cannot establish factual agreement. Showing both close candidates and retaining breaking-change evidence makes that limitation visible.

The worker verifies SHA-256 hashes before using assets; evidence stays out of network requests and browser caches. Git collection leaves the chosen checkout unchanged and does not execute its code. Filenames are visible evidence, not model input. The English-oriented model sees at most **256 wordpieces per input**, with truncation disclosed. Markdown extraction preserves inline-code literals but omits headings and fenced examples.

[Verification records](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/docs/VERIFICATION.md) cover real native/browser inference, exports, keyboard interaction, responsive layouts, cancellation, upload races, asset failures, and cache integrity. They also identify the limits of those checks.

## Why Does Open Innovation Matter?

Open weights and an open runtime let a static site deliver semantic matching without receiving release evidence or operating an inference service. The CLI can perform later audits offline. No inference credential or per-request API charge is needed, although installation, downloads, and the user's compute have costs.

Maintainers can inspect the pinned model revision, matching policy, evidence, fixtures, and source; host the app themselves; and reproduce a promising or mistaken association. A different encoder would require compatibility work and a new evaluation. The model is genuinely central: without its embeddings, this semantic comparison becomes a different algorithm.

Original code and synthetic fixtures are **MIT**; the model and Transformers.js are **Apache-2.0**. [Model provenance](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/docs/MODEL_CARD.md) and [third-party notices](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/docs/THIRD_PARTY.md) credit the underlying work.

This new project began on **October 13, 2026**. The next commercial step is a willing maintainer testing a previously reviewed release, inspecting extra work and missed gaps before discussing a paid integration.

## Prize Categories

**Best Use of GitHub Copilot — through GitHub Actions automation.** The [category description](https://dev.to/challenges/hacktoberfest-week2-2026-10-12) includes "automate your project with GitHub Actions."

The [workflow](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/.github/workflows/ci.yml) runs on pushes/PRs across **Windows/Ubuntu × Node 22/26**, with read-only permissions and commit-pinned official actions. Each job installs locked dependencies, tests the application, verifies the model, builds the browser distribution, checks fetch-forbidden native inference, and exercises Git-to-report execution. [All four jobs passed at `f109c12`](https://github.com/JunaidAhamed-7777/release-sieve/actions/runs/38452234959). Browser automation was verified locally. This category entry uses Actions; it does not claim Copilot authored the application.

**AI disclosure:** AI-assisted.
