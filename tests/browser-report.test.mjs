import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../src/report.mjs';
test('browser HTML export describes its actual local runtime without CLI bootstrap instructions',()=>{
  const html=renderReport({changes:[],notes:[],model:{device:'wasm',localInference:true,id:'test-model'}});
  assert.match(html,/Browser-local inference recorded/);
  assert.match(html,/read-only snapshot/);
  assert.doesNotMatch(html,/npm run bootstrap/);
});
