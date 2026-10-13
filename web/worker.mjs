import { BertModel, BertTokenizer, env, mean_pooling } from './transformers-bert.mjs';
import { audit, parseNotes, validateInputs } from '../src/audit.mjs';
import { MODEL_MANIFEST } from './model-manifest.mjs';

const SITE_ROOT = new URL('../', import.meta.url);
const CACHE_NAME = `release-sieve-assets-${MODEL_MANIFEST.revision}-${MODEL_MANIFEST.runtime.version}`;
const NETWORK_FETCH = globalThis.fetch.bind(globalThis);
const MODEL_BASE = new URL(`models/${MODEL_MANIFEST.revision}/`, SITE_ROOT);
const ALL_ASSETS = [...MODEL_MANIFEST.files, ...MODEL_MANIFEST.runtime.files];
const ALLOWED_URLS = new Set(ALL_ASSETS.map((file) => new URL(file.url, SITE_ROOT).href));
let running = false;
let initialized = null;

function localURL(request) {
  const url = new URL(request instanceof Request ? request.url : String(request), SITE_ROOT);
  if (url.origin !== SITE_ROOT.origin || url.search || url.hash) {
    throw new Error('Only fixed assets from this site may be requested.');
  }
  return url;
}

function responseFor(file, bytes) {
  return new Response(bytes.slice(), { status: 200, headers: {
    'Content-Type': file.path.endsWith('.json') ? 'application/json' : file.path.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream',
    'Content-Length': String(bytes.byteLength),
  } });
}

async function verifyBytes(file, bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== file.bytes || hash !== file.sha256) {
    throw new Error(`Integrity check failed for ${file.path}. Refresh the page and try again; the hosted asset must match the pinned build.`);
  }
}

async function downloadAssets(progress) {
  const verified = new Map();
  const totalBytes = ALL_ASSETS.reduce((sum, file) => sum + file.bytes, 0);
  let finishedBytes = 0;
  let downloadedBytes = 0;
  let cachedAssets = 0;
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); }
  catch { progress('download', 'Browser storage is unavailable. Assets will stay in memory for this run.', 2); }
  for (const file of ALL_ASSETS) {
    const url = new URL(file.url, SITE_ROOT).href;
    let bytes;
    const cached = cache ? await cache.match(url) : null;
    if (cached) {
      bytes = new Uint8Array(await cached.arrayBuffer());
      try {
        await verifyBytes(file, bytes);
        cachedAssets++;
        progress('verify', `Verified cached ${file.path}.`, 2 + (finishedBytes + file.bytes) / totalBytes * 68);
      } catch {
        await cache.delete(url);
        bytes = null;
        progress('verify', `Replacing an invalid cached ${file.path}.`, 2 + finishedBytes / totalBytes * 68);
      }
    }
    if (!bytes) {
      progress('download', `Downloading ${file.path} from this site.`, 2 + finishedBytes / totalBytes * 68);
      // No input-derived URLs, headers, body, credentials, or remote destinations.
      localURL(url);
      if (!ALLOWED_URLS.has(url)) throw new Error('Asset URL is outside the pinned manifest.');
      const response = await NETWORK_FETCH(url, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`Could not load ${file.path} (${response.status}). Keep this tab open and check your connection.`);
      bytes = new Uint8Array(file.bytes);
      let loaded = 0;
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (loaded + value.byteLength > file.bytes) {
            await reader.cancel();
            throw new Error(`Unexpected size for ${file.path}; refusing an unpinned asset.`);
          }
          bytes.set(value, loaded);
          loaded += value.byteLength;
          downloadedBytes += value.byteLength;
          progress('download', `Downloading ${file.path}: ${(loaded / 1_000_000).toFixed(1)} / ${(file.bytes / 1_000_000).toFixed(1)} MB.`, 2 + (finishedBytes + loaded) / totalBytes * 68);
        }
      } else {
        const downloaded = new Uint8Array(await response.arrayBuffer());
        loaded = downloaded.byteLength;
        downloadedBytes += loaded;
        bytes = downloaded;
      }
      if (loaded !== file.bytes) throw new Error(`Incomplete ${file.path}; expected ${file.bytes} bytes, received ${loaded}. Try again.`);
      progress('verify', `Checking SHA-256 for ${file.path}.`, 2 + (finishedBytes + file.bytes) / totalBytes * 68);
      await verifyBytes(file, bytes);
      if (cache) {
        try { await cache.put(url, responseFor(file, bytes)); }
        catch { cache = null; progress('verify', 'Browser storage is full or unavailable. Verified assets remain in memory for this run.', 2 + (finishedBytes + file.bytes) / totalBytes * 68); }
      }
    }
    finishedBytes += file.bytes;
    verified.set(url, { file, bytes });
  }
  return { verified, downloadedBytes, cachedAssets, assetCount: ALL_ASSETS.length, persistentCacheAvailable: Boolean(cache) };
}

