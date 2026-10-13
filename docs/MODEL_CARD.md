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
| Execution | Local Node.js CPU inference, or browser WebAssembly inference in a dedicated worker |
| Embedding | 384 components, attention-mask-aware mean pooling, L2 normalization |

The ONNX conversion and tokenizer files come from Xenova's repository. Release Sieve does not claim authorship of the model or its conversion. The repository card explicitly identifies the upstream Sentence Transformers model and its Transformers.js-compatible ONNX export. The upstream card describes a short English sentence/paragraph encoder trained with a contrastive objective. [Export card](https://huggingface.co/Xenova/all-MiniLM-L6-v2), [upstream card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2).

## Required local files and integrity

The CLI's explicit bootstrap fetches these four files from the pinned revision, preserving their paths in the ignored `.models` cache. The browser distribution copies those verified bytes into `docs/models/<revision>/Xenova/all-MiniLM-L6-v2/` so the public app can serve the model from its own origin.

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

## Browser distribution

`npm run build:web` verifies the CLI cache against `model-lock.json`, copies the pinned model files, and bundles the app and worker. A small adapter imports BERT model/tokenizer modules from the exact Transformers.js 4.3.1 source distribution and registers only that architecture. This omits the SDK's universal model registry and unrelated model classes. The adapter uses internal source exports, so a runtime upgrade requires an explicit compatibility check; the build rejects a different installed SDK version.

The browser uses the WASM-only ONNX Runtime entry from `onnxruntime-web` `1.31.0-dev.20260914-8d85527a0`. Its two runtime assets are `ort-wasm-simd-threaded.wasm` (14,264,838 bytes) and `ort-wasm-simd-threaded.mjs` (24,381 bytes). These are copied from the installed, lockfile-pinned npm package. The app's first audit needs **37,974,266 bytes** of model/runtime assets, plus the smaller app and worker JavaScript. [ONNX Runtime package](https://registry.npmjs.org/onnxruntime-web/1.31.0-dev.20260914-8d85527a0).

The generated [web-assets.json](web-assets.json) records the exact SHA-256 and byte length of every published app, model, runtime, and license asset. The build generates the worker's asset manifest from the same verified sources. Browser downloads use fixed same-origin URLs under the site's own project prefix; they never contain a change, release-note text, filename supplied by a user, or input-derived headers or bodies.

The worker checks SHA-256 before using each asset and before reusing it from CacheStorage. Only model/runtime bytes are cached. If browser storage is unavailable, the worker uses verified bytes in memory and reports that persistence was unavailable. The JavaScript factory is imported from a Blob made from verified bytes, and the verified WASM bytes are passed directly to the runtime. A custom memory cache exposes only verified assets to Transformers.js's file registry; it cannot fetch or persist inputs. The worker disables remote models, filesystem/browser caches inside Transformers.js, and runtime proxy workers; it uses one WASM thread so cross-origin isolation headers are unnecessary. No sharp package, Node native inference library, or native DLL is included in the browser bundle. Original model attribution, Apache licenses, and ONNX Runtime's MIT license and full third-party notices accompany the browser assets. [Third-party inventory](THIRD_PARTY.md).

Successful audits retain the verified model in the worker for another run. Canceling or clearing the app terminates that worker, stopping download/inference and discarding its memory. Changes and notes are used in memory and are not written to browser storage. A loaded page with an initialized worker can audit again without network access. Reloading the app offline is not guaranteed; there is no service worker providing an offline app shell.

## Offline behavior

Installing npm dependencies and explicitly bootstrapping the pinned model require network access. Auditing then uses local files with remote model loading disabled (`env.allowRemoteModels = false`, `local_files_only: true`) and the CPU device selected. A missing or corrupt cache must produce an actionable error; auditing must not silently fetch weights or substitute a different model. The CLI reads only the local inputs chosen by the operator.

The local path and remote-loading controls are supported by Transformers.js; its `q8` file suffix is `_quantized`. These APIs were checked in the installed 4.3.1 package. The [environment API documentation](https://huggingface.co/docs/transformers.js/api/env) describes the loading controls, and the [dtype guide](https://huggingface.co/docs/transformers.js/guides/dtypes) describes explicit quantization selection.

The included [local verification record](../demo/model-verification.json) records a successful CPU run on Node.js `v26.8.1`, Windows x64. The [verification script](../scripts/verify-model.mjs) replaces `globalThis.fetch` with a throwing function before loading the model and checks finite 384-component normalized vectors, a paraphrase ranking above an unrelated example, and detection of a truncated long input. This is evidence for that machine and fixture, not a claim that every operating system or Node version has been tested.

## Text limits and review responsibility

The upstream model's intended default limit is **256 word pieces**. The exported config and tokenizer advertise a 512-token architectural maximum; that is not evidence that longer inputs are equally suitable. Release Sieve uses a 256-token limit for each encoded text, including special tokens, and records a count of truncated inputs in the report. It tokenizes directly with an explicit limit before pooling the model output. Long messages need concise evidence summaries; text after that limit may not influence a match. [Upstream intended use](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2#intended-uses), [pinned configuration](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/751bff37182d3f1213fa05d7196b954e230abad9/config.json), [pinned tokenizer configuration](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/751bff37182d3f1213fa05d7196b954e230abad9/tokenizer_config.json).

Cosine similarity ranks possible relationships. It is not a calibrated probability, a factuality check, or proof that a bullet fully covers a change. Similar wording can hide opposite behavior, different versions, numbers, flags, identifiers, or scope. English prose is the intended use here; other languages, terse code-only changes, and project-specific jargon can be unreliable. Quantization and numerical differences between Node CPU and browser WASM can change scores, especially near a threshold. Default thresholds are review heuristics. Human review remains necessary for ambiguous matches, breaking changes, omissions, and final release notes.

The synthetic demonstration verifies behavior on its included fixtures. It does not establish general accuracy, customer demand, revenue, or time saved. Release Sieve has not fine-tuned or benchmarked this model on private repository data.

The [frozen 48-case synthetic evaluation](../evaluation/README.md) separately measures author-specified correspondence decisions against lexical baselines, including negative outcomes. No model/default-policy tuning used the reporting cases. It found useful paraphrase associations and substantial contradiction failures; all eight deliberately contradictory notes were accepted by the default semantic policy. This is a short-English diagnostic suite, not independent human annotation, a representative release sample, or proof of factual coverage. Coarse native/WASM timing observations and every case are retained.
