import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateInputs } from '../src/audit.mjs';
import { exportChanges, parseExportArgs } from '../scripts/export-changes.mjs';

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'export-changes.mjs');
const cli = (...args) => exec(process.execPath, [SCRIPT, ...args], { cwd: ROOT, windowsHide: true, timeout: 30_000 });

function cleanGitEnvironment() {
  const environment = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE']) delete environment[key];
  return environment;
}

async function git(repo, ...args) {
  return (await exec('git', ['--no-pager', '-c', 'user.name=Synthetic Export Test', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=disabled-test-hooks', ...args], {
    cwd: repo, windowsHide: true, timeout: 15_000, env: cleanGitEnvironment(),
  })).stdout;
}

async function fixture(t) {
  const temporaryRoot = resolve(process.env.RELEASE_SIEVE_TEST_TMP || tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'release-sieve-export-'));
  t.after(async () => {
    const target = resolve(directory), child = relative(temporaryRoot, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && basename(target).startsWith('release-sieve-export-'), 'cleanup must stay inside its generated fixture root');
    await rm(target, { recursive: true, force: true });
  });
  const repo = join(directory, 'synthetic-repo');
  await mkdir(repo);
  await git(repo, 'init', '--initial-branch=main', '--template=');
  await writeFile(join(repo, 'app.txt'), 'initial synthetic content\n');
  await git(repo, 'add', '--', 'app.txt');
  await git(repo, 'commit', '-m', 'chore: initialize synthetic export fixture');
  await git(repo, 'tag', 'v1.0');
  await writeFile(join(repo, 'app.txt'), 'initial synthetic content\nretry\n');
  await git(repo, 'add', '--', 'app.txt');
  await git(repo, 'commit', '-m', 'fix: retry transient requests', '-m', 'Only retry temporary connection failures.');
  return { directory, repo, out: join(directory, 'output', 'changes.json') };
}

test('help explains browser-ready JSON without loading a model', async () => {
  const { stdout, stderr } = await cli('--help');
  assert.match(stdout, /node scripts\/export-changes\.mjs/);
  assert.match(stdout, /JSON array/);
  assert.match(stdout, /No model/);
  assert.match(stdout, /--force/);
  assert.equal(stderr, '');
});

test('argument validation rejects missing, empty and unexpected values', () => {
  const valid = ['--repo', '/synthetic', '--base', 'v1.0', '--out', 'changes.json'];
  assert.equal(parseExportArgs(valid).head, 'HEAD');
  assert.equal(parseExportArgs(valid).force, false);
  for (const args of [[], ['--repo', ''], [...valid, '--out', ' '], [...valid, '--repo', '\0'], [...valid, '--unknown'], [...valid, 'unexpected'], [...valid, '--force=yes']]) {
    assert.throws(() => parseExportArgs(args));
  }
});

test('unsafe Git refs are rejected before attempting repository reads', async () => {
  await assert.rejects(cli('--repo', join(ROOT, 'absent-synthetic-repo'), '--base', 'HEAD~1', '--out', 'unused-synthetic-output.json'), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /exact branch/);
    assert.doesNotMatch(error.stderr, /ENOENT/);
    return true;
  });
});

test('direct export calls validate destination and overwrite intent before reads', async () => {
  const valid = { repo: join(ROOT, 'absent-synthetic-repo'), base: 'v1.0', out: 'unused-synthetic-output.json' };
  await assert.rejects(exportChanges({ ...valid, out: 42 }), /--out/);
  await assert.rejects(exportChanges({ ...valid, force: 'false' }), /--force must be a boolean/);
  await assert.rejects(exportChanges({ ...valid, head: null }), /--head/);
});

test('synthetic Git export roundtrips as canonical browser input and leaves source unchanged', async (t) => {
  const { repo, out } = await fixture(t);
  await writeFile(join(repo, 'untracked.txt'), 'untouched synthetic local file\n');
  const statusBefore = await git(repo, 'status', '--porcelain=v1');
  const headBefore = await git(repo, 'rev-parse', 'HEAD');
  const indexBefore = await readFile(join(repo, '.git', 'index'));
  const configBefore = await readFile(join(repo, '.git', 'config'));
  const result = await cli('--repo', repo, '--base', 'v1.0', '--head', 'HEAD', '--out', out);
  const raw = await readFile(out, 'utf8'), changes = JSON.parse(raw);
  assert.ok(Array.isArray(changes));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].id, headBefore.trim());
  assert.equal(changes[0].subject, 'fix: retry transient requests');
  assert.equal(changes[0].body, 'Only retry temporary connection failures.');
  assert.deepEqual(changes[0].files, ['app.txt']);
  assert.equal(changes[0].breaking, false);
  assert.equal(raw, `${JSON.stringify(changes, null, 2)}\n`);
  assert.doesNotThrow(() => validateInputs({ changes, notes: [] }));
  assert.match(result.stdout, /Exported 1 non-merge commit to/);
  assert.ok(result.stdout.includes(out));
  assert.match(result.stdout, /Keep this JSON local/);
  assert.equal(await git(repo, 'status', '--porcelain=v1'), statusBefore);
  assert.equal(await git(repo, 'rev-parse', 'HEAD'), headBefore);
  assert.deepEqual(await readFile(join(repo, '.git', 'index')), indexBefore);
  assert.deepEqual(await readFile(join(repo, '.git', 'config')), configBefore);
  assert.equal(await readFile(join(repo, 'untracked.txt'), 'utf8'), 'untouched synthetic local file\n');
});

test('existing exports remain intact unless overwrite is explicitly requested', async (t) => {
  const { repo, out } = await fixture(t);
  await mkdir(dirname(out));
  await writeFile(out, 'existing synthetic output\n');
  await assert.rejects(cli('--repo', repo, '--base', 'v1.0', '--out', out), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /already exists/);
    assert.match(error.stderr, /--force/);
    return true;
  });
  assert.equal(await readFile(out, 'utf8'), 'existing synthetic output\n');
  await cli('--repo', repo, '--base', 'v1.0', '--out', out, '--force');
  assert.equal(JSON.parse(await readFile(out, 'utf8'))[0].subject, 'fix: retry transient requests');
});

test('an empty selected range exports a valid empty JSON array', async (t) => {
  const { repo, out } = await fixture(t);
  const result = await cli('--repo', repo, '--base', 'HEAD', '--out', out);
  assert.equal(await readFile(out, 'utf8'), '[]\n');
  assert.match(result.stdout, /Exported 0 non-merge commits/);
});
