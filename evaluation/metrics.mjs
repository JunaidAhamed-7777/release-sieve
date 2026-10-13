import { isBreaking, validateInputs } from '../src/audit.mjs';

const EXPECTED = new Set(['match', 'review', 'internal']);
const ACTUAL = new Set(['matched', 'review', 'internal']);
const GROUPS = new Set(['ordinary', 'breaking', 'internal']);

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonempty string.`);
}

/** Validate labels against inputs before running any evaluator. No input is mutated. */
export function validateScenario(scenario) {
  object(scenario, 'scenario');
  if (scenario.schemaVersion !== undefined && scenario.schemaVersion !== 1) {
    throw new TypeError('scenario.schemaVersion must be 1 when supplied.');
  }
  for (const key of ['id', 'category', 'domain']) text(scenario[key], `scenario.${key}`);
  validateInputs({ changes: scenario.changes, notes: scenario.notes });
  if (!scenario.changes.length) throw new TypeError('scenario must contain at least one change.');
  if (!Array.isArray(scenario.labels)) throw new TypeError('scenario.labels must be an array.');
  const changeIds = new Set(scenario.changes.map((change) => change.id));
  const noteIds = new Set(scenario.notes.map((note) => note.id));
  const labeledIds = new Set();
  for (const [index, label] of scenario.labels.entries()) {
    const name = `scenario.labels[${index}]`;
    object(label, name);
    if (!changeIds.has(label.changeId)) throw new TypeError(`${name}.changeId must refer to a known change.`);
    if (labeledIds.has(label.changeId)) throw new TypeError(`Duplicate label for change ${JSON.stringify(label.changeId)}.`);
    labeledIds.add(label.changeId);
    if (!EXPECTED.has(label.expected)) throw new TypeError(`${name}.expected must be match, review, or internal.`);
    text(label.rationale, `${name}.rationale`);
    if (label.reviewReason !== undefined) text(label.reviewReason, `${name}.reviewReason`);
    if (!Array.isArray(label.acceptableNoteIds)) throw new TypeError(`${name}.acceptableNoteIds must be an array.`);
    const acceptable = new Set();
    for (const id of label.acceptableNoteIds) {
      if (!noteIds.has(id)) throw new TypeError(`${name}.acceptableNoteIds must refer to known notes.`);
      if (acceptable.has(id)) throw new TypeError(`${name}.acceptableNoteIds contains a duplicate note ID.`);
      acceptable.add(id);
    }
    if (label.expected === 'match' && acceptable.size !== 1) {
      throw new TypeError(`${name}: a safe match requires exactly one acceptable note ID.`);
    }
    if (label.expected === 'internal' && acceptable.size !== 0) {
      throw new TypeError(`${name}: an internal label must have no acceptable note IDs.`);
    }
  }
  if (labeledIds.size !== changeIds.size) throw new TypeError('Every change must have exactly one label.');
  return scenario;
}

function optionalScore(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite when supplied.`);
  return value;
}

/** Classify policy decisions separately from top-k retrieval and safety gates. */
export function evaluateScenario(scenario, report) {
  validateScenario(scenario);
  object(report, 'report');
  if (report.schemaVersion !== undefined && report.schemaVersion !== 1) throw new TypeError('report.schemaVersion must be 1 when supplied.');
  if (!Array.isArray(report.changes)) throw new TypeError('report.changes must be an array.');
  const changes = new Map(scenario.changes.map((change) => [change.id, change]));
  const labels = new Map(scenario.labels.map((label) => [label.changeId, label]));
  const noteIds = new Set(scenario.notes.map((note) => note.id));
  const results = new Map();
  for (const result of report.changes) {
    object(result, 'report change');
    if (!changes.has(result.id)) throw new TypeError('Report contains an unknown change ID.');
    if (results.has(result.id)) throw new TypeError('Report contains a duplicate change ID.');
    if (!ACTUAL.has(result.status)) throw new TypeError('Report change status must be matched, review, or internal.');
    if (result.match !== undefined && result.match !== null) {
      object(result.match, 'report change match');
      if (!noteIds.has(result.match.noteId)) throw new TypeError('Report candidate must refer to a known note.');
      if (result.match.runnerUp !== undefined && result.match.runnerUp !== null) {
        object(result.match.runnerUp, 'report change runner-up');
        if (!noteIds.has(result.match.runnerUp.noteId)) throw new TypeError('Report runner-up must refer to a known note.');
        if (result.match.runnerUp.noteId === result.match.noteId) throw new TypeError('Report runner-up must differ from the closest note.');
      }
    } else if (result.status === 'matched') throw new TypeError('A matched report change requires a candidate note.');
    results.set(result.id, result);
  }
  if (results.size !== changes.size) throw new TypeError('Report must contain every scenario change exactly once.');

  return scenario.changes.map((change) => {
    const label = labels.get(change.id);
    const result = results.get(change.id);
    const matchNoteId = result.match?.noteId ?? null;
    const runnerUpNoteId = result.match?.runnerUp?.noteId ?? null;
    const retrievalEligible = label.expected === 'match';
    const correctAccepted = result.status === 'matched' && retrievalEligible && label.acceptableNoteIds.includes(matchNoteId);
    const group = isBreaking(change) ? 'breaking' : label.expected === 'internal' ? 'internal' : 'ordinary';
    return {
      scenarioId: scenario.id,
      changeId: change.id,
      category: scenario.category,
      domain: scenario.domain,
      group,
      expected: label.expected,
      actual: result.status,
      acceptableNoteIds: [...label.acceptableNoteIds],
      rationale: label.rationale,
      reviewReason: label.reviewReason ?? null,
      matchNoteId,
      acceptedNoteId: result.status === 'matched' ? matchNoteId : null,
      runnerUpNoteId,
      bestScore: optionalScore(result.match?.score, 'bestScore'),
      gap: optionalScore(result.match?.margin, 'gap'),
      runnerUpScore: optionalScore(result.match?.runnerUp?.score, 'runnerUpScore'),
      correctAccepted,
      falseReassurance: result.status === 'matched' && !correctAccepted,
      mustReviewEscape: result.status === 'matched' && label.expected === 'review',
      retrievalEligible,
      top1Correct: retrievalEligible ? label.acceptableNoteIds.includes(matchNoteId) : null,
      top2Correct: retrievalEligible ? label.acceptableNoteIds.includes(matchNoteId) || label.acceptableNoteIds.includes(runnerUpNoteId) : null,
      unexpectedInternalSuppression: group === 'ordinary' && result.status === 'internal',
    };
  });
}

