import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import { RequestPool } from '../../runtime/core/pool';
import { callUpstream, retryAfterMs } from '../../runtime/core/upstream';
import { ToolHost } from '../../runtime/core/tool-host';

const credentials = { get: async () => 'fixture-key', set: async () => {} };
const embeddings = () => ({ encode: async () => [1, 0], close: async () => {} });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const choice = (message: Record<string, unknown>) => json({ choices: [{ message: { role: 'assistant', ...message } }] });
const isMemory = (body: any) => String(body.messages[0].content).includes('facts每项');
async function make(fetcher: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-agent-fw-'));
  const core = new CompanionService({ dataDir: dir, credentials, embeddings: embeddings(), fetch: fetcher });
  await core.init();
  return { core, cleanup: async () => { await core.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('main character understands the request and sets the alarm through the schedule_wakeup tool', async () => {
  const bodies: any[] = [];
  const { core, cleanup } = await make(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (isMemory(body)) return choice({ content: '{"facts":[],"diary":""}' });
    bodies.push(body);
    const last = body.messages.at(-1);
    if (last.role === 'tool') return choice({ content: JSON.stringify({ text: `好，${JSON.parse(last.content).dueAt} 叫你喝水！`, expression: 'pleased', action: 'nod' }) });
    return choice({ content: null, reasoning_content: 'private', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'schedule_wakeup', arguments: JSON.stringify({ note: '提醒用户喝水', in_minutes: 30, for_user: true }) } }] });
  });
  try {
    assert.equal((await core.handle({ type: 'chat.send', text: '半小时后提醒我喝水' })).ok, true);
    await core.waitForBackground();
    assert.ok(bodies[0].tools.some((t: any) => t.function.name === 'schedule_wakeup'));
    const [alarm] = core.getSnapshot().schedules!;
    assert.equal(alarm.note, '提醒用户喝水');
    assert.equal(alarm.createdBy, 'user', 'for_user marks it as the user’s own reminder');
    const followUp = bodies[1].messages;
    assert.equal(followUp.at(-2).reasoning_content, 'private', 'assistant tool turn replayed verbatim');
    assert.equal(followUp.at(-1).tool_call_id, 'call_1');
    assert.match(core.getSnapshot().messages.at(-1)!.text, /叫你喝水/);
  } finally { await cleanup(); }
});

test('a gateway that rejects tools is remembered and the JSON schedule field still works', async () => {
  let withTools = 0;
  const { core, cleanup } = await make(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (isMemory(body)) return choice({ content: '{"facts":[],"diary":""}' });
    if (body.tools) { withTools++; return json({ error: 'tools not supported with json mode' }, 400); }
    return choice({ content: JSON.stringify({ text: '记下了', expression: 'neutral', action: 'idle', schedule: { inMinutes: 10, note: '回访' } }) });
  });
  try {
    assert.equal((await core.handle({ type: 'chat.send', text: '十分钟后来找我' })).ok, true);
    await core.handle({ type: 'chat.send', text: '再说一句' });
    await core.waitForBackground();
    assert.equal(withTools, 1, 'tools are not offered again to the same endpoint');
    assert.equal(core.getSnapshot().schedules![0].note, '回访');
  } finally { await cleanup(); }
});

test('recall_day returns the local transcript of a past day for the main character', async () => {
  let recalled = '';
  const { core, cleanup } = await make(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (isMemory(body)) return choice({ content: '{"facts":[],"diary":""}' });
    const last = body.messages.at(-1);
    if (last.role === 'tool') { recalled = last.content; return choice({ content: JSON.stringify({ text: '想起来了', expression: 'neutral', action: 'idle' }) }); }
    if (last.content === '昨天我说了啥') return choice({ content: null, tool_calls: [{ id: 'r', type: 'function', function: { name: 'recall_day', arguments: JSON.stringify({ day: new Date().toLocaleDateString('en-CA') }) } }] });
    return choice({ content: JSON.stringify({ text: '收到', expression: 'neutral', action: 'idle' }) });
  });
  try {
    await core.handle({ type: 'chat.send', text: '我养了一只叫阿黄的猫' });
    await core.handle({ type: 'chat.send', text: '昨天我说了啥' });
    assert.match(JSON.parse(recalled).messages.join('\n'), /阿黄/);
  } finally { await cleanup(); }
});

test('executor CronCreate wakes the main character instead of its own session', async () => {
  const jobs: any[] = [];
  const host = new ToolHost({ save: () => {}, ask: async () => ({}), child: async () => '', mainCron: { create: job => { jobs.push(job); return { id: 'w1', nextAt: Date.now() + 60_000 }; }, list: () => [], delete: () => true } });
  const session = host.session(tmpdir());
  const out = await host.execute(session, 'CronCreate', { cron: '7 9 * * *', prompt: '提醒用户站会', recurring: true }, new AbortController().signal);
  assert.match(out.content, /main-character/);
  assert.equal(session.crons.length, 0);
  assert.deepEqual(jobs, [{ cron: '7 9 * * *', prompt: '提醒用户站会', recurring: true }]);
  host.close();
});

test('upstream retries 429 honouring Retry-After without holding a pool slot while waiting', async () => {
  const pool = new RequestPool(1);
  let calls = 0, inflightDuringWait = -1;
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1) { setTimeout(() => { inflightDuringWait = pool.stats().inflight; }, 20); return new Response('', { status: 429, headers: { 'retry-after': '0.05' } }); }
    return new Response('ok');
  };
  const { response, release } = await callUpstream({ fetch: fetcher, url: 'http://x/', init: {}, pool, priority: 'chat', signal: new AbortController().signal });
  assert.equal(await response.text(), 'ok'); release();
  assert.equal(calls, 2);
  assert.equal(inflightDuringWait, 0, 'slot released during backoff');
  assert.equal(pool.stats().inflight, 0);
  assert.equal(retryAfterMs('999999'), 60_000, 'hostile Retry-After is capped');
  pool.close();
});
