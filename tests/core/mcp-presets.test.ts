import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import { validServers } from '../../runtime/core/mcp';
import { MCP_PRESETS, mcpPreset, presetSecrets, presetServer, presetServerName } from '../../runtime/shared/mcp-presets';

test('every preset is a valid server entry, pinned (no @latest), with unique ids', () => {
  assert.equal(new Set(MCP_PRESETS.map(p => p.id)).size, MCP_PRESETS.length);
  for (const p of MCP_PRESETS) {
    const entry = presetServer(p, [], p.folder ? 'C:\\notes' : undefined);
    assert.doesNotThrow(() => validServers([entry]), p.id);
    assert.ok(!JSON.stringify(entry).includes('@latest'), `${p.id} must pin a version`);
    for (const a of p.args || []) if (a.startsWith('@') && a.lastIndexOf('@') > 0) assert.match(a, /@\d/, `${p.id}: ${a}`);
    assert.equal('envKeys' in entry || 'headerKeys' in entry, false, 'secret names are recorded only after a value is saved');
  }
});

test('folder presets need a folder, names never collide, Bearer prefix is added once', () => {
  const folder = mcpPreset('folder')!;
  assert.throws(() => presetServer(folder, []), /文件夹/);
  assert.deepEqual(presetServer(folder, [], 'D:\\资料').args?.at(-1), 'D:\\资料');
  assert.equal(presetServerName(folder, ['files', 'files-2']), 'files-3');
  const gh = mcpPreset('github')!;
  assert.deepEqual(presetSecrets(gh, { Authorization: 'ghp_abc' }), { Authorization: 'Bearer ghp_abc' });
  assert.deepEqual(presetSecrets(gh, { Authorization: 'bearer ghp_abc' }), { Authorization: 'bearer ghp_abc' });
  assert.deepEqual(presetSecrets(gh, { Authorization: '  ' }), {});
});

test('mcp.addPreset: the key goes only to the encrypted store, and GalAgent\'s own data folder is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-preset-')), notes = join(dir, 'vault');
  await mkdir(notes);
  const saved: Record<string, unknown> = {};
  const core = new CompanionService({ dataDir: join(dir, 'data'), workingDir: dir, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} },
    mcpSecrets: { get: async name => (saved[name] as any) || {}, set: async (name, value) => { saved[name] = value; } },
    fetch: async () => new Response('{}') });
  await core.init();
  try {
    let r = await core.handle({ type: 'mcp.addPreset', id: 'todoist', secrets: { TODOIST_API_KEY: 'secret-123' } });
    assert.equal(r.ok, true, r.error);
    const s = core.getSnapshot();
    const todo = s.settings.mcpServers!.find(m => m.name === 'todoist')!;
    assert.deepEqual(todo.envKeys, ['TODOIST_API_KEY']);
    assert.ok(!JSON.stringify(s).includes('secret-123'), 'the value never reaches the snapshot');
    assert.deepEqual(saved.todoist, { env: { TODOIST_API_KEY: 'secret-123' } });
    r = await core.handle({ type: 'mcp.addPreset', id: 'notes', folder: notes });
    assert.equal(r.ok, true, r.error);
    assert.equal(core.getSnapshot().settings.mcpServers!.find(m => m.name === 'notes')!.args!.at(-1), notes);
    r = await core.handle({ type: 'mcp.addPreset', id: 'folder', folder: join(dir, 'data') });
    assert.equal(r.ok, false); assert.match(r.error!, /数据目录/);
    r = await core.handle({ type: 'mcp.addPreset', id: 'folder', folder: join(dir, 'missing') });
    assert.equal(r.ok, false);
    r = await core.handle({ type: 'mcp.addPreset', id: 'nope' });
    assert.equal(r.ok, false);
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});
