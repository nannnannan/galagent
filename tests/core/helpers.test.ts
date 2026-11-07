import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../runtime/core/store';
import { CompanionService } from '../../runtime/core/companion';
import { contextBriefs, fallbackDigest, needsDigest, parseBrief, urlsIn } from '../../runtime/core/helpers';
import type { AgentRunner } from '../../runtime/core/kimi-agent';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const say = (content: unknown) => json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }] });
const calls = (list: [string, unknown][]) => json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: list.map(([name, args], i) => ({ id: 'c' + i, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }, finish_reason: 'tool_calls' }] });

test('briefs keep their full length, stay a week in the working set, and may only cite URLs the helper really saw', () => {
  const seen = new Set(urlsIn(JSON.stringify({ results: [{ url: 'https://a.com/1' }, { url: 'javascript:x' }] })));
  urlsIn(JSON.stringify({ url: 'https://b.com/2', text: '…' })).forEach(u => seen.add(u));
  assert.deepEqual([...seen], ['https://a.com/1', 'https://b.com/2']);
  const b = parseBrief(JSON.stringify({ gist: 'x'.repeat(9999), points: Array(9).fill('p'), sources: [{ url: 'https://a.com/1' }, { url: 'https://evil.com' }, { url: 'https://a.com/1' }] }), '目标', seen, 'id1', 1);
  assert.equal(b.gist.length, 9999, 'gists are not cut'); assert.equal(b.points.length, 9, 'nor are points');
  assert.deepEqual(b.sources.map(s => s.url), ['https://a.com/1']);
  assert.equal(parseBrief('not json at all', 'g', seen, 'id2', 1).gist, 'not json at all');
  assert.equal(contextBriefs([{ ...b, at: 0 }], 2 * 86400_000).length, 1, 'briefs stay in the working set for a week');
  assert.equal(contextBriefs([{ ...b, at: 0 }], 8 * 86400_000).length, 0, 'then only open_brief reaches them');
  assert.equal(contextBriefs([{ ...b, at: 0 }], 2 * 86400_000)[0].gist.length, 9999);
  assert.ok(!needsDigest('长'.repeat(3000))); assert.ok(needsDigest('长'.repeat(4001))); assert.ok(fallbackDigest('长'.repeat(9000)).length < 4000);
});

test('ask_helpers runs up to 4 helpers side by side; the main agent sees gists, a follow-up turn sees recentBriefs, open_brief gives details', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-helpers-'));
  let inflight = 0, peak = 0, helpers = 0; const mains: any[] = [];
  const core = new CompanionService({ dataDir: dir, workingDir: dir, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} },
    fetch: async (_u, init) => {
      const body = JSON.parse(String(init?.body)), system = String(body.messages[0].content);
      if (system.includes('facts每项')) return json({ choices: [{ message: { content: '{"facts":[],"diary":""}' } }] });
      if (system.startsWith('你是桌面陪伴角色（主代理）派出去的并行助手')) {
        helpers++; inflight++; peak = Math.max(peak, inflight);
        await new Promise(r => setTimeout(r, 30)); inflight--;
        const goal = JSON.parse(String(body.messages[1].content)).goal;
        return say({ gist: `关于「${goal}」的结论`, points: ['细节一', '细节二'] });
      }
      mains.push(body);
      const tools = body.messages.filter((m: any) => m.role === 'tool');
      if (mains.length === 1 && !tools.length) return calls([['ask_helpers', { tasks: [1, 2, 3, 4, 5].map(i => ({ goal: `事情${i}` })) }]]);
      if (mains.length === 2) { const briefs = JSON.parse(tools[0].content).briefs; return say({ text: `查了 ${briefs.length} 件`, expression: 'neutral', action: 'idle' }); }
      if (mains.length === 3) { const ctx = String(body.messages[0].content); assert.match(ctx, /recentBriefs/); const id = /"id":"([0-9a-f-]{36})","by":"helper"/.exec(ctx)![1]; return calls([['open_brief', { id }]]); }
      return say({ text: JSON.parse(body.messages.at(-1).content).points.join('、'), expression: 'neutral', action: 'idle' });
    } });
  await core.init();
  try {
    await core.handle({ type: 'chat.send', text: '同时帮我查五件事' });
    assert.equal(helpers, 4, 'at most 4 helpers per call'); assert.ok(peak >= 2, 'helpers run in parallel');
    assert.match(core.getSnapshot().messages.at(-1)!.text, /查了 4 件/);
    const seenByMain = JSON.stringify(mains[1].messages);
    assert.match(seenByMain, /关于「事情1」的结论/);
    await core.handle({ type: 'chat.send', text: '第一件具体说说' });
    assert.match(core.getSnapshot().messages.at(-1)!.text, /细节一、细节二/);
    assert.ok(core.getSnapshot().status.contextTokens <= 6500);
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a long executor report reaches the main agent as a gist; the full report stays in the task history; running work shows on the board', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-digest-'));
  const long = '第一步做了很多事。'.repeat(600) + '最后：全部完成，文件在 D:/out。';
  let release: () => void = () => {}; let boardSeen = false;
  const runner: AgentRunner = { probe: async () => ({ name: 'x', version: '1' }), close: () => {}, run: () => new Promise(r => { release = () => r({ summary: long, stopReason: 'end_turn', sessionId: 's', tools: [] }); }) };
  const core = new CompanionService({ dataDir: dir, workingDir: dir, agentRunner: runner, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} },
    fetch: async (_u, init) => {
      const body = JSON.parse(String(init?.body)), system = String(body.messages[0].content);
      if (system.includes('facts每项')) return json({ choices: [{ message: { content: '{"facts":[],"diary":""}' } }] });
      if (system.startsWith('把执行代理交回的任务汇报压缩')) return say({ gist: '整理完成，结果在 D:/out。' });
      if (/"board"/.test(system) && /执行任务/.test(system)) boardSeen = true;
      return say({ text: '好', expression: 'neutral', action: 'idle' });
    } });
  await core.init();
  try {
    await core.handle({ type: 'agent.run', task: '整理一大堆文件' });
    await core.handle({ type: 'chat.send', text: '进度怎么样' });
    assert.ok(boardSeen, 'the running task is on the board in the main context');
    release(); await core.waitForAgent();
    const deadline = Date.now() + 1500;
    while (core.getSnapshot().agent!.lastResult!.gist !== '整理完成，结果在 D:/out。' && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 10));
    const msg = core.getSnapshot().messages.find(m => m.text.startsWith('[执行代理结束]'))!;
    assert.match(msg.text, /整理完成，结果在 D:\/out。/); assert.ok(msg.text.length < 120, 'the chat line is the gist, not the whole report');
    assert.equal(core.getSnapshot().agent!.lastResult!.gist, '整理完成，结果在 D:/out。');
    const run = core.getSnapshot().taskHistory![0];
    const detail = (await core.handle({ type: 'agent.task', id: run.id })).data as any;
    assert.equal(detail.summary, long, 'the full report is kept for the 任务 page');
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});

