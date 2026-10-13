import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateScenario } from '../evaluation/metrics.mjs';

test('evaluation and calibration splits retain explicit counts and distinct scenario identities',async()=>{
  const reporting=JSON.parse(await readFile(new URL('../evaluation/fixtures.json',import.meta.url)));
  const calibration=JSON.parse(await readFile(new URL('../evaluation/calibration.json',import.meta.url)));
  const expected={literal:8,paraphrase:8,omitted:8,hard_negative:8,ambiguous:6,breaking:6,internal:4};
  assert.equal(reporting.scenarios.length,48);assert.equal(calibration.scenarios.length,12);
  const actual={};const ids=new Set();
  for(const scenario of [...reporting.scenarios,...calibration.scenarios]){validateScenario(scenario);assert.equal(ids.has(scenario.id),false);ids.add(scenario.id);}
  for(const scenario of reporting.scenarios)actual[scenario.category]=(actual[scenario.category]??0)+1;
  assert.deepEqual(actual,expected);
  assert.equal(reporting.scenarios.filter(s=>s.notes.length===0).length,2);
  assert.deepEqual(calibration.scenarios.reduce((counts,s)=>{counts[s.labels[0].expected]++;return counts;},{match:0,review:0}),{match:6,review:6});
});
