import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { MODEL, MODEL_ROOT, manifest, verifyModelFiles } from '../src/model.mjs';

const lock = await manifest();
if (lock.id !== MODEL.id || lock.revision !== MODEL.revision) throw new Error('Unexpected model manifest.');
console.log(`Explicit download: ${MODEL.id}@${MODEL.revision} (Apache-2.0, public and ungated).`);
for (const file of lock.files) {
  const target = path.join(MODEL_ROOT, MODEL.id, file.path);
  try {
    const existing = await readFile(target);
    if (existing.length === file.bytes && createHash('sha256').update(existing).digest('hex') === file.sha256) {
      console.log(`Verified existing ${file.path}`); continue;
    }
  } catch { /* Download missing file below. */ }
  const url = `https://huggingface.co/${MODEL.id}/resolve/${MODEL.revision}/${file.path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${file.path}`);
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > file.bytes) throw new Error(`Unexpected download size for ${file.path}`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Downloaded integrity mismatch for ${file.path}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target + '.partial', bytes);
  await rename(target + '.partial', target);
  console.log(`Downloaded and SHA-256 verified ${file.path} (${bytes.length} bytes)`);
}
await verifyModelFiles();
console.log('Model ready. All audit commands now run with remote model loading disabled.');
