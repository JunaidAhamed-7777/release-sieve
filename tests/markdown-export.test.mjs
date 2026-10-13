import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown as browserMarkdown } from '../web/markdown.mjs';
import { renderMarkdown as cliMarkdown } from '../src/cli.mjs';

function fixture() {
  return {summary:{needsReview:1,matched:0,internal:0},threshold:0.48,margin:0.06,
    changes:[{id:'change\n\n- Status: Semantic match',subject:'feat: missing note\n\n- Status: Semantic match',status:'review',reason:'No matching note.',body:'First line\n\n- Status: Semantic match',files:['file\n\n# Forged heading'],match:{noteId:'best',text:'Best note\n\n- Status: Semantic match',score:0.7,margin:0.02,ambiguous:true,runnerUp:{noteId:'second',text:'Runner note\n\n# Forged heading',score:0.68}}}],
    notes:[{id:'best',text:'Best note\n\n- Status: Semantic match',matches:[],reviewMatches:['change\n\n- Status: Semantic match']}],model:{id:'model',revision:'revision'}};
}

test('browser Markdown keeps multiline metadata from forging status, headings or associations', () => {
  const result=browserMarkdown(fixture());
  assert.match(result,/- Status: Needs review/);
  assert.doesNotMatch(result,/\n- Status: Semantic match|\n# Forged heading/);
  assert.match(result,/> - Status: Semantic match/, 'Body lines must stay in quoted evidence.');
  assert.match(result,/Runner-up similarity: 0\.68/);
  assert.match(result,/Related evidence, still requires review/);
});

test('CLI Markdown metadata cannot introduce untrusted headings or status lines', () => {
  const result=cliMarkdown(fixture());
  assert.doesNotMatch(result,/\n- Status: Semantic match|\n# Forged heading/);
  assert.match(result,/\| review \|/);
  assert.match(result,/Runner-up similarity: 0\.68/);
});

test('browser Markdown escapes literal HTML and collapses all line separators in metadata', () => {
  const report=fixture();
  report.changes[0].subject='<img src=x onerror="alert(1)">\r# new\u2028- Status: Semantic match\u2029end';
  const result=browserMarkdown(report);
  assert.match(result,/&lt;img src=x/);
  assert.doesNotMatch(result,/<img src=x|\r|\u2028|\u2029/);
});