function configureRuntime(verified) {
  const runtimeFile = (suffix) => {
    const file = MODEL_MANIFEST.runtime.files.find((candidate) => candidate.path.endsWith(suffix));
    return verified.get(new URL(file.url, SITE_ROOT).href).bytes;
  };
  // Runtime calls may read verified assets, but can never initiate a network request.
  const verifiedFetch = async (request, options = {}) => {
    const url = localURL(request);
    if (options.method && options.method !== 'GET') throw new Error('Inference may only read verified local assets.');
    const asset = verified.get(url.href);
    if (asset) return responseFor(asset.file, asset.bytes);
    if (url.href.startsWith(MODEL_BASE.href)) return new Response(null, { status: 404 });
    throw new Error('Inference attempted to request an asset outside the verified manifest.');
  };
  globalThis.fetch = verifiedFetch;
  env.fetch = verifiedFetch;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = MODEL_BASE.href;
  env.useBrowserCache = false;
  env.useFSCache = false;
  // Transformers.js 4's registry probes CacheInterface for local HTTP files.
  // Serve those probes only from bytes already verified above, without I/O.
  env.useCustomCache = true;
  env.customCache = {
    async match(request) {
      const url = new URL(request instanceof Request ? request.url : String(request), SITE_ROOT);
      const asset = verified.get(url.href);
      return asset ? responseFor(asset.file, asset.bytes) : undefined;
    },
    async put() { /* Only the verified asset loader may persist cache bytes. */ },
  };
  env.useWasmCache = false;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmBinary = runtimeFile('.wasm');
  const factoryURL = URL.createObjectURL(new Blob([runtimeFile('.mjs')], { type: 'text/javascript' }));
  env.backends.onnx.wasm.wasmPaths = {
    mjs: factoryURL,
    wasm: new URL(MODEL_MANIFEST.runtime.files.find((file) => file.path.endsWith('.wasm')).url, SITE_ROOT).href,
  };
  return factoryURL;
}

