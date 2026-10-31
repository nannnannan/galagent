import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import { OpenAIToolAgent } from '../../runtime/core/openai-agent';
import { Store } from '../../runtime/core/store';
import { isKimiK3Model, MIRA_DEFAULT_MODEL } from '../../runtime/shared/provider';

const aliases = ['kimi-k3.1-pro', 'kimi-code/k3.1-pro', 'kimi-code/k3.1', 'k3.1', 'k3.1-pro'];
const json = (content: string) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }));
const credentials = { get: async () => 'fixture', set: async () => {} };
const embeddings = { encode: async () => [1, 0], close: async () => {} };

test('K3.1 aliases and legacy K3 are recognized without treating unrelated model IDs as K3', () => {
  for (const model of [...aliases, 'kimi-code/k3', 'kimi-k3', 'k3', 'kimi-k3-eas']) assert.equal(isKimiK3Model(model), true, model);
  for (const model of ['kimi-k2.6', 'gpt-4.1', 'kimi-k3.10-pro', 'k3.1-other']) assert.equal(isKimiK3Model(model), false, model);
});

test('new profiles default to K3.1 Pro while explicitly saved K3 stays unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-provider-'));
  let core = new CompanionService({ dataDir: dir, credentials, embeddings });
  try {
    await core.init(); assert.equal(core.getSnapshot().provider.model, MIRA_DEFAULT_MODEL);
    await core.close();
    const store = new Store(dir); store.put('state', 'provider', { baseUrl: 'http://127.0.0.1:18890/v1', model: 'kimi-code/k3', mode: 'mira-proxy' }); store.close();
    core = new CompanionService({ dataDir: dir, credentials, embeddings });
    await core.init(); assert.equal(core.getSnapshot().provider.model, 'kimi-code/k3');
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});

test('main character uses K3 thinking budget for every K3.1 alias and preserves the selected ID', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-k31-chat-'));
  const requests: any[] = [];
  const core = new CompanionService({ dataDir: dir, credentials, embeddings, fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.messages[0].content.includes('facts每项')) return json('{"ops":[],"diary":""}');
    requests.push(body); return json('{"text":"你好。","expression":"neutral","action":"idle","name":"星棱"}');
  } });
  try {
    await core.init();
    for (const model of aliases) {
      await core.handle({ type: 'config.save', baseUrl: 'https://example.com/v1', model });
      assert.equal(core.getSnapshot().provider.mode, 'mira-proxy');
      assert.equal((await core.handle({ type: 'chat.send', text: '你好' })).ok, true);
      await core.waitForBackground();
      const body = requests.at(-1);
      assert.equal(body.model, model); assert.equal(body.reasoning_effort, 'low'); assert.equal(body.max_completion_tokens, 4096); assert.equal(body.max_tokens, undefined);
    }
    await core.handle({ type: 'config.save', baseUrl: 'https://example.com/v1', model: MIRA_DEFAULT_MODEL, mode: 'native-api' });
    await core.handle({ type: 'chat.send', text: '官方接口模式' }); await core.waitForBackground();
    const native = requests.at(-1);
    assert.equal(native.reasoning_effort, undefined); assert.equal(native.max_completion_tokens, undefined); assert.equal(native.max_tokens, 900);
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});

test('executor keeps K3.1 thinking and 26 tools, while explicit native API still omits private fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-k31-tools-'));
  try {
    for (const mode of [undefined, 'mira-proxy', 'native-api'] as const) {
      let request: any;
      const agent = new OpenAIToolAgent({ provider: () => ({ baseUrl: 'https://example.com/v1', model: MIRA_DEFAULT_MODEL, mode }), credentials, ask: async () => ({}), fetch: async (_url, init) => { request = JSON.parse(String(init?.body)); return json('完成'); } });
      try {
        assert.equal((await agent.run('say hello', dir, new AbortController().signal)).stopReason, 'end_turn');
        assert.equal(request.model, MIRA_DEFAULT_MODEL); assert.equal(request.tools.length, 26); assert.equal(request.stream, true);
        if (mode === 'native-api') { assert.equal(request.thinking, undefined); assert.equal(request.max_completion_tokens, undefined); }
        else { assert.deepEqual(request.thinking, { type: 'enabled', keep: 'all' }); assert.equal(request.max_completion_tokens, 4096); }
      } finally { agent.close(); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
