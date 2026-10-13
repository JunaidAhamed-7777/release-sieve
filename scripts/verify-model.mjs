import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createEmbedder, MODEL, ROOT } from '../src/model.mjs';
import path from 'node:path';

// This test actively fails if any inference code attempts an HTTP fetch.
globalThis.fetch = async () => { throw new Error('Network fetch forbidden during offline verification'); };
const started = performance.now();
const embedder = await createEmbedder();
try {
  const texts = ['Prevent duplicate payment charges', 'Do not bill customers twice for one payment', 'Change the dashboard background color', 'invoice '.repeat(400)];
  const vectors = await embedder.embed(texts);
  for (const vector of vectors) {
    assert.equal(vector.length, 384);
    assert.ok(vector.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...vector) - 1) < 0.001);
  }
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const related = dot(vectors[0], vectors[1]), unrelated = dot(vectors[0], vectors[2]);
  assert.ok(related > unrelated + 0.2, `Expected paraphrase ranking: ${related} vs ${unrelated}`);
  assert.equal(embedder.truncatedInputs, 1);
  const evidence = {
    verifiedAt: new Date().toISOString(), model: MODEL,
    environment: { node: process.version, platform: process.platform, architecture: process.arch },
    checks: { dimensions:384, normalized:true, fetchForbidden:true, longInputTruncated:true },
    similarities: { related, unrelated },
    durationMs: Math.round(performance.now() - started),
    caveat: 'One local verification run, not a latency benchmark or production accuracy estimate.',
  };
  await writeFile(path.join(ROOT, 'demo', 'model-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { await embedder.dispose(); }
