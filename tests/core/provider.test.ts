import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import { OpenAIToolAgent } from '../../runtime/core/openai-agent';
import { Store } from '../../runtime/core/store';
import { apiRoot, endpointUrl } from '../../runtime/shared/endpoints';
import { CHAT_PROTOCOL, DEFAULT_CHAT_MODEL, OPENAI_BASE_URL, chatBaseUrl, readChatEndpoint } from '../../runtime/shared/provider';

const json = (content: string) => new Response(JSON.stringify({
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
}));
const embeddings = { encode: async () => [1, 0], close: async () => {} };

test('OpenAI-compatible roots support a host, full route and provider-specific prefix', () => {
  assert.equal(apiRoot('https://example.com'), 'https://example.com/v1');
  assert.equal(apiRoot('https://example.com/tenant/openai/v1/chat/completions/'), 'https://example.com/tenant/openai/v1');
  assert.equal(endpointUrl('chat', 'http://[::1]:8080/custom'), 'http://[::1]:8080/custom/chat/completions');
  const unversioned = 'https://example.com/chat/completions';
  assert.equal(endpointUrl('chat', chatBaseUrl(unversioned)), unversioned);
  for (const address of ['https://example.com/v1?secret=1', 'https://example.com/v1#x', 'https://u:p@example.com/v1']) {
    assert.throws(() => apiRoot(address));
  }
  const explicitLoopback = { baseUrl: 'http://127.0.0.1:18890/v1', model: 'local', protocol: CHAT_PROTOCOL };
  assert.deepEqual(readChatEndpoint(explicitLoopback), { baseUrl: explicitLoopback.baseUrl, model: explicitLoopback.model });
});

test('old proxy config is migrated without reusing its key or executor alias', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-provider-'));
  const store = new Store(dir);
  store.saveState({
    provider: { baseUrl: 'http://127.0.0.1:18890/v1', model: 'kimi-code/k3', mode: 'mira-proxy' },
    settings: { executor: { model: 'old-local-alias', maxTurns: 12 } },
  });
  store.put('message', 'before', { id: 'before', role: 'user', source: 'chat', text: '旧聊天', createdAt: new Date().toISOString() });
  store.close();
  const requested: string[] = [];
  const core = new CompanionService({
    dataDir: dir, embeddings, credentials: {
      get: async url => { requested.push(url); return undefined; },
      set: async () => {},
      migrateLegacy: async () => { throw new Error('Legacy proxy key must not migrate'); },
    },
  });
  try {
    await core.init();
    const snap = core.getSnapshot();
    assert.equal(snap.provider.baseUrl, OPENAI_BASE_URL);
    assert.equal(snap.provider.model, DEFAULT_CHAT_MODEL);
    assert.equal(snap.provider.configured, false);
    assert.equal(snap.settings.executor?.model, undefined);
    assert.equal(snap.settings.executor?.maxTurns, 12);
    assert.ok(snap.messages.some(m => m.id === 'before'));
    assert.deepEqual(requested, [], 'migrated profiles never look up an inherited key until the user saves a connection');
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});

test('direct profiles preserve the model and bind only the original key source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-direct-'));
  const store = new Store(dir);
  store.saveState({ provider: { baseUrl: 'https://old.example/v1', model: 'model-a', mode: 'native-api' } });
  store.close();
  const originKeys = new Map<string, string>();
  const credentials = {
    migrateLegacy: async (url: string) => { assert.equal(url, 'https://old.example/v1'); originKeys.set(new URL(url).origin, 'old'); },
    get: async (url: string) => originKeys.get(new URL(url).origin),
    set: async (key: string, url: string) => { originKeys.set(new URL(url).origin, key); },
  };
  const core = new CompanionService({ dataDir: dir, credentials, embeddings });
  try {
    await core.init();
    assert.equal(core.getSnapshot().provider.configured, true);
    assert.equal(core.getSnapshot().provider.model, 'model-a');
    await core.handle({ type: 'settings.update', settings: { executor: { model: 'model-a' } } });
    assert.equal((await core.handle({ type: 'config.save', baseUrl: 'https://new.example/team/chat/completions', model: 'model-b' })).ok, true);
    assert.equal(core.getSnapshot().provider.baseUrl, 'https://new.example/team');
    assert.equal(core.getSnapshot().provider.configured, false);
    assert.equal(core.getSnapshot().settings.executor?.model, undefined);
    assert.equal((await core.handle({ type: 'config.save', baseUrl: 'https://new.example/team', model: 'model-b', apiKey: 'new' })).ok, true);
    assert.equal(core.getSnapshot().provider.configured, true);
    assert.equal(originKeys.get('https://new.example'), 'new');
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});

test('executor adapts an endpoint that rejects streaming and the legacy limit field', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-openai-tools-'));
  const requests: Record<string, unknown>[] = [];
  const agent = new OpenAIToolAgent({
    provider: () => ({ baseUrl: 'https://example.test/gateway/chat/completions', model: 'kimi-k3.1-pro' }),
    credentials: { get: async () => 'fixture' }, ask: async () => ({}),
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://example.test/gateway/chat/completions');
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      assert.equal(body.thinking, undefined);
      assert.equal(body.tools.length, 27);
      if (body.stream) return new Response('Unsupported parameter stream', { status: 400 });
      if (body.max_tokens) return new Response('Use max_completion_tokens instead of unsupported max_tokens', { status: 400 });
      return json('执行完成。');
    },
  });
  try {
    assert.equal((await agent.run('测试 OpenAI 兼容执行。', dir, new AbortController().signal)).stopReason, 'end_turn');
    assert.equal(requests.length, 3);
    assert.equal(requests[2].max_completion_tokens, 8192);
    assert.equal(requests[2].stream_options, undefined);
  } finally { agent.close(); await rm(dir, { recursive: true, force: true }); }
});
