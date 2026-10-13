import { parseChangesInput, parseNoteInput, validateInputs, EXAMPLES } from './input.mjs';
import { isBreaking } from '../src/audit.mjs';
import { renderReport } from '../src/report.mjs';

const $ = (id) => document.getElementById(id);
const changesInput = $('changes-input');
const notesInput = $('notes-input');
const resultFilters = Array.from(document.querySelectorAll('[data-filter]'));
const draftControls = [changesInput, notesInput, $('threshold-input'), $('margin-input'), $('example-select'), $('load-example'), $('upload-changes'), $('upload-notes'), $('changes-file'), $('notes-file'), $('add-example-note')];
const state = { worker: null, busy: false, runId: 0, activeRun: null, report: null, filter: 'all', search: '', synthetic: true, example: 'ledgerfinch', draftRevision: 0, inputEpoch: 0, fieldRevisions: { changes: 0, notes: 0 }, uploadTokens: { changes: 0, notes: 0 }, pendingUploads: { changes: null, notes: null }, rows: [], previewTimer: null };
const statusNames = { review: 'Needs review', matched: 'Semantic match', internal: 'Internal suggestion' };
const announcement = element('p', 'sr-only');
announcement.setAttribute('role', 'status');
announcement.setAttribute('aria-live', 'polite');
document.body.append(announcement);

