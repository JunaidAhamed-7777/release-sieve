import { readFile,writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT,MODEL } from '../src/model.mjs';
import { sha256 } from '../evaluation/freeze.mjs';
import { validateScenario } from '../evaluation/metrics.mjs';

const paths=[
  'evaluation/fixtures.json','evaluation/calibration.json','evaluation/timing-workload.json',
  'evaluation/PROTOCOL.md','evaluation/FIXTURES.md','evaluation/lexical.mjs','evaluation/metrics.mjs','evaluation/selection.mjs','evaluation/freeze.mjs',
  'scripts/freeze-evaluation.mjs','scripts/benchmark-native.mjs','scripts/benchmark-browser.mjs','scripts/serve-web.mjs',
  'src/audit.mjs','src/model.mjs','web/worker.mjs','web/model-manifest.mjs','web/transformers-bert.mjs',
  'docs/assets/worker.mjs','docs/web-assets.json','model-lock.json','package.json','package-lock.json',
];
const files=[];
for(const relative of paths){
  const filename=path.join(ROOT,relative);
  const original=await readFile(filename,'utf8');
  const normalized=original.replace(/\r\n/g,'\n');
  if(normalized!==original)await writeFile(filename,normalized);
  const bytes=await readFile(filename);
  files.push({path:relative,bytes:bytes.length,sha256:sha256(bytes)});
}
const data=async relative=>JSON.parse(await readFile(path.join(ROOT,relative),'utf8'));
const reporting=await data('evaluation/fixtures.json');
const calibration=await data('evaluation/calibration.json');
const workload=await data('evaluation/timing-workload.json');
assert.equal(reporting.scenarios.length,48);assert.equal(calibration.scenarios.length,12);
assert.equal(workload.changes.length,20);assert.equal(workload.notes.length,12);
reporting.scenarios.forEach(validateScenario);calibration.scenarios.forEach(validateScenario);
const ids=new Set();for(const scenario of [...reporting.scenarios,...calibration.scenarios]){assert.equal(ids.has(scenario.id),false);ids.add(scenario.id);}
const {stdout}=await promisify(execFile)('git',['rev-parse','HEAD'],{cwd:ROOT,windowsHide:true});
const digest=relative=>files.find(file=>file.path===relative).sha256;
const freeze={schemaVersion:1,frozenAtUTC:new Date().toISOString(),baseProductCommit:stdout.trim(),model:{id:MODEL.id,revision:MODEL.revision,dtype:MODEL.dtype,maxTokens:MODEL.maxTokens},files,
  splits:{evaluation:{path:'evaluation/fixtures.json',sha256:digest('evaluation/fixtures.json'),scenarios:48},calibration:{path:'evaluation/calibration.json',sha256:digest('evaluation/calibration.json'),scenarios:12},timing:{path:'evaluation/timing-workload.json',sha256:digest('evaluation/timing-workload.json'),changes:20,notes:12}},
  disclosure:'Fixtures and evaluator frozen before scoring; author-defined synthetic specification, not independent human annotation. No model/default-policy change.'};
await writeFile(path.join(ROOT,'evaluation/freeze.json'),JSON.stringify(freeze,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({frozenAtUTC:freeze.frozenAtUTC,baseProductCommit:freeze.baseProductCommit,splits:freeze.splits,files:files.length},null,2));
