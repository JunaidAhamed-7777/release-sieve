import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const MODEL_ROOT = path.join(ROOT, '.models');
export const MODEL = Object.freeze({
  id: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  dtype: 'q8',
  dimensions: 384,
  maxTokens: 256,
  runtime: '@huggingface/transformers 4.3.1 / ONNX Runtime CPU',
  offline: true,
});

export async function manifest() {
  return JSON.parse(await readFile(path.join(ROOT, 'model-lock.json'), 'utf8'));
}

export async function verifyModelFiles() {
  const lock = await manifest();
  if (lock.id !== MODEL.id || lock.revision !== MODEL.revision) throw new Error('Model lock does not match the pinned model.');
  for (const file of lock.files) {
    const filename = path.join(MODEL_ROOT, MODEL.id, file.path);
    let bytes;
    try { bytes = await readFile(filename); }
    catch { throw new Error(`Missing local model file ${file.path}. Run npm run bootstrap once with internet access.`); }
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== file.bytes || hash !== file.sha256) throw new Error(`Integrity check failed for ${file.path}. Run npm run bootstrap to restore pinned files.`);
  }
  return lock;
}

export async function createEmbedder() {
  await verifyModelFiles();
  const { env, AutoTokenizer, AutoModel, mean_pooling } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useFSCache = false;
  env.localModelPath = MODEL_ROOT + path.sep;
  const options = { local_files_only: true, revision: MODEL.revision };
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL.id, options);
  const model = await AutoModel.from_pretrained(MODEL.id, {
    ...options, dtype: MODEL.dtype, device: 'cpu',
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
  let truncatedInputs = 0;
  return {
    info: MODEL,
    get truncatedInputs() { return truncatedInputs; },
    async embed(texts) {
      const result = [];
      // Bounded batches keep memory proportional to 8 short inputs rather than a release's size.
      for (let i = 0; i < texts.length; i += 8) {
        const batch = texts.slice(i, i + 8);
        for (const text of batch) {
          const tokens = tokenizer(text, { truncation: false, padding: false });
          if (tokens.input_ids.dims.at(-1) > MODEL.maxTokens) truncatedInputs++;
        }
        const inputs = tokenizer(batch, { padding: true, truncation: true, max_length: MODEL.maxTokens });
        const output = await model(inputs);
        const vectors = mean_pooling(output.last_hidden_state, inputs.attention_mask).normalize(2, -1).tolist();
        result.push(...vectors);
      }
      return result;
    },
    async dispose() { await model.dispose(); },
  };
}