test('limits: the API-reported window and output cap are used, the user can override them, and briefs survive a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-limits-'));
  const bodies: any[] = [];
  let readOldBrief = false;
  let retrieved: { gist: string } | undefined;
  const opts = { dataDir: dir, workingDir: dir, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} },
    fetch: (async (_u: string, init?: RequestInit) => { const body = JSON.parse(String(init?.body)); if (String(body.messages[0].content).includes('facts每项')) return json({ choices: [{ message: { content: '{"facts":[],"diary":""}' } }] }); bodies.push(body);
      if (readOldBrief) {
        const tool = body.messages.find((m: { role: string }) => m.role === 'tool');
        if (!tool) return calls([['open_brief', { id: 'b-old' }]]);
        retrieved = JSON.parse(tool.content);
      }
      return say({ text: '好', expression: 'neutral', action: 'idle' }); }) as typeof fetch };
  let core = new CompanionService(opts); await core.init();
  try {
    await core.handle({ type: 'config.save', baseUrl: 'https://api.example.com/v1', model: 'm-1' });
    assert.equal(core.contextWindow(), 1_000_000, 'default 1M');
    core.setModelLimits({ model: 'm-1', baseUrl: 'https://api.example.com/v1', contextWindow: 262144, maxOutput: 131072 });
    assert.equal(core.contextWindow(), 262144);
    await core.handle({ type: 'chat.send', text: '你好' });
    assert.equal(bodies.at(-1).max_tokens, 32768, 'a huge API limit is capped for a chat line');
    assert.equal(core.getSnapshot().status.contextBudget, 262144);
    await core.handle({ type: 'settings.update', settings: { contextWindow: 2_000_000, maxOutputTokens: 9000 } });
    await core.handle({ type: 'chat.send', text: '再来' });
    assert.equal(bodies.at(-1).max_tokens, 9000); assert.equal(core.contextWindow(), 2_000_000);
    await core.handle({ type: 'config.save', baseUrl: 'https://api.example.com/v1', model: 'm-2' });
    assert.equal(core.contextWindow(), 2_000_000, 'the user value applies to any model');
    await core.handle({ type: 'settings.update', settings: { contextWindow: 0, maxOutputTokens: 0 } });
    assert.equal(core.contextWindow(), 1_000_000, 'detected limits belong to m-1 only');
    await core.close();
    const saved = new Store(dir);
    try {
      saved.put('state', 'briefs', [{ id: 'b-old', by: 'helper', goal: '很久以前查的', gist: '长'.repeat(5000), points: [], sources: [], at: Date.now() - 400 * 86400_000 }]);
    } finally { saved.close(); }
    core = new CompanionService(opts); await core.init();
    readOldBrief = true;
    assert.ok((await core.handle({ type: 'chat.send', text: '打开以前的梗概' })).ok);
    assert.equal(retrieved?.gist.length, 5000, 'legacy briefs survive a restart and reach the tool in full');
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});
