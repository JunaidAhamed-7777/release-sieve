import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit.mjs';
import { evaluateScenario, summarizeEvaluation, summarizeTiming, validateScenario } from '../evaluation/metrics.mjs';

function scenario(id = 'sample', overrides = {}) {
  return {
    id, category: 'stub-category', domain: 'stub-domain',
    changes: [{ id: 'change', subject: 'feat: expose synthetic option' }],
    notes: [{ id: 'right', text: 'The synthetic option is available.' }, { id: 'wrong', text: 'An unrelated option changed.' }],
    labels: [{ changeId: 'change', expected: 'match', acceptableNoteIds: ['right'], rationale: 'Explicit synthetic correspondence.' }],
    ...overrides,
  };
}

function label(expected, acceptableNoteIds = []) {
  return { changeId: 'change', expected, acceptableNoteIds, rationale: 'A human-readable synthetic test label.' };
}

function report(actual, noteId = null, runnerUpId = null) {
  return { schemaVersion: 1, changes: [{ id: 'change', status: actual, match: noteId === null ? null : {
    noteId, score: 0.8, margin: 0.2, runnerUp: runnerUpId === null ? null : { noteId: runnerUpId, score: 0.6 },
  } }] };
}

test('safe accepted correspondence is useful; a wrong accepted note is false reassurance but not a must-review escape', () => {
  const correct = evaluateScenario(scenario('correct'), report('matched', 'right', 'wrong'))[0];
  const wrong = evaluateScenario(scenario('wrong'), report('matched', 'wrong', 'right'))[0];
  assert.equal(correct.correctAccepted, true);
  assert.equal(correct.falseReassurance, false);
  assert.equal(correct.mustReviewEscape, false);
  assert.equal(wrong.correctAccepted, false);
  assert.equal(wrong.falseReassurance, true);
  assert.equal(wrong.mustReviewEscape, false);
  assert.equal(wrong.top1Correct, false);
  assert.equal(wrong.top2Correct, true);
  assert.equal(wrong.bestScore, 0.8);
  assert.equal(wrong.gap, 0.2);
  assert.equal(wrong.runnerUpScore, 0.6);
  assert.equal(wrong.acceptedNoteId, 'wrong');
});

test('accepting an ambiguous review label is unsafe even when the candidate is individually acceptable', () => {
  const row = evaluateScenario(scenario('ambiguous', { labels: [label('review', ['right', 'wrong'])] }), report('matched', 'right', 'wrong'))[0];
  assert.equal(row.correctAccepted, false);
  assert.equal(row.falseReassurance, true);
  assert.equal(row.mustReviewEscape, true);
  assert.equal(row.retrievalEligible, false);
  assert.equal(row.top1Correct, null);
  assert.equal(row.top2Correct, null);
});

test('retrieval remains measurable when the policy abstains, and absent evidence is not correct retrieval', () => {
  const abstained = evaluateScenario(scenario(), report('review', 'wrong', 'right'))[0];
  assert.equal(abstained.top1Correct, false);
  assert.equal(abstained.top2Correct, true);
  assert.equal(abstained.correctAccepted, false);
  assert.equal(abstained.falseReassurance, false);
  assert.equal(abstained.acceptedNoteId, null);
  const suppressed = evaluateScenario(scenario(), report('internal'))[0];
  assert.equal(suppressed.top1Correct, false);
  assert.equal(suppressed.top2Correct, false);
  assert.equal(suppressed.unexpectedInternalSuppression, true);
  assert.equal(suppressed.bestScore, null);
});

