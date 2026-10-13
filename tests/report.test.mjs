import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderReport } from '../src/report.mjs';
import { audit } from '../src/audit.mjs';

const model = {
  id: 'sentence-transformers/all-MiniLM-L6-v2',
  revision: 'a-pinned-revision',
  dtype: 'q8',
  runtime: 'ONNX Runtime / CPU',
  offline: true,
};

function fixture() {
  return {
    threshold: 0.48,
    margin: 0.06,
    model,
    changes: [
      { id: 'f001', subject: 'fix(cache): reuse cached invoices', body: 'Prevent duplicate invoice requests.', files: ['src/cache.mjs'], status: 'matched', priority: 'normal', reason: 'Candidate association passed the policy.', match: { noteId: 'note-1', text: 'Reuse cached invoices.', score: 0.71, margin: 0.13 } },
      { id: 'f002', subject: 'feat(api)!: remove the legacy export endpoint', body: 'BREAKING CHANGE: migrate to export v2.', files: ['src/api.mjs'], status: 'review', priority: 'high', reason: 'Breaking change requires human review.', match: { noteId: 'note-2', text: 'New export endpoint.', score: 0.479999, margin: 0.061234 } },
      { id: 'f003', subject: 'test: add invoice regression fixture', files: ['tests/cache.test.mjs'], status: 'internal', priority: 'normal', reason: 'Confirm this heuristic fits the change.', match: null },
    ],
    notes: [
      { id: 'note-1', text: 'Reuse cached invoices.', status: 'matched', matches: ['f001'] },
      { id: 'note-2', text: 'New export endpoint.', status: 'unlinked', matches: [] },
    ],
  };
}

function scripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
}

test('renders flat audit evidence, notes, review policy and pinned model details', () => {
  const html = renderReport(fixture());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Before you ship, check what your notes missed\./);
  assert.match(html, /fix\(cache\): reuse cached invoices/);
  assert.match(html, /Prevent duplicate invoice requests\./);
  assert.match(html, /src\/cache\.mjs/);
  assert.match(html, /<blockquote>Reuse cached invoices\.<\/blockquote>/);
  assert.match(html, /Similarity ≥ <strong>0\.48<\/strong>/);
  assert.match(html, /Top-two gap ≥ <strong>0\.06<\/strong>/);
  assert.match(html, /0\.479999/); // A value below threshold must not round up to 0.48.
  assert.match(html, /not confidence or correctness/);
  assert.match(html, /Breaking changes always require human review/);
  assert.match(html, /2 release notes · 1 unlinked/);
  assert.match(html, /sentence-transformers\/all-MiniLM-L6-v2/);
  assert.match(html, /a-pinned-revision/);
  assert.match(html, /Offline mode recorded/);
  assert.match(html, /npm run bootstrap/);
  assert.match(html, /Audit runs use local files only/);
  assert.doesNotMatch(html, /--offline/);
});

