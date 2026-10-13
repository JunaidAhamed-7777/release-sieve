---
title: "Release Sieve: a local AI second look before you ship"
published: false
tags: devchallenge, hf26challenge, opensource, ai
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).*

## What I Built

A commit says “prevent duplicate charges on webhook retries.” The release note says “a repeated payment notification will no longer bill you twice.” Those are different words for the same useful fix. A simple keyword check can struggle with that relationship, while a generated changelog introduces another question: did the model invent anything?

**Release Sieve** takes a narrower approach. Paste commit subjects, load a JSON change file, and add the planned notes for one release. An open-weight model runs in your browser and produces a review queue: likely semantic matches, changes that need a second look, and internal-change suggestions. Each row retains its source message and changed paths; when a candidate exists, it also shows the closest note and similarity score. You can change the notes, review again, and download HTML, JSON, or Markdown. It never publishes notes.

The intended buyer is a freelance release maintainer or a small product team responsible for explaining updates to customers. The possible paid offering is a tailored release-review workflow or integration. That is a business hypothesis, not validated demand: this prototype has no customers, revenue, or measured time savings.

## Demo

[Open the browser app](https://junaidahamed-7777.github.io/release-sieve/). Choose **Review release** to run the preloaded synthetic example through the actual local model. The first run downloads about **38 MB** of model and WebAssembly assets from the same site. Your input text stays in the browser. No installation, repository access, API key, or account is needed.

![Release Sieve browser workbench reviewing a synthetic release](https://raw.githubusercontent.com/JunaidAhamed-7777/release-sieve/main/demo/web-desktop.png)

The invented **Ledger Finch** release has six changes and four notes. The real model run produces **three review items, one semantic match, and two internal suggestions**:

- The duplicate-payment fix matches its customer-friendly note.
- A timezone reminder fix is missing from the notes and remains flagged.
- Removing the old invoice API remains a high-priority review item even though a migration note looks related.
- The CSV export has a plausible note, but its top-two gap is below the **0.06** policy. The report asks for review instead of forcing an association.
- A dark-theme announcement has no passed change link. That is something to investigate, not proof that the note is wrong.

Filter for **Needs review**, search for “timezone,” then inspect the API removal. Choose **Add the missing note** and run again to compare the new associations. A second synthetic example isolates that edit: a restoration feature starts without a related note, then becomes a semantic match after its note is added. You can also replace the example with your own commit lines or local JSON and Markdown files.

Progress shows downloading, integrity checks, model loading, and local encoding. Cancel stops the worker and preserves the draft. Successful reviews keep the model loaded for a later review, including without network access in that open page. Offline page reload is not promised. Export buttons save review snapshots locally.

The command-line version is also available:

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

The repository includes the browser app, CLI, synthetic inputs, committed sample outputs, Git export helper, architecture, model provenance, license attribution, tests, and verification records.

## How I Built It

Open-weight AI is the mechanism that relates differently phrased changes and notes. Release Sieve runs the **Apache-2.0 all-MiniLM-L6-v2** sentence model through **Transformers.js and ONNX Runtime**. The browser uses single-threaded WebAssembly in a worker; the CLI uses local CPU inference. Both use the same pinned Xenova q8 ONNX export. All required model and browser runtime files have recorded SHA-256 hashes. Assets are verified before use or cache reuse; the browser serves them from its own origin.

The workflow is small:

1. Collect subjects, bodies, and filenames from an exact Git range, or read supplied JSON. Parse single-release Markdown notes and validate bounded inputs.
2. Suggest conventional `docs`, `test`, and similar labels as internal changes. This is an explicit heuristic, not an AI impact prediction.
3. Encode remaining messages and notes as normalized 384-dimensional vectors. Rank note candidates by cosine similarity.
4. Require both a minimum score and a separation from the runner-up. Always retain breaking changes for human review. Render the original evidence beside the candidate note.

No patch analysis or generated prose is involved. The Git collector leaves the input checkout unchanged, disables signature-display helpers and lazy fetching, and does not execute repository code. The browser sends only fixed public-asset GET requests, then exposes verified asset bytes to the inference runtime. Input text does not become a URL, header, request body, or cache entry. The interface uses text nodes for evidence, and exported HTML escapes untrusted strings.

Verification includes tests for ambiguity, breaking markers, bounds, malicious text, Git behavior, and browser input parsing; a CLI model test that makes `fetch` throw; and Git-to-report execution using a temporary synthetic repository. Browser workflow verification uses real WASM inference and exercises examples, note edits, local files, exports, keyboard filters, desktop/mobile layouts, cancellation, and error recovery. [Verification records](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/docs/VERIFICATION.md) identify tested behavior and its limits rather than imply production accuracy.

## Why Does Open Innovation Matter?

The model's weights and runtime are what make local semantic comparison possible. A public static site can deliver the workbench and model without receiving release evidence or operating an inference service. There is no per-request API bill or service credential. The source, model revision, hashes, thresholds, and review policy are inspectable. Another maintainer can change the matching policy or adapt the backend without depending on a provider's hosted endpoint.

That autonomy comes with limits. Similarity is not a probability or a factuality check. Negation, versions, numbers, broad bullets, and domain jargon can fool the model. Inputs are limited to 256 wordpieces, and truncation is disclosed. Merge-only conflict-resolution edits and uncommitted changes are outside the collector's scope. Human review is still required, including for internal suggestions and apparently successful matches.

Original application code and synthetic fixtures use MIT. The model and Transformers.js use Apache-2.0; runtime dependencies keep their own licenses. [Model provenance](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/docs/MODEL_CARD.md) and [third-party attribution](https://github.com/JunaidAhamed-7777/release-sieve/blob/main/docs/THIRD_PARTY.md) document that boundary.

This new project began on **October 13, 2026**, within the Week 2 window. The next useful step is user validation with a willing maintainer, before making claims about accuracy, willingness to pay, or time saved.

**AI disclosure:** AI-assisted.