async function run(message) {
  const { runId, changes, threshold, margin } = message;
  let lastPercent = 0;
  const progress = (phase, text, percent) => {
    lastPercent = Math.max(lastPercent, Math.min(100, Number.isFinite(percent) ? percent : lastPercent));
    postMessage({ type: 'progress', runId, phase, message: text, percent: Math.round(lastPercent * 10) / 10 });
  };
  const started = performance.now();
  let pendingModel = null;
  let pendingFactoryURL = null;
  try {
    progress('validate', 'Checking input limits before loading any model assets.', 0);
    const notes = typeof message.notes === 'string' ? parseNotes(message.notes) : message.notes;
    validateInputs({ changes, notes, threshold, margin });
    if (!crypto.subtle) throw new Error('This app needs a secure browser context (HTTPS or localhost) for asset integrity checks.');
    let assetLoadMs = 0;
    let modelLoadMs = 0;
    const reusedModel = Boolean(initialized);
    let assets;
    if (!initialized) {
      const assetStarted = performance.now();
      assets = await downloadAssets(progress);
      assetLoadMs = Math.round(performance.now() - assetStarted);
      progress('loading', 'All assets verified. Loading the tokenizer and local WASM model.', 72);
      pendingFactoryURL = configureRuntime(assets.verified);
      const modelStarted = performance.now();
      const options = { local_files_only: true, revision: MODEL_MANIFEST.revision };
      const tokenizer = await BertTokenizer.from_pretrained(MODEL_MANIFEST.id, options);
      pendingModel = await BertModel.from_pretrained(MODEL_MANIFEST.id, { ...options, dtype: 'q8', device: 'wasm' });
      modelLoadMs = Math.round(performance.now() - modelStarted);
      initialized = { tokenizer, model: pendingModel, factoryURL: pendingFactoryURL, persistentCacheAvailable: assets.persistentCacheAvailable };
      pendingModel = null;
      pendingFactoryURL = null;
    } else {
      assets = { downloadedBytes: 0, cachedAssets: 0, assetCount: ALL_ASSETS.length, persistentCacheAvailable: initialized.persistentCacheAvailable };
      progress('loading', 'Reusing the verified model already loaded in this worker.', 76);
    }
    const { tokenizer, model } = initialized;
    progress('embedding', 'Local model ready. Encoding changes and release notes.', 78);
    let truncatedInputs = 0;
    let inferenceMs = 0;
    const embed = async (texts) => {
      const inferenceStarted = performance.now();
      const vectors = [];
      for (let index = 0; index < texts.length; index += 8) {
        const batch = texts.slice(index, index + 8);
        for (const text of batch) {
          const full = tokenizer(text, { padding: false, truncation: false });
          if (full.input_ids.dims.at(-1) > 256) truncatedInputs++;
        }
        const inputs = tokenizer(batch, { padding: true, truncation: true, max_length: 256 });
        const output = await model(inputs);
        vectors.push(...mean_pooling(output.last_hidden_state, inputs.attention_mask).normalize(2, -1).tolist());
        const completed = Math.min(index + batch.length, texts.length);
        progress('embedding', `Encoded ${completed} / ${texts.length} texts locally.`, 78 + completed / texts.length * 18);
      }
      inferenceMs = Math.round(performance.now() - inferenceStarted);
      return vectors;
    };
    const report = await audit({ changes, notes, threshold, margin, embed });
    progress('audit', 'Assembling source-linked matches and the human review queue.', 98);
    report.model = {
      id: MODEL_MANIFEST.id, revision: MODEL_MANIFEST.revision, dtype: 'q8', dimensions: 384,
      maxTokens: 256, runtime: `@huggingface/transformers ${MODEL_MANIFEST.runtime.version} / ONNX Runtime WASM`,
      device: 'wasm', localInference: true, offline: true,
    };
    report.input = { mode: 'browser', synthetic: Boolean(message.synthetic) };
    report.diagnostics = {
      durationMs: Math.round(performance.now() - started), truncatedInputs,
      assetLoadMs, modelLoadMs, inferenceMs, downloadedBytes: assets.downloadedBytes,
      cachedAssets: assets.cachedAssets, assetCount: assets.assetCount,
      persistentCacheAvailable: assets.persistentCacheAvailable, reusedModel,
      includesModelLoadAndHashVerification: !reusedModel,
    };
    report.warnings = ['Semantic similarity is advisory, not confidence or proof that a change is documented.'];
    if (truncatedInputs) report.warnings.push(`${truncatedInputs} inputs exceeded 256 wordpieces and were truncated; inspect them manually.`);
    if (!assets.persistentCacheAvailable) report.warnings.push('Browser storage was unavailable; model and runtime assets may need downloading on the next run.');
    progress('complete', 'Audit ready. Inspect related notes and all flagged changes.', 100);
    postMessage({ type: 'result', runId, report });
  } catch (error) {
    postMessage({ type: 'error', runId, message: error instanceof Error ? error.message : 'The local audit could not complete.' });
  } finally {
    // The main thread terminates this worker on cancel/clear. Successful runs
    // keep only verified runtime/model state for fast offline reuse; no drafts.
    if (pendingModel) await pendingModel.dispose();
    if (pendingFactoryURL) URL.revokeObjectURL(pendingFactoryURL);
  }
}

addEventListener('message', async ({ data }) => {
  if (!data || data.type !== 'run') return;
  if (running) { postMessage({ type: 'error', runId: data.runId, message: 'An audit is already running. Cancel it before starting another.' }); return; }
  running = true;
  try { await run(data); }
  finally { running = false; }
});