// Every source/model/note string enters the page as text, never parsed HTML.
function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function score(value) { return finite(value) ? value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : 'unavailable'; }
function announce(message) { announcement.textContent = message; }
function hasPendingUploads() { return Object.values(state.pendingUploads).some((token) => token !== null); }
function updateRunControl() {
  const pending = hasPendingUploads();
  $('run-button').disabled = state.busy || pending;
  $('run-button').querySelector('span').textContent = state.busy ? 'Reviewing…' : pending ? 'Reading file…' : 'Review release';
  $('retry-button').disabled = state.busy || pending;
}
function invalidateUpload(kind) {
  state.uploadTokens[kind] += 1;
  state.pendingUploads[kind] = null;
  $(`${kind}-file`).value = '';
  updateRunControl();
}
function invalidateUploads() {
  invalidateUpload('changes');
  invalidateUpload('notes');
}
function setBusy(busy) {
  state.busy = busy;
  draftControls.forEach((control) => { control.disabled = busy; });
  updateRunControl();
  $('cancel-button').hidden = !busy;
}
function clearResults() {
  state.report = null;
  state.rows = [];
  $('results').hidden = true;
  $('change-results').replaceChildren();
  $('note-results').replaceChildren();
  $('model-details-body').replaceChildren();
  $('result-warnings').replaceChildren();
}
function invalidateDraft({ synthetic = false } = {}) {
  state.draftRevision += 1;
  state.synthetic = synthetic;
  clearResults();
  $('run-state').hidden = true;
  $('draft-source').textContent = synthetic ? 'Synthetic example · no customer data' : 'Your draft · kept in this tab only';
  $('draft-source').classList.toggle('synthetic', synthetic);
  if (!synthetic) $('draft-action').hidden = true;
}
function fieldStatus(kind, error, count) {
  const input = kind === 'changes' ? changesInput : notesInput;
  const feedback = $(`${kind}-feedback`);
  const label = kind === 'changes' ? 'change' : 'note';
  $(`${kind}-count`).textContent = error ? 'Check format' : `${count} ${label}${count === 1 ? '' : 's'}`;
  input.setAttribute('aria-invalid', String(Boolean(error)));
  feedback.classList.toggle('error', Boolean(error));
  feedback.textContent = error ? error.message : kind === 'notes' && count === 0 ? 'No notes yet. Non-internal changes will need review.' : kind === 'changes' && count === 0 ? 'Add a change, upload a file, or load an example.' : '';
}
function previewInputs() {
  for (const [kind, input, parser] of [['changes', changesInput, parseChangesInput], ['notes', notesInput, parseNoteInput]]) {
    if (state.pendingUploads[kind] !== null) continue;
    try { fieldStatus(kind, null, parser(input.value).length); }
    catch (error) { fieldStatus(kind, error, 0); }
  }
}
function readDraft() {
  let changes;
  let notes;
  try { changes = parseChangesInput(changesInput.value); }
  catch (error) { fieldStatus('changes', error, 0); changesInput.focus(); throw error; }
  if (!changes.length) { changesInput.focus(); throw new Error('Add at least one change, or load a synthetic example.'); }
  try { notes = parseNoteInput(notesInput.value); }
  catch (error) { fieldStatus('notes', error, 0); notesInput.focus(); throw error; }
  const threshold = Number($('threshold-input').value);
  const margin = Number($('margin-input').value);
  if (!$('threshold-input').value.trim() || !$('margin-input').value.trim()) throw new Error('Enter a similarity threshold and top-two gap between 0 and 1.');
  validateInputs({ changes, notes, threshold, margin });
  return { changes, notes, threshold, margin, synthetic: state.synthetic };
}
function showStatus(message, { percent, detail = '', error = false, retry = false } = {}) {
  const panel = $('run-state');
  panel.hidden = false;
  panel.classList.toggle('error', error);
  $('run-status').textContent = message;
  $('run-detail').textContent = detail;
  $('run-detail').hidden = !detail;
  $('run-progress').hidden = error || percent === undefined;
  if (finite(percent)) {
    $('run-progress').value = Math.max(0, Math.min(100, percent));
    $('progress-label').textContent = `${Math.round(percent)}%`;
  } else $('progress-label').textContent = '';
  $('retry-button').hidden = !retry;
}
function stopWorker() {
  if (state.worker) state.worker.terminate();
  state.worker = null;
  state.activeRun = null;
  state.runId += 1; // Invalidates queued messages from a cancelled instance.
}
function cancelRun() {
  if (!state.busy) return;
  stopWorker();
  setBusy(false);
  showStatus('Review cancelled. Your draft is still here.', { detail: 'You can change the inputs and run again. Downloaded model assets may remain in the browser cache.' });
  announce('Review cancelled. Inputs preserved.');
}
function handleFailure(message) {
  stopWorker();
  setBusy(false);
  showStatus('The review could not finish.', { error: true, retry: true, detail: String(message || 'The model worker stopped unexpectedly. Try again in a current desktop browser.') });
}
function getWorker() {
  if (state.worker) return state.worker;
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event) => {
    const message = event.data;
    if (worker !== state.worker || !state.busy || !message || message.runId !== state.activeRun) return;
    if (message.type === 'progress') {
      const detail = finite(message.loaded) && finite(message.total) && message.total > 0
        ? `${(message.loaded / 1_000_000).toFixed(1)} of ${(message.total / 1_000_000).toFixed(1)} MB · Inputs stay in this browser.`
        : message.phase === 'download' ? 'Only public model and runtime files are downloaded. Your changes and notes are not sent.' : 'The worker runs on this device. Cancel stops the worker and keeps your draft.';
      showStatus(message.message || 'Review in progress…', { percent: message.percent, detail });
    } else if (message.type === 'result') {
      state.activeRun = null;
      setBusy(false);
      state.report = message.report;
      if (!renderResults(message.report)) return;
      showStatus('Review ready. Check the evidence below.', { percent: 100, detail: 'The model remains loaded for your next review in this open tab.' });
      $('results-heading').focus({ preventScroll: true });
      $('results').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    } else if (message.type === 'error') handleFailure(message.message);
  });
  worker.addEventListener('error', (event) => {
    if (worker !== state.worker || !state.busy) return;
    event.preventDefault();
    handleFailure(event.message || 'The browser could not load the model worker. Serve the app over HTTP and try a current browser.');
  });
  worker.addEventListener('messageerror', () => {
    if (worker === state.worker && state.busy) handleFailure('The worker returned an unreadable message. Retry the review.');
  });
  state.worker = worker;
  return worker;
}
function runReview() {
  if (state.busy || hasPendingUploads()) return;
  let draft;
  try { draft = readDraft(); }
  catch (error) { showStatus('Check your inputs before reviewing.', { error: true, detail: error.message }); return; }
  clearResults();
  setBusy(true);
  state.runId += 1;
  state.activeRun = state.runId;
  showStatus('Preparing the local model…', { percent: 0, detail: 'The first run downloads about 38 MB of public assets. Your input text stays in this browser.' });
  try { getWorker().postMessage({ type: 'run', runId: state.activeRun, ...draft }); }
  catch (error) { handleFailure(error.message); }
}

