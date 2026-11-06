// Regressions found when auditing the 2026-11-06 cleanup pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isPrivateAddress } from '../../runtime/core/net-guard';
import { archiveMatches, dayDigest } from '../../runtime/core/daily';
import { safeChildEnv } from '../../runtime/core/safe-env';
import { forwardable, WeChatBridge, type WeChatClient, type WeChatSession } from '../../runtime/core/wechat/bridge';
import { urlsIn } from '../../runtime/core/helpers';
import type { AppSnapshot, Message } from '../../runtime/shared/contracts';

test('private-address check: embedded IPv4 decides for NAT64 / 6to4 / Teredo; full-form mapped loopback still caught', () => {
  const cases: [string, boolean][] = [
    ['127.0.0.1', true], ['8.8.8.8', false], ['::1', true], ['::', true], ['[::1]', true],
    ['::ffff:7f00:1', true], ['0:0:0:0:0:ffff:7f00:1', true], ['::7f00:1', true], ['::ffff:808:808', false],
    ['2001:4860:4860::8888', false], ['2606:4700::1111', false],
    ['64:ff9b::808:808', false], ['64:ff9b::a00:1', true],          // DNS64 sites stay reachable, a NAT64'd 10.0.0.1 does not
    ['2002:808:808::1', false], ['2002:7f00:1::', true],
    ['2001:0:4136:e378:8000:63bf:f7f7:f7f7', false], ['2001:0:4136:e378:8000:63bf:80ff:fffe', true],
    ['2001:db8::1', true], ['fc00::1', true], ['fe80::1', true], ['ff02::1', true], ['100::1', true],
  ];
  for (const [address, expected] of cases) assert.equal(isPrivateAddress(address), expected, address);
});

test('daily archives written before the full-text fingerprint still match after upgrade', () => {
  const day: Message[] = [{ id: 'a', role: 'user', text: '今天去爬山了，风很大，山顶上能看到整个城市的灯，回来的路上还下了点雨', createdAt: '2026-11-05T10:00:00Z', source: 'chat' }];
  const legacy = createHash('sha256').update(JSON.stringify(day.map(m => [m.id, m.text.length, m.text.slice(0, 32)]))).digest('hex').slice(0, 24);
  assert.ok(archiveMatches({ digest: legacy }, day), 'an archive saved by v0.7.0 is kept');
  assert.ok(archiveMatches({ digest: dayDigest(day) }, day));
  assert.ok(!archiveMatches({ digest: legacy }, []), 'a deletion still invalidates it');
});

test('child env drops secrets but keeps PWD', () => {
  const env = safeChildEnv({ PWD: '/x', OLDPWD: '/y', PATH: '/bin', AWS_SECRET_ACCESS_KEY: 's', OPENAI_API_KEY: 'k', GITHUB_TOKEN: 't' });
  assert.deepEqual(Object.keys(env).sort(), ['OLDPWD', 'PATH', 'PWD']);
});

test('a "补一句" goes where the reply it follows went', () => {
  const base = { id: 'x', role: 'assistant', source: 'chat', text: '啊对了', createdAt: '', afterthought: true } as Message;
  assert.equal(forwardable({ ...base, channel: 'wechat' }), true);
  assert.equal(forwardable(base), false, 'after a desktop reply it stays on the desktop');
});

test('helpers may cite sources of a brief they read back, but not arbitrary "sources" fields', () => {
  assert.deepEqual(urlsIn(JSON.stringify({ kind: 'brief', sources: [{ url: 'https://a.example/x' }] })), ['https://a.example/x']);
  assert.deepEqual(urlsIn(JSON.stringify({ sources: [{ url: 'https://b.example/y' }] })), []);
});

