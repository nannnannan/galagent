import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const launcher = path.resolve('scripts/Start-GalAgent.ps1');
const windows = { skip: process.platform !== 'win32', timeout: 60000 };
type Prepared = { ok: true; executablePath: string; installDirectory: string; buildId: string; reused: boolean; started: false; keepVersions: number; removedVersions: string[]; skippedCleanup: string[] };

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'galagent-launcher-test-'));
  const source = path.join(root, 'package'), install = path.join(root, 'install');
  await mkdir(path.join(source, 'resources', 'models'), { recursive: true });
  await writeFile(path.join(source, 'GalAgent.exe'), 'fixture executable: never run');
  await writeFile(path.join(source, 'resources', 'app.asar'), 'fixture asar v1');
  await writeFile(path.join(source, 'resources', 'models', '本地资源.txt'), '原始资源');
  return { root, source, install, cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) };
}
function invoke(source: string, install: string) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-PackageDirectory', source, '-InstallRoot', install, '-PrepareOnly'], {
    encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 256 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
function prepare(source: string, install: string): Prepared {
  const result = invoke(source, install);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const prepared = JSON.parse(result.stdout.trim().replace(/^\uFEFF/, '')) as Prepared;
  assert.equal(prepared.ok, true); assert.equal(prepared.started, false);
  assert.equal(typeof prepared.buildId, 'string'); assert.ok(prepared.buildId.length > 0);
  assert.equal(path.basename(prepared.executablePath), 'GalAgent.exe');
  assert.equal(path.dirname(prepared.executablePath), prepared.installDirectory);
  const relative = path.relative(install, prepared.installDirectory);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'installation remains inside the caller-owned test root');
  return prepared;
}
async function contents(dir: string): Promise<string[]> {
  return readdir(dir).then(entries => entries.sort()).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
}

test('launcher prepares a complete isolated copy, reuses it, and preserves older builds after an update', windows, async () => {
  const f = await fixture();
  try {
    const first = prepare(f.source, f.install);
    assert.equal(first.reused, false);
    assert.equal(await readFile(first.executablePath, 'utf8'), 'fixture executable: never run');
    const resource = path.join('resources', 'models', '本地资源.txt');
    assert.equal(await readFile(path.join(first.installDirectory, resource), 'utf8'), '原始资源');
    const sentinel = path.join(first.installDirectory, 'preserve-this-copy.txt'); await writeFile(sentinel, 'existing copy');
    const same = prepare(f.source, f.install);
    assert.equal(same.reused, true); assert.equal(same.installDirectory, first.installDirectory);
    assert.equal(await readFile(sentinel, 'utf8'), 'existing copy');
    await writeFile(path.join(f.source, 'resources', 'app.asar'), 'fixture asar v2');
    await writeFile(path.join(f.source, resource), '新版资源');
    const updated = prepare(f.source, f.install);
    assert.equal(updated.reused, false); assert.notEqual(updated.buildId, first.buildId);
    assert.notEqual(updated.installDirectory, first.installDirectory);
    assert.equal(await readFile(path.join(updated.installDirectory, resource), 'utf8'), '新版资源');
    assert.equal(await readFile(path.join(first.installDirectory, resource), 'utf8'), '原始资源');
    assert.equal(await readFile(path.join(first.installDirectory, 'resources', 'app.asar'), 'utf8'), 'fixture asar v1');
  } finally { await f.cleanup(); }
});

test('launcher rejects packages missing either critical file without creating an installed build', windows, async () => {
  for (const missing of ['GalAgent.exe', path.join('resources', 'app.asar')]) {
    const f = await fixture();
    try {
      await rm(path.join(f.source, missing));
      assert.notEqual(invoke(f.source, f.install).status, 0);
      assert.deepEqual(await contents(f.install), []);
    } finally { await f.cleanup(); }
  }
});

test('launcher rejects equal or nested source and installation roots before copying', windows, async () => {
  const f = await fixture();
  try {
    for (const install of [f.source, path.join(f.source, 'installed'), f.root]) {
      assert.notEqual(invoke(f.source, install).status, 0, `unsafe containment accepted: ${install}`);
    }
    assert.deepEqual(await contents(f.root), ['package']);
    assert.deepEqual(await contents(f.source), ['GalAgent.exe', 'resources']);
    assert.equal(await readFile(path.join(f.source, 'resources', 'app.asar'), 'utf8'), 'fixture asar v1');
  } finally { await f.cleanup(); }
});

test('launcher refuses a junction installation root and leaves its target untouched', windows, async () => {
  const f = await fixture();
  try {
    const target = path.join(f.root, 'junction-target'); await mkdir(target);
    await symlink(target, f.install, 'junction');
    assert.notEqual(invoke(f.source, f.install).status, 0);
    assert.deepEqual(await contents(target), []);
  } finally { await f.cleanup(); }
});

