import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LIMITS, isBreaking, validateInputs } from './audit.mjs';

const execFileAsync = promisify(execFile);
const HASH = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;

function validateRef(ref, label) {
  // Deliberately accept exact refs/hashes, not revision expressions or options.
  if (typeof ref !== 'string' || !ref.length || ref.length > 1_024
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)
    || ref.includes('..') || ref.endsWith('/') || ref.includes('//')) {
    throw new TypeError(`${label} must be an exact branch, tag, HEAD, or commit hash; revision expressions and options are unsupported.`);
  }
  return ref;
}

async function runGit(repo, args, { maxBuffer = 64 * 1024 } = {}) {
  try {
    const environment = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE']) {
      delete environment[key];
    }
    const { stdout } = await execFileAsync('git', ['--no-pager', '--no-lazy-fetch', '-c', 'color.ui=false', '-c', 'log.showSignature=false', '-c', 'i18n.logOutputEncoding=UTF-8', ...args], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer,
      timeout: 15_000,
      windowsHide: true,
      env: environment,
    });
    return stdout;
  } catch (error) {
    const detail = String(error.stderr || error.message).trim().slice(0, 1_500);
    const wrapped = new Error(`Git read failed: ${detail}`, { cause: error });
    wrapped.code = error.code;
    throw wrapped;
  }
}

async function resolveCommit(repo, ref) {
  const hash = (await runGit(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
  if (!HASH.test(hash)) throw new Error(`Git did not resolve ${JSON.stringify(ref)} to one commit.`);
  return hash;
}

/**
 * Read non-merge commits reachable from head and not base (Git's base..head).
 * Repository files, refs, index, and configuration are never written.
 * Merge commits are excluded; their constituent commits remain in the range.
 */
export async function collectChanges({ repo, base, head = 'HEAD' } = {}) {
  if (typeof repo !== 'string' || !repo.length || repo.includes('\0')) throw new TypeError('repo must be a repository directory path.');
  validateRef(base, 'base');
  validateRef(head, 'head');
  const directory = resolve(repo);
  if (!(await stat(directory)).isDirectory()) throw new TypeError('repo must be a directory.');
  const baseHash = await resolveCommit(directory, base);
  const headHash = await resolveCommit(directory, head);
  const output = await runGit(directory, ['rev-list', '--reverse', '--no-merges', `--max-count=${LIMITS.changes + 1}`, `${baseHash}..${headHash}`]);
  const hashes = output.trim() ? output.trim().split(/\r?\n/) : [];
  if (hashes.length > LIMITS.changes) throw new RangeError(`Range exceeds ${LIMITS.changes} non-merge commits; choose a smaller range.`);
  if (hashes.some((hash) => !HASH.test(hash))) throw new Error('Git returned an invalid commit identifier.');
  const changes = [];
  // Bounded batches keep read-only subprocess pressure predictable.
  for (let offset = 0; offset < hashes.length; offset += 8) {
    const batch = await Promise.all(hashes.slice(offset, offset + 8).map(async (id) => {
      const [message, paths] = await Promise.all([
        runGit(directory, ['show', '--no-patch', '--format=%s%x00%b', id, '--']),
        runGit(directory, ['diff-tree', '--no-ext-diff', '--no-textconv', '--root', '--no-commit-id', '--name-only', '-r', '-z', id, '--'], { maxBuffer: LIMITS.totalCharacters * 4 + LIMITS.filesPerChange }),
      ]);
      const separator = message.indexOf('\0');
      if (separator < 0) throw new Error('Git returned an invalid commit message.');
      const change = { id, subject: message.slice(0, separator), body: message.slice(separator + 1).trimEnd(), files: paths.split('\0').filter(Boolean) };
      change.breaking = isBreaking(change);
      validateInputs({ changes: [change], notes: [] });
      return change;
    }));
    validateInputs({ changes: [...changes, ...batch], notes: [] });
    changes.push(...batch);
  }
  return changes;
}
