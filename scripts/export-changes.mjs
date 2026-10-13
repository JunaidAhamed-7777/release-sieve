#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { collectChanges } from '../src/git.mjs';

export const HELP = `Release Sieve - export a local Git range for browser upload

node scripts/export-changes.mjs --repo /path/to/repo --base v1.0 --head HEAD --out changes.json

--repo /path/to/repo  Local source repository (read only)
--base v1.0          Exact branch, tag, or commit hash to exclude
--head HEAD          Exact branch, tag, or commit hash to include (default HEAD)
--out changes.json   Destination JSON file; parent folders are created if needed
--force              Overwrite an existing destination file
--help               Print this help

The output is a JSON array ready for the browser's Changes JSON upload.
Git 2.46+ is required. Merge commits are excluded; constituent commits remain.
No model, account, credentials, or downloads are needed for this export.
Commit messages and filenames may contain private source evidence. Keep this
file local and upload it only to a browser instance you trust.
`;

function validateOptions(options = {}) {
  const values = { ...options, head: options.head === undefined ? 'HEAD' : options.head, force: options.force === undefined ? false : options.force };
  for (const key of ['repo', 'base', 'head', 'out']) {
    if (typeof values[key] !== 'string' || !values[key].trim() || values[key].includes('\0')) {
      throw new TypeError(`Provide a nonempty --${key}. Use --help for an example.`);
    }
  }
  if (typeof values.force !== 'boolean') throw new TypeError('--force must be a boolean.');
  return values;
}

export function parseExportArgs(args) {
  const { values } = parseArgs({ args, options: {
    repo: { type: 'string' }, base: { type: 'string' },
    head: { type: 'string', default: 'HEAD' }, out: { type: 'string' },
    force: { type: 'boolean', default: false }, help: { type: 'boolean' },
  }, strict: true, allowPositionals: false });
  return values.help ? values : validateOptions(values);
}

export async function exportChanges(input) {
  const options = validateOptions(input);
  // The collector validates exact refs and input bounds before returning rows,
  // prevents helper execution/lazy fetching, and never writes the source repo.
  const changes = await collectChanges({ repo: options.repo, base: options.base, head: options.head });
  const destination = resolve(options.out);
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(destination, `${JSON.stringify(changes, null, 2)}\n`, { flag: options.force ? 'w' : 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Output already exists: ${destination}. Choose another --out or use --force.`, { cause: error });
    throw error;
  }
  return { changes: changes.length, path: destination };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseExportArgs(args);
  if (options.help) { console.log(HELP); return; }
  const result = await exportChanges(options);
  console.log(`Exported ${result.changes} non-merge commit${result.changes === 1 ? '' : 's'} to ${result.path}`);
  console.log('Source evidence can be private. Keep this JSON local; choose a trusted browser instance for upload.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Release Sieve export: ${error.message}`); process.exitCode = 1; });
}
