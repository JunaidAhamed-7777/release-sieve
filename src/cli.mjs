#!/usr/bin/env node
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { audit, parseNotes, validateInputs } from './audit.mjs';
import { collectChanges } from './git.mjs';
import { createEmbedder } from './model.mjs';
import { renderReport } from './report.mjs';

const HELP = `Release Sieve — local semantic release-note review

node src/cli.mjs --changes changes.json --notes notes.md [--out output]
node src/cli.mjs --repo /path/to/repo --base v1.0 --head HEAD --notes notes.md

--threshold 0.48      Minimum cosine similarity, advisory only
--margin 0.06         Minimum gap between top two notes
--fail-on-review      Exit 2 if any change needs review (CI opt-in)
--force               Overwrite existing audit outputs
--synthetic           Mark the report as synthetic demonstration data
--help                Print this help

Run npm run bootstrap once before your first audit. Audits never download models.
Input is commit messages + changed filenames, not code diffs. Notes must be for ONE release.
`;

async function readBounded(file, limit) {
  const info = await stat(file);
  if (!info.isFile() || info.size > limit) throw new Error(`Input must be a file no larger than ${limit} bytes: ${file}`);
  return readFile(file, 'utf8');
}

export function renderMarkdown(report) {
  const clean = value => String(value).replace(/[\r\n\u2028\u2029|]/g, ' ').replace(/([\\`*_\[\]<>])/g, '\\$1');
  const score = value => Number.isFinite(value) ? value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : 'unavailable';
  const comparisons = report.changes.filter(change => change.match?.runnerUp).map(change => {
    const match = change.match;
    return `### ${clean(change.id)}\n\nClosest note (${clean(match.noteId)}): ${clean(match.text)}\n\nSimilarity: ${score(match.score)}. Top-two gap: ${score(match.margin)}.\n\nRunner-up note (${clean(match.runnerUp.noteId)}): ${clean(match.runnerUp.text)}\n\nRunner-up similarity: ${score(match.runnerUp.score)}.${match.ambiguous ? ' The top-two gap is below the review policy; neither candidate is an accepted association.' : ''}`;
  });
  const notes = report.notes.map(note => {
    const labels = [];
    if (note.matches?.length) labels.push(`Associated changes: ${note.matches.map(clean).join(', ')}`);
    if (note.reviewMatches?.length) labels.push(`Related evidence, still requires review: ${note.reviewMatches.map(clean).join(', ')}`);
    return `- ${clean(note.id)}: ${clean(note.text)} (${labels.join('; ') || 'unlinked'})`;
  });
  return `# Release Sieve audit\n\n${report.summary.needsReview} need review · ${report.summary.matched} semantic matches · ${report.summary.internal} internal suggestions\n\nSimilarity is advisory, not confidence or proof. Breaking changes always need review.\n\n| Change | Status | Closest note | Similarity | Reason |\n| --- | --- | --- | --- | --- |\n` + report.changes.map(change => `| ${clean(change.id.slice(0, 12))}: ${clean(change.subject)} | ${change.status} | ${clean(change.match?.text ?? '—')} | ${change.match ? score(change.match.score) : '—'} | ${clean(change.reason)} |`).join('\n') + (comparisons.length ? `\n\n## Candidate comparisons\n\n${comparisons.join('\n\n')}` : '') + `\n\n## Release notes\n\n${notes.join('\n')}\n\nModel: ${report.model.id}@${report.model.revision}; q8 CPU; local files only.\n`;
}

async function main() {
  const { values } = parseArgs({ options: {
    changes: { type: 'string' }, notes: { type: 'string' }, repo: { type: 'string' },
    base: { type: 'string' }, head: { type: 'string', default: 'HEAD' },
    out: { type: 'string', default: 'output' }, threshold: { type: 'string', default: '0.48' },
    margin: { type: 'string', default: '0.06' }, 'fail-on-review': { type: 'boolean' },
    force: { type: 'boolean' }, synthetic: { type: 'boolean' }, help: { type: 'boolean' },
  }, strict: true, allowPositionals: false });
  if (values.help) { console.log(HELP); return; }
  if (!values.notes || Boolean(values.changes) === Boolean(values.repo)) throw new Error('Provide --notes and exactly one of --changes or --repo. Use --help for examples.');
  if (values.repo && !values.base) throw new Error('Git input needs --base and --head (default HEAD).');
  if (!values.repo && values.base) throw new Error('--base requires --repo.');
  const threshold = Number(values.threshold), margin = Number(values.margin);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 || !Number.isFinite(margin) || margin < 0 || margin > 1) throw new Error('Threshold and margin must be finite numbers between 0 and 1.');
  const notes = parseNotes(await readBounded(values.notes, 256_000));
  const changes = values.repo ? await collectChanges({ repo: values.repo, base: values.base, head: values.head }) : JSON.parse(await readBounded(values.changes, 2_000_000));
  validateInputs({ changes, notes, threshold, margin });
  const out = path.resolve(values.out);
  if (!values.force) for (const name of ['audit.json', 'audit.html', 'audit.md']) {
    try { await stat(path.join(out, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Output ${name} already exists. Choose another --out or use --force.`);
  }
  const started = performance.now();
  const embedder = await createEmbedder();
  try {
    const report = await audit({ changes, notes, threshold, margin, embed: texts => embedder.embed(texts) });
    report.model = embedder.info;
    report.input = { mode: values.repo ? 'git' : 'json', base: values.repo ? values.base : null, head: values.repo ? values.head : null, synthetic: Boolean(values.synthetic) };
    report.diagnostics = { durationMs: Math.round(performance.now() - started), truncatedInputs: embedder.truncatedInputs, includesModelLoadAndHashVerification: true };
    report.warnings = ['Semantic similarity does not prove correctness or release-note completeness.', 'Internal suggestions are based on conventional-commit labels; review them too.', 'Commit messages and changed filenames are evidence; code behavior is not analyzed.', 'Use notes for a single release. Contradictions, negation, and numbers can fool the model.'];
    if (embedder.truncatedInputs) report.warnings.push(`${embedder.truncatedInputs} inputs exceeded 256 wordpieces and were truncated; inspect them manually.`);
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'audit.json'), JSON.stringify(report, null, 2) + '\n', { flag: values.force ? 'w' : 'wx' });
    await writeFile(path.join(out, 'audit.html'), renderReport(report).replace(/[ \t]+$/gm, ''), { flag: values.force ? 'w' : 'wx' });
    await writeFile(path.join(out, 'audit.md'), renderMarkdown(report), { flag: values.force ? 'w' : 'wx' });
    console.log(`${report.summary.needsReview} need review · ${report.summary.matched} semantic matches · ${report.summary.internal} internal suggestions`);
    console.log(`Local-only q8 CPU audit: ${report.diagnostics.durationMs} ms. Truncated inputs: ${embedder.truncatedInputs}.`);
    console.log(`Report: ${path.join(out, 'audit.html')}`);
    if (values['fail-on-review'] && report.summary.needsReview > 0) process.exitCode = 2;
  } finally { await embedder.dispose(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Release Sieve: ${error.message}`); process.exitCode = 1; });
}
