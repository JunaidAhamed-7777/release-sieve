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
 * Return advisory matches with the closest candidate retained on review rows.
 * Only passed matches appear in notes[].matches. With one note, the separation
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
    const separation = best ? best.score - (candidates[1]?.score ?? 0) : 0;
    const match = best ? { noteId: best.note.id, text: best.note.text, score: rounded(best.score), margin: rounded(separation) } : null;
    let status = 'review';
    let reason;
    if (breaking) reason = 'Breaking change requires human review, even when a note looks related.';
    else if (!best) reason = 'No release notes supplied; this change needs review.';
    else if (best.score < threshold) reason = 'Closest note is below the semantic similarity threshold.';
    else if (separation < margin) reason = 'Several notes have similar scores; inspect the closest candidates.';
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
    notes: notes.map((note) => ({ ...note, matches: noteMatches.get(note.id), status: noteMatches.get(note.id).length ? 'matched' : 'unlinked' })),
    threshold,
    margin,
  };
}

function cleanMarkdown(text) {
  return text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<https?:\/\/[^>]+>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/(`+)(.*?)\1/g, '$2')
    .replace(/\*\*|__|~~/g, '')
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,:;!?])/g, '$1$2')
    .replace(/\s+/g, ' ').trim();
}

/** Extract each Markdown bullet or plain paragraph as a distinct note. */
export function parseNotes(markdown) {
  stringValue(markdown, 'markdown', LIMITS.markdownCharacters, true);
  const notes = [];
  let current = [];
  let fence = null;
  const flush = () => {
    const text = cleanMarkdown(current.join(' '));
    current = [];
    if (!text) return;
    if (text.length > LIMITS.noteCharacters) throw new TypeError(`Note exceeds ${LIMITS.noteCharacters} characters.`);
    if (notes.length >= LIMITS.notes) throw new TypeError(`Markdown exceeds ${LIMITS.notes} notes.`);
    notes.push({ id: `note-${notes.length + 1}`, text });
  };
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) { flush(); fence = fenceMatch[1][0]; }
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    if (!line.trim() || /^\s{0,3}#{1,6}(?:\s|$)/.test(line) || /^\s*[-*_]{3,}\s*$/.test(line) || /^\s*\[[^\]]+\]:\s*\S/.test(line)) {
      flush();
      continue;
    }
    const bullet = /^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.*)$/.exec(line);
    if (bullet) { flush(); current.push(bullet[1]); }
    else current.push(line.trim());
  }
  flush();
  return notes;
}
