import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ROOT } from '../src/model.mjs';
const exec = promisify(execFile);
const cli = path.join(ROOT,'src/cli.mjs');
test('CLI help is available without model initialization',async()=>{
  const {stdout}=await exec(process.execPath,[cli,'--help'],{windowsHide:true});
  assert.match(stdout,/Audits never download models/);
});
for(const [label,args,pattern] of [
  ['missing inputs',[],/Provide --notes/],
  ['unknown option',['--unknown'],/Unknown option/],
  ['invalid threshold',['--changes','demo/changes.json','--notes','demo/notes.md','--threshold','NaN'],/Threshold and margin/],
  ['ambiguous sources',['--changes','demo/changes.json','--repo','.','--notes','demo/notes.md'],/exactly one/],
]) test(`CLI rejects ${label} before inference`,async()=>{
  await assert.rejects(exec(process.execPath,[cli,...args],{cwd:ROOT,windowsHide:true}),error=>error.code===1 && pattern.test(error.stderr));
});
