# Model provenance and inference limits

Release Sieve uses an existing open-weight sentence encoder to compare change evidence with release-note bullets. It does not train a model, generate prose, or decide whether a release is safe. Its output is a review queue with source evidence.

## Pinned artifact

| Property | Value |
| --- | --- |
| Model repository | [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) |
| Upstream model | [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) |
| Revision | `751bff37182d3f1213fa05d7196b954e230abad9` |
| License | Apache-2.0, as declared by both model repositories |
| Format used | `onnx/model_quantized.onnx`, the runtime's `q8` variant |
| Runtime | `@huggingface/transformers` **4.3.1**, pinned in `package.json` and `package-lock.json` |
| Execution | Local Node.js CPU inference through ONNX Runtime |
| Embedding | 384 components, attention-mask-aware mean pooling, L2 normalization |

The ONNX conversion and tokenizer files come from Xenova's repository. Release Sieve does not claim authorship of the model or its conversion. The repository card explicitly identifies the upstream Sentence Transformers model and its Transformers.js-compatible ONNX export. The upstream card describes a short English sentence/paragraph encoder trained with a contrastive objective. [Export card](https://huggingface.co/Xenova/all-MiniLM-L6-v2), [upstream card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2).

## Required local files and integrity

The explicit bootstrap fetches these four files from the pinned revision, preserving their paths. No model weights are committed to this source repository.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `config.json` | 650 | `7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7` |
| `tokenizer.json` | 711,661 | `da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0` |
| `tokenizer_config.json` | 366 | `9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3` |
| `onnx/model_quantized.onnx` | 22,972,370 | `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1` |

The total is **23,685,047 bytes** of model artifacts, excluding npm dependencies. Bootstrap uses URLs of this form:

```text
https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/<file>
```

The revision, file sizes, license, public/ungated status, and ONNX SHA-256 were checked against the [public Hugging Face model API](https://huggingface.co/api/models/Xenova/all-MiniLM-L6-v2?blobs=true) on **2026-10-13**. The three JSON SHA-256 hashes were calculated from exact bytes read from those revision-pinned URLs. Their Git blob SHA-1 hashes also matched the API's `blobId` values: `72147e4ff4426ebedbfa2146c4a0999def51a313`, `c17ed520ed8438736732a54957a69306b8822215`, and `37fca74771bc76a8e01178ce3a6055a0995f8093`, respectively. The [ONNX file page](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/751bff37182d3f1213fa05d7196b954e230abad9/onnx/model_quantized.onnx) independently displays its SHA-256.

`special_tokens_map.json` and `vocab.txt` are present upstream, but Transformers.js loads this tokenizer from `tokenizer.json` and `tokenizer_config.json`. The encoded vocabulary and special tokens are in those files. No custom model code or remote-code execution is needed for this BERT export.

## Offline behavior

Installing npm dependencies and explicitly bootstrapping the pinned model require network access. Auditing then uses local files with remote model loading disabled (`env.allowRemoteModels = false`, `local_files_only: true`) and the CPU device selected. A missing or corrupt cache must produce an actionable error; auditing must not silently fetch weights or substitute a different model. The CLI reads only the local inputs chosen by the operator.

The local path and remote-loading controls are supported by Transformers.js; its `q8` file suffix is `_quantized`. These APIs were checked in the installed 4.3.1 package. The [environment API documentation](https://huggingface.co/docs/transformers.js/api/env) describes the loading controls, and the [dtype guide](https://huggingface.co/docs/transformers.js/guides/dtypes) describes explicit quantization selection.

The included [local verification record](../demo/model-verification.json) records a successful CPU run on Node.js `v26.8.1`, Windows x64. The [verification script](../scripts/verify-model.mjs) replaces `globalThis.fetch` with a throwing function before loading the model and checks finite 384-component normalized vectors, a paraphrase ranking above an unrelated example, and detection of a truncated long input. This is evidence for that machine and fixture, not a claim that every operating system or Node version has been tested.

## Text limits and review responsibility

The upstream model's intended default limit is **256 word pieces**. The exported config and tokenizer advertise a 512-token architectural maximum; that is not evidence that longer inputs are equally suitable. Release Sieve uses a 256-token limit for each encoded text, including special tokens, and records a count of truncated inputs in the report. It tokenizes directly with an explicit limit before pooling the model output. Long messages need concise evidence summaries; text after that limit may not influence a match. [Upstream intended use](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2#intended-uses), [pinned configuration](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/751bff37182d3f1213fa05d7196b954e230abad9/config.json), [pinned tokenizer configuration](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/751bff37182d3f1213fa05d7196b954e230abad9/tokenizer_config.json).

Cosine similarity ranks possible relationships. It is not a calibrated probability, a factuality check, or proof that a bullet fully covers a change. Similar wording can hide opposite behavior, different versions, numbers, flags, identifiers, or scope. English prose is the intended use here; other languages, terse code-only changes, and project-specific jargon can be unreliable. Quantization can change scores, and default thresholds are review heuristics. Human review remains necessary for ambiguous matches, breaking changes, omissions, and final release notes.

The synthetic demonstration verifies behavior on its included fixtures. It does not establish general accuracy, customer demand, revenue, or time saved. Release Sieve has not fine-tuned or benchmarked this model on private repository data.
