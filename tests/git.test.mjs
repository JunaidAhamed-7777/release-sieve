import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { collectChanges } from '../src/git.mjs';

const execFileAsync = promisify(execFile);
const command = async (repo, ...args) => (await execFileAsync('git', ['-c', 'user.name=Release Sieve Test', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=disabled-test-hooks', ...args], { cwd: repo, windowsHide: true })).stdout;

async function fixture(t) {
  const temporaryRoot = resolve(process.env.RELEASE_SIEVE_TEST_TMP || tmpdir());
  const repo = await mkdtemp(join(temporaryRoot, 'release-sieve-git-'));
  t.after(async () => {
    const target = resolve(repo);
    const child = relative(temporaryRoot, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && basename(target).startsWith('release-sieve-git-'), 'cleanup must stay within the synthetic fixture root');
    await rm(target, { recursive: true, force: true });
  });
  await command(repo, 'init', '--initial-branch=main');
  await writeFile(join(repo, 'app.txt'), 'initial\n');
  await command(repo, 'add', '--', 'app.txt');
  await command(repo, 'commit', '-m', 'chore: initial synthetic fixture');
  const base = (await command(repo, 'rev-parse', 'HEAD')).trim();
  return { repo, base };
}

test('collectChanges reads subjects, bodies, file evidence and breaking flags without writing', async (t) => {
  const { repo, base } = await fixture(t);
  await writeFile(join(repo, 'app.txt'), 'initial\nretry\n');
  await command(repo, 'add', '--', 'app.txt');
  await command(repo, 'commit', '-m', 'fix: retry transient requests', '-m', 'Keep persistent errors visible.');
  await writeFile(join(repo, 'api v2.txt'), 'new protocol\n');
  await command(repo, 'add', '--', 'api v2.txt');
  await command(repo, 'commit', '-m', 'feat(api)!: replace legacy endpoint', '-m', 'BREAKING CHANGE: migrate clients to v2.');
  await writeFile(join(repo, 'untracked.txt'), 'must remain untouched\n');
  const indexBefore = await readFile(join(repo, '.git', 'index'));
  const configBefore = await readFile(join(repo, '.git', 'config'));
  const headBefore = await command(repo, 'rev-parse', 'HEAD');
  const statusBefore = await command(repo, 'status', '--porcelain=v1');
  const changes = await collectChanges({ repo, base, head: 'main' });
  assert.equal(changes.length, 2);
  assert.match(changes[0].id, /^[a-f0-9]{40}$/);
  assert.equal(changes[0].subject, 'fix: retry transient requests');
  assert.equal(changes[0].body, 'Keep persistent errors visible.');
  assert.deepEqual(changes[0].files, ['app.txt']);
  assert.equal(changes[0].breaking, false);
  assert.deepEqual(changes[1].files, ['api v2.txt']);
  assert.equal(changes[1].breaking, true);
  assert.deepEqual(await readFile(join(repo, '.git', 'index')), indexBefore);
  assert.deepEqual(await readFile(join(repo, '.git', 'config')), configBefore);
  assert.equal(await command(repo, 'rev-parse', 'HEAD'), headBefore);
  assert.equal(await command(repo, 'status', '--porcelain=v1'), statusBefore);
  assert.equal(await readFile(join(repo, 'untracked.txt'), 'utf8'), 'must remain untouched\n');
});

test('same base/head returns no changes and annotated tags resolve to commits', async (t) => {
  const { repo, base } = await fixture(t);
  await command(repo, 'tag', '-a', 'v0.1.0', '-m', 'Synthetic base tag');
  assert.deepEqual(await collectChanges({ repo, base: 'v0.1.0', head: base }), []);
});

test('merge commits are excluded while branch commits retain their evidence', async (t) => {
  const { repo, base } = await fixture(t);
  await command(repo, 'checkout', '-b', 'feature');
  await writeFile(join(repo, 'feature.txt'), 'feature\n');
  await command(repo, 'add', '--', 'feature.txt');
  await command(repo, 'commit', '-m', 'feat: add exports');
  await command(repo, 'checkout', 'main');
  await writeFile(join(repo, 'docs.txt'), 'docs\n');
  await command(repo, 'add', '--', 'docs.txt');
  await command(repo, 'commit', '-m', 'docs: explain exports');
  await command(repo, 'merge', '--no-ff', 'feature', '-m', 'merge feature exports');
  const changes = await collectChanges({ repo, base });
  assert.equal(changes.length, 2);
  assert.deepEqual(new Set(changes.map((row) => row.subject)), new Set(['feat: add exports', 'docs: explain exports']));
  assert.equal(changes.some((row) => row.subject === 'merge feature exports'), false);
});

test('ref options, revision expressions and unknown refs fail clearly', async (t) => {
  const { repo, base } = await fixture(t);
  for (const unsafe of ['--help', '-c', 'HEAD~1', 'HEAD^', 'main..HEAD', 'HEAD@{1}', 'main\nHEAD', ':/message', 'a\\b', 'refs//heads/main']) {
    await assert.rejects(collectChanges({ repo, base: unsafe }), /exact branch/);
    await assert.rejects(collectChanges({ repo, base, head: unsafe }), /exact branch/);
  }
  await assert.rejects(collectChanges({ repo, base: 'missing-release-tag' }), /Git read failed/);
  await assert.rejects(collectChanges({ repo, base, head: 'missing-branch' }), /Git read failed/);
});

test('missing repository and invalid arguments are rejected', async (t) => {
  const { repo, base } = await fixture(t);
  await assert.rejects(collectChanges({ repo: '', base }), /repo must/);
  await assert.rejects(collectChanges({ repo, base: '' }), /exact branch/);
  await assert.rejects(collectChanges({ repo: join(repo, 'app.txt'), base }), /directory/);
  await assert.rejects(collectChanges({ repo: join(repo, 'missing'), base }), /ENOENT/);
});

test('inherited Git directory settings cannot redirect the requested repository', async (t) => {
  const { repo, base } = await fixture(t);
  const original = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  try {
    process.env.GIT_DIR = join(repo, 'does-not-exist');
    process.env.GIT_WORK_TREE = join(repo, 'does-not-exist');
    assert.deepEqual(await collectChanges({ repo, base }), []);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('configured signature display cannot launch a GPG helper during collection', async (t) => {
  const { repo, base } = await fixture(t);
  const marker = join(repo, 'gpg-marker.txt');
  const helper = join(repo, process.platform === 'win32' ? 'synthetic-gpg.cmd' : 'synthetic-gpg');
  const helperText = process.platform === 'win32'
    ? '@echo off\r\necho invoked > "%~dp0gpg-marker.txt"\r\nexit /b 1\r\n'
    : '#!/bin/sh\nprintf invoked > "$(dirname "$0")/gpg-marker.txt"\nexit 1\n';
  await writeFile(helper, helperText, { mode: 0o755 });
  await command(repo, 'config', 'log.showSignature', 'true');
  await command(repo, 'config', 'gpg.program', helper);
  const tree = (await command(repo, 'rev-parse', 'HEAD^{tree}')).trim();
  const rawCommit = `tree ${tree}\nparent ${base}\nauthor Synthetic <synthetic@example.invalid> 1700000000 +0000\ncommitter Synthetic <synthetic@example.invalid> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n fake signature\n -----END PGP SIGNATURE-----\n\nfeat: signed synthetic update\n`;
  const commitFile = join(repo, 'synthetic-commit.txt');
  await writeFile(commitFile, rawCommit);
  const signedHash = (await command(repo, 'hash-object', '-t', 'commit', '-w', '--', commitFile)).trim();
  await command(repo, 'update-ref', 'refs/heads/main', signedHash);
  // Establish that the fake signature actually exercises Git's configured helper.
  await command(repo, 'show', '--no-patch', '--format=%s', signedHash, '--');
  assert.match(await readFile(marker, 'utf8'), /invoked/);
  await rm(marker);
  const changes = await collectChanges({ repo, base });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].subject, 'feat: signed synthetic update');
  await assert.rejects(readFile(marker), /ENOENT/, 'collector must not execute the configured GPG helper');
});

test('partial-clone missing objects fail locally before attempting a fetch', async (t) => {
  const source = await fixture(t);
  await command(source.repo, 'commit', '--allow-empty', '-m', 'feat: promised synthetic change');
  const promisedHead = (await command(source.repo, 'rev-parse', 'HEAD')).trim();
  const preparePartial = async () => {
    const partial = await fixture(t);
    await command(partial.repo, 'config', 'extensions.partialClone', 'origin');
    await command(partial.repo, 'remote', 'add', 'origin', pathToFileURL(join(partial.repo, 'absent-synthetic-origin')).href);
    await command(partial.repo, 'config', 'remote.origin.promisor', 'true');
    // Simulate a promised commit absent from local object storage. This is only
    // a generated fixture; the collector itself never writes any refs.
    await writeFile(join(partial.repo, '.git', 'refs', 'heads', 'main'), `${promisedHead}\n`);
    return partial;
  };
  const baseline = await preparePartial();
  await assert.rejects(command(baseline.repo, 'rev-parse', '--verify', 'HEAD^{commit}'), (error) => {
    assert.match(error.stderr, /Could not read from remote repository/, 'ordinary Git must attempt a fetch from the intentionally absent local origin');
    return true;
  });
  const guarded = await preparePartial();
  const before = await readdir(join(guarded.repo, '.git', 'objects', 'pack'));
  await assert.rejects(collectChanges({ repo: guarded.repo, base: guarded.base }), (error) => {
    assert.match(error.message, /Git read failed/);
    assert.doesNotMatch(error.cause.stderr, /Could not read from remote repository|NtCreateDirectoryObject/, 'collector must fail on the missing local object before attempting transport');
    return true;
  });
  assert.deepEqual(await readdir(join(guarded.repo, '.git', 'objects', 'pack')), before, 'collector must not fetch missing objects');
});

test('oversized commit messages are rejected during collection before returning rows', async (t) => {
  const { repo, base } = await fixture(t);
  const messageFile = join(repo, 'oversized-commit-message.txt');
  await writeFile(messageFile, `feat: oversized synthetic context\n\n${'x'.repeat(12_001)}\n`);
  await command(repo, 'commit', '--allow-empty', '--file', messageFile);
  await assert.rejects(collectChanges({ repo, base }), /body.*at most 12000/);
});

test('configured legacy log encoding cannot corrupt Unicode commit evidence', async (t) => {
  const { repo, base } = await fixture(t);
  await command(repo, 'config', 'i18n.logOutputEncoding', 'ISO-8859-1');
  await command(repo, 'commit', '--allow-empty', '-m', 'fix: café reminders', '-m', 'Preserve naïve café labels.');
  const changes = await collectChanges({ repo, base });
  assert.equal(changes[0].subject, 'fix: café reminders');
  assert.equal(changes[0].body, 'Preserve naïve café labels.');
});