test('escapes hostile source, file, note, id, reason and model strings', () => {
  const payload = `</script><script>globalThis.pwned = true</script><img src=x onerror="alert('x')">&\u2028\u2029`;
  const report = fixture();
  Object.assign(report.changes[0], { id: payload, subject: payload, body: payload, files: [payload], reason: payload });
  Object.assign(report.changes[0].match, { noteId: payload, text: payload });
  Object.assign(report.notes[0], { id: payload, text: payload, matches: [payload] });
  report.model = { id: payload, revision: payload, dtype: payload, runtime: payload, offline: true };
  report.generatedAt = payload;
  const html = renderReport(report);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>globalThis\.pwned/);
  assert.match(html, /&lt;\/script&gt;&lt;script&gt;globalThis\.pwned = true&lt;\/script&gt;/);
  assert.match(html, /onerror=&quot;alert\(&#39;x&#39;\)&quot;&gt;&amp;/);
  const [json, executable] = scripts(html);
  assert.equal(scripts(html).length, 2, 'input must not introduce an extra executable script');
  assert.doesNotMatch(json, /[<>&\u2028\u2029]/);
  assert.match(json, /\\u003c\/script\\u003e/);
  assert.equal(JSON.parse(json)[0].search.includes(payload.toLocaleLowerCase('en-US')), true);
  assert.doesNotMatch(executable, /pwned/);
  assert.doesNotMatch(executable, /innerHTML|outerHTML|document\.write|eval\(/);
});

test('has no external assets or browser network API and blocks network with CSP', () => {
  const html = renderReport(fixture());
  assert.doesNotMatch(html, /<(?:script|link|img|iframe|audio|video)[^>]*\s(?:src|href)=/i);
  assert.doesNotMatch(html, /@import|url\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
});

test('labels negative cosine scores and separation without probability conversion', () => {
  const report = fixture();
  Object.assign(report.changes[1].match, { score: -0.123456, margin: -0.123456 });
  const html = renderReport(report);
  assert.match(html, /<dt>Similarity<\/dt><dd>-0\.123456<\/dd>/);
  assert.match(html, /scores are not probabilities/);
  assert.match(html, /With one note, the gap uses a zero-similarity baseline/);
});

test('canonical flat evidence cannot be replaced by an unknown input extension', () => {
  const report = fixture();
  report.changes[0].input = { id: 'fake', subject: 'fake evidence', files: ['fake.file'] };
  report.changes[0].status = 'unexpected';
  const html = renderReport(report);
  const data = JSON.parse(scripts(html)[0]);
  assert.equal(data[0].status, 'review');
  assert.match(html, /data-change-index="0" data-status="review"/);
  assert.match(html, /reuse cached invoices/);
  assert.match(html, /src\/cache\.mjs/);
  assert.doesNotMatch(html, /fake evidence|fake\.file/);
  assert.equal(data[0].search.includes('fake evidence'), false);
});

test('synthetic demo and model truncation are disclosed in the report', () => {
  const report = fixture();
  report.input = { synthetic: true };
  report.model = { ...model, maxTokens: 256, dimensions: 384 };
  report.diagnostics = { durationMs: 922, truncatedInputs: 2, includesModelLoadAndHashVerification: true };
  report.warnings = ['<script>Untrusted warning</script>'];
  const html = renderReport(report);
  assert.match(html, /<strong>Synthetic demo<\/strong> · no customer data/);
  assert.match(html, /2 model inputs exceeded the token cap and were truncated/);
  assert.match(html, /model may not have seen all of the evidence/);
  assert.match(html, /&lt;script&gt;Untrusted warning&lt;\/script&gt;/);
  assert.match(html, /<strong>256 wordpieces<\/strong>/);
  assert.match(html, /384 embedding dimensions/);
  assert.match(html, /This run: <strong>922 ms<\/strong>, including model loading and file hash verification/);
  assert.match(html, /not a benchmark/);
});

test('derives displayed counts from rendered evidence even if summary is inconsistent', () => {
  const report = fixture();
  report.summary = { needsReview: 100, matched: 200, internal: 300 };
  const html = renderReport(report);
  assert.match(html, /<span class="metric-value">1<\/span><span class="metric-label">needs review/);
  assert.match(html, /<span class="metric-value">1<\/span><span class="metric-label">semantic match<\/span>/);
  assert.match(html, /<span class="metric-value">1<\/span><span class="metric-label">internal suggestion<\/span>/);
});

test('handles empty evidence without misleading score placeholders', () => {
  const html = renderReport({ changes: [], notes: [] });
  assert.match(html, /Showing 0 of 0 changes/);
  assert.match(html, /No changes to review/);
  assert.match(html, /No release notes supplied/);
  assert.match(html, /Execution mode not recorded/);
  assert.doesNotMatch(html, />(?:undefined|NaN)</);
});

test('rejects missing report objects', () => {
  for (const value of [undefined, null, 'report', []]) {
    assert.throws(() => renderReport(value), /requires an analysis report object/);
  }
});

// Run the report's actual inline script against a minimal DOM surface. This
// verifies stateful filtering and text-only updates without adding a UI library.
function browserHarness(html) {
  const [json, script] = scripts(html);
  const data = JSON.parse(json);
  const cards = data.map((item) => ({ dataset: { changeIndex: String(item.index) }, hidden: false }));
  let focused = null;
  const buttons = ['all', 'review', 'matched', 'internal'].map((filter) => ({
    dataset: { filter },
    attributes: { 'aria-pressed': String(filter === 'all') },
    listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { focused = filter; },
  }));
  const search = {
    value: '', listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
  };
  const counter = { textContent: `Showing ${cards.length} of ${cards.length} changes` };
  const empty = { hidden: cards.length !== 0 };
  const elements = { 'report-data': { textContent: json }, 'evidence-search': search, 'result-count': counter, 'empty-state': empty };
  const document = {
    getElementById(id) { assert.ok(elements[id], `unexpected element ${id}`); return elements[id]; },
    querySelectorAll(selector) {
      if (selector === '[data-change-index]') return cards;
      if (selector === '[data-filter]') return buttons;
      throw new Error(`unexpected selector ${selector}`);
    },
  };
  vm.runInNewContext(script, { document });
  return { cards, buttons, search, counter, empty, focused: () => focused };
}

test('filter and search operate together, update accessible state, and recover empty results', () => {
  const ui = browserHarness(renderReport(fixture()));
  ui.buttons[1].listeners.click();
  assert.deepEqual(ui.cards.map((card) => card.hidden), [true, false, true]);
  assert.equal(ui.counter.textContent, 'Showing 1 of 3 changes');
  assert.equal(ui.buttons[1].attributes['aria-pressed'], 'true');
  assert.equal(ui.buttons[0].attributes['aria-pressed'], 'false');
  ui.search.value = 'src/cache';
  ui.search.listeners.input();
  assert.equal(ui.empty.hidden, false);
  assert.equal(ui.counter.textContent, 'Showing 0 of 3 changes');
  ui.buttons[0].listeners.click();
  assert.deepEqual(ui.cards.map((card) => card.hidden), [false, true, true]);
  assert.equal(ui.empty.hidden, true);
  ui.search.value = '  INVOICE REQUESTS  ';
  ui.search.listeners.input();
  assert.deepEqual(ui.cards.map((card) => card.hidden), [false, true, true]);
  ui.search.value = 'note-2';
  ui.search.listeners.input();
  assert.deepEqual(ui.cards.map((card) => card.hidden), [true, false, true]);
  ui.search.value = '';
  ui.search.listeners.input();
  assert.equal(ui.counter.textContent, 'Showing 3 of 3 changes');
});

test('filter keys move focus while activation remains native button behavior', () => {
  const ui = browserHarness(renderReport(fixture()));
  let prevented = 0;
  const press = (index, key) => ui.buttons[index].listeners.keydown({ key, preventDefault() { prevented += 1; } });
  press(0, 'ArrowLeft');
  assert.equal(ui.focused(), 'internal');
  press(3, 'ArrowRight');
  assert.equal(ui.focused(), 'all');
  press(1, 'End');
  assert.equal(ui.focused(), 'internal');
  press(2, 'Home');
  assert.equal(ui.focused(), 'all');
  assert.equal(prevented, 4);
  assert.equal(ui.buttons[0].attributes['aria-pressed'], 'true');
});

test('renders the audit output contract end to end without hiding a breaking change', async () => {
  const changes = [
    { id: 'breaking', subject: 'feat!: change invoice schema', body: 'BREAKING CHANGE: update integrations.' },
    { id: 'fix', subject: 'fix: stop duplicate invoices', files: ['src/invoices.mjs'] },
    { id: 'internal', subject: 'test: add invoice fixture' },
  ];
  const notes = [{ id: 'note-1', text: 'Stop duplicate invoices.' }];
  const report = await audit({ changes, notes, embed: async () => [[1, 0], [1, 0], [1, 0]], threshold: 0.72, margin: 0.11 });
  report.model = model;
  const html = renderReport(report);
  assert.match(html, /Similarity ≥ <strong>0\.72<\/strong>/);
  assert.match(html, /Top-two gap ≥ <strong>0\.11<\/strong>/);
  assert.match(html, /Breaking change requires human review, even when a note looks related/);
  const data = JSON.parse(scripts(html)[0]);
  assert.deepEqual(data.map((item) => item.status), ['review', 'matched', 'internal']);
  const ui = browserHarness(html);
  ui.buttons[1].listeners.click();
  assert.equal(ui.cards[0].hidden, false);
  assert.equal(ui.cards[1].hidden, true);
});
