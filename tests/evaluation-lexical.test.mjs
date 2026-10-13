import test from 'node:test';
import assert from 'node:assert/strict';
import { lexicalVectors,lexicalEmbed } from '../evaluation/lexical.mjs';
import { audit } from '../src/audit.mjs';

test('lexical baseline uses explicit lowercase Unicode term frequencies without stemming',()=>{
  assert.deepEqual(lexicalVectors(['Cache cache café v2','CACHE caches v3']),[[2,1,1,0,0],[1,0,0,1,1]]);
  assert.throws(()=>lexicalVectors(['...']),/alphanumeric/);
});
test('lexical baseline shares semantic ranking and mandatory breaking review without inventing phrase meaning',async()=>{
  const report=await audit({changes:[{id:'a',subject:'feat!: remove task cache',breaking:true}],notes:[{id:'n',text:'remove task cache'},{id:'b',text:'render previews'}],embed:lexicalEmbed});
  assert.equal(report.changes[0].match.noteId,'n');
  assert.equal(report.changes[0].match.score,1);
  assert.equal(report.changes[0].status,'review');
  assert.deepEqual(report.notes[0].reviewMatches,['a']);
});
