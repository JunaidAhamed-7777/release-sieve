/**
 * A self-contained, read-only report. All input strings are untrusted, including
 * commit messages, file paths and release notes. Do not interpolate them into JS.
 */
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

// An application/json script still has an HTML raw-text parser. Escape '<' so a
// note containing </script> cannot terminate it, then escape the other delimiters.
const safeJson = (value) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
  (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const scoreLabel = (value) => finiteNumber(value) ? value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : 'unavailable';
const statuses = {
  review: { label: 'Needs review', short: 'Review', className: 'review' },
  matched: { label: 'Semantic match', short: 'Matched', className: 'matched' },
  internal: { label: 'Internal suggestion', short: 'Internal', className: 'internal' },
};

function normalizeChanges(report) {
  return (Array.isArray(report.changes) ? report.changes : []).map((change, index) => {
    const item = change && typeof change === 'object' ? change : {};
    // The audit contract uses flat canonical fields. Unknown extension fields
    // such as item.input must never replace the evidence the model analyzed.
    const input = item;
    return {
      ...item,
      input,
      index,
      // A malformed status is a review item; it must not disappear from filters.
      status: Object.hasOwn(statuses, item.status) ? item.status : 'review',
    };
  });
}

function renderChange(change) {
  const { input, status, index } = change;
  const label = statuses[status];
  const files = Array.isArray(input.files) ? input.files : [];
  const highPriority = input.breaking || change.priority === 'high';
  const match = change.match && typeof change.match === 'object' ? change.match : null;
  const subject = String(input.subject ?? '(Untitled change)');
  return `<article class="change-card ${label.className}" data-change-index="${index}" data-status="${status}" aria-labelledby="change-title-${index}">
    <div class="card-heading">
      <span class="status-label"><span class="status-dot" aria-hidden="true"></span>${label.label}</span>
      ${highPriority ? `<span class="priority-label">${input.breaking ? 'Breaking · human review required' : 'High priority · human review required'}</span>` : ''}
      <code class="change-id">${escapeHtml(input.id ?? `change-${index + 1}`)}</code>
    </div>
    <h3 id="change-title-${index}">${escapeHtml(subject)}</h3>
    <p class="reason">${escapeHtml(change.reason ?? 'Review the evidence before deciding whether this belongs in the release notes.')}</p>
    <div class="evidence-grid">
      <section class="source-evidence" aria-label="Change evidence">
        <h4>Change evidence</h4>
        ${input.body ? `<p class="commit-body">${escapeHtml(input.body)}</p>` : '<p class="muted">No commit body supplied.</p>'}
        ${files.length ? `<ul class="files" aria-label="Changed files">${files.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('')}</ul>` : '<p class="muted no-files">No file paths supplied.</p>'}
      </section>
      <section class="note-evidence" aria-label="Candidate release note">
        <div class="note-heading"><h4>${match ? 'Closest release note' : 'Release note candidate'}</h4>${match ? `<code>${escapeHtml(match.noteId)}</code>` : ''}</div>
        ${match ? `<blockquote>${escapeHtml(match.text)}</blockquote>
          <dl class="score-row"><div><dt>Similarity</dt><dd>${scoreLabel(match.score)}</dd></div><div><dt>Top-two gap</dt><dd>${scoreLabel(match.margin)}</dd></div></dl>` : '<p class="muted empty-candidate">No candidate association. Review the source evidence.</p>'}
      </section>
    </div>
  </article>`;
}

function renderNote(note, index) {
  const input = note && typeof note === 'object' ? note : {};
  const matches = Array.isArray(input.matches) ? input.matches : [];
  const unlinked = input.status === 'unlinked' || matches.length === 0;
  return `<article class="note-card ${unlinked ? 'unlinked' : 'linked'}">
    <div class="note-card-heading"><code>${escapeHtml(input.id ?? `note-${index + 1}`)}</code><span>${unlinked ? 'Unlinked' : `${matches.length} association${matches.length === 1 ? '' : 's'}`}</span></div>
    <p>${escapeHtml(input.text)}</p>
    ${matches.length ? `<p class="note-associations"><span>Associated changes</span> ${matches.map((id) => `<code>${escapeHtml(id)}</code>`).join(' ')}</p>` : '<p class="note-associations">No change associated by the model. This is a prompt to inspect, not evidence that the note is wrong.</p>'}
  </article>`;
}

/** Render an analysis result to complete HTML, without remote fonts or assets. */
export function renderReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError('renderReport requires an analysis report object.');
  }
  const changes = normalizeChanges(report);
  const notes = Array.isArray(report.notes) ? report.notes : [];
  const counts = changes.reduce((result, change) => {
    result[change.status] += 1;
    return result;
  }, { review: 0, matched: 0, internal: 0 });
  const unlinkedNotes = notes.filter((note) => !note || note.status === 'unlinked' || !Array.isArray(note.matches) || note.matches.length === 0).length;
  const threshold = finiteNumber(report.threshold) ? report.threshold : 0.48;
  const marginThreshold = finiteNumber(report.margin) ? report.margin : finiteNumber(report.marginThreshold) ? report.marginThreshold : 0.06;
  const model = report.model && typeof report.model === 'object' ? report.model : {};
  const diagnostics = report.diagnostics && typeof report.diagnostics === 'object' ? report.diagnostics : {};
  const truncatedInputs = finiteNumber(diagnostics.truncatedInputs) && diagnostics.truncatedInputs > 0 ? diagnostics.truncatedInputs : 0;
  const warnings = Array.isArray(report.warnings) ? report.warnings.map(String) : [];
  const truncationWarning = truncatedInputs ? `${truncatedInputs} model input${truncatedInputs === 1 ? '' : 's'} exceeded the token cap and were truncated. The model may not have seen all of the evidence shown below; inspect long changes and notes manually.` : '';
  const diagnosticLine = finiteNumber(diagnostics.durationMs) && diagnostics.durationMs >= 0
    ? `<p class="model-message run-detail">This run: <strong>${escapeHtml(diagnostics.durationMs)} ms</strong>${diagnostics.includesModelLoadAndHashVerification === true ? ', including model loading and file hash verification' : ''}. A local measurement, not a benchmark.</p>` : '';
  const filterData = changes.map(({ input, match, reason, status, index }) => ({
    index,
    status,
    search: [input.id, input.subject, input.body, ...(Array.isArray(input.files) ? input.files : []), match?.noteId, match?.text, reason]
      .filter((value) => value !== undefined && value !== null).join('\n').toLocaleLowerCase('en-US'),
  }));
  const generatedAt = report.generatedAt ? `<span>Generated ${escapeHtml(report.generatedAt)}</span>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'">
  <meta name="color-scheme" content="light">
  <title>Release Sieve — Release note review</title>
  <style>
    :root{--navy:#102832;--navy-deep:#0c2029;--cream:#f7f5ec;--paper:#fffefa;--ink:#17313b;--muted:#54676d;--line:#d6ded9;--teal:#076e66;--teal-pale:#e4f3ec;--orange:#a54321;--orange-pale:#fff0e5;--internal:#62747c;--radius:16px;font-family:Segoe UI,system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color:var(--ink);background:var(--cream);font-size:16px;line-height:1.55}
    *{box-sizing:border-box}body{margin:0}button,input{font:inherit}button{cursor:pointer}a{color:inherit}code{font-family:Consolas,Monaco,monospace;overflow-wrap:anywhere}button:focus-visible,input:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #a54321;outline-offset:4px}button:focus-visible{position:relative;z-index:1}.skip-link{position:absolute;top:-100px;left:20px;background:var(--paper);padding:12px 18px;z-index:10}.skip-link:focus{top:12px}.shell{max-width:1160px;margin:auto;padding:0 32px}
    .masthead{background:var(--navy);color:var(--cream)}.topline{display:flex;justify-content:space-between;align-items:center;padding-top:26px;padding-bottom:24px;border-bottom:1px solid #ffffff25;gap:16px}.brand{display:flex;align-items:center;gap:12px;font-size:20px;font-weight:700;letter-spacing:-.4px}.brand-mark{width:33px;height:33px;display:grid;grid-template-columns:repeat(3,5px);grid-template-rows:repeat(3,5px);justify-content:center;align-content:center;gap:3px;transform:rotate(-12deg);background:#96dcc0;border-radius:8px}.brand-mark i{border-radius:50%;background:var(--navy)}.local-pill{font-size:12px;letter-spacing:.8px;text-transform:uppercase;border:1px solid #ffffff45;border-radius:30px;padding:6px 12px;white-space:nowrap;color:#bed4ce}.local-pill::before{content:'';display:inline-block;width:6px;height:6px;border-radius:100%;background:#96dcc0;vertical-align:2px;margin-right:8px}
    .hero{display:grid;grid-template-columns:1.5fr 1fr;gap:50px;padding:48px 0 38px}.eyebrow{font-size:12px;letter-spacing:1.7px;font-weight:700;text-transform:uppercase;margin:0 0 15px;color:#96dcc0}.hero h1{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:clamp(34px,4.2vw,52px);letter-spacing:-1.7px;line-height:1.12;max-width:640px;margin:0 0 20px}.hero-description{color:#c0d0cf;max-width:540px;font-size:15px;margin:0;line-height:1.75}.hero-description strong{color:var(--cream);font-weight:600}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start;padding-top:8px}.metric{border:1px solid #ffffff25;border-radius:12px;padding:18px 19px;background:#ffffff04}.metric-review{grid-row:span 2;background:#183b43;border-color:#54706b;display:flex;flex-direction:column;justify-content:center}.metric-value{font-size:39px;font-weight:600;letter-spacing:-1px;line-height:1.15;font-variant-numeric:tabular-nums;display:block}.metric-review .metric-value{font-size:68px;color:#ffa875}.metric-label{font-size:13px;display:block;margin-top:6px;color:#c5d3cf}.metric-review .metric-label{color:#fff0e4;font-weight:600}.policy-strip{padding:18px 0 23px;display:flex;gap:24px;justify-content:space-between;align-items:center;border-top:1px solid #ffffff25;font-size:12px;color:#c0d0cf}.policy-strip strong{color:var(--cream);font-weight:600}.policy-strip .separator{color:#6d898c;padding:0 9px}.policy-note{margin:0;max-width:410px;text-align:right}
    main{padding-top:36px;padding-bottom:52px}.section-heading{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:20px}.section-heading h2{font-size:25px;letter-spacing:-.8px;line-height:1.2;margin:0 0 9px}.section-heading p{font-size:14px;color:var(--muted);margin:0;max-width:680px}.section-index{font-family:Consolas,monospace;color:#869691;font-size:12px;letter-spacing:1px;padding-top:6px;white-space:nowrap}.review-warning{display:flex;align-items:flex-start;gap:10px;padding:13px 16px;margin-bottom:22px;border:1px solid #ead3bf;border-left:3px solid #cd6939;border-radius:8px;background:#fff5eb;color:#784726;font-size:13px}.warning-symbol{font-weight:700}.review-warning p{margin:0}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:12px}.filters{display:flex;flex-wrap:wrap;gap:4px;background:#e8ede7;padding:5px;border-radius:10px}.filter-button{border:0;background:transparent;color:#53666b;font-size:13px;font-weight:600;padding:9px 13px;border-radius:7px;white-space:nowrap}.filter-button[aria-pressed="true"]{background:var(--paper);color:var(--ink);box-shadow:0 1px 3px #17313b20}.filter-button .filter-count{font-size:11px;margin-left:5px;font-variant-numeric:tabular-nums;font-weight:400;opacity:.8}.search-wrap{display:flex;align-items:center;position:relative;flex:1;max-width:300px}.search-wrap svg{position:absolute;left:12px;pointer-events:none;color:#697d80}.search-wrap input{width:100%;padding:10px 12px 10px 36px;line-height:1.4;font-size:13px;background:var(--paper);border:1px solid #cbd6d0;border-radius:9px;color:var(--ink)}.search-wrap input::placeholder{color:#607177}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.result-count{font-size:12px;color:#667b7b;margin:0 0 17px;padding:0 2px}.change-list{display:grid;gap:18px}.change-card{border:1px solid #cfdad4;border-radius:var(--radius);overflow:hidden;background:var(--paper);padding:22px 24px 0}.change-card.review{border-left:4px solid #cf6b3b}.change-card.matched{border-left:4px solid #268b70}.change-card.internal{border-left:4px solid #82939b}.card-heading{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.status-label{display:flex;gap:7px;align-items:center;font-size:11px;letter-spacing:.8px;text-transform:uppercase;font-weight:700;color:var(--teal)}.status-dot{width:6px;height:6px;border-radius:50%;background:currentColor}.review .status-label{color:var(--orange)}.internal .status-label{color:var(--internal)}.priority-label{font-size:11px;color:#884327;background:var(--orange-pale);border:1px solid #ecd6c4;border-radius:4px;padding:2px 7px}.change-id{margin-left:auto;font-size:11px;color:#70827e;max-width:100%;word-break:break-all}.change-card h3{font-size:20px;line-height:1.4;letter-spacing:-.4px;margin:0 0 8px;overflow-wrap:anywhere}.reason{font-size:13px;line-height:1.65;margin:0 0 19px;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere}.evidence-grid{display:grid;grid-template-columns:1fr 1fr;margin:0 -24px;border-top:1px solid #dfe5df;background:#f6f8f1}.source-evidence,.note-evidence{padding:17px 24px 20px;min-width:0}.source-evidence{border-right:1px solid #dfe5df}.evidence-grid h4{font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#667a79;margin:0 0 10px;font-weight:700}.commit-body{font-size:13px;color:#3a5259;margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#778b87;font-size:12px;margin:0;line-height:1.65}.files{display:flex;flex-wrap:wrap;list-style:none;padding:0;margin:12px 0 0;gap:5px}.files li{font-size:10px;line-height:1.6;background:#edf1e9;border:1px solid #dce4da;border-radius:4px;padding:3px 7px;color:#4d6868;max-width:100%}.files code{overflow-wrap:anywhere}.no-files{margin-top:10px}.note-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.note-heading code{font-size:10px;color:#70827e;max-width:45%;word-break:break-all}.note-evidence blockquote{border-left:2px solid #97b3a8;margin:0 0 14px;padding-left:12px;color:#28464e;font-size:13px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.score-row{display:flex;gap:26px;margin:0;flex-wrap:wrap}.score-row div{display:flex;gap:8px;align-items:baseline}.score-row dt{font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:#647b79}.score-row dd{font-size:15px;color:#294e51;margin:0;font-variant-numeric:tabular-nums;font-weight:600}.empty-candidate{padding-top:3px}.empty-state{border:1px dashed #becdc3;padding:36px 24px;border-radius:12px;text-align:center;color:var(--muted)}.empty-state strong{font-size:17px;display:block;color:var(--ink);margin-bottom:6px}.empty-state p{margin:0;font-size:13px}[hidden]{display:none!important}
    .notes-section{margin-top:45px;padding-top:30px;border-top:1px solid #cfdad4}.notes-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.note-card{border:1px solid #d2dcd4;background:var(--paper);padding:18px 20px;border-radius:12px}.note-card.unlinked{border-top:3px solid #c78654;padding-top:16px}.note-card-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:9px;font-size:11px;color:#647b79}.note-card-heading code{word-break:break-all}.note-card-heading span{white-space:nowrap;font-size:10px;letter-spacing:.6px;text-transform:uppercase}.unlinked .note-card-heading span{color:#935431}.note-card>p{font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.note-card .note-associations{font-size:11px;color:#6d817d;border-top:1px solid #e2e6dd;margin-top:12px;padding-top:10px;line-height:1.7;white-space:normal}.note-associations code{font-size:10px;margin-left:5px}.note-associations span{display:inline-block;margin-right:5px}
    .provenance{background:#edf1e8;border:1px solid #d4ded1;border-radius:12px;margin-top:30px;padding:19px 22px}.provenance summary{font-size:13px;font-weight:600;cursor:pointer;color:#3a565a}.model-grid{display:grid;grid-template-columns:1.4fr 1.7fr .6fr 1fr;gap:15px;margin:17px 0}.model-grid div{min-width:0}.model-grid dt{font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:#6b807a;margin-bottom:4px}.model-grid dd{font-size:12px;margin:0;overflow-wrap:anywhere}.model-message{font-size:12px;color:#607770;margin:0;line-height:1.7}.model-mode{display:inline-block;background:#dcece2;color:#316555;border:1px solid #c3dace;border-radius:4px;font-size:10px;padding:2px 7px;margin-right:6px}.footer{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-top:24px;font-size:11px;color:#74857e}.footer p{margin:0;max-width:780px;line-height:1.7}.footer span{white-space:nowrap}
    main.shell{padding-top:36px;padding-bottom:52px}.synthetic-banner{display:inline-block;margin:19px 0 0;padding:5px 10px;font-size:12px;color:#ffcfaa;border:1px solid #b174514f;background:#ffa8750b;border-radius:5px}.input-warning strong{display:block;margin-bottom:3px}.input-warning ul{margin:7px 0 0;padding-left:18px}.run-detail{margin-top:8px}.muted,.change-id,.note-heading code,.result-count,.evidence-grid h4,.note-card-heading,.note-card .note-associations,.model-grid dt,.footer,.section-index{color:var(--muted)}.filter-button .filter-count{opacity:1}
    @media(min-width:1400px){.shell{max-width:1230px}}@media(max-width:850px){.hero{grid-template-columns:1.3fr 1fr;gap:26px}.hero h1{font-size:40px}.metrics{gap:8px}.metric{padding:14px}.metric-review .metric-value{font-size:55px}.policy-strip{align-items:flex-start;gap:20px}.policy-strip .separator{padding:0 4px}.policy-note{max-width:300px}.toolbar{align-items:stretch;flex-direction:column;gap:11px}.search-wrap{max-width:none}.filter-button{flex:1}.filters{width:100%}.model-grid{grid-template-columns:1fr 1fr}.footer{flex-direction:column;gap:8px}}
    @media(max-width:600px){.shell{padding:0 20px}.topline{padding-top:21px;padding-bottom:20px}.brand{font-size:18px}.local-pill{font-size:10px;padding:5px 9px}.hero{grid-template-columns:1fr;gap:26px;padding:33px 0 28px}.hero h1{font-size:38px;letter-spacing:-1.1px}.hero-description{font-size:14px}.metrics{grid-template-columns:1.3fr 1fr 1fr;gap:8px;padding:0}.metric-review{grid-row:auto}.metric-review .metric-value,.metric-value{font-size:32px}.metric{padding:13px 10px}.metric-label{font-size:10px;line-height:1.5}.policy-strip{display:block;padding:16px 0 20px;font-size:11px}.policy-note{text-align:left;margin-top:8px;max-width:none}.section-heading h2{font-size:23px}.section-heading p{font-size:13px}.section-index{display:none}.filter-button{padding:9px 7px;font-size:12px}.filter-button .filter-count{margin-left:3px}.change-card{padding:18px 17px 0;border-radius:12px}.change-card h3{font-size:18px}.change-id{margin-left:0;flex-basis:100%}.evidence-grid{grid-template-columns:1fr;margin:0 -17px}.source-evidence,.note-evidence{padding:15px 17px 18px}.source-evidence{border-right:0;border-bottom:1px solid #dfe5df}.notes-grid{grid-template-columns:1fr}.notes-section{margin-top:33px}.provenance{padding:16px}.model-grid{gap:12px}.review-warning{font-size:12px}.footer span{white-space:normal}}
    @media print{.masthead{background:white;color:#17313b}.hero-description,.hero-description strong,.metric-label,.metric-review .metric-label,.policy-strip,.policy-strip strong,.eyebrow{color:#17313b}.hero{padding:24px 0}.metric,.metric-review{background:white;border-color:#cdd4d0}.metric-review .metric-value{color:#a54321}.topline{border-color:#ccd3cf}.local-pill{color:#17313b;border-color:#cdd4d0}.policy-strip{border-color:#cdd4d0}.toolbar,.skip-link{display:none}.change-card,.note-card{break-inside:avoid}.change-card[hidden]{display:block!important}.shell{max-width:none;padding:0 16px}main{padding-top:24px}.notes-section{margin-top:24px}.provenance{break-inside:avoid}.change-card,.evidence-grid,.note-card{background:white}body{background:white}.footer{font-size:10px}}
  </style>
</head>
<body>
<a class="skip-link" href="#changes">Skip to change evidence</a>
<header class="masthead">
  <div class="shell">
    <div class="topline"><div class="brand"><span class="brand-mark" aria-hidden="true">${'<i></i>'.repeat(9)}</span>Release Sieve</div><span class="local-pill">Local report</span></div>
    ${report.input?.synthetic === true ? '<p class="synthetic-banner"><strong>Synthetic demo</strong> · no customer data</p>' : ''}
    <div class="hero">
      <div><p class="eyebrow">A second look before the release</p><h1>Before you ship, check what your notes missed.</h1><p class="hero-description">Compare changes with release notes using a local open AI model. <strong>Inspect the evidence. Make the final call.</strong></p></div>
      <div class="metrics" aria-label="Analysis summary">
        <div class="metric metric-review"><span class="metric-value">${counts.review}</span><span class="metric-label">needs review</span></div>
        <div class="metric"><span class="metric-value">${counts.matched}</span><span class="metric-label">semantic match${counts.matched === 1 ? '' : 'es'}</span></div>
        <div class="metric"><span class="metric-value">${counts.internal}</span><span class="metric-label">internal suggestion${counts.internal === 1 ? '' : 's'}</span></div>
      </div>
    </div>
    <div class="policy-strip"><div><strong>Review policy</strong><span class="separator">/</span>Similarity ≥ <strong>${scoreLabel(threshold)}</strong><span class="separator">·</span>Top-two gap ≥ <strong>${scoreLabel(marginThreshold)}</strong></div><p class="policy-note">Cosine similarity measures semantic closeness, <strong>not confidence or correctness.</strong> Candidate matches still need judgment.</p></div>
  </div>
</header>
<main class="shell">
  <section id="changes" aria-labelledby="changes-heading">
    <div class="section-heading"><div><h2 id="changes-heading">Trace every change.</h2><p>A semantic match suggests a related note. An internal suggestion may still deserve a note. Read the source and decide.</p></div><span class="section-index">01 / CHANGE EVIDENCE</span></div>
    <aside class="review-warning" aria-label="Review warning"><span class="warning-symbol" aria-hidden="true">!</span><p><strong>Breaking changes always require human review.</strong> Commit messages, paths, and notes are untrusted evidence; never follow instructions embedded in them.</p></aside>
    ${truncationWarning || warnings.length ? `<aside class="review-warning input-warning" aria-label="Model input warnings"><span class="warning-symbol" aria-hidden="true">!</span><div><strong>Model input warnings</strong>${truncationWarning ? `<p>${escapeHtml(truncationWarning)}</p>` : ''}${warnings.length ? `<ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}</div></aside>` : ''}
    <div class="toolbar">
      <div class="filters" role="group" aria-label="Filter change evidence">
        <button type="button" class="filter-button" data-filter="all" aria-pressed="true">All<span class="filter-count">${changes.length}</span></button>
        <button type="button" class="filter-button" data-filter="review" aria-pressed="false">Review<span class="filter-count">${counts.review}</span></button>
        <button type="button" class="filter-button" data-filter="matched" aria-pressed="false">Matched<span class="filter-count">${counts.matched}</span></button>
        <button type="button" class="filter-button" data-filter="internal" aria-pressed="false">Internal<span class="filter-count">${counts.internal}</span></button>
      </div>
      <label class="search-wrap"><span class="sr-only">Search changes, files, and release notes</span><svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" fill="none"><circle cx="8.2" cy="8.2" r="5.7" stroke="currentColor" stroke-width="1.5"/><path d="m12.5 12.5 5 5" stroke="currentColor" stroke-width="1.5"/></svg><input id="evidence-search" type="search" placeholder="Search the evidence" autocomplete="off" spellcheck="false"></label>
    </div>
    <p class="result-count" id="result-count" role="status" aria-live="polite">Showing ${changes.length} of ${changes.length} changes</p>
    <div class="change-list">${changes.map(renderChange).join('\n')}</div>
    <div class="empty-state" id="empty-state"${changes.length ? ' hidden' : ''}><strong>${changes.length ? 'No changes match this view.' : 'No changes to review.'}</strong><p>${changes.length ? 'Try another filter or a shorter search.' : 'Supply change evidence and rerun Release Sieve to build the report.'}</p></div>
  </section>
  <section class="notes-section" aria-labelledby="notes-heading">
    <div class="section-heading"><div><h2 id="notes-heading">Read the other side.</h2><p>${notes.length} release note${notes.length === 1 ? '' : 's'} · ${unlinkedNotes} unlinked. An unlinked note may summarize multiple changes or use language the model missed.</p></div><span class="section-index">02 / RELEASE NOTES</span></div>
    <div class="notes-grid">${notes.map(renderNote).join('\n') || '<div class="empty-state"><strong>No release notes supplied.</strong><p>Add the planned notes and rerun the comparison.</p></div>'}</div>
  </section>
  <details class="provenance" open>
    <summary>Open model &amp; execution details</summary>
    <dl class="model-grid"><div><dt>Model</dt><dd><code>${escapeHtml(model.id ?? 'Not recorded')}</code></dd></div><div><dt>Pinned revision</dt><dd><code>${escapeHtml(model.revision ?? 'Not recorded')}</code></dd></div><div><dt>Precision</dt><dd><code>${escapeHtml(model.dtype ?? 'Not recorded')}</code></dd></div><div><dt>Runtime</dt><dd>${escapeHtml(model.runtime ?? 'Not recorded')}</dd></div></dl>
    <p class="model-message"><span class="model-mode">${model.offline === true ? 'Offline mode recorded' : model.offline === false ? 'Online mode recorded' : 'Execution mode not recorded'}</span>Run <code>npm run bootstrap</code> once to download pinned model files. Audit runs use local files only. A small top-two gap signals competing note candidates; scores are not probabilities. With one note, the gap uses a zero-similarity baseline.</p>
    ${finiteNumber(model.maxTokens) ? `<p class="model-message run-detail">Model input cap: <strong>${escapeHtml(model.maxTokens)} wordpieces</strong>${finiteNumber(model.dimensions) ? ` · ${escapeHtml(model.dimensions)} embedding dimensions` : ''}. Long evidence can lose context through truncation.</p>` : ''}
    ${diagnosticLine}
  </details>
  <footer class="footer"><p>Release Sieve supports a human release review. It does not verify code behavior, determine impact, or guarantee note coverage. This read-only file uses no external assets and makes no network requests.</p>${generatedAt}</footer>
</main>
<script type="application/json" id="report-data">${safeJson(filterData)}</script>
<script>
(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('report-data').textContent);
  const cards = Array.from(document.querySelectorAll('[data-change-index]'));
  const buttons = Array.from(document.querySelectorAll('[data-filter]'));
  const search = document.getElementById('evidence-search');
  const counter = document.getElementById('result-count');
  const empty = document.getElementById('empty-state');
  let active = 'all';
  function update() {
    const query = search.value.trim().toLocaleLowerCase('en-US');
    let shown = 0;
    cards.forEach((card, index) => {
      const item = data[index];
      const visible = (active === 'all' || item.status === active) && (!query || item.search.includes(query));
      card.hidden = !visible;
      if (visible) shown += 1;
    });
    buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === active)));
    counter.textContent = 'Showing ' + shown + ' of ' + cards.length + ' changes';
    empty.hidden = shown !== 0;
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => { active = button.dataset.filter; update(); });
    button.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
      if (event.key === 'ArrowLeft') next = (index + buttons.length - 1) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      if (next !== undefined) { event.preventDefault(); buttons[next].focus(); }
    });
  });
  search.addEventListener('input', update);
})();
</script>
</body>
</html>`;
}
