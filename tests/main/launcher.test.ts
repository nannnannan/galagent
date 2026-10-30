import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const launcher = path.resolve('scripts/Start-GalAgent.ps1');
const windows = { skip: process.platform !== 'win32', timeout: 60000 };
type Prepared = { ok: true; executablePath: string; installDirectory: string; buildId: string; reused: boolean; started: false };

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
