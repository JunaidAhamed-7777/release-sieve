const statusNames = { review: 'Needs review', matched: 'Semantic match', internal: 'Internal suggestion' };
const score = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : 'unavailable';

function markdownText(value) {
  return String(value ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|])/g, '\\$1');
}
export function renderMarkdown(report) {
  const lines = ['# Release Sieve review', '', 'Semantic similarity suggests associations, not verified release-note coverage. Breaking changes require human review.', ''];
  if (report.input?.synthetic) lines.push('Synthetic example. No customer data.', '');
  lines.push(`Similarity threshold: ${score(report.threshold)}. Minimum top-two gap: ${score(report.margin)}.`, '', '## Changes', '');
  report.changes.forEach((change) => {
    lines.push(`### ${markdownText(change.subject)}`, '', `- ID: ${markdownText(change.id)}`, `- Status: ${statusNames[change.status] ?? 'Needs review'}`, `- Reason: ${markdownText(change.reason)}`);
    if (change.body) lines.push('', ...String(change.body).split(/\r\n|[\r\n\u2028\u2029]/).map((line) => `> ${markdownText(line)}`));
    if (change.files?.length) lines.push('', 'Files:', ...change.files.map((file) => `- ${markdownText(file)}`));
    if (change.match) lines.push('', `Closest note (${markdownText(change.match.noteId)}): ${markdownText(change.match.text)}`, `Similarity: ${score(change.match.score)}. Top-two gap: ${score(change.match.margin)}.`);
    if (change.match?.runnerUp) lines.push(`Runner-up note (${markdownText(change.match.runnerUp.noteId)}): ${markdownText(change.match.runnerUp.text)}`, `Runner-up similarity: ${score(change.match.runnerUp.score)}.${change.match.ambiguous ? ' The top-two gap is below the review policy; neither candidate is an accepted association.' : ''}`);
    lines.push('');
  });
  lines.push('## Release notes', '');
  report.notes.forEach((note) => {
    const associations = [];
    if (note.matches?.length) associations.push(`Associated changes: ${note.matches.map(markdownText).join(', ')}`);
    if (note.reviewMatches?.length) associations.push(`Related evidence, still requires review: ${note.reviewMatches.map(markdownText).join(', ')}`);
    lines.push(`- ${markdownText(note.id)}: ${markdownText(note.text)} (${associations.join('; ') || 'unlinked'})`);
  });
  if (report.warnings?.length) lines.push('', '## Input warnings', '', ...report.warnings.map((warning) => `- ${markdownText(warning)}`));
  lines.push('', '## Model', '', `Model: ${markdownText(report.model?.id)}. Revision: ${markdownText(report.model?.revision)}. Runtime: ${markdownText(report.model?.runtime)}.`, '');
  return lines.join('\n');
}
