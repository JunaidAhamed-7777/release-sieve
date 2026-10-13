import { readFile,mkdir,writeFile,access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT,MODEL,createEmbedder } from '../src/model.mjs';
import { audit } from '../src/audit.mjs';
import { verifyFreeze,sha256 } from '../evaluation/freeze.mjs';
import { evaluateScenario,summarizeEvaluation,summarizeTiming,validateScenario } from '../evaluation/metrics.mjs';
import { calibrateLexical,lexicalReport } from '../evaluation/selection.mjs';

const exec=promisify(execFile);
const readJSON=async filename=>JSON.parse(await readFile(path.join(ROOT,filename),'utf8'));
const rounded=value=>Math.round(value*1000)/1000;

async function timingChild(){
  await verifyFreeze();
  const workload=await readJSON('evaluation/timing-workload.json');
  globalThis.fetch=async()=>{throw new Error('Network access is forbidden in this native benchmark.');};
  const setupStart=performance.now();
  const embedder=await createEmbedder();
  const setupMs=performance.now()-setupStart;
  try{
    const start=performance.now();
    const report=await audit({...workload,embed:embedder.embed});
    const auditMs=performance.now()-start;
    assert.equal(embedder.truncatedInputs,0);
    console.log(JSON.stringify({setupMs:rounded(setupMs),auditMs:rounded(auditMs),modelAndAuditMs:rounded(setupMs+auditMs),truncatedInputs:embedder.truncatedInputs,summary:report.summary}));
  }finally{await embedder.dispose();}
}

async function main(){
  const {values}=parseArgs({options:{out:{type:'string',default:'evaluation/results/native.json'}},strict:true});
  const output=path.resolve(ROOT,values.out);
  try{await access(output);throw new Error('Output exists. Choose a different --out file to retain previous observations.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const freeze=await verifyFreeze();
  const fixtures=await readJSON('evaluation/fixtures.json');
  const calibration=await readJSON('evaluation/calibration.json');
  const workload=await readJSON('evaluation/timing-workload.json');
  fixtures.scenarios.forEach(validateScenario);calibration.scenarios.forEach(validateScenario);

  // Freeze/selection happens before any held-out model inference.
  const selected=await calibrateLexical(calibration.scenarios);
  console.log(`Lexical calibration selected ${selected.mode}${selected.mode==='gates'?` ${selected.threshold}/${selected.margin}`:''} before reporting-set inference.`);
  const fixed={mode:'gates',threshold:0.48,margin:0.06};
  const outcomes={semantic:[],lexicalFixed:[],lexicalCalibrated:[]};
  const reportRecords=[];
  globalThis.fetch=async()=>{throw new Error('Network access is forbidden in this native benchmark.');};
  const embedder=await createEmbedder();
  try{
    for(const scenario of fixtures.scenarios){
      const semantic=await audit({...scenario,threshold:0.48,margin:0.06,embed:embedder.embed});
      const lexicalFixed=await lexicalReport(scenario,fixed);
      const lexicalCalibrated=await lexicalReport(scenario,selected);
      for(const [name,report] of Object.entries({semantic,lexicalFixed,lexicalCalibrated}))outcomes[name].push(...evaluateScenario(scenario,report));
      reportRecords.push({scenarioId:scenario.id,semantic,lexicalFixed,lexicalCalibrated});
    }
    assert.equal(embedder.truncatedInputs,0,'The diagnostic fixture set must not silently truncate evidence.');
    const warm=[];
    let encodedTextCount=0;
    let encodedCharacters=0;
    const timingEmbed=async texts=>{encodedTextCount=texts.length;encodedCharacters=texts.reduce((sum,text)=>sum+text.length,0);return embedder.embed(texts);};
    for(let index=0;index<10;index++){
      const start=performance.now();
      const report=await audit({...workload,embed:timingEmbed});
      warm.push({auditMs:rounded(performance.now()-start),summary:report.summary,truncatedInputs:embedder.truncatedInputs});
    }
    assert.equal(embedder.truncatedInputs,0);
    const cold=[];
    for(let index=0;index<5;index++){
      const start=performance.now();
      const {stdout}=await exec(process.execPath,[path.join(ROOT,'scripts/benchmark-native.mjs'),'--timing-child'],{windowsHide:true,timeout:120000,maxBuffer:100000});
      const observation=JSON.parse(stdout.trim());
      assert.equal(observation.truncatedInputs,0);
      cold.push({...observation,processWallMs:rounded(performance.now()-start)});
    }
    const rawFixture=await readFile(path.join(ROOT,'evaluation/fixtures.json'));
    const rawCalibration=await readFile(path.join(ROOT,'evaluation/calibration.json'));
    const rawWorkload=await readFile(path.join(ROOT,'evaluation/timing-workload.json'));
    const backend=JSON.parse(await readFile(path.join(ROOT,'node_modules/onnxruntime-node/package.json'),'utf8')).version;
    const result={
      schemaVersion:1,measuredAt:new Date().toISOString(),baseProductCommit:freeze.baseProductCommit,
      environment:{os:process.platform,architecture:process.arch,node:process.version,backend:`onnxruntime-node ${backend}`,intraOpThreads:2,interOpThreads:1,memoryMeasured:false},
      model:MODEL,
      fixtures:{evaluationSha256:sha256(rawFixture),calibrationSha256:sha256(rawCalibration),timingSha256:sha256(rawWorkload),reportingScenarios:fixtures.scenarios.length,calibrationScenarios:calibration.scenarios.length,labelOrigin:fixtures.labelOrigin},
      policies:{semantic:fixed,lexicalFixed:fixed,lexicalCalibrated:selected},
      summaries:Object.fromEntries(Object.entries(outcomes).map(([name,rows])=>[name,summarizeEvaluation(rows)])),
      outcomes,reports:reportRecords,
      timings:{
        workload:{changes:workload.changes.length,notes:workload.notes.length,eligibleChanges:encodedTextCount-workload.notes.length,encodedTexts:encodedTextCount,encodedCharacters},
        cold:{definition:'Five fresh Node processes; setup includes local hash verification, module/tokenizer/model load. Parent process wall time also includes Node startup, freeze verification and disposal. OS file caches were not flushed.',samples:cold,setupMs:summarizeTiming(cold.map(row=>row.setupMs)),auditMs:summarizeTiming(cold.map(row=>row.auditMs)),modelAndAuditMs:summarizeTiming(cold.map(row=>row.modelAndAuditMs)),processWallMs:summarizeTiming(cold.map(row=>row.processWallMs))},
        warm:{definition:'Ten consecutive audits reusing a loaded model after the reporting-set run; no warm observations discarded. Excludes model setup and process startup.',samples:warm,auditMs:summarizeTiming(warm.map(row=>row.auditMs))},
      },
      limitations:['Author-constructed English synthetic labels; not a representative production sample or independent human annotation.','Ambiguous acceptance is a conservative review-policy violation and need not be a factual contradiction.','Only lexical gates were selected on twelve separate calibration cases; zero calibration errors does not imply zero future risk.','No customer feedback, willingness to pay, time savings, memory use or production accuracy measured.'],
    };
    await mkdir(path.dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({policies:{lexicalCalibrated:selected.mode==='gates'?{threshold:selected.threshold,margin:selected.margin}:selected.mode},ordinary:Object.fromEntries(Object.entries(result.summaries).map(([name,summary])=>[name,summary.ordinary])),timings:{cold:result.timings.cold.modelAndAuditMs,warm:result.timings.warm.auditMs}},null,2));
  }finally{await embedder.dispose();}
}

if(process.argv.includes('--timing-child'))await timingChild();else await main();
