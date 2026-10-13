/** Semantic correspondence is a review aid, never proof that a change is documented. */
export const LIMITS = Object.freeze({
  changes: 500,
  notes: 200,
  subjectCharacters: 2_000,
  bodyCharacters: 12_000,
  noteCharacters: 12_000,
  markdownCharacters: 200_000,
  totalCharacters: 500_000,
  filesPerChange: 1_000,
  pathCharacters: 4_096,
});

const INTERNAL_TYPES = new Set(['docs', 'test', 'build', 'chore', 'ci', 'style', 'refactor']);
const CONVENTIONAL_COMMIT = /^([a-z]+)(?:\([^\r\n)]+\))?(!)?:\s*/i;

function stringValue(value, label, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maximum) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'a' : 'a nonempty'} string of at most ${maximum} characters.`);
  }
  return value;
}

function validateRows(rows, kind) {
  if (!Array.isArray(rows) || rows.length > LIMITS[kind]) {
    throw new TypeError(`${kind} must be an array with at most ${LIMITS[kind]} entries.`);
  }
  const ids = new Set();
  let characters = 0;
  for (const [index, row] of rows.entries()) {
    const label = `${kind}[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError(`${label} must be an object.`);
    }
    stringValue(row.id, `${label}.id`, 200);
    if (ids.has(row.id)) throw new TypeError(`${kind} contains duplicate id ${JSON.stringify(row.id)}.`);
    ids.add(row.id);
    if (kind === 'notes') {
      characters += stringValue(row.text, `${label}.text`, LIMITS.noteCharacters).length;
    } else {
      characters += stringValue(row.subject, `${label}.subject`, LIMITS.subjectCharacters).length;
      if (row.body !== undefined) characters += stringValue(row.body, `${label}.body`, LIMITS.bodyCharacters, true).length;
      if (row.breaking !== undefined && typeof row.breaking !== 'boolean') {
        throw new TypeError(`${label}.breaking must be a boolean.`);
      }
      if (row.files !== undefined) {
        if (!Array.isArray(row.files) || row.files.length > LIMITS.filesPerChange) {
          throw new TypeError(`${label}.files must be an array with at most ${LIMITS.filesPerChange} paths.`);
        }
        for (const file of row.files) characters += stringValue(file, `${label}.files entry`, LIMITS.pathCharacters).length;
      }
    }
  }
  return characters;
}

export function isBreaking(change) {
  return change.breaking === true
    || Boolean(CONVENTIONAL_COMMIT.exec(change.subject)?.[2])
    || /(?:^|\r?\n)BREAKING[ -]CHANGE:\s*\S/i.test(change.body ?? '');
}

function internalType(change) {
  const type = CONVENTIONAL_COMMIT.exec(change.subject)?.[1].toLowerCase();
  return !isBreaking(change) && INTERNAL_TYPES.has(type) ? type : null;
}

function normalizedVectors(vectors, count) {
  if (!Array.isArray(vectors) || vectors.length !== count) {
    throw new TypeError(`embed must return ${count} vectors in input order.`);
  }
  let dimensions;
  return vectors.map((vector, index) => {
    if ((!Array.isArray(vector) && !ArrayBuffer.isView(vector)) || !vector.length || vector.length > 65_536) {
      throw new TypeError(`Embedding ${index} must be a nonempty numeric vector.`);
    }
    dimensions ??= vector.length;
    if (vector.length !== dimensions) throw new TypeError('All embeddings must have the same dimensions.');
    const values = Array.from(vector);
    if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new TypeError(`Embedding ${index} contains a non-finite or non-numeric value.`);
    }
    // Scale first to avoid overflow/underflow when a backend returns unusual finite values.
    const scale = values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
    if (scale === 0) throw new TypeError(`Embedding ${index} has zero magnitude.`);
    const scaled = values.map((value) => value / scale);
    const norm = Math.sqrt(scaled.reduce((sum, value) => sum + value * value, 0));
    return scaled.map((value) => value / norm);
  });
}

function cosine(left, right) {
  return Math.max(-1, Math.min(1, left.reduce((sum, value, index) => sum + value * right[index], 0)));
}

const rounded = (value) => Math.round(value * 1_000_000) / 1_000_000;