test('ordinary primary metrics have explicit denominators and exclude breaking/internal easy gates', () => {
  const rows = [
    ...evaluateScenario(scenario('safe'), report('matched', 'right')),
    ...evaluateScenario(scenario('wrong'), report('matched', 'wrong')),
    ...evaluateScenario(scenario('abstain'), report('review', 'right')),
    ...evaluateScenario(scenario('missing', { labels: [label('review')] }), report('review', 'wrong')),
    ...evaluateScenario(scenario('unsafe', { labels: [label('review', ['right', 'wrong'])] }), report('matched', 'right')),
    ...evaluateScenario(scenario('suppressed', { labels: [label('review')] }), report('internal')),
    ...evaluateScenario(scenario('breaking', {
      category: 'breaking-category', changes: [{ id: 'change', subject: 'chore(api)!: remove synthetic option' }],
      labels: [label('review', ['right'])],
    }), report('review', 'right')),
    ...evaluateScenario(scenario('internal', {
      category: 'internal-category', changes: [{ id: 'change', subject: 'docs: describe synthetic option' }],
      labels: [label('internal')],
    }), report('internal')),
  ];
  const summary = summarizeEvaluation(rows);
  assert.equal(summary.ordinary.counts.total, 6);
  assert.deepEqual(summary.ordinary.counts.expected, { match: 3, review: 3, internal: 0 });
  assert.deepEqual(summary.ordinary.counts.actual, { matched: 3, review: 2, internal: 1 });
  assert.deepEqual(summary.ordinary.metrics.usefulAcceptance, { numerator: 1, denominator: 3, rate: 1 / 3 });
  assert.deepEqual(summary.ordinary.metrics.acceptedPrecision, { numerator: 1, denominator: 3, rate: 1 / 3 });
  assert.deepEqual(summary.ordinary.metrics.reviewBurden, { numerator: 2, denominator: 6, rate: 1 / 3 });
  assert.deepEqual(summary.ordinary.metrics.falseReassurance, { numerator: 2, denominator: 3, rate: 2 / 3 });
  assert.deepEqual(summary.ordinary.metrics.mustReviewEscape, { numerator: 1, denominator: 3, rate: 1 / 3 });
  assert.deepEqual(summary.ordinary.metrics.unexpectedInternalSuppression, { numerator: 1, denominator: 6, rate: 1 / 6 });
  assert.deepEqual(summary.ordinary.metrics.retrievalTop1, { numerator: 2, denominator: 3, rate: 2 / 3 });
  assert.equal(summary.ordinary.counts.requiredReviewSuppressed, 1);
  assert.equal(summary.byGroup.breaking.counts.actual.review, 1);
  assert.equal(summary.byGroup.internal.counts.correctInternal, 1);
  assert.equal(summary.byCategory['stub-category'].counts.total, 6);
  assert.equal(summary.byDomain['stub-domain'].counts.total, 8);
  assert.equal(summary.overall.counts.total, 8);
  assert.equal('accuracy' in summary.overall.metrics, false);
});

test('no acceptances yield N/A false reassurance rather than an invented zero rate', () => {
  const summary = summarizeEvaluation(evaluateScenario(scenario(), report('review', 'right')));
  assert.deepEqual(summary.ordinary.metrics.falseReassurance, { numerator: 0, denominator: 0, rate: null });
  assert.deepEqual(summary.ordinary.metrics.mustReviewEscape, { numerator: 0, denominator: 0, rate: null });
  assert.deepEqual(summarizeEvaluation([]).ordinary.metrics.reviewBurden, { numerator: 0, denominator: 0, rate: null });
});

test('breaking classification uses original input evidence, even for an internal conventional type', () => {
  const inputs = scenario('breaking-body', {
    changes: [{ id: 'change', subject: 'refactor: replace schema', body: 'BREAKING CHANGE: clients must migrate.' }],
    labels: [label('review', ['right'])],
  });
  const row = evaluateScenario(inputs, report('matched', 'right'))[0];
  assert.equal(row.group, 'breaking');
  assert.equal(row.mustReviewEscape, true);
  assert.equal(summarizeEvaluation([row]).ordinary.counts.total, 0);
  assert.equal(summarizeEvaluation([row]).byGroup.breaking.counts.mustReviewEscape, 1);
});

test('a genuinely user-facing change suppressed by an internal heuristic stays in the ordinary denominator', async () => {
  const inputs = scenario('heuristic-error', { changes: [{ id: 'change', subject: 'refactor: change exposed output format' }] });
  const result = await audit({ changes: inputs.changes, notes: inputs.notes, embed: async () => { throw new Error('Heuristic must skip embedding.'); } });
  const summary = summarizeEvaluation(evaluateScenario(inputs, result));
  assert.equal(summary.ordinary.counts.total, 1);
  assert.equal(summary.ordinary.counts.unexpectedInternalSuppression, 1);
  assert.equal(summary.ordinary.metrics.usefulAcceptance.denominator, 1);
  assert.equal(summary.byGroup.internal.counts.total, 0);
});