test('WeChat: older messages sliding back into the snapshot after a deletion are not pushed again', async () => {
  let snap = { messages: [], settings: { wechatEnabled: true }, agent: { questions: [] } } as unknown as AppSnapshot;
  const sent: string[] = [];
  const client = { setSession: () => {}, getLoginQrcode: async () => ({ qrcode: '', qrcodeContent: '' }), pollLogin: async () => ({ status: 'wait' }), getUpdates: async (cursor: string, signal?: AbortSignal) => { await new Promise<void>(r => signal?.addEventListener('abort', () => r(), { once: true })); return { messages: [], cursor }; }, sendText: async (_to: string, text: string) => { sent.push(text); return []; } } as unknown as WeChatClient;
  const session: WeChatSession = { token: 't', userId: 'me', boundAt: Date.now(), cursor: '', contextToken: 'c', contextAt: Date.now(), lastInboundAt: Date.now() - 3600_000 };
  const bridge = new WeChatBridge({ client, secrets: { load: async () => session, save: async () => {} }, core: { snapshot: () => snap, handle: async () => ({ ok: true }), setReachable: () => {}, redact: t => t, setView: () => {} }, away: () => true });
  const m = (id: string, at: string) => ({ id, role: 'assistant', source: 'initiative', text: id, createdAt: at });
  snap = { ...snap, messages: [m('new', '2026-11-06T10:00:00Z')] } as AppSnapshot;
  await bridge.init(); bridge.close(); (bridge as any).view.state = 'connected'; (bridge as any).publish();
  // The window (last 120) shrank after a deletion: an older initiative is visible again, but it is not news.
  await bridge.onSnapshot(snap = { ...snap, messages: [m('old', '2026-11-01T10:00:00Z'), m('new', '2026-11-06T10:00:00Z')] } as AppSnapshot);
  assert.deepEqual(sent, []);
  await bridge.onSnapshot(snap = { ...snap, messages: [...snap.messages, m('fresh', '2026-11-06T11:00:00Z')] } as AppSnapshot);
  assert.deepEqual(sent, ['fresh']);
});

test('Bash settles once the shell exits even if a backgrounded child holds the pipe, and that child is not killed', { skip: process.platform === 'win32' }, async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { ToolHost } = await import('../../runtime/core/tool-host');
  const { normalizeSandbox } = await import('../../runtime/core/privacy');
  const dir = await mkdtemp(path.join(tmpdir(), 'galagent-bg-'));
  try {
    const host = new ToolHost({ save: () => {}, ask: async () => ({}), child: async () => '', sandbox: () => normalizeSandbox({ level: 'open' }) });
    const started = Date.now();
    const out = await host.execute(host.session(dir), 'Bash', { command: 'echo hi; (sleep 3; echo late; touch marker) &' }, new AbortController().signal);
    assert.match(out.content, /hi/);
    assert.ok(Date.now() - started < 2900, 'the task settles before the background job finishes');
    await new Promise(r => setTimeout(r, 3500));
    assert.ok(existsSync(path.join(dir, 'marker')), 'the background job kept running (no EPIPE)');
    host.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a stale saved TTS address does not block other settings or lockdown; a newly typed bad one is refused', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { CompanionService } = await import('../../runtime/core/companion');
  const dir = await mkdtemp(path.join(tmpdir(), 'galagent-tts-'));
  const core = new CompanionService({ dataDir: dir, workingDir: dir, credentials: { get: async () => undefined, set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} } });
  try {
    await core.init();
    (core as any).state.settings.ttsBaseUrl = 'http://192.168.1.20/v1'; // saved by an older version
    assert.equal((await core.handle({ type: 'settings.update', settings: { bubbleSeconds: 20 } })).ok, true);
    assert.equal((await core.handle({ type: 'privacy.lockdown' })).ok, true);
    assert.equal((await core.handle({ type: 'settings.update', settings: { ttsBaseUrl: 'http://evil.example/v1' } })).ok, false);
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a reminder the executor sets for the user counts as the user\'s, and lifts a matching character alarm', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { Store } = await import('../../runtime/core/store');
  const { SelfWakeScheduler } = await import('../../runtime/core/scheduler');
  const dir = await mkdtemp(path.join(tmpdir(), 'galagent-cron-'));
  const store = new Store(dir);
  try {
    const s = new SelfWakeScheduler(store);
    const at = new Date(Date.now() + 3600_000).toISOString();
    const mine = s.add({ note: '喝水', at }, 'character');
    assert.equal(mine.createdBy, 'character');
    const lifted = s.add({ note: '喝水', at }, 'user');
    assert.equal(lifted.id, mine.id); assert.equal(lifted.createdBy, 'user');
    assert.equal(s.list().length, 1);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
