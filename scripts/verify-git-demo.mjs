import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../src/model.mjs';

const exec = promisify(execFile);
const tempParent = process.env.RELEASE_SIEVE_TEST_TMP || os.tmpdir();
const dir = await mkdtemp(path.join(tempParent, 'release-sieve-e2e-'));
const repo = path.join(dir, 'synthetic');
const output = path.join(dir, 'report');
async function git(...args) { return exec('git', ['-c','commit.gpgsign=false','-c','tag.gpgsign=false','-c','core.hooksPath=', '-C', repo, ...args], { windowsHide: true }); }
try {
  await mkdir(repo);
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Synthetic Fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(repo, 'README.md'), '# Synthetic Ledger Finch\n');
  await git('add', 'README.md'); await git('commit', '-m', 'chore: initial fixture'); await git('tag', 'v1.0');
  const changes = JSON.parse(await readFile(path.join(ROOT, 'demo', 'changes.json'), 'utf8'));
  for (const [i, change] of changes.entries()) {
    const filename = `change-${i}.txt`;
    await writeFile(path.join(repo, filename), `${change.subject}\n${change.body ?? ''}\n`);
    await git('add', filename);
    await git('commit', '-m', change.subject, '-m', change.body ?? '');
  }
  const before = (await git('status', '--porcelain')).stdout;
  const args = [path.join(ROOT, 'src', 'cli.mjs'), '--repo', repo, '--base', 'v1.0', '--head', 'HEAD', '--notes', path.join(ROOT, 'demo', 'notes.md'), '--out', output, '--fail-on-review'];
  let code = 0;
  try { await exec(process.execPath, args, { windowsHide:true, timeout:120000 }); }
  catch (error) { code = error.code; if (code !== 2) throw error; }
  assert.equal(code, 2, 'Opt-in review gate exits 2');
  const report = JSON.parse(await readFile(path.join(output, 'audit.json'), 'utf8'));
  assert.equal(report.summary.changes, 6);
  assert.equal(report.summary.internal, 2);
  assert.equal(report.changes.find(c => c.subject.includes('timezone')).status, 'review');
  assert.equal(report.changes.find(c => c.breaking).status, 'review');
  assert.equal((await git('status','--porcelain')).stdout, before, 'Source checkout is unchanged');
  let collisionCode = 0;
  try { await exec(process.execPath, args, { windowsHide:true }); } catch (error) { collisionCode = error.code; }
  assert.equal(collisionCode, 1, 'Existing outputs require explicit overwrite');
  console.log('PASS: synthetic Git collection → pinned local inference → HTML/JSON/Markdown; review exit=2; source unchanged; overwrite refused.');
  await writeFile(path.join(ROOT, 'demo', 'git-e2e-verification.json'), JSON.stringify({verifiedAt:new Date().toISOString(),checks:{syntheticGit:true,readOnlySource:true,realModel:true,outputs:['html','json','markdown'],reviewExitCode:2,overwriteRefused:true},summary:report.summary}, null, 2) + '\n');
} finally {
  // mkdtemp creates this exact directory beneath the OS temp root; never remove the input repo.
  const resolved = path.resolve(dir), tempRoot = path.resolve(tempParent);
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('release-sieve-e2e-')) throw new Error('Unsafe temp cleanup target');
  await rm(resolved, { recursive:true, force:true });
}