test('multiple changes are evaluated in input order without mutating fixtures or report', () => {
  const inputs = scenario('multi', {
    changes: [{ id: 'b', subject: 'fix: synthetic recovery' }, { id: 'a', subject: 'test: synthetic recovery' }],
    labels: [
      { ...label('internal'), changeId: 'a' },
      { ...label('match', ['right']), changeId: 'b' },
    ],
  });
  const results = { changes: [{ id: 'a', status: 'internal', match: null }, { id: 'b', status: 'matched', match: { noteId: 'right' } }] };
  const before = structuredClone({ inputs, results });
  const rows = evaluateScenario(inputs, results);
  assert.deepEqual(rows.map((row) => row.changeId), ['b', 'a']);
  assert.deepEqual(rows.map((row) => row.group), ['ordinary', 'internal']);
  assert.deepEqual({ inputs, results }, before);
  rows[0].acceptableNoteIds.push('mutating-output');
  assert.deepEqual(inputs.labels[1].acceptableNoteIds, ['right']);
});

test('labels reject missing, unknown, duplicate, ambiguous-safe, or inconsistent note references', () => {
  const bad = [
    { labels: [] },
    { labels: [{ ...label('review'), changeId: 'unknown' }] },
    { labels: [label('review'), label('review')] },
    { labels: [label('match')] },
    { labels: [label('match', ['right', 'wrong'])] },
    { labels: [label('review', ['unknown'])] },
    { labels: [label('review', ['right', 'right'])] },
    { labels: [label('internal', ['right'])] },
    { labels: [{ ...label('review'), expected: 'maybe' }] },
    { labels: [{ ...label('review'), rationale: ' ' }] },
    { labels: [{ ...label('review'), reviewReason: '' }] },
    { schemaVersion: 2 }, { changes: [] }, { category: '' }, { domain: null },
    { notes: [{ id: 'right', text: 'A' }, { id: 'right', text: 'B' }] },
    { changes: [{ id: 'change', subject: 'A' }, { id: 'change', subject: 'B' }] },
  ];
  for (const overrides of bad) assert.throws(() => validateScenario(scenario('invalid', overrides)), TypeError);
  const valid = scenario('review-with-two', { labels: [label('review', ['right', 'wrong'])] });
  assert.equal(validateScenario(valid), valid);
});

test('report validation prevents missing or invented decisions from silently altering denominators', () => {
  const bad = [
    { changes: [] },
    { changes: [{ id: 'unknown', status: 'review' }] },
    { changes: [{ id: 'change', status: 'review' }, { id: 'change', status: 'review' }] },
    { changes: [{ id: 'change', status: 'matched', match: null }] },
    { changes: [{ id: 'change', status: 'guess' }] },
    report('matched', 'unknown'),
    report('matched', 'right', 'unknown'),
    report('matched', 'right', 'right'),
    { changes: [{ id: 'change', status: 'review', match: { noteId: 'right', score: Infinity } }] },
  ];
  for (const result of bad) assert.throws(() => evaluateScenario(scenario(), result), TypeError);
});

test('aggregation refuses duplicate scenario/change observations and malformed retrieval flags', () => {
  const [row] = evaluateScenario(scenario(), report('matched', 'right'));
  assert.throws(() => summarizeEvaluation([row, row]), /duplicate/);
  assert.throws(() => summarizeEvaluation([{ ...row, top1Correct: null }]), /Top-k/);
  assert.throws(() => summarizeEvaluation([{ ...row, falseReassurance: 1 }]), /boolean/);
  assert.equal(summarizeEvaluation([row, { ...row, scenarioId: 'another' }]).ordinary.counts.total, 2);
});

test('timing summaries include all samples, handle odd/even medians and preserve input order', () => {
  const samples = [9, 1, 4];
  assert.deepEqual(summarizeTiming(samples), { n: 3, median: 4, min: 1, max: 9 });
  assert.deepEqual(samples, [9, 1, 4]);
  assert.deepEqual(summarizeTiming([9, 1, 6, 4]), { n: 4, median: 5, min: 1, max: 9 });
  assert.deepEqual(summarizeTiming([0]), { n: 1, median: 0, min: 0, max: 0 });
  assert.deepEqual(summarizeTiming([]), { n: 0, median: null, min: null, max: null });
  assert.equal(summarizeTiming([Number.MAX_VALUE, Number.MAX_VALUE]).median, Number.MAX_VALUE);
  assert.equal(summarizeTiming([Number.MIN_VALUE, Number.MIN_VALUE]).median, Number.MIN_VALUE);
  for (const invalid of [null, [NaN], [Infinity], [-1], ['4']]) assert.throws(() => summarizeTiming(invalid), TypeError);
});
