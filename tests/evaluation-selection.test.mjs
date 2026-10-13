import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOperatingPoint,lexicalReport } from '../evaluation/selection.mjs';

test('lexical calibration excludes unsafe gates then uses prespecified conservative ties',()=>{
  const selected=selectOperatingPoint([{threshold:.4,margin:.1,correctAccepted:6,unsafeAccepted:1},{threshold:.5,margin:.06,correctAccepted:3,unsafeAccepted:0},{threshold:.6,margin:.03,correctAccepted:3,unsafeAccepted:0},{threshold:.6,margin:.1,correctAccepted:3,unsafeAccepted:0}]);
  assert.equal(selected.threshold,.6);assert.equal(selected.margin,.1);
  assert.equal(selectOperatingPoint([{threshold:.9,margin:.2,correctAccepted:1,unsafeAccepted:1}]).mode,'always-review');
});
test('always-review baseline really abstains on a perfect lexical score',async()=>{
  const report=await lexicalReport({changes:[{id:'a',subject:'feat: restore workspace'}],notes:[{id:'n',text:'restore workspace'}]},{mode:'always-review'});
  assert.equal(report.changes[0].match.score,1);
  assert.equal(report.changes[0].status,'review');
  assert.equal(report.summary.matched,0);
  assert.deepEqual(report.notes[0].matches,[]);
});
