import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestPool } from '../../runtime/core/pool';
import { callUpstream } from '../../runtime/core/upstream';
import { responseText } from '../../runtime/core/api-response';
import { shareResearchWeb } from '../../runtime/core/research-runner';

test('cancellation releases the model slot even when the fetch or response body ignores it', async () => {
  const pool = new RequestPool(1),
    signal = new AbortController();
  let complete!: (response: Response) => void;
  const call = callUpstream({
    fetch: () => new Promise<Response>((resolve) => (complete = resolve)),
    url: 'https://fixture.example/v1',
    init: {},
    pool,
    priority: 'chat',
    signal: signal.signal,
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(pool.stats().inflight, 1);
  signal.abort();
  await assert.rejects(call);
  assert.equal(pool.stats().inflight, 0);
  complete(new Response('{}'));
  await Promise.resolve();
  const bodyAbort = new AbortController();
  const body = new Response(new ReadableStream<Uint8Array>({ start() {} }));
  const reading = responseText(body, bodyAbort.signal);
  bodyAbort.abort();
  await assert.rejects(reading);
  pool.close();
});

test('research helpers share searches and opened pages only inside one pass', async () => {
  let reads = 0,
    searches = 0;
  const web = {
    read: async (url: string) => {
      reads++;
      return { title: 'fixture', url, text: 'page' };
    },
    search: async (_q: string, _n?: number) => {
      searches++;
      return { engine: 'fixture', results: [] };
    },
  };
  const shared = shareResearchWeb(web);
  await Promise.all([shared.read('https://fixture.example/a'), shared.read('https://fixture.example/a')]);
  await Promise.all([shared.search('query', 3), shared.search('query', 3)]);
  assert.equal(reads, 1);
  assert.equal(searches, 1);
  await shareResearchWeb(web).read('https://fixture.example/a');
  assert.equal(reads, 2, 'a new pass gets fresh data');
});
test('native executor adapts unsupported output-budget and usage fields without replaying tools', async () => {
  const { OpenAIToolAgent } = await import('../../runtime/core/openai-agent');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'gal-api-adapt-'));
  let attempts = 0;
  const agent = new OpenAIToolAgent({
    provider: () => ({ baseUrl: 'https://fixture.example/v1', model: 'model', mode: 'native-api' }),
    credentials: { get: async () => 'fixture' },
    ask: async () => ({}),
    fetch: async (_url, init) => {
      attempts++;
      const b = JSON.parse(String(init?.body));
      if (b.stream_options)
        return new Response(JSON.stringify({ error: { message: 'stream_options is unsupported' } }), {
          status: 400,
        });
      if (b.max_tokens)
        return new Response(
          JSON.stringify({
            error: { message: 'max_tokens is not supported, use max_completion_tokens instead' },
          }),
          { status: 400 },
        );
      assert.ok(b.max_completion_tokens > 0);
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '已完成' } }],
        }),
      );
    },
  });
  try {
    assert.equal((await agent.run('检查兼容性', dir, new AbortController().signal)).summary, '已完成');
    assert.equal(attempts, 3);
    await agent.run('再检查一次', dir, new AbortController().signal);
    assert.equal(attempts, 4);
  } finally {
    agent.close();
    await rm(dir, { recursive: true, force: true });
  }
});
