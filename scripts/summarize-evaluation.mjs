import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from '../src/model.mjs';
import { verifyFreeze } from '../evaluation/freeze.mjs';

const freeze=await verifyFreeze();
const native=JSON.parse(await readFile(path.join(ROOT,'evaluation/results/native.json'),'utf8'));
const browser=JSON.parse(await readFile(path.join(ROOT,'evaluation/results/browser.json'),'utf8'));
const fixtures=JSON.parse(await readFile(path.join(ROOT,'evaluation/fixtures.json'),'utf8'));
assert.equal(native.fixtures.evaluationSha256,freeze.splits.evaluation.sha256);
assert.equal(browser.freeze.fixtureSHA256,freeze.splits.evaluation.sha256);
const labels={semantic:'Semantic, fixed 0.48 / 0.06',lexicalFixed:'Lexical, fixed 0.48 / 0.06',lexicalCalibrated:`Lexical, calibration-selected ${native.policies.lexicalCalibrated.threshold} / ${native.policies.lexicalCalibrated.margin}`};
const fraction=metric=>metric.denominator?`${metric.numerator}/${metric.denominator} (${(metric.rate*100).toFixed(1)}%)`:'N/A (0 observations)';
const time=summary=>`${summary.median.toFixed(1)} ms (${summary.min.toFixed(1)}–${summary.max.toFixed(1)}), n=${summary.n}`;
const clean=text=>String(text).replace(/[\r\n|]/g,' ').replace(/([\\`*_\[\]<>])/g,'\\$1');

const lines=[
  '# Release Sieve: frozen synthetic evaluation',
  '',
  'This diagnostic evaluation tests correspondence and review decisions on **48 author-constructed English synthetic mini-releases**. Labels are specifications with readable rationales, not independent human annotations. The proportions were deliberately chosen; these are not estimates of deployed error rates, customer savings, or business demand.',
  '',
  `The protocol, exact input bytes, scoring code and existing product/model state were frozen before inference in commit **c23a14b7112c73168661ea46d97cfe646d43ccf0**, at ${freeze.frozenAtUTC}. Evaluation SHA-256: \`${freeze.splits.evaluation.sha256}\`. [Freeze inventory](freeze.json), [full protocol](PROTOCOL.md), [fixture specifications](FIXTURES.md), [all labels](fixtures.json).`,
  '',
  '## Operating points',
  '',
  'The semantic policy remains the production default: cosine ≥0.48, top-two gap ≥0.06, all breaking changes reviewed, conventional internal types handled separately. No weights, model revision, defaults or fixtures were altered after scoring.',
  '',
  'The lexical baseline uses lowercase Unicode alphanumeric term counts and cosine similarity, without stemming, stopword removal, IDF fitting or learned weights. Sharing numeric gates is not a claim that lexical and embedding score scales are equivalent. Therefore both fixed gates and a separately selected lexical operating point are shown.',
  '',
  `A disjoint **12-case calibration set** supplied six safe and six ordinary must-review cases. The predeclared 60-point grid maximized correct acceptance subject to zero unsafe calibration accepts, breaking ties toward stricter gates. It selected **${native.policies.lexicalCalibrated.threshold} / ${native.policies.lexicalCalibrated.margin}**, accepting **3/6** safe cases and **0/6** must-review cases. That finite selection condition does not establish zero future risk. [Calibration labels](calibration.json) and all grid outcomes in [native results](results/native.json).`,
  '',
  '## Ordinary-case outcomes',
  '',
  'The primary denominator is **38 ordinary cases: 16 safe unique matches and 22 cases requiring review**. Six mandatory breaking and four internal cases are reported separately below.',
  '',
  '| Matcher / policy | Correct acceptance /16 safe | Review /38 ordinary | Accepted precision | False reassurance /all accepts | Must-review escapes /22 | Top-1 /16 | Top-2 /16 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
];
for(const [name,title]of Object.entries(labels)){
  const m=native.summaries[name].ordinary.metrics;
  lines.push(`| ${title} | ${fraction(m.usefulAcceptance)} | ${fraction(m.reviewBurden)} | ${fraction(m.acceptedPrecision)} | ${fraction(m.falseReassurance)} | ${fraction(m.mustReviewEscape)} | ${fraction(m.retrievalTop1)} | ${fraction(m.retrievalTop2)} |`);
}
lines.push('',
  '“False reassurance” means accepting a labeled must-review case or accepting the wrong note on a safe case. Ambiguity is a conservative specification/review-policy choice: accepting a plausible candidate there is not necessarily a factual contradiction. Must-review escape has a different denominator and excludes wrong-note accepts on safe cases. There were no wrong-note accepts on the 16 safe cases in these observations.',
  '',
  '**The semantic matcher accepted all eight contradictory hard negatives.** Its ten unsafe accepts consist of those eight contradictions plus two ambiguity-policy violations. It reviewed all eight omissions. It found all eight paraphrases as accepted correspondences; both lexical operating points sent all eight paraphrases to review. The useful paraphrase behavior does not make the matcher a contradiction detector or proof of coverage.',
  '',
  '| Category | Cases | Semantic accepted/review/internal | Fixed lexical accepted/review/internal | Calibrated lexical accepted/review/internal |',
  '| --- | ---: | --- | --- | --- |',
);
for(const category of ['literal','paraphrase','omitted','hard_negative','ambiguous','breaking','internal']){
  const entries=Object.keys(labels).map(name=>native.summaries[name].byCategory[category].counts);
  lines.push(`| ${category} | ${entries[0].total} | ${entries.map(count=>`${count.actual.matched}/${count.actual.review}/${count.actual.internal}`).join(' | ')} |`);
}
const wasmRows=browser.evaluation.cases.flatMap(item=>item.outcomes);
const differences=[];
const scoreDeltas=[];
for(const row of native.outcomes.semantic){
  const other=wasmRows.find(candidate=>candidate.scenarioId===row.scenarioId&&candidate.changeId===row.changeId);
  assert.ok(other);
  if(row.actual!==other.actual||row.matchNoteId!==other.matchNoteId||row.runnerUpNoteId!==other.runnerUpNoteId)differences.push(row.scenarioId);
  if(row.bestScore!==null&&other.bestScore!==null)scoreDeltas.push(Math.abs(row.bestScore-other.bestScore));
}
lines.push('',
  `Node CPU and browser WASM agreed on all **${wasmRows.length}** dispositions and top-two candidate rankings (${differences.length} differences). Only the closest and runner-up candidates were recorded; lower ranks in scenarios with more candidates were not compared. Scores were not identical: the largest observed top-score absolute difference was **${Math.max(...scoreDeltas).toFixed(6)}**. Small numerical differences can matter near a gate; this observation does not guarantee backend equivalence on other inputs.`,
  '',
  'All three operating points kept **6/6 breaking changes in review** and **4/4 internal cases as internal suggestions**. These check deterministic policy gates and are excluded from the primary model results. The fixtures do not validate internal heuristics on deceptive real commit types.',
  '',
  '## Inspect every error',
  '',
  'Every unsafe accept and missed safe acceptance is retained below. Scores are the observed native values, not probabilities. Each ID identifies the same frozen scenario in fixtures.json; use the browser raw results for its numerical values.',
  '',
);
for(const [name,title]of Object.entries(labels)){
  lines.push(`### ${title}`,'');
  for(const row of native.outcomes[name].filter(row=>row.falseReassurance||row.expected==='match'&&!row.correctAccepted)){
    const scenario=fixtures.scenarios.find(scenario=>scenario.id===row.scenarioId);
    const note=scenario.notes.find(note=>note.id===row.matchNoteId);
    lines.push(`- **${row.scenarioId}**: expected ${row.expected}; observed ${row.actual}. Closest \`${row.matchNoteId??'none'}\`, score ${row.bestScore??'N/A'}, gap ${row.gap??'N/A'}.`,
      `  - Change: ${clean(scenario.changes[0].subject)}`,
      `  - Candidate: ${clean(note?.text??'No candidate.')}`,
      `  - Label rationale: ${clean(row.rationale)}`);
  }
  lines.push('');
}
lines.push(
  '## Measured timings',
  '',
  'One fixed **20-change /12-note synthetic workload** encoded **28 texts** (16 non-internal changes plus 12 notes), with **0 truncated inputs**. Native recorded 2,415 encoded characters. Windows x64, Node 26.8.1, ONNX Runtime Node 1.30.0 (two intra-op/one inter-op threads); headless Edge 153.0.4234.32 and single-threaded ONNX Runtime WASM. This is one coarse environment, not a cross-device benchmark. Memory was not measured.',
  '',
  '| Cohort | Observed median (minimum–maximum), sample count | Included work |',
  '| --- | --- | --- |',
  `| Native fresh-process model setup + audit | ${time(native.timings.cold.modelAndAuditMs)} | Local model hashes/imports/tokenizer/model initialization and audit; excludes Node startup/disposal |`,
  `| Native fresh-process total wall time | ${time(native.timings.cold.processWallMs)} | Also includes process launch, freeze validation and disposal |`,
  `| Native loaded-model audit | ${time(native.timings.warm.auditMs)} | Audit in an existing model; no setup |`,
  `| Browser empty-cache context/model cold | ${time(browser.timing.contextModelCold.summary.messageRoundTripMs)} | Loopback asset transfer/hash checks, model load, audit and messaging; any worker startup still pending after postMessage |`,
  `| Browser verified-cache fresh worker | ${time(browser.timing.cachedFreshWorker.summary.messageRoundTripMs)} | Cache reads/hash checks, model initialization, audit and messaging |`,
  `| Browser reused worker | ${time(browser.timing.warmReusedWorker.summary.messageRoundTripMs)} | Audit and result messaging; no asset/model setup |`,
  '',
  'Each browser cold sample downloaded **37,974,266 bytes** of model/runtime files. Cached and reused-worker samples downloaded **zero** model/runtime bytes. Six cache assets were SHA-256 checked. Browser timings exclude server/browser launch, page creation and UI rendering. They share a browser process and use loopback; OS disk/code caches were not flushed. They do not measure public-hosting download speed. Cohorts were run sequentially, not deliberately in contention; background machine activity was not isolated. Every sample is retained without discarding warm observations.',
  '',
  '### Timing-definition correction',
  '',
  'The initial article/report and the historical messageRoundTripMs description in the frozen browser script and original browser.json incorrectly described worker startup as included without qualification. The worker was constructed before the timer started. **Browser timings run from immediately before postMessage until the result event. They exclude worker construction and startup already completed, but may include remaining startup.** They also exclude browser launch, page creation/loading and UI rendering. Worker-reported durationMs has a separate boundary beginning inside the run handler.',
  '',
  'This corrects the interpretation, not the measured samples. The frozen benchmark script, protocol, fixtures, original JSON observations, model and policy remain unchanged; their original wording is retained for provenance and superseded by this explicit correction. No rerun or new timing measurement was made.',
  '',
  '## Reproduce and retain observations',
  '',
  'Install the exact lockfile dependencies and bootstrap the pinned public model once. Use an installed Edge (or set RELEASE_SIEVE_BROWSER=chrome); no browser download is needed. The committed distribution supplies the browser worker/assets.',
  '',
  '```sh',
  'npm ci --ignore-scripts',
  'npm run bootstrap',
  'npm test',
  'npm run benchmark:native -- --out evaluation/results/my-native.json',
  'npm run benchmark:browser -- --out evaluation/results/my-browser.json',
  '```',
  '',
  'Both runners verify frozen hashes before inference and refuse to overwrite an existing result file. Do not regenerate the freeze to make changed source appear comparable. To change a protocol or model, preserve this version and use a new evaluation set. Native inference explicitly forbids fetch. Browser inference uses unchanged shipped worker bytes and fixed same-origin asset GETs with no request bodies. This test did not detect evidence uploads or persistent drafts.',
  '',
  '[Native raw reports, calibration grid and individual timing samples](results/native.json) · [Browser case outcomes, asset checks and samples](results/browser.json) · [Timing input](timing-workload.json) · [Metric definitions](metrics.mjs).',
  '',
  '## Limits and practical implication',
  '',
  'This balanced, small, author-written suite is diagnostic, not a randomly sampled release corpus. It contains easy literal controls and deliberately difficult contradictions. No confidence intervals or general accuracy claim follow from it. Labels reflect the stated synthetic behavior, not inspected code diffs or independently adjudicated maintainer feedback. English short-text results do not cover multilingual releases, long-input truncation, multiple changes per note, large candidate collections, physical mobile devices, Firefox or Safari.',
  '',
  'The observed value is finding differently phrased candidate relationships while keeping evidence visible. The observed risk is that similarity preserves related vocabulary while missing numbers, direction, scope and preconditions. A maintainer must read apparently matched notes as well as the review queue. The next commercial step is a willing maintainer trial; this project has no validated willingness to pay, measured user time savings, customers or revenue. AI-assisted.',
  '',
);
await writeFile(path.join(ROOT,'evaluation/README.md'),lines.join('\n'));
const csvColumns=['matcher','scenarioId','category','domain','group','expected','actual','matchNoteId','bestScore','gap','runnerUpNoteId','runnerUpScore','correctAccepted','falseReassurance','mustReviewEscape','top1Correct','top2Correct'];
const csv=value=>`"${String(value??'').replaceAll('"','""')}"`;
const records=Object.entries(native.outcomes).flatMap(([matcher,rows])=>rows.map(row=>({matcher,...row})));
await writeFile(path.join(ROOT,'evaluation/results/outcomes.csv'),[csvColumns.map(csv).join(','),...records.map(row=>csvColumns.map(column=>csv(row[column])).join(','))].join('\n')+'\n');
console.log(JSON.stringify({ordinaryCases:38,rows:records.length,backendDecisionDifferences:differences.length,largestScoreDifference:Math.max(...scoreDeltas),semanticUnsafeAccepted:native.outcomes.semantic.filter(row=>row.falseReassurance).length},null,2));
