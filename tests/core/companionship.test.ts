import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CompanionService } from '../../runtime/core/companion';
import { Store } from '../../runtime/core/store';
import { validateCommand } from '../../runtime/main/validation';
import { AttentionLoop } from '../../runtime/core/attention';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-companionship-'));
  const sourceId = randomUUID(), store = new Store(dir);
  store.put('state', 'identity', { id: randomUUID(), name: '星棱', onboarding: 'ready', stage: 'S4' });
  store.put('message', sourceId, { id: sourceId, role: 'assistant', source: 'initiative', text: '任务完成了。', createdAt: new Date().toISOString(), initiativeTopics: ['task'] });
  store.close();
  const requests: any[] = [];
  const make = () => new CompanionService({ dataDir: dir, features: { attention: true, journal: true },
    credentials: { get: async () => 'fixture', set: async () => {} },
    embeddings: { encode: async () => [1, 0], close: async () => {} },
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)); requests.push(request);
      const system = String(request.messages[0].content);
      const reply = system.includes('facts每项') ? { ops: [], diary: '' } : system.startsWith('你是GalAgent的后台注意力代理') ? { decision: 'silent', reason: '无需打扰', evidence: [], nextCheck: null } : { text: '我在这里。', expression: 'neutral', action: 'idle' };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { total_tokens: 10 } }));
    },
  });
  const core = make(); await core.init();
  return { dir, core, sourceId, requests, make, cleanup: async () => { await core.close(); await rm(dir, { recursive: true, force: true }); } };
}
test('legacy saves default to daily; focus blocks initiative and still allows user conversation', async () => {
  const f = await fixture();
  try {
    assert.equal(f.core.getSnapshot().settings.companionMode, 'daily');
    assert.equal((await f.core.handle({ type: 'settings.update', settings: { companionMode: 'focus' } })).ok, true);
    await f.core.tick();
    assert.equal(f.core.getSnapshot().status.attention?.paused, 'focus'); assert.equal(f.requests.length, 0);
    assert.equal((await f.core.handle({ type: 'chat.send', text: '我想聊一句' })).ok, true);
    assert.match(f.core.getSnapshot().messages.at(-1)!.text, /我在/);
    assert.equal(JSON.parse(f.requests[0].messages[0].content.split('\n状态数据：')[1]).companionship.mode, 'focus');
  } finally { await f.cleanup(); }
});
test('rest clears and rejects observation without overwriting the user observation switches', async () => {
  const f = await fixture();
  try {
    await f.core.handle({ type: 'settings.update', settings: { observationEnabled: true, companionMode: 'rest' } });
    f.core.setObservation({ available: true, appName: 'editor', observedAt: new Date().toISOString() });
    f.core.offerClipboard({ text: 'should not enter', excluded: false });
    f.core.offerBrowser({ activeTab: { url: 'https://example.com', title: 'private page' } });
    const s = f.core.getSnapshot();
    assert.equal(s.observation.available, false); assert.equal(s.browser?.connected, false); assert.equal(s.status.perception?.clipboardEntries, 0);
    assert.equal(s.settings.observationEnabled, true);
    await f.core.handle({ type: 'settings.update', settings: { companionMode: 'daily' } });
    f.core.setObservation({ available: true, appName: 'editor', observedAt: new Date().toISOString() });
    assert.equal(f.core.getSnapshot().observation.available, true);
  } finally { await f.cleanup(); }
});
test('explicit feedback is source-bound, persists across restart and can be reset', async () => {
  const f = await fixture(); let restored: CompanionService | undefined;
  try {
    assert.equal((await f.core.handle({ type: 'initiative.feedback', messageId: randomUUID(), value: 'mute' })).ok, false);
    assert.equal((await f.core.handle({ type: 'initiative.feedback', messageId: f.sourceId, value: 'mute' })).ok, true);
    await f.core.handle({ type: 'settings.update', settings: { companionMode: 'focus' } });
    await f.core.close(); restored = f.make(); await restored.init();
    assert.equal(restored.getSnapshot().settings.companionMode, 'focus');
    assert.equal(restored.getSnapshot().companionship?.topics.task, 'mute');
    assert.equal(restored.getSnapshot().companionship?.ratings[f.sourceId], 'mute');
    await restored.handle({ type: 'initiative.feedback', messageId: f.sourceId, value: 'welcome' });
    assert.equal(restored.getSnapshot().companionship?.topics.task, 'welcome');
    const archive = restored.exportArchive();
    await restored.handle({ type: 'initiative.resetFeedback' });
    assert.deepEqual(restored.getSnapshot().companionship?.topics, {});
    await restored.importArchive(archive);
    assert.equal(restored.getSnapshot().companionship?.topics.task, 'welcome');
    assert.equal(restored.getSnapshot().settings.companionMode, 'focus');
  } finally { await restored?.close(); if (!restored) await f.core.close(); await rm(f.dir, { recursive: true, force: true }); }
});
test('muted event kinds never reach attention evaluation or trigger a wake', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-preferences-')), store = new Store(dir);
  let evaluated = 0, woke = 0;
  const loop = new AttentionLoop({ store, accepts: event => event.kind !== 'task', eligible: () => undefined, canWake: () => true,
    evaluate: async () => { evaluated++; return {}; }, wake: async () => { woke++; return true; }, sampleScreen: async () => ({ skipped: 'disabled' }), clipboard: () => [], brief: async () => ({}),
  });
  try {
    loop.push({ id: 'task:fixture', kind: 'task', at: Date.now(), expiresAt: Date.now() + 60000, summary: 'done', important: true });
    await loop.tick(); assert.equal(evaluated, 0); assert.equal(woke, 0);
  } finally { loop.close(); store.close(); await rm(dir, { recursive: true, force: true }); }
});
test('IPC rejects unknown modes and forged feedback values', () => {
  assert.throws(() => validateCommand({ type: 'settings.update', settings: { companionMode: 'autonomous' } }));
  assert.throws(() => validateCommand({ type: 'initiative.feedback', messageId: 'x', value: 'change-personality' }));
  assert.equal(validateCommand({ type: 'tts.stop' }).type, 'tts.stop');
});