const metric = (numerator, denominator) => ({ numerator, denominator, rate: denominator === 0 ? null : numerator / denominator });

function summarizeRows(rows) {
  const count = (predicate) => rows.filter(predicate).length;
  const expected = Object.fromEntries([...EXPECTED].map((status) => [status, count((row) => row.expected === status)]));
  const actual = Object.fromEntries([...ACTUAL].map((status) => [status, count((row) => row.actual === status)]));
  const counts = {
    total: rows.length,
    expected,
    actual,
    accepted: actual.matched,
    correctAccepted: count((row) => row.correctAccepted),
    falseReassurance: count((row) => row.falseReassurance),
    mustReviewEscape: count((row) => row.mustReviewEscape),
    unexpectedInternalSuppression: count((row) => row.unexpectedInternalSuppression),
    safeMatchReviewed: count((row) => row.expected === 'match' && row.actual === 'review'),
    wrongNoteAccepted: count((row) => row.expected === 'match' && row.falseReassurance),
    requiredReviewSuppressed: count((row) => row.expected === 'review' && row.actual === 'internal'),
    correctInternal: count((row) => row.expected === 'internal' && row.actual === 'internal'),
    retrievalEligible: count((row) => row.retrievalEligible),
    top1Correct: count((row) => row.top1Correct === true),
    top2Correct: count((row) => row.top2Correct === true),
  };
  return {
    counts,
    metrics: {
      usefulAcceptance: metric(counts.correctAccepted, expected.match),
      acceptedPrecision: metric(counts.correctAccepted, actual.matched),
      reviewBurden: metric(actual.review, rows.length),
      falseReassurance: metric(counts.falseReassurance, actual.matched),
      mustReviewEscape: metric(counts.mustReviewEscape, expected.review),
      unexpectedInternalSuppression: metric(counts.unexpectedInternalSuppression, rows.length),
      retrievalTop1: metric(counts.top1Correct, counts.retrievalEligible),
      retrievalTop2: metric(counts.top2Correct, counts.retrievalEligible),
      internalRetention: metric(counts.correctInternal, expected.internal),
    },
  };
}

/** Primary results exclude internal heuristics and mandatory breaking-change gates. */
export function summarizeEvaluation(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Evaluation rows must be an array.');
  const seen = new Map();
  for (const row of rows) {
    object(row, 'evaluation row');
    for (const key of ['scenarioId', 'changeId', 'category', 'domain']) text(row[key], `evaluation row.${key}`);
    if (!GROUPS.has(row.group) || !EXPECTED.has(row.expected) || !ACTUAL.has(row.actual)) throw new TypeError('Evaluation row has an invalid group or status.');
    const ids = seen.get(row.scenarioId) ?? new Set();
    if (ids.has(row.changeId)) throw new TypeError('Evaluation rows contain a duplicate scenario/change pair.');
    ids.add(row.changeId);
    seen.set(row.scenarioId, ids);
    for (const key of ['correctAccepted', 'falseReassurance', 'mustReviewEscape', 'retrievalEligible', 'unexpectedInternalSuppression']) {
      if (typeof row[key] !== 'boolean') throw new TypeError(`evaluation row.${key} must be a boolean.`);
    }
    for (const key of ['top1Correct', 'top2Correct']) {
      if (row[key] !== null && typeof row[key] !== 'boolean') throw new TypeError(`evaluation row.${key} must be a boolean or null.`);
      if (row.retrievalEligible !== (row[key] !== null)) throw new TypeError('Top-k retrieval must only be measured for safe uniquely covered changes.');
    }
  }
  const grouped = (key) => Object.fromEntries([...new Set(rows.map((row) => row[key]))].sort()
    .map((value) => [value, summarizeRows(rows.filter((row) => row[key] === value))]));
  const byGroup = Object.fromEntries([...GROUPS].map((group) => [group, summarizeRows(rows.filter((row) => row.group === group))]));
  return {
    ordinary: byGroup.ordinary,
    overall: summarizeRows(rows),
    byGroup,
    byCategory: grouped('category'),
    byDomain: grouped('domain'),
  };
}

/** Millisecond samples: keep raw observations elsewhere; no warm-up removal here. */
export function summarizeTiming(samples) {
  if (!Array.isArray(samples) || samples.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new TypeError('Timing samples must be an array of finite nonnegative numbers.');
  }
  if (!samples.length) return { n: 0, median: null, min: null, max: null };
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  // Nonnegative sorted values allow a difference-based mean without overflow
  // or halving equal subnormal observations down to zero.
  const median = sorted.length % 2 ? sorted[middle] : sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2;
  return { n: sorted.length, median, min: sorted[0], max: sorted.at(-1) };
}
