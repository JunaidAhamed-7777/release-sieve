# Third-party attribution and licenses

Release Sieve's original application code is licensed under [MIT](../LICENSE). That license does not replace the licenses of its model, runtime dependencies, or native libraries. The repository distributes application source and a dependency lockfile; model files and `node_modules` are installed separately.

## Model

[`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) is the Transformers.js-compatible ONNX export of [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2). Both repositories declare **Apache-2.0**. Attribution belongs to their respective upstream authors and contributors. Release Sieve downloads the existing, unmodified export; it does not train, convert, or relicense it. See [MODEL_CARD.md](MODEL_CARD.md) for the exact revision and file hashes, and [Apache-2.0](licenses/apache-2.0.txt) for the license text.

The pinned export repository has no separate `LICENSE` or `NOTICE` file in its file listing. Its `README.md` contains the license declaration and upstream attribution. This observation is specific to revision `751bff37182d3f1213fa05d7196b954e230abad9`; it is not a claim that downstream packaging needs no notices. [Pinned files](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/751bff37182d3f1213fa05d7196b954e230abad9).

## Runtime dependency inventory

The following versions and declared licenses were observed in the installed Windows x64 dependency tree on **2026-10-13**. `package-lock.json` is the exact dependency record. Platform-specific optional packages can differ on another operating system.

| Component | Observed version | Declared license | Role |
| --- | --- | --- | --- |
| `@huggingface/transformers` | 4.3.1 | Apache-2.0 | Model/tokenizer loading and embedding pipeline |
| `@huggingface/tokenizers` | 0.2.0 | Apache-2.0 | Tokenization dependency |
| `@huggingface/jinja` | 0.5.10 | MIT | Runtime dependency |
| `onnxruntime-node` | 1.30.0 | MIT | Native CPU inference |
| `onnxruntime-common` | 1.30.0 | MIT | ONNX Runtime JavaScript interfaces |
| `onnxruntime-web` | 1.31.0-dev.20260914-8d85527a0 | MIT | Transformers.js dependency; browser backend |
| `sharp` | 0.35.5 | Apache-2.0 | Transformers.js image-processing dependency |
| `@img/sharp-win32-x64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | Optional prebuilt native sharp/libvips package |

The npm metadata for the top-level runtime declares its dependency set and package license. The installed package files were also inspected, including sharp's native-package `README.md`, which enumerates additional bundled libraries and their licenses. [Transformers.js package metadata](https://registry.npmjs.org/@huggingface/transformers/4.3.1), [ONNX Runtime](https://github.com/microsoft/onnxruntime), [sharp licensing](https://sharp.pixelplumbing.com/#licensing), [sharp native package metadata](https://registry.npmjs.org/@img/sharp-win32-x64/0.35.5).

This table is an attribution guide, not a complete transitive software bill of materials. Installation preserves the packages' upstream license files, README attribution, and any notices. Release Sieve does not require image processing, but installing Transformers.js also installs its image-related dependencies.

## Redistributing dependencies or model files

Keep upstream licenses and copyright/attribution notices with any redistributed dependencies or model files. Apache-2.0 includes license-copy, changed-file marking, and applicable NOTICE preservation requirements. MIT components require their copyright and permission notices. The native sharp package includes LGPL libraries and additional notices; bundling those binaries into a standalone executable, image, or archive needs the corresponding license materials and applicable source/relinking provisions. The source-only Release Sieve repository does not bundle those binaries.

The original code, synthetic demo fixture, and documentation may use the repository's MIT license. Do not describe the entire dependency tree or the model weights as MIT. No model fine-tuning, model-weight modification, endorsement, customer results, or revenue is claimed.
