import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT,MODEL } from '../src/model.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Refuse scoring if any declared protocol, input, model lock or evaluator changed. */
export async function verifyFreeze() {
  const freeze=JSON.parse(await readFile(path.join(ROOT,'evaluation/freeze.json'),'utf8'));
  if(freeze.schemaVersion!==1||freeze.model.id!==MODEL.id||freeze.model.revision!==MODEL.revision)throw new Error('Evaluation freeze does not match the pinned model.');
  if(!Array.isArray(freeze.files)||!freeze.files.length)throw new Error('Evaluation freeze has no files.');
  for(const file of freeze.files){
    if(typeof file.path!=='string'||file.path.includes('\\')||file.path.startsWith('/')||file.path.split('/').some(part=>part==='..'||part===''))throw new Error('Unsafe evaluation freeze path.');
    const bytes=await readFile(path.join(ROOT,...file.path.split('/')));
    if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw new Error(`Frozen evaluation changed: ${file.path}. Preserve this version and create a new protocol before reporting different inputs.`);
  }
  return freeze;
}
