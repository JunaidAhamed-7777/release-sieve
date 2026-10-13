import test from 'node:test';
import assert from 'node:assert/strict';
import { audit, parseNotes } from '../src/audit.mjs';
import { renderReport } from '../src/report.mjs';

test('inline code preserves generic types, comparisons and literal HTML as model evidence', async () => {
  const markdown = '- Support `<Customer>` generic type in the SDK.\n  Includes nested customer arrays.\n- Evaluate `a < b && b > c`.\n- Display `<img src=x onerror="alert(1)">` literally.\n- Preserve ``a`b`` and `[literal](link)`.';
  const notes = parseNotes(markdown);
  assert.deepEqual(notes.map(note => note.text), [
    'Support <Customer> generic type in the SDK. Includes nested customer arrays.',
    'Evaluate a < b && b > c.',
    'Display <img src=x onerror="alert(1)"> literally.',
    'Preserve a`b and [literal](link).',
  ]);
  let encoded;
  const report = await audit({changes:[{id:'generic',subject:'feat: support <Customer> generic type in SDK'}],notes,embed:async texts => {encoded=texts;return texts.map(() => [1,0]);}});
  assert.deepEqual(encoded.slice(1), notes.map(note => note.text));
  const html = renderReport(report);
  assert.match(html,/&lt;Customer&gt;/);
  assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html,/<img src=x|<Customer>/);
  assert.equal([...html.matchAll(/<script(?:\s[^>]*)?>/g)].length,2);
});

test('prose markup stays cleaned while fenced examples and headings are omitted', () => {
  const notes=parseNotes('# Release\n- **Support** `<Customer>` with [help](https://example.invalid).\n\n```html\n<img src=x>\n```\n\nA _plain_ note.');
  assert.deepEqual(notes.map(note => note.text),['Support <Customer> with help.','A plain note.']);
});

test('prose cleanup retains supported images, reference links, tasks, and decorations', () => {
  const notes = parseNotes('- [X] **Ship** ![preview](https://example.invalid/image.png) and [guide][docs].\n- ~~Retired~~ __formatting__ remains _readable_.\n\n[docs]: https://example.invalid/guide');
  assert.deepEqual(notes.map(note => note.text), ['Ship preview and guide.', 'Retired formatting remains readable.']);
});

test('inline code pairs complete backtick runs and retains different inner runs', () => {
  const notes = parseNotes('- Preserve ``a```b`` exactly.\n- Unmatched ` stays literal.\n- Keep `**literal** [label](url) <Type> a < b` as evidence.');
  assert.deepEqual(notes.map(note => note.text), [
    'Preserve a```b exactly.',
    'Unmatched ` stays literal.',
    'Keep **literal** [label](url) <Type> a < b as evidence.',
  ]);
});

test('surrounding prose markup can span protected inline-code evidence', () => {
  const notes = parseNotes('- [Use `Array<Customer>` now](https://example.invalid/help).\n- *Use `--verbose` now*.\n- [`Array<Customer>`][api].\n- **Keep `[literal](url) <Type> *marker*` unchanged**.');
  assert.deepEqual(notes.map(note => note.text), [
    'Use Array<Customer> now.',
    'Use --verbose now.',
    'Array<Customer>.',
    'Keep [literal](url) <Type> *marker* unchanged.',
  ]);
});

test('a four-backtick fence contains three-backtick examples and their bullets', () => {
  const markdown = ['- Before.', '````markdown', '```js', '- hidden inner bullet', '```', '- still hidden', '````', '- After.'].join('\n');
  assert.deepEqual(parseNotes(markdown).map(note => note.text), ['Before.', 'After.']);
});

test('fence closers require the opening character, sufficient length, and no suffix text', () => {
  const markdown = ['````text', '~~~', '- hidden after wrong character', '```', '- hidden after short run', '````not-a-close', '- hidden after suffix', '````` \t', '- Visible.'].join('\n');
  assert.deepEqual(parseNotes(markdown).map(note => note.text), ['Visible.']);
});

test('tilde fences close with longer whitespace-only runs and midline runs remain prose', () => {
  const markdown = ['~~~text', '- hidden', '~~~~ \t', '- Document ``` in prose.', 'Continue with ~~~ in prose.'].join('\n');
  // Midline runs never open a fence; the established prose cleanup still strips '~~'.
  assert.deepEqual(parseNotes(markdown).map(note => note.text), ['Document ``` in prose. Continue with ~ in prose.']);
});

test('an unclosed outer fence cannot expose nested release-note bullets', () => {
  const markdown = ['- Before.', '````', '```', '- hidden', '```'].join('\n');
  assert.deepEqual(parseNotes(markdown).map(note => note.text), ['Before.']);
});