test('resource-only updates create a new runtime; three updates retain two versions and preserve unknown folders', windows, async () => {
  const f = await fixture();
  try {
    const first = prepare(f.source, f.install);
    const unknown = path.join(f.install, 'personal-folder');
    await mkdir(unknown); await writeFile(path.join(unknown, 'notes.txt'), 'keep me');
    const resource = path.join('resources', 'models', '本地资源.txt');
    await writeFile(path.join(f.source, resource), 'changed model');
    const second = prepare(f.source, f.install);
    assert.notEqual(second.buildId, first.buildId);
    assert.equal(await readFile(path.join(second.installDirectory, resource), 'utf8'), 'changed model');
    await writeFile(path.join(f.source, 'resources', 'observer.ps1'), 'changed observer');
    const third = prepare(f.source, f.install);
    assert.equal(third.keepVersions, 2);
    assert.deepEqual(third.removedVersions, [first.buildId]);
    assert.deepEqual((await contents(f.install)).filter(n => n.startsWith('build-')).sort(), [second.buildId, third.buildId].sort());
    assert.equal(await readFile(path.join(unknown, 'notes.txt'), 'utf8'), 'keep me');
    assert.equal(prepare(f.source, f.install).reused, true);
    await writeFile(path.join(third.installDirectory, resource), 'tampered');
    assert.notEqual(invoke(f.source, f.install).status, 0, 'installed resources are checked on reuse');
  } finally { await f.cleanup(); }
});

test('a running previous version is retained, then collected after its process exits', windows, async () => {
  const f = await fixture();
  let process: ReturnType<typeof spawn> | undefined;
  let exited: Promise<void> | undefined;
  try {
    await copyFile(path.join(globalThis.process.env.SystemRoot!, 'System32', 'ping.exe'), path.join(f.source, 'GalAgent.exe'));
    const first = prepare(f.source, f.install);
    process = spawn(first.executablePath, ['-t', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
    exited = new Promise(resolve => process!.once('close', () => resolve()));
    await new Promise<void>((resolve, reject) => { process!.once('spawn', resolve); process!.once('error', reject); });
    await writeFile(path.join(f.source, 'resources', 'app.asar'), 'v2');
    prepare(f.source, f.install);
    await writeFile(path.join(f.source, 'resources', 'app.asar'), 'v3');
    const third = prepare(f.source, f.install);
    assert.ok(third.skippedCleanup.some(s => s.includes(first.buildId) && s.includes('running')));
    assert.equal((await contents(f.install)).filter(n => n.startsWith('build-')).length, 3);
    process.kill(); await exited;
    const collected = prepare(f.source, f.install);
    assert.ok(collected.removedVersions.includes(first.buildId));
  } finally { if (process && process.exitCode === null) { process.kill(); await exited; } await f.cleanup(); }
});

test('concurrent preparation uses one version directory and leaves no staging copies', windows, async () => {
  const f = await fixture();
  try {
    const prepareAsync = () => new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher,
        '-PackageDirectory', f.source, '-InstallRoot', f.install, '-PrepareOnly'], { windowsHide: true });
      let errors = ''; child.stderr.on('data', chunk => { errors += chunk; }); child.stdout.resume();
      child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(errors)));
    });
    await Promise.all([prepareAsync(), prepareAsync()]);
    assert.equal((await contents(f.install)).length, 1);
    assert.equal(prepare(f.source, f.install).reused, true);
  } finally { await f.cleanup(); }
});

test('legacy managed copies participate in retention, a pinned copy is preserved, and profiles cannot live in runtime storage', windows, async () => {
  const f = await fixture();
  try {
    const exeSha256 = createHash('sha256').update(await readFile(path.join(f.source, 'GalAgent.exe'))).digest('hex').toUpperCase();
    const asarSha256 = createHash('sha256').update(await readFile(path.join(f.source, 'resources/app.asar'))).digest('hex').toUpperCase();
    const buildId = 'build-' + createHash('sha256').update(exeSha256 + asarSha256).digest('hex').slice(0, 24);
    const legacy = path.join(f.install, buildId);
    await mkdir(path.join(legacy, 'resources'), { recursive: true });
    await copyFile(path.join(f.source, 'GalAgent.exe'), path.join(legacy, 'GalAgent.exe'));
    await copyFile(path.join(f.source, 'resources/app.asar'), path.join(legacy, 'resources/app.asar'));
    await writeFile(path.join(legacy, '.galagent-install.json'), JSON.stringify({ version: 1, buildId, exeSha256, asarSha256, preparedAt: '2026-01-01T00:00:00Z' }));
    const first = prepare(f.source, f.install);
    await writeFile(path.join(first.installDirectory, '.galagent-keep'), 'keep for rollback');
    await writeFile(path.join(f.source, 'resources/app.asar'), 'v2'); prepare(f.source, f.install);
    await writeFile(path.join(f.source, 'resources/app.asar'), 'v3'); const third = prepare(f.source, f.install);
    assert.ok(third.removedVersions.includes(buildId));
    assert.ok(third.skippedCleanup.some(s => s.includes(first.buildId) && s.includes('pinned')));
    const badProfile = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher,
      '-PackageDirectory', f.source, '-InstallRoot', f.install, '-ProfileDirectory', first.installDirectory, '-PrepareOnly'],
      { windowsHide: true, encoding: 'utf8', timeout: 20000 });
    assert.notEqual(badProfile.status, 0);
    assert.equal(await readFile(path.join(first.installDirectory, '.galagent-keep'), 'utf8'), 'keep for rollback');
  } finally { await f.cleanup(); }
});
