---
title: "Release Sieve: a local AI second look before you ship"
published: false
tags: devchallenge, hf26challenge, opensource, ai
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).*

## What I Built

A commit says “prevent duplicate charges on webhook retries.” The release note says “a repeated payment notification will no longer bill you twice.” Those are different words for the same useful fix. A simple keyword check can struggle with that relationship, while a generated changelog introduces another question: did the model invent anything?

**Release Sieve** takes a narrower approach. It compares local commit evidence with the planned notes for one release, then produces a review report: likely semantic matches, changes that need a second look, and internal-change suggestions. Each row retains its source message and changed paths; when a candidate exists, it also shows the closest note and similarity score. The output is HTML, JSON, and Markdown. It never publishes notes.

The intended buyer is a freelance release maintainer or a small product team responsible for explaining updates to customers. The possible paid offering is a tailored release-review workflow or integration. That is a business hypothesis, not validated demand: this prototype has no customers, revenue, or measured time savings.

## Demo

[Open the interactive synthetic report](https://junaidahamed-7777.github.io/release-sieve/). This is a precomputed demonstration; the actual inference runs locally through the CLI. No repository upload or API key is needed.

![Release Sieve reviewing a synthetic release](https://raw.githubusercontent.com/JunaidAhamed-7777/release-sieve/main/demo/report-desktop.png)

The invented **Ledger Finch** release has six changes and four notes. The real model run produces **three review items, one semantic match, and two internal suggestions**:

- The duplicate-payment fix matches its customer-friendly note.
- A timezone reminder fix is missing from the notes and remains flagged.
- Removing the old invoice API remains a high-priority review item even though a migration note looks related.
- The CSV export has a plausible note, but its top-two gap is **0.058622**, just below the **0.06** policy. The report asks for review instead of forcing an association.
- A dark-theme announcement has no passed change link. That is something to investigate, not proof that the note is wrong.

Use the **Review** filter, search for “timezone,” then inspect the API removal. The point is to make the release review easier to inspect, including the model's uncertainty.

To reproduce:

```sh
git clone https://github.com/JunaidAhamed-7777/release-sieve.git
cd release-sieve
npm ci --ignore-scripts
npm run bootstrap
npm run demo
npm run serve:demo
```

## Code

{% github JunaidAhamed-7777/release-sieve %}

The repository includes the synthetic inputs, committed outputs, setup instructions, architecture, model provenance, license attribution, tests, and verification records.

## How I Built It

Open-weight AI is the mechanism that relates differently phrased changes and notes. Release Sieve runs the **Apache-2.0 all-MiniLM-L6-v2** sentence model through **Transformers.js and ONNX Runtime on CPU**. The Xenova ONNX export is pinned to a specific revision; all four required files have recorded SHA-256 hashes. Bootstrap downloads about **23.7 MB** of model artifacts. Subsequent audits explicitly disable remote model loading.

The workflow is small:

1. Collect subjects, bodies, and filenames from an exact Git range, or read supplied JSON. Parse single-release Markdown notes and validate bounded inputs.
2. Suggest conventional `docs`, `test`, and similar labels as internal changes. This is an explicit heuristic, not an AI impact prediction.
3. Encode remaining messages and notes as normalized 384-dimensional vectors. Rank note candidates by cosine similarity.
4. Require both a minimum score and a separation from the runner-up. Always retain breaking changes for human review. Render the original evidence beside the candidate note.

No patch analysis or generated prose is involved. The collector leaves the input checkout unchanged, disables signature-display helpers and lazy fetching, and does not execute repository code. The report escapes untrusted evidence and uses no external assets.

Verification includes unit tests for ambiguity, breaking markers, bounds, malicious text, and Git behavior; a real-model test that makes `fetch` throw; and a Git-to-report end-to-end test using a temporary synthetic repository. Browser checks exercised keyboard filters, search, empty states, and desktop/mobile layouts with no page network requests or JavaScript errors. The verification records show the actual environment and results rather than an inferred production benchmark.

## Why Does Open Innovation Matter?

The model's weights and runtime are what make local semantic comparison possible. After setup, release evidence stays on the operator's machine and there is no per-request API bill or service credential. The source, model revision, hashes, thresholds, and review policy are inspectable. Another maintainer can change the matching policy or adapt the backend without depending on a provider's hosted endpoint.

That autonomy comes with limits. Similarity is not a probability or a factuality check. Negation, versions, numbers, broad bullets, and domain jargon can fool the model. Inputs are limited to 256 wordpieces, and truncation is disclosed. Merge-only conflict-resolution edits and uncommitted changes are outside the collector's scope. Human review is still required, including for internal suggestions and apparently successful matches.

Original application code and synthetic fixtures use MIT. The model and Transformers.js use Apache-2.0; runtime dependencies keep their own licenses. [Model provenance](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/docs/MODEL_CARD.md) and [third-party attribution](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/docs/THIRD_PARTY.md) document that boundary.

This new project began on **October 13, 2026**, within the Week 2 window. The next useful step is user validation with a willing maintainer, before making claims about accuracy, willingness to pay, or time saved.

**AI disclosure:** AI-assisted.
