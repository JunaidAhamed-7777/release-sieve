import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/model.mjs';
import { MODEL_MANIFEST } from '../web/model-manifest.mjs';

// Exercise the real browser worker and model. Only the public asset cache and
// cache-open failure are altered; model responses and inference are not mocked.
const assets = [...MODEL_MANIFEST.files, ...MODEL_MANIFEST.runtime.files];
const assetBytes = assets.reduce((sum, file) => sum + file.bytes, 0);
const expectedSummary = { changes: 6, notes: 4, needsReview: 3, matched: 1, internal: 2 };
const cacheName = `release-sieve-assets-${MODEL_MANIFEST.revision}-${MODEL_MANIFEST.runtime.version}`;
const cacheRoot = path.join(ROOT, '.cache');
await mkdir(cacheRoot, { recursive: true });
const work = await mkdtemp(path.join(cacheRoot, 'web-cache-test-'));
const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve-web.mjs')], {
  windowsHide: true,
  env: { ...process.env, RELEASE_SIEVE_PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
const evidence = {
  verifiedAt: new Date().toISOString(),
  model: { id: MODEL_MANIFEST.id, revision: MODEL_MANIFEST.revision, device: 'wasm' },
  checks: {},
  runs: [],
};

function serverURL() {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Local app server did not start.')), 15_000);
    server.stdout.on('data', (bytes) => {
      output += bytes.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    server.once('error', (error) => { clearTimeout(timer); reject(error); });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Local server exited ${code}.`)); });
  });
}

async function ready(page) {
  await Promise.race([
    page.locator('#run-status').filter({ hasText: 'Review ready.' }).waitFor({ timeout: 120_000 }),
    page.locator('#retry-button').waitFor({ timeout: 120_000 }).then(async () => {
      throw new Error(await page.locator('#run-detail').innerText());
    }),
  ]);
  assert.equal(await page.locator('#results').isVisible(), true);
}

async function run(page, name) {
  await page.locator('#run-button').click();
  await ready(page);
  const pending = page.waitForEvent('download');
  await page.locator('#export-json').click();
  const download = await pending;
  const target = path.join(work, `${name}.json`);
  await download.saveAs(target);
  const report = JSON.parse(await readFile(target, 'utf8'));
  assert.deepEqual(report.summary, expectedSummary);
  assert.equal(report.model.device, 'wasm');
  assert.equal(report.model.localInference, true);
  assert.equal(report.model.revision, MODEL_MANIFEST.revision);
  assert.equal(report.diagnostics.assetCount, assets.length);
  evidence.runs.push({ name, summary: report.summary, diagnostics: report.diagnostics });
  return report;
}

async function inspectCache(page, origin) {
  const expected = assets.map((file) => ({ ...file, url: new URL(file.url, origin + '/').href }));
  const actual = await page.evaluate(async ({ cacheName, expected }) => {
    const names = await caches.keys();
    const cache = await caches.open(cacheName);
    const keys = (await cache.keys()).map((request) => request.url).sort();
    const files = [];
    for (const file of expected) {
      const response = await cache.match(file.url);
      if (!response) throw new Error(`Missing cached ${file.path}.`);
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
      files.push({ path: file.path, bytes: bytes.byteLength, sha256 });
    }
    return { names, keys, files };
  }, { cacheName, expected });
  assert.deepEqual(actual.names, [cacheName]);
  assert.deepEqual(actual.keys, expected.map((file) => file.url).sort());
  assert.deepEqual(actual.files, assets.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })));
  return actual.files;
}

async function noDraftPersistence(page, expectedCacheNames) {
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: (await indexedDB.databases()).map((database) => database.name).sort(),
    caches: (await caches.keys()).sort(),
  }));
  assert.deepEqual(storage, { local: 0, session: 0, databases: [], caches: [...expectedCacheNames].sort() });
}

try {
  const url = await serverURL();
  const assetURLs = new Set(assets.map((file) => new URL(file.url, url + '/').href));
  browser = await chromium.launch({
    channel: process.env.RELEASE_SIEVE_BROWSER || 'msedge',
    headless: true,
    chromiumSandbox: true,
    env: {
      ...process.env,
      ...(process.env.RELEASE_SIEVE_TEST_TMP ? { TEMP: process.env.RELEASE_SIEVE_TEST_TMP, TMP: process.env.RELEASE_SIEVE_TEST_TMP } : {}),
    },
  });
  const context = await browser.newContext({ acceptDownloads: true, reducedMotion: 'reduce' });
  const requests = [];
  const errors = [];
  const workers = [];
  context.on('request', (request) => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.goto(url, { waitUntil: 'load' });
  const cold = await run(page, 'cold public asset cache');
  assert.equal(cold.diagnostics.reusedModel, false);
  assert.equal(cold.diagnostics.cachedAssets, 0);
  assert.equal(cold.diagnostics.downloadedBytes, assetBytes);
  assert.equal(cold.diagnostics.persistentCacheAvailable, true);
  assert.equal(requests.filter((request) => assetURLs.has(request.url)).length, assets.length);
  const hashes = await inspectCache(page, url);
  await noDraftPersistence(page, [cacheName]);
  evidence.checks.coldRealInferenceAndSixCachedHashes = true;
  evidence.cachedAssets = hashes;
  console.log('PASS: cold real WASM inference; all six public cache assets match pinned SHA-256 hashes.');

  const beforeReload = requests.length;
  const workerCount = workers.length;
  await page.reload({ waitUntil: 'load' });
  const fresh = await run(page, 'fresh worker after page reload');
  assert.equal(workers.length, workerCount + 1);
  assert.equal(fresh.diagnostics.reusedModel, false);
  assert.equal(fresh.diagnostics.cachedAssets, assets.length);
  assert.equal(fresh.diagnostics.downloadedBytes, 0);
  assert.equal(fresh.diagnostics.persistentCacheAvailable, true);
  assert.deepEqual(requests.slice(beforeReload).filter((request) => assetURLs.has(request.url)), []);
  await inspectCache(page, url);
  await noDraftPersistence(page, [cacheName]);
  evidence.checks.pageReloadUsesVerifiedCacheWithNoAssetDownloads = true;
  console.log('PASS: page reload creates a fresh worker, verifies six cached assets, and performs real inference without asset downloads.');

  const config = assets.find((file) => file.path === 'config.json');
  assert.ok(config);
  const configURL = new URL(config.url, url + '/').href;
  // Corrupt a public model asset in this temporary context, retaining its size
  // so hash validation, rather than only the length check, must reject it.
  const corruption = await page.evaluate(async ({ cacheName, configURL }) => {
    const cache = await caches.open(cacheName);
    const response = await cache.match(configURL);
    const bytes = new Uint8Array(await response.arrayBuffer());
    bytes[0] ^= 1;
    await cache.put(configURL, new Response(bytes, { headers: { 'Content-Type': 'application/json' } }));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return { bytes: bytes.byteLength, sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('') };
  }, { cacheName, configURL });
  assert.equal(corruption.bytes, config.bytes);
  assert.notEqual(corruption.sha256, config.sha256);
  const beforeRecovery = requests.length;
  await page.reload({ waitUntil: 'load' });
  const recovered = await run(page, 'hash-corrupted config recovery');
  assert.equal(recovered.diagnostics.reusedModel, false);
  assert.equal(recovered.diagnostics.cachedAssets, assets.length - 1);
  assert.equal(recovered.diagnostics.downloadedBytes, config.bytes);
  assert.equal(recovered.diagnostics.persistentCacheAvailable, true);
  assert.deepEqual(requests.slice(beforeRecovery).filter((request) => assetURLs.has(request.url)).map((request) => request.url), [configURL]);
  await inspectCache(page, url);
  await noDraftPersistence(page, [cacheName]);
  evidence.checks.corruptSameLengthAssetRedownloadsOnlyConfig = true;
  console.log(`PASS: a same-length corrupt config is replaced with ${config.bytes} pinned bytes; the other five assets are reused.`);

  // A separate temporary context has no prior model cache. Change only the
  // worker's CacheStorage.open result to exercise its real memory-only fallback.
  const denied = await browser.newContext({ acceptDownloads: true, reducedMotion: 'reduce' });
  const deniedRequests = [];
  denied.on('request', (request) => deniedRequests.push({ url: request.url(), method: request.method(), body: request.postData() }));
  let modifiedWorkers = 0;
  await denied.route('**/assets/worker.mjs', async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    const original = await response.text();
    const override = "Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async () => { throw new DOMException('Synthetic cache-open denial', 'QuotaExceededError'); } } });\n";
    modifiedWorkers++;
    await route.fulfill({ response, body: override + original });
  });
  const deniedPage = await denied.newPage();
  deniedPage.on('pageerror', (error) => errors.push(error.message));
  await deniedPage.goto(url, { waitUntil: 'load' });
  const unavailable = await run(deniedPage, 'persistent CacheStorage unavailable');
  assert.equal(modifiedWorkers, 1);
  assert.equal(unavailable.diagnostics.reusedModel, false);
  assert.equal(unavailable.diagnostics.cachedAssets, 0);
  assert.equal(unavailable.diagnostics.downloadedBytes, assetBytes);
  assert.equal(unavailable.diagnostics.persistentCacheAvailable, false);
  assert.ok(unavailable.warnings.some((warning) => /storage was unavailable/i.test(warning)));
  assert.equal(deniedRequests.filter((request) => assetURLs.has(request.url)).length, assets.length);
  await noDraftPersistence(deniedPage, []);
  evidence.checks.cacheOpenFailureStillUsesRealWasmInference = true;
  evidence.checks.unavailableCacheStoresNoDraftOrAssets = true;
  console.log('PASS: CacheStorage-open failure falls back to verified in-memory assets and real WASM inference without persistent input data.');

  const networkRequests = [...requests, ...deniedRequests].filter((request) => /^https?:/.test(request.url));
  assert.deepEqual(networkRequests.filter((request) => request.method !== 'GET' || request.body != null || new URL(request.url).origin !== url), []);
  assert.deepEqual(errors, []);
  evidence.checks.sameOriginGetRequestsWithoutBodies = true;
  evidence.checks.javascriptErrors = 0;
  evidence.browser = await browser.version();
  evidence.caveat = 'Synthetic workflows with actual pinned model inference. Cache denial is a controlled worker-only failure; these checks do not certify all browser storage failure modes or production accuracy.';
  await writeFile(path.join(ROOT, 'demo/web-cache-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  await denied.close();
  await context.close();
} finally {
  if (browser) await browser.close();
  server.kill();
  const resolved = path.resolve(work);
  if (path.dirname(resolved) !== path.resolve(cacheRoot) || !path.basename(resolved).startsWith('web-cache-test-')) throw new Error('Unsafe test artifact cleanup.');
  await rm(resolved, { recursive: true, force: true });
}