function renderChange(change, index) {
  const status = Object.hasOwn(statusNames, change.status) ? change.status : 'review';
  const card = element('article', `change-card ${status}`);
  const top = element('div', 'change-top');
  const labels = element('div', 'change-labels');
  labels.append(element('span', 'status-tag', statusNames[status]));
  if (isBreaking(change) || change.priority === 'high') labels.append(element('span', 'priority-tag', 'Breaking · human review required'));
  labels.append(element('code', 'change-id', change.id));
  const title = element('h3', '', change.subject);
  title.id = `result-change-${index}`;
  card.setAttribute('aria-labelledby', title.id);
  top.append(labels, title, element('p', 'change-reason', change.reason));
  const evidence = element('div', 'change-evidence');
  const source = element('section', 'source-evidence');
  source.setAttribute('aria-label', 'Source change evidence');
  source.append(element('h4', 'evidence-heading', 'Change evidence'));
  const body = String(change.body ?? '');
  if (body.length > 450) {
    source.append(element('p', 'source-body', `${body.slice(0, 450)}…`));
    const details = element('details', 'source-extra');
    details.append(element('summary', '', 'Read full commit body'), element('p', 'source-body', body));
    source.append(details);
  } else source.append(element('p', body ? 'source-body' : 'evidence-placeholder', body || 'No commit body supplied.'));
  const files = Array.isArray(change.files) ? change.files : [];
  function fileList(paths) {
    const list = element('ul', 'file-list');
    list.setAttribute('aria-label', 'Changed files');
    paths.forEach((file) => { const item = element('li'); item.append(element('code', '', file)); list.append(item); });
    return list;
  }
  if (files.length) source.append(fileList(files.slice(0, 6)));
  else source.append(element('p', 'evidence-placeholder', 'No file paths supplied.'));
  if (files.length > 6) { const details = element('details', 'source-extra'); details.append(element('summary', '', `Read ${files.length - 6} more file paths`), fileList(files.slice(6))); source.append(details); }
  const candidate = element('section', 'candidate-evidence');
  candidate.setAttribute('aria-label', 'Closest release note evidence');
  const heading = element('div', 'candidate-heading');
  heading.append(element('h4', 'evidence-heading', 'Closest release note'));
  if (change.match) {
    heading.append(element('code', '', change.match.noteId));
    candidate.append(heading, element('blockquote', 'candidate-text', change.match.text));
    const scores = element('dl', 'score-line');
    for (const [label, value, explanation] of [['Similarity', change.match.score, 'Cosine similarity: related meaning, not a probability.'], ['Top-two gap', change.match.margin, 'Difference between the two highest note similarities. With one note, the baseline is zero.']]) {
      const part = element('div'); const term = element('dt', '', label); term.title = explanation; part.append(term, element('dd', '', score(value))); scores.append(part);
    }
    candidate.append(scores);
  } else {
    candidate.append(heading, element('p', 'evidence-placeholder', status === 'internal' ? 'Internal suggestions use the commit-type heuristic and are not scored by the model. Check whether a user-facing note is needed.' : 'No release note candidate. Review the change and decide what needs documenting.'));
  }
  evidence.append(source, candidate);
  card.append(top, evidence);
  return { card, status, search: [change.id, change.subject, change.body, ...files, change.match?.noteId, change.match?.text, change.reason].filter((value) => value !== undefined && value !== null).join('\n').toLocaleLowerCase('en-US') };
}
function applyResultFilter() {
  const query = $('result-search').value.trim().toLocaleLowerCase('en-US');
  let shown = 0;
  state.rows.forEach((row) => {
    const visible = (state.filter === 'all' || row.status === state.filter) && (!query || row.search.includes(query));
    row.card.hidden = !visible;
    if (visible) shown += 1;
  });
  resultFilters.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));
  $('visible-count').textContent = `Showing ${shown} of ${state.rows.length} changes · Similarity suggests related meaning; it does not verify coverage.`;
  $('no-results').hidden = shown !== 0;
}
function renderNotes(notes) {
  const unlinked = notes.filter((note) => !Array.isArray(note.matches) || !note.matches.length).length;
  $('notes-review-context').textContent = `${notes.length} notes · ${unlinked} unlinked. Unlinked notes may summarize changes or use wording the model missed.`;
  const output = $('note-results');
  output.replaceChildren();
  notes.forEach((note) => {
    const matches = Array.isArray(note.matches) ? note.matches : [];
    const card = element('article', `note-card ${matches.length ? 'linked' : 'unlinked'}`);
    const meta = element('div', 'note-meta');
    meta.append(element('code', '', note.id), element('span', '', matches.length ? `${matches.length} association${matches.length === 1 ? '' : 's'}` : 'Unlinked'));
    const associations = element('p', 'note-associations', matches.length ? 'Associated changes: ' : 'No semantic association. Inspect the wording and the source changes.');
    matches.forEach((id, index) => { if (index) associations.append(document.createTextNode(', ')); associations.append(element('code', '', id)); });
    card.append(meta, element('p', 'note-text', note.text), associations);
    output.append(card);
  });
  if (!notes.length) output.append(element('p', 'evidence-placeholder', 'No notes supplied. Add the planned release notes and run again.'));
}
function renderModelDetails(report) {
  const output = $('model-details-body');
  output.replaceChildren();
  const model = report.model ?? {};
  const diagnostics = report.diagnostics ?? {};
  const list = element('dl', 'model-list');
  for (const [label, value] of [['Open model', model.id], ['Pinned revision', model.revision], ['Precision', model.dtype], ['Runtime', model.runtime]]) {
    const part = element('div'); part.append(element('dt', '', label), element('dd', '', value ?? 'Not recorded')); list.append(part);
  }
  output.append(list);
  const details = [];
  if (finite(diagnostics.durationMs)) details.push(`This run took ${diagnostics.durationMs} ms locally${diagnostics.includesModelLoadAndHashVerification === true ? ', including setup' : ''}. This is not a benchmark.`);
  if (finite(diagnostics.downloadedBytes)) details.push(`${(diagnostics.downloadedBytes / 1_000_000).toFixed(1)} MB downloaded this run.`);
  if (diagnostics.reusedModel === true) details.push('Reused the model already loaded in this open tab.');
  else if (finite(diagnostics.cachedAssets) && finite(diagnostics.assetCount)) details.push(`${diagnostics.cachedAssets} of ${diagnostics.assetCount} model/runtime assets reused from cache.`);
  details.push(`${model.maxTokens ?? 256} wordpieces per input; ${model.dimensions ?? 384} embedding dimensions. Cached public assets can remain after Clear. Your input text is never stored by this app.`);
  output.append(element('p', 'model-footnote', details.join(' ')));
}
function renderResults(report) {
  if (!report || !Array.isArray(report.changes) || !Array.isArray(report.notes)) { handleFailure('The worker returned an incomplete report. Retry the review.'); return false; }
  state.filter = 'all';
  $('result-search').value = '';
  const counts = { review: 0, matched: 0, internal: 0 };
  $('change-results').replaceChildren();
  state.rows = report.changes.map((change, index) => { const row = renderChange(change, index); counts[row.status] += 1; $('change-results').append(row.card); return row; });
  $('review-count').textContent = counts.review;
  $('matched-count').textContent = counts.matched;
  $('internal-count').textContent = counts.internal;
  const synthetic = report.input?.synthetic === true;
  $('result-context').textContent = `${synthetic ? 'Synthetic example · no customer data · ' : ''}${report.changes.length} changes compared with ${report.notes.length} notes · Similarity ≥ ${score(report.threshold)} · Top-two gap ≥ ${score(report.margin)}.`;
  // The universal advisory is already explained in the policy and evidence
  // toolbar. Keep the notice box for run-specific truncation/cache limitations.
  const warnings = Array.isArray(report.warnings) ? report.warnings.filter((warning) => warning !== 'Semantic similarity is advisory, not confidence or proof that a change is documented.') : [];
  if (finite(report.diagnostics?.truncatedInputs) && report.diagnostics.truncatedInputs > 0) warnings.unshift(`${report.diagnostics.truncatedInputs} inputs exceeded the model's wordpiece cap. The model may not have seen all evidence shown; inspect long changes and notes manually.`);
  const warningPanel = $('result-warnings');
  warningPanel.replaceChildren();
  warningPanel.hidden = warnings.length === 0;
  if (warnings.length) {
    warningPanel.append(element('strong', '', report.diagnostics?.truncatedInputs > 0 ? 'Model input limits affected this review.' : 'Execution notes'));
    const list = element('ul'); new Set(warnings).forEach((warning) => list.append(element('li', '', warning))); warningPanel.append(list);
  }
  renderNotes(report.notes);
  renderModelDetails(report);
  applyResultFilter();
  $('results').hidden = false;
  return true;
}

