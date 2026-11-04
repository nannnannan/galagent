import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import type { AgentRunner } from '../../runtime/core/kimi-agent';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const say = (content: unknown) => json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }] });
const calls = (list: [string, unknown][]) => json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: list.map(([name, args], i) => ({ id: 'c' + i + name, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }, finish_reason: 'tool_calls' }] });
type Script = (body: any, toolResults: any[]) => Response;
async function make(script: Script, runner?: AgentRunner) {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-control-'));
  const bodies: any[] = [];
  const core = new CompanionService({ dataDir: dir, workingDir: dir, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} }, features: { attention: true }, agentRunner: runner,
    fetch: async (_u, init) => {
      const body = JSON.parse(String(init?.body)), system = String(body.messages[0].content);
      if (system.includes('facts每项')) return json({ choices: [{ message: { content: '{"facts":[],"diary":""}' } }] });
      if (system.startsWith('你是GalAgent的后台注意力代理')) return say({ decision: 'silent', reason: 'x', evidence: [], nextCheck: null });
      bodies.push(body);
      return script(body, body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content)));
    } });
  await core.init();
  return { core, bodies, dir, cleanup: async () => { await core.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('main character dispatches several tasks in parallel through run_task and keeps chatting', async () => {
  const started: { task: string; fresh?: boolean }[] = []; const release: (() => void)[] = [];
  const runner: AgentRunner = { probe: async () => ({ name: 'x', version: '1' }), close: () => {}, run: (task, _cwd, _signal, _p, options) => { started.push({ task, fresh: options?.fresh }); return new Promise(resolve => release.push(() => resolve({ summary: '完成：' + task.split('\n')[0], stopReason: 'end_turn', sessionId: 's', tools: [] }))); } };
  const { core, bodies, cleanup } = await make((_b, results) => results.length ? say({ text: `好，开了 ${results[0].started.length} 个任务`, expression: 'pleased', action: 'nod' }) : calls([['run_task', { tasks: ['整理下载文件夹', '查一下明天的天气', '统计项目代码行数'] }]]), runner);
  try {
    await core.handle({ type: 'chat.send', text: '帮我同时做三件事' });
    assert.ok(bodies[0].tools.some((t: any) => t.function.name === 'run_task'));
    assert.match(core.getSnapshot().messages.at(-1)!.text, /开了 3 个任务/);
    assert.equal(started.length, 3);
    assert.deepEqual(started.map(s => !!s.fresh), [false, true, true], 'parallel runs get their own sessions');
    assert.equal(core.getSnapshot().agent!.running!.length, 3);
    release.forEach(r => r()); await core.waitForAgent();
    assert.equal(core.getSnapshot().agent!.busy, false);
    assert.equal(core.getSnapshot().messages.filter(m => m.text.startsWith('[执行代理结束]')).length, 3);
  } finally { await cleanup(); }
});

test('update_settings: ordinary settings apply at once; widening privacy waits for one click unless full control', async () => {
  let patch: Record<string, unknown> = {};
  const { core, cleanup } = await make((_b, results) => results.length ? say({ text: JSON.stringify(results.at(-1)), expression: 'neutral', action: 'idle' }) : calls([['update_settings', { patch, reason: '方便我看看你在忙什么' }]]));
  try {
    patch = { proactiveIntervalMinutes: 30, topics: { clipboard: false }, splitReplies: false, aiControl: 'full' };
    await core.handle({ type: 'chat.send', text: '主动别太频繁，半小时一次，剪贴板话题关掉' });
    let s = core.getSnapshot();
    assert.equal(s.settings.proactiveIntervalMinutes, 30); assert.equal(s.settings.splitReplies, false);
    assert.equal(s.companionship?.topics.clipboard, 'mute');
    assert.equal(s.settings.aiControl, undefined, 'the AI can never grant itself full control');
    patch = { observationEnabled: true, screenCaptureEnabled: true, sandbox: { level: 'full' }, bubbleSeconds: 20 };
    await core.handle({ type: 'chat.send', text: '帮我打开桌面观察，沙箱完全放开' });
    s = core.getSnapshot();
    assert.equal(s.settings.bubbleSeconds, 20, 'non-sensitive part applied');
    assert.equal(s.settings.observationEnabled, false); assert.equal(s.settings.sandbox!.level, 'standard');
    const q = s.agent!.questions!.at(-1)!;
    assert.match(q.questions[0].question, /打开桌面观察[\s\S]*完全放开/);
    await core.handle({ type: 'agent.answer', id: q.id, answers: { [q.questions[0].question]: '同意' } });
    await new Promise(r => setTimeout(r, 20));
    s = core.getSnapshot();
    assert.equal(s.settings.observationEnabled, true); assert.equal(s.settings.sandbox!.level, 'full');
    assert.match(s.messages.at(-1)!.text, /已按你的确认修改设置/);
    // The user grants full control themselves: no more confirmation.
    await core.handle({ type: 'settings.update', settings: { aiControl: 'full' } });
    patch = { clipboardEnabled: true, sandbox: { redactSecrets: false } };
    await core.handle({ type: 'chat.send', text: '剪贴板也打开' });
    s = core.getSnapshot();
    assert.equal(s.settings.clipboardEnabled, true); assert.equal(s.settings.sandbox!.redactSecrets, false);
  } finally { await cleanup(); }
});

test('control tools exist only in direct chat; watch tool manages what TA keeps an eye on', async () => {
  const { core, bodies, cleanup } = await make((b, results) => {
    if (!b.tools?.some((t: any) => t.function.name === 'watch')) return say({ text: '', expression: 'neutral', action: 'idle' });
    return results.length ? say({ text: '记下了', expression: 'nod', action: 'nod' }) : calls([['watch', { action: 'add', title: '快递到了没', check_after_minutes: 60 }]]);
  });
  try {
    await core.handle({ type: 'chat.send', text: '帮我留意快递' });
    assert.equal(core.getSnapshot().watches?.[0]?.title, '快递到了没');
    const before = bodies.length;
    await core.handle({ type: 'pet.interact', interaction: 'tap' });
    for (const body of bodies.slice(before)) assert.ok(!body.tools?.some((t: any) => ['run_task', 'update_settings'].includes(t.function.name)), 'scenes never get control tools');
  } finally { await cleanup(); }
});

test('voice input is the user\'s call: the AI cannot switch it on or redirect where audio goes; lockdown switches it off', async () => {
  const { core, cleanup } = await make((_b, results) => results.length ? say({ text: JSON.stringify(results.at(-1)), expression: 'neutral', action: 'idle' }) : calls([['update_settings', { patch: { voiceInputEnabled: true, sttBaseUrl: 'https://evil.example/v1', sttModel: 'x', bubbleSeconds: 15 }, reason: '方便你说话' }]]));
  try {
    await core.handle({ type: 'chat.send', text: '帮我把语音输入打开' });
    let s = core.getSnapshot().settings;
    assert.equal(s.voiceInputEnabled, undefined); assert.equal(s.sttBaseUrl, undefined);
    assert.equal(s.bubbleSeconds, 15, 'the rest of the patch still applies');
    assert.equal((await core.handle({ type: 'stt.configure', voiceInputEnabled: true })).ok, false, 'needs an address and a model first');
    await core.handle({ type: 'stt.configure', sttBaseUrl: 'https://api.openai.com/v1', sttModel: 'whisper-1' });
    assert.equal((await core.handle({ type: 'stt.configure', voiceInputEnabled: true })).ok, true);
    assert.equal(core.getSnapshot().settings.voiceInputEnabled, true);
    await core.handle({ type: 'privacy.lockdown' });
    s = core.getSnapshot().settings;
    assert.equal(s.voiceInputEnabled, false);
  } finally { await cleanup(); }
});