/** Validate before loading a model or starting inference. */
export function validateInputs({ changes, notes, threshold = 0.48, margin = 0.06 } = {}) {
  for (const [name, value] of [['threshold', threshold], ['margin', margin]]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError(`${name} must be a finite number between 0 and 1.`);
    }
  }
  const totalCharacters = validateRows(changes, 'changes') + validateRows(notes, 'notes');
  if (totalCharacters > LIMITS.totalCharacters) throw new TypeError(`Input exceeds ${LIMITS.totalCharacters} total characters.`);
  return { changes, notes, threshold, margin };
}

export function embeddingText(change) {
  return [change.subject.replace(CONVENTIONAL_COMMIT, ''), change.body].filter(Boolean).join('\n\n');
}

/**
 * Return advisory matches with the top two real candidates retained as evidence.
 * Only passed matches appear in notes[].matches; strong breaking-change candidates
 * appear separately in notes[].reviewMatches. With one note, the separation
 * margin is measured against an unrelated (zero-similarity) baseline.
 */
export async function audit({ changes, notes, embed, threshold = 0.48, margin = 0.06 } = {}) {
  validateInputs({ changes, notes, threshold, margin });
  if (typeof embed !== 'function') throw new TypeError('embed must be an async text-to-vectors function.');
  const eligible = changes.filter((change) => !internalType(change));
  let changeVectors = [];
  let noteVectors = [];
  if (eligible.length && notes.length) {
    const texts = [...eligible.map(embeddingText), ...notes.map((note) => note.text)];
    const vectors = normalizedVectors(await embed(texts), texts.length);
    changeVectors = vectors.slice(0, eligible.length);
    noteVectors = vectors.slice(eligible.length);
  }
  const vectorById = new Map(eligible.map((change, index) => [change.id, changeVectors[index]]));
  const noteMatches = new Map(notes.map((note) => [note.id, []]));
  const noteReviewMatches = new Map(notes.map((note) => [note.id, []]));
  const resultChanges = changes.map((change) => {
    const type = internalType(change);
    const breaking = isBreaking(change);
    if (type) {
      return { ...change, status: 'internal', priority: 'normal', match: null,
        reason: `Conventional commit type "${type}" is treated as internal; confirm this heuristic fits the change.` };
    }
    const candidates = noteVectors.map((vector, index) => ({ note: notes[index], score: cosine(vectorById.get(change.id), vector), index }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const best = candidates[0];
    const second = candidates[1];
    const separation = best ? best.score - (second?.score ?? 0) : 0;
    const match = best ? {
      noteId: best.note.id, text: best.note.text, score: rounded(best.score), margin: rounded(separation),
      runnerUp: second ? { noteId: second.note.id, text: second.note.text, score: rounded(second.score) } : null,
      // Rounded presentation must not change the policy decision.
      ambiguous: Boolean(second && separation < margin),
    } : null;
    let status = 'review';
    let reason;
    if (breaking) {
      reason = 'Breaking change requires human review, even when a note looks related.';
      if (best && best.score >= threshold && separation >= margin) noteReviewMatches.get(best.note.id).push(change.id);
    }
    else if (!best) reason = 'No release notes supplied; this change needs review.';
    else if (best.score < threshold) reason = 'Closest note is below the semantic similarity threshold.';
    else if (separation < margin) reason = second
      ? 'Several notes have similar scores; compare the closest and runner-up candidates.'
      : 'Closest note does not clear the minimum separation from the zero-similarity baseline.';
    else {
      status = 'matched';
      reason = 'Closest note passed similarity and separation checks; inspect its wording before publishing.';
      noteMatches.get(best.note.id).push(change.id);
    }
    return { ...change, status, priority: breaking ? 'high' : 'normal', match, reason };
  });
  return {
    schemaVersion: 1,
    summary: {
      changes: changes.length,
      notes: notes.length,
      needsReview: resultChanges.filter((change) => change.status === 'review').length,
      matched: resultChanges.filter((change) => change.status === 'matched').length,
      internal: resultChanges.filter((change) => change.status === 'internal').length,
    },
    changes: resultChanges,
    notes: notes.map((note) => ({ ...note, matches: noteMatches.get(note.id), reviewMatches: noteReviewMatches.get(note.id),
      status: noteMatches.get(note.id).length ? 'matched' : noteReviewMatches.get(note.id).length ? 'review' : 'unlinked' })),
    threshold,
    margin,
  };
}

const whitespace = (character) => character !== undefined && /\s/u.test(character);

/** Index the nearest closing delimiter once, instead of retrying a search at every opener. */
function nextDelimiters(text, characters, literal = null) {
  const indexes = new Map(characters.map((character) => [character, new Int32Array(text.length + 1)]));
  const nearest = new Map(characters.map((character) => [character, -1]));
  for (let index = text.length; index >= 0; index -= 1) {
    if (!literal?.[index] && nearest.has(text[index])) nearest.set(text[index], index);
    for (const character of characters) indexes.get(character)[index] = nearest.get(character);
  }
  return indexes;
}

function textBuilder() {
  const characters = [];
  const protection = [];
  return {
    append(source, start, end, literal) {
      for (let index = start; index < end; index += 1) {
        characters.push(source.text[index]);
        protection.push(literal ?? source.literal?.[index] ?? 0);
      }
    },
    finish() { return { text: characters.join(''), literal: Uint8Array.from(protection) }; },
  };
}

function cleanProseMarkup(document) {
  // This deliberately small Markdown subset uses a fixed number of linear
  // scans. Unmatched brackets or angles cannot trigger repeated suffix scans.
  const { text, literal } = document;
  const delimiters = nextDelimiters(text, [']', ')'], literal);
  const brackets = delimiters.get(']');
  const parentheses = delimiters.get(')');
  const linked = textBuilder();
  for (let index = 0; index < text.length;) {
    const image = !literal[index] && !literal[index + 1] && text[index] === '!' && text[index + 1] === '[';
    const opening = image ? index + 1 : index;
    if (!literal[opening] && text[opening] === '[') {
      const labelEnd = brackets[opening + 1];
      const hasLabel = labelEnd > opening + 1;
      const destination = labelEnd >= 0 && !literal[labelEnd + 1] ? text[labelEnd + 1] : undefined;
      const destinationEnd = destination === '(' ? parentheses[labelEnd + 2]
        : destination === '[' ? brackets[labelEnd + 2] : -1;
      if (destinationEnd >= 0 && (hasLabel || image && destination === '(')) {
        // Reference-image cleanup retains the existing literal '!' prefix.
        if (image && destination === '[') linked.append(document, index, index + 1);
        linked.append(document, opening + 1, labelEnd);
        index = destinationEnd + 1;
        continue;
      }
    }
    linked.append(document, index, index + 1);
    index += 1;
  }
  const linkDocument = linked.finish();
  const linkText = linkDocument.text;
  const angles = nextDelimiters(linkText, ['>'], linkDocument.literal).get('>');
  const prose = textBuilder();
  for (let index = 0; index < linkText.length;) {
    const closing = !linkDocument.literal[index] && linkText[index] === '<' ? angles[index + 1] : -1;
    if (closing >= 0) { index = closing + 1; continue; }
    const character = linkText[index];
    if (!linkDocument.literal[index] && !linkDocument.literal[index + 1]
      && (character === '*' || character === '_' || character === '~') && linkText[index + 1] === character) {
      index += 2;
    } else { prose.append(linkDocument, index, index + 1); index += 1; }
  }
  const plainDocument = prose.finish();
  const plain = plainDocument.text;
  const emphasis = nextDelimiters(plain, ['*', '_'], plainDocument.literal);
  const result = textBuilder();
  for (let index = 0; index < plain.length;) {
    const marker = plain[index];
    if (!plainDocument.literal[index] && (marker === '*' || marker === '_') && (index === 0 || whitespace(plain[index - 1]))) {
      const star = emphasis.get('*')[index + 1];
      const underscore = emphasis.get('_')[index + 1];
      const closing = star < 0 ? underscore : underscore < 0 ? star : Math.min(star, underscore);
      const following = plain[closing + 1];
      if (closing > index + 1 && plain[closing] === marker
        && (following === undefined || whitespace(following) || '.,:;!?'.includes(following))) {
        result.append(plainDocument, index + 1, closing);
        index = closing + 1;
        continue;
      }
    }
    result.append(plainDocument, index, index + 1);
    index += 1;
  }
  return result.finish().text;
}

function cleanMarkdown(text) {
  // Pair complete, equal-length backtick runs in linear time. Inline code is
  // literal evidence: only surrounding prose receives markup cleanup.
  const runs = [];
  for (let index = 0; index < text.length;) {
    if (text[index] !== '`') { index += 1; continue; }
    const start = index;
    while (text[index] === '`') index += 1;
    runs.push({ start, end: index, length: index - start, next: null });
  }
  const nextByLength = new Map();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    run.next = nextByLength.get(run.length) ?? null;
    nextByLength.set(run.length, run);
  }
  const result = textBuilder();
  const source = { text };
  let cursor = 0;
  for (const run of runs) {
    if (run.start < cursor || !run.next) continue;
    result.append(source, cursor, run.start, 0);
    result.append(source, run.end, run.next.start, 1);
    cursor = run.next.end;
  }
  result.append(source, cursor, text.length, 0);
  return cleanProseMarkup(result.finish()).replace(/\s+/g, ' ').trim();
}

/** Extract each Markdown bullet or plain paragraph as a distinct bounded note. */
export function parseNotes(markdown) {
  stringValue(markdown, 'markdown', LIMITS.markdownCharacters, true);
  const notes = [];
  let current = [];
  let rawCharacters = 0;
  let fence = null;
  const append = (rawText) => {
    rawCharacters += rawText.length + (current.length ? 1 : 0);
    if (rawCharacters > LIMITS.noteCharacters) throw new TypeError(`Note exceeds ${LIMITS.noteCharacters} raw characters.`);
    current.push(rawText.trim());
  };
  const flush = () => {
    const text = cleanMarkdown(current.join(' '));
    current = [];
    rawCharacters = 0;
    if (!text) return;
    if (text.length > LIMITS.noteCharacters) throw new TypeError(`Note exceeds ${LIMITS.noteCharacters} characters.`);
    if (notes.length >= LIMITS.notes) throw new TypeError(`Markdown exceeds ${LIMITS.notes} notes.`);
    notes.push({ id: `note-${notes.length + 1}`, text });
  };
  for (const line of markdown.split(/\r?\n/)) {
    let start = 0;
    while (whitespace(line[start])) start += 1;
    const character = line[start];
    let fenceEnd = start;
    if (character === '`' || character === '~') {
      while (line[fenceEnd] === character) fenceEnd += 1;
    }
    const fenceLength = fenceEnd - start;
    if (fenceLength >= 3) {
      if (!fence) { flush(); fence = { character, length: fenceLength }; }
      else if (character === fence.character && fenceLength >= fence.length && !line.slice(fenceEnd).trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const trimmed = line.trim();
    let headingEnd = start;
    while (line[headingEnd] === '#' && headingEnd - start < 6) headingEnd += 1;
    const heading = start <= 3 && headingEnd > start && (line[headingEnd] === undefined || whitespace(line[headingEnd]));
    const rule = trimmed.length >= 3 && [...trimmed].every((value) => value === '-' || value === '*' || value === '_');
    const referenceEnd = trimmed[0] === '[' ? trimmed.indexOf(']') : -1;
    const reference = referenceEnd > 1 && trimmed[referenceEnd + 1] === ':' && Boolean(trimmed.slice(referenceEnd + 2).trim());
    if (!trimmed || heading || rule || reference) { flush(); continue; }
    let bulletEnd = start;
    if (character === '-' || character === '+' || character === '*') bulletEnd += 1;
    else {
      while (line[bulletEnd] >= '0' && line[bulletEnd] <= '9') bulletEnd += 1;
      if (bulletEnd === start || line[bulletEnd] !== '.' && line[bulletEnd] !== ')') bulletEnd = start;
      else bulletEnd += 1;
    }
    if (bulletEnd > start && whitespace(line[bulletEnd])) {
      flush();
      while (whitespace(line[bulletEnd])) bulletEnd += 1;
      if (line[bulletEnd] === '[' && ' xX'.includes(line[bulletEnd + 1] ?? '') && line[bulletEnd + 2] === ']') {
        bulletEnd += 3;
        while (whitespace(line[bulletEnd])) bulletEnd += 1;
      }
      append(line.slice(bulletEnd));
    } else append(line);
  }
  flush();
  return notes;
}