function loadExample(id = $('example-select').value) {
  if (state.busy) return;
  const example = EXAMPLES[id];
  if (!example) return;
  state.example = id;
  state.inputEpoch += 1;
  invalidateUploads();
  $('example-select').value = id;
  changesInput.value = example.changesText;
  notesInput.value = example.notesText;
  $('threshold-input').value = '0.48';
  $('margin-input').value = '0.06';
  invalidateDraft({ synthetic: true });
  $('example-description').textContent = example.description;
  $('draft-action').hidden = !example.suggestedNote;
  $('suggested-note-copy').textContent = example.suggestedNote ? `Add: “${example.suggestedNote.replace(/^\s*[-+*]\s+/, '')}” Then rerun with the same changes.` : '';
  previewInputs();
  announce(`${example.label} example loaded. Inputs are synthetic.`);
}
function addExampleNote() {
  if (state.busy) return;
  const example = EXAMPLES[state.example];
  if (!example?.suggestedNote || !state.synthetic) return;
  invalidateUpload('notes');
  state.fieldRevisions.notes += 1;
  notesInput.value = `${notesInput.value.trimEnd()}\n\n- ${example.suggestedNote.replace(/^\s*[-+*]\s+/, '')}\n`;
  invalidateDraft({ synthetic: true });
  $('draft-action').hidden = true;
  previewInputs();
  announce('Missing note added. Run the review again to compare.');
  notesInput.focus();
}
async function uploadFile(kind, file) {
  if (!file || state.busy) return;
  const input = kind === 'changes' ? changesInput : notesInput;
  // Independent fields can upload concurrently. In the same field, the latest
  // selection wins, even when an older file read finishes or rejects later.
  const token = ++state.uploadTokens[kind];
  state.pendingUploads[kind] = token;
  clearResults();
  $('run-state').hidden = true;
  updateRunControl();
  $(`${kind}-feedback`).classList.remove('error');
  $(`${kind}-feedback`).textContent = 'Reading file…';
  $(`${kind}-count`).textContent = 'Reading…';
  const epoch = state.inputEpoch;
  const revision = state.fieldRevisions[kind];
  const runId = state.runId;
  const current = () => !state.busy && token === state.uploadTokens[kind] && epoch === state.inputEpoch && revision === state.fieldRevisions[kind] && runId === state.runId;
  try {
    if (file.size > 2_000_000) throw new Error('Use a text file smaller than 2 MB. Split a larger release into smaller reviews.');
    const text = await file.text();
    if (!current()) return;
    state.pendingUploads[kind] = null;
    updateRunControl();
    input.value = text;
    state.fieldRevisions[kind] += 1;
    invalidateDraft();
    previewInputs();
    announce(`${file.name} loaded. Check the parsed count before reviewing.`);
  } catch (error) { if (current()) fieldStatus(kind, error, 0); }
  finally {
    if (token === state.uploadTokens[kind] && epoch === state.inputEpoch) {
      state.pendingUploads[kind] = null;
      $(`${kind}-file`).value = '';
      updateRunControl();
    }
  }
}
function clearDraft() {
  stopWorker();
  setBusy(false);
  state.inputEpoch += 1;
  invalidateUploads();
  changesInput.value = '';
  notesInput.value = '';
  $('threshold-input').value = '0.48';
  $('margin-input').value = '0.06';
  invalidateDraft();
  previewInputs();
  showStatus('Inputs and results cleared.', { detail: 'No draft was stored. Verified public model assets may remain in the browser cache.' });
  changesInput.focus();
}
function markdownText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|])/g, '\\$1');
}
function renderMarkdown(report) {
  const lines = ['# Release Sieve review', '', 'Semantic similarity suggests associations, not verified release-note coverage. Breaking changes require human review.', ''];
  if (report.input?.synthetic) lines.push('Synthetic example. No customer data.', '');
  lines.push(`Similarity threshold: ${score(report.threshold)}. Minimum top-two gap: ${score(report.margin)}.`, '', '## Changes', '');
  report.changes.forEach((change) => {
    lines.push(`### ${markdownText(change.subject)}`, '', `- ID: ${markdownText(change.id)}`, `- Status: ${statusNames[change.status] ?? 'Needs review'}`, `- Reason: ${markdownText(change.reason)}`);
    if (change.body) lines.push('', ...String(change.body).split(/\r?\n/).map((line) => `> ${markdownText(line)}`));
    if (change.files?.length) lines.push('', 'Files:', ...change.files.map((file) => `- ${markdownText(file)}`));
    if (change.match) lines.push('', `Closest note (${markdownText(change.match.noteId)}): ${markdownText(change.match.text)}`, `Similarity: ${score(change.match.score)}. Top-two gap: ${score(change.match.margin)}.`);
    lines.push('');
  });
  lines.push('## Release notes', '');
  report.notes.forEach((note) => lines.push(`- ${markdownText(note.id)}: ${markdownText(note.text)} (${note.matches?.length ? `${note.matches.length} associations` : 'unlinked'})`));
  if (report.warnings?.length) lines.push('', '## Input warnings', '', ...report.warnings.map((warning) => `- ${markdownText(warning)}`));
  lines.push('', '## Model', '', `Model: ${markdownText(report.model?.id)}. Revision: ${markdownText(report.model?.revision)}. Runtime: ${markdownText(report.model?.runtime)}.`, '');
  return lines.join('\n');
}
function download(kind) {
  const report = state.report;
  if (!report || state.busy) return;
  const formats = {
    json: { content: JSON.stringify(report, null, 2), type: 'application/json', name: 'release-sieve-review.json' },
    markdown: { content: renderMarkdown(report), type: 'text/markdown;charset=utf-8', name: 'release-sieve-review.md' },
    html: { content: renderReport(report), type: 'text/html;charset=utf-8', name: 'release-sieve-review.html' },
  };
  const format = formats[kind];
  const url = URL.createObjectURL(new Blob([format.content], { type: format.type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = format.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  announce(`${format.name} downloaded. The export includes your changes and release notes.`);
}

Object.values(EXAMPLES).forEach((example) => { const option = element('option', '', example.label); option.value = example.id; $('example-select').append(option); });
$('example-select').addEventListener('change', () => { $('example-description').textContent = EXAMPLES[$('example-select').value]?.description ?? ''; });
$('load-example').addEventListener('click', () => loadExample());
$('add-example-note').addEventListener('click', addExampleNote);
$('clear-button').addEventListener('click', clearDraft);
$('run-button').addEventListener('click', runReview);
$('retry-button').addEventListener('click', runReview);
$('cancel-button').addEventListener('click', cancelRun);
for (const input of [changesInput, notesInput, $('threshold-input'), $('margin-input')]) input.addEventListener('input', () => {
  if (state.busy) return;
  if (input === changesInput) { state.fieldRevisions.changes += 1; invalidateUpload('changes'); }
  if (input === notesInput) { state.fieldRevisions.notes += 1; invalidateUpload('notes'); }
  if (input !== changesInput && input !== notesInput) invalidateUploads();
  invalidateDraft({ synthetic: input === changesInput || input === notesInput ? false : state.synthetic });
  window.clearTimeout(state.previewTimer);
  state.previewTimer = window.setTimeout(previewInputs, 250);
});
for (const kind of ['changes', 'notes']) {
  $(`upload-${kind}`).addEventListener('click', () => $(`${kind}-file`).click());
  $(`${kind}-file`).addEventListener('change', () => uploadFile(kind, $(`${kind}-file`).files[0]));
}
resultFilters.forEach((button, index) => {
  button.addEventListener('click', () => { state.filter = button.dataset.filter; applyResultFilter(); });
  button.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % resultFilters.length;
    if (event.key === 'ArrowLeft') next = (index + resultFilters.length - 1) % resultFilters.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = resultFilters.length - 1;
    if (next !== undefined) { event.preventDefault(); resultFilters[next].focus(); }
  });
});
$('result-search').addEventListener('input', applyResultFilter);
for (const kind of ['json', 'markdown', 'html']) $(`export-${kind}`).addEventListener('click', () => download(kind));
loadExample('ledgerfinch');
