import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ROOT } from '../src/model.mjs';
import { MODEL_MANIFEST } from '../web/model-manifest.mjs';
import { evaluateScenario, summarizeEvaluation, summarizeTiming, validateScenario } from '../evaluation/metrics.mjs';
import { verifyFreeze } from '../evaluation/freeze.mjs';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--out' || !args[1])) {
  throw new Error('Usage: node scripts/benchmark-browser.mjs [--out evaluation/results/my-browser.json]');
}
const outputPath = path.resolve(ROOT, args[1] || 'evaluation/results/browser.json');
if (!outputPath.startsWith(path.resolve(ROOT) + path.sep)) {
  throw new Error('Benchmark output must be inside this project directory.');
}
try {
  await access(outputPath);
  throw new Error('Benchmark output already exists. Choose a new --out filename to preserve previous observations.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// Freeze verification happens before starting any inference or browser process.
// There are no synthetic model responses in this harness: every report comes
// from the exact shipped docs/assets/worker.mjs and its pinned WASM assets.
const freeze = await verifyFreeze();
const fixtureBytes = await readFile(path.join(ROOT, freeze.splits.evaluation.path));
const workloadBytes = await readFile(path.join(ROOT, freeze.splits.timing.path));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256(fixtureBytes), freeze.splits.evaluation.sha256);
assert.equal(sha256(workloadBytes), freeze.splits.timing.sha256);
const fixtures = JSON.parse(fixtureBytes).scenarios;
const workload = JSON.parse(workloadBytes);
assert.equal(fixtures.length, 48);
assert.equal(workload.changes.length, 20);
assert.equal(workload.notes.length, 12);
for (const fixture of fixtures) validateScenario(fixture);
const policy = Object.freeze({ threshold: 0.48, margin: 0.06 });
const assets = [...MODEL_MANIFEST.files, ...MODEL_MANIFEST.runtime.files];
const assetBytes = assets.reduce((sum, file) => sum + file.bytes, 0);
assert.equal(assets.length, 6);
assert.equal(assetBytes, 37_974_266);
assert.equal(MODEL_MANIFEST.revision, freeze.model.revision);
const cacheName = `release-sieve-assets-${MODEL_MANIFEST.revision}-${MODEL_MANIFEST.runtime.version}`;
const temporaryRoot = path.resolve(process.env.RELEASE_SIEVE_TEST_TMP || os.tmpdir());
const work = await mkdtemp(path.join(temporaryRoot, 'release-sieve-browser-benchmark-'));
const samples = { contextModelCold: [], cachedFreshWorker: [], warmReusedWorker: [] };
const requests = [];
const browserErrors = [];
let browser;
let server;

async function serverURL() {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Loopback server did not start.')), 15_000);
    server.stdout.on('data', (bytes) => {
      output += bytes.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    server.once('error', (error) => { clearTimeout(timer); reject(error); });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Loopback server exited ${code}.`)); });
  });
}

async function benchmarkPage(context, origin) {
  const page = await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(error.message));
  // A blank same-origin harness prevents the product UI from affecting timings.
  // Only this document is supplied by the harness; the worker and every model
  // asset are served unchanged from the existing public docs build.
  await page.route(`${origin}/__benchmark__.html`, (route) => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>Release Sieve benchmark</title>',
  }));
  await page.goto(`${origin}/__benchmark__.html`, { waitUntil: 'load' });
  await page.evaluate(() => {
    globalThis.releaseSieveBenchmarkWorker = new Worker('/assets/worker.mjs', { type: 'module' });
    globalThis.releaseSieveBenchmarkRun = 0;
  });
  return page;
}

async function workerAudit(page, input) {
  const result = await page.evaluate(({ input, policy }) => new Promise((resolve, reject) => {
    const worker = globalThis.releaseSieveBenchmarkWorker;
    const runId = ++globalThis.releaseSieveBenchmarkRun;
    const phases = new Set();
    let progressMessages = 0;
    let lastProgress = 0;
    const timer = setTimeout(() => {
      worker.removeEventListener('message', message);
      worker.removeEventListener('error', failure);
      reject(new Error('Real browser worker audit exceeded its deadline.'));
    }, 120_000);
    function cleanup() {
      clearTimeout(timer);
      worker.removeEventListener('message', message);
      worker.removeEventListener('error', failure);
    }
    function failure(event) { cleanup(); reject(new Error(event.message || 'Browser worker failed.')); }
    function message(event) {
      const value = event.data;
      if (value.runId !== runId) return;
      if (value.type === 'progress') {
        if (value.percent < lastProgress) { cleanup(); reject(new Error('Worker progress moved backwards.')); return; }
        lastProgress = value.percent;
        progressMessages++;
        phases.add(value.phase);
      } else if (value.type === 'error') {
        cleanup(); reject(new Error(value.message));
      } else if (value.type === 'result') {
        const messageRoundTripMs = performance.now() - started;
        cleanup();
        resolve({ report: value.report, messageRoundTripMs, progressMessages, phases: [...phases], lastProgress });
      }
    }
    worker.addEventListener('message', message);
    worker.addEventListener('error', failure);
    const started = performance.now();
    worker.postMessage({ type: 'run', runId, changes: input.changes, notes: input.notes, synthetic: true, ...policy });
  }), { input, policy });
  assert.equal(result.report.model.device, 'wasm');
  assert.equal(result.report.model.localInference, true);
  assert.equal(result.report.model.revision, MODEL_MANIFEST.revision);
  assert.equal(result.report.diagnostics.truncatedInputs, 0);
  assert.equal(result.report.diagnostics.assetCount, 6);
  assert.equal(result.lastProgress, 100);
  return result;
}

function recordSample(result, index) {
  return { sample: index + 1, messageRoundTripMs: result.messageRoundTripMs,
    diagnostics: result.report.diagnostics, summary: result.report.summary,
    progressMessages: result.progressMessages, phases: result.phases };
}

async function verifyCache(page, origin) {
  const expected = assets.map((asset) => ({ ...asset, url: new URL(asset.url, origin + '/').href }));
  const actual = await page.evaluate(async ({ cacheName, expected }) => {
    const names = await caches.keys();
    const cache = await caches.open(cacheName);
    const urls = (await cache.keys()).map((request) => request.url).sort();
    const files = [];
    for (const file of expected) {
      const response = await cache.match(file.url);
      if (!response) throw new Error(`Missing cached public asset ${file.path}.`);
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      files.push({ path: file.path, bytes: bytes.byteLength,
        sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('') });
    }
    return { names, urls, files, localStorageItems: localStorage.length, sessionStorageItems: sessionStorage.length };
  }, { cacheName, expected });
  assert.deepEqual(actual.names, [cacheName]);
  assert.deepEqual(actual.urls, expected.map((file) => file.url).sort());
  assert.deepEqual(actual.files, assets.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })));
  assert.equal(actual.localStorageItems, 0);
  assert.equal(actual.sessionStorageItems, 0);
}

function summarizeSamples(cohort) {
  return Object.fromEntries(['messageRoundTripMs', 'durationMs', 'assetLoadMs', 'modelLoadMs', 'inferenceMs'].map((field) => [
    field, summarizeTiming(cohort.map((sample) => field === 'messageRoundTripMs' ? sample[field] : sample.diagnostics[field])),
  ]));
}

try {
  server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve-web.mjs')], {
    windowsHide: true, env: { ...process.env, RELEASE_SIEVE_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const origin = await serverURL();
  browser = await chromium.launch({ channel: process.env.RELEASE_SIEVE_BROWSER || 'msedge',
    headless: true, chromiumSandbox: true, env: { ...process.env, TEMP: work, TMP: work } });
  const contexts = [];
  // Five isolated asset caches. Models are terminated after each audit so that
  // later trials do not intentionally keep five model instances resident.
  for (let index = 0; index < 5; index++) {
    const context = await browser.newContext();
    context.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push({ url: request.url(), method: request.method(), body: request.postData() });
    });
    contexts.push(context);
    const page = await benchmarkPage(context, origin);
    assert.deepEqual(await page.evaluate(() => caches.keys()), []);
    const result = await workerAudit(page, workload);
    assert.equal(result.report.diagnostics.reusedModel, false);
    assert.equal(result.report.diagnostics.cachedAssets, 0);
    assert.equal(result.report.diagnostics.downloadedBytes, assetBytes);
    assert.equal(result.report.diagnostics.persistentCacheAvailable, true);
    samples.contextModelCold.push(recordSample(result, index));
    await verifyCache(page, origin);
    await page.evaluate(() => globalThis.releaseSieveBenchmarkWorker.terminate());
    await page.close();
    console.log(`Browser context/model-cold sample ${index + 1}/5 completed.`);
  }
  let warmPage;
  for (let index = 0; index < 5; index++) {
    const page = await benchmarkPage(contexts[index], origin);
    const beforeRequests = requests.length;
    const result = await workerAudit(page, workload);
    assert.equal(result.report.diagnostics.reusedModel, false);
    assert.equal(result.report.diagnostics.cachedAssets, 6);
    assert.equal(result.report.diagnostics.downloadedBytes, 0);
    assert.equal(result.report.diagnostics.persistentCacheAvailable, true);
    // A new worker module is fetched; no model/runtime asset may be downloaded.
    assert.ok(requests.slice(beforeRequests).every((request) => !assets.some((asset) => request.url === new URL(asset.url, origin + '/').href)));
    samples.cachedFreshWorker.push(recordSample(result, index));
    if (index === 4) warmPage = page;
    else await contexts[index].close();
    console.log(`Browser cached fresh-worker sample ${index + 1}/5 completed.`);
  }
  for (let index = 0; index < 10; index++) {
    const beforeRequests = requests.length;
    const result = await workerAudit(warmPage, workload);
    assert.equal(result.report.diagnostics.reusedModel, true);
    assert.equal(result.report.diagnostics.cachedAssets, 0);
    assert.equal(result.report.diagnostics.downloadedBytes, 0);
    assert.equal(requests.length, beforeRequests);
    samples.warmReusedWorker.push(recordSample(result, index));
  }
  console.log('Browser warm reused-worker samples 10/10 completed. Starting frozen held-out evaluation.');
  const rows = [];
  const cases = [];
  for (const fixture of fixtures) {
    const result = await workerAudit(warmPage, fixture);
    assert.equal(result.report.diagnostics.reusedModel, true);
    assert.equal(result.report.diagnostics.downloadedBytes, 0);
    const evaluated = evaluateScenario(fixture, result.report);
    rows.push(...evaluated);
    cases.push({ scenarioId: fixture.id, diagnostics: result.report.diagnostics,
      messageRoundTripMs: result.messageRoundTripMs, summary: result.report.summary, outcomes: evaluated });
  }
  await verifyCache(warmPage, origin);
  assert.deepEqual(browserErrors, []);
  assert.ok(requests.every((request) => request.method === 'GET' && request.body === null && new URL(request.url).origin === origin));
  const evidence = {
    schemaVersion: 1, evaluatedAtUTC: new Date().toISOString(),
    freeze: { frozenAtUTC: freeze.frozenAtUTC, baseProductCommit: freeze.baseProductCommit,
      fixtureSHA256: freeze.splits.evaluation.sha256, timingWorkloadSHA256: freeze.splits.timing.sha256 },
    environment: { osPlatform: os.platform(), architecture: os.arch(), browserChannel: process.env.RELEASE_SIEVE_BROWSER || 'msedge',
      browserVersion: await browser.version(), nodeVersion: process.version,
      transformersVersion: MODEL_MANIFEST.runtime.version, onnxRuntimeVersion: MODEL_MANIFEST.runtime.backendVersion,
      backend: 'WASM', threads: 1, headless: true, chromiumSandbox: true },
    model: { id: MODEL_MANIFEST.id, revision: MODEL_MANIFEST.revision, dtype: MODEL_MANIFEST.dtype,
      dimensions: MODEL_MANIFEST.dimensions, maxTokens: MODEL_MANIFEST.maxTokens },
    policy,
    workload: { changes: 20, notes: 12, eligibleChanges: 16, encodedTexts: 28, truncatedInputs: 0 },
    timingDefinition: {
      messageRoundTripMs: 'Page performance.now immediately before postMessage until the result event; includes worker startup on fresh workers, hashing/loading/inference, progress messaging and report transfer; excludes browser launch, server startup, page creation and UI rendering.',
      diagnostics: 'Worker-reported integer milliseconds. durationMs starts inside the run handler; assetLoadMs includes downloading/cache reads and SHA-256 checks; modelLoadMs covers tokenizer/model initialization; inferenceMs covers tokenization and embedding.',
      cold: 'Five fresh isolated browser contexts with empty public-asset CacheStorage. A shared browser process, local loopback server and OS disk/code caches are not flushed; this is context/model cold, not cold OS disk.',
      cached: 'Five fresh pages/workers using the six verified public assets saved by their paired cold contexts; model initialization still occurs.',
      warm: 'Ten audits in one already initialized worker following its cached fresh-worker run; no samples discarded.',
      transfer: 'Loopback asset transfer is not a public-network download-speed measurement. Downloaded bytes come from each worker diagnostic.',
      memory: 'Not measured; no memory claim.',
    },
    timing: Object.fromEntries(Object.entries(samples).map(([name, cohort]) => [name, { summary: summarizeSamples(cohort), samples: cohort }])),
    evaluation: { scenarios: fixtures.length, labelOrigin: 'author-defined synthetic specification, not independent human annotation',
      summary: summarizeEvaluation(rows), cases },
    checks: { realShippedWorker: true, frozenInputsVerified: true, assetCacheSHA256Verified: true,
      sixPublicAssetsOnly: true, sameOriginGETOnly: true, requestBodiesAbsent: true,
      draftLocalStorageItems: 0, draftSessionStorageItems: 0, javascriptErrors: 0,
      modelOrRuntimeBytesDownloadedPerColdSample: assetBytes, cachedAndWarmDownloadsZero: true },
    limitations: ['Synthetic author-defined labels are not representative production data or commercial validation.',
      'The score policy is unchanged and advisory; accepted matches can be unsafe or wrong.',
      'Single installed Chromium-family browser on one coarse OS/architecture; no physical mobile, Safari or Firefox timing.',
      'Timing samples share a browser process and loopback server; no claims about public-hosting latency, cold disk or memory.'],
  };
  await verifyFreeze();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ timing: Object.fromEntries(Object.entries(evidence.timing).map(([name, value]) => [name, value.summary])),
    ordinary: evidence.evaluation.summary.ordinary, scenarios: fixtures.length }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) server.kill();
  const resolved = path.resolve(work);
  if (path.dirname(resolved) === temporaryRoot && path.basename(resolved).startsWith('release-sieve-browser-benchmark-')) {
    await rm(resolved, { recursive: true, force: true });
  }
}
