import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import type { AgentRunner } from '../../runtime/core/kimi-agent';
import type { TaskRunDetail } from '../../runtime/shared/contracts';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const say = (content: unknown) => json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }] });
async function make(runner?: AgentRunner) {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-history-'));
  const core = new CompanionService({ dataDir: dir, workingDir: dir, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} }, agentRunner: runner,
    fetch: async (_u, init) => { const system = String(JSON.parse(String(init?.body)).messages[0].content); if (system.includes('facts每项')) return json({ choices: [{ message: { content: '{"facts":[],"diary":""}' } }] }); return say({ text: '好', expression: 'neutral', action: 'idle' }); } });
  await core.init();
  return { core, dir, cleanup: async () => { await core.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('finished tasks land in the history with tools, files and duration, survive a restart, and undo one run by id', async () => {
  const undone: string[] = [];
  const runner: AgentRunner = {
    probe: async () => ({ name: 'x', version: '1' }), close: () => {},
    run: async task => ({ summary: '做好了：' + task.split('\n')[0], stopReason: 'end_turn', sessionId: 's', tools: [{ id: '1', title: 'Read: a.ts', status: 'completed' }, { id: '2', title: 'Read: b.ts', status: 'completed' }, { id: '3', title: 'Write', status: 'completed' }], changedFiles: ['/tmp/x/a.ts'], runId: 'run-' + task.length }),
    undoRun: async runId => { undone.push(runId); return { runId, label: 'x', restored: ['/tmp/x/a.ts'], conflicts: [], skipped: [] }; },
  };
  const first = await make(runner);
  try {
    await first.core.handle({ type: 'agent.run', task: '整理下载文件夹' });
    await first.core.waitForAgent();
    const list = first.core.getSnapshot().taskHistory!;
    assert.equal(list.length, 1);
    assert.equal(list[0].status, 'done'); assert.equal(list[0].changedFiles, 1); assert.equal(list[0].undoable, true); assert.equal(list[0].toolCount, 3);
    const detail = (await first.core.handle({ type: 'agent.task', id: list[0].id })).data as TaskRunDetail;
    assert.deepEqual(detail.tools, { Read: 2, Write: 1 });
    assert.deepEqual(detail.files, ['/tmp/x/a.ts']);
    assert.match(detail.task, /整理下载文件夹/);
    assert.ok(detail.durationMs >= 0);
    const r = await first.core.handle({ type: 'agent.undo', runId: detail.runId });
    assert.equal(r.ok, true); assert.deepEqual(undone, [detail.runId]);
    const after = first.core.getSnapshot().taskHistory![0];
    assert.equal(after.undone, true); assert.equal(after.undoable, false);
    await first.core.close();
    const again = new CompanionService({ dataDir: first.dir, workingDir: first.dir, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} }, agentRunner: runner, fetch: async () => say({ text: '', expression: 'neutral', action: 'idle' }) });
    await again.init();
    assert.equal(again.getSnapshot().taskHistory![0].undone, true, 'history survives a restart');
    await again.handle({ type: 'agent.clearHistory' });
    assert.deepEqual(again.getSnapshot().taskHistory, []);
    await again.close();
  } finally { await rm(first.dir, { recursive: true, force: true }); }
});

test('adaptive pacing: ignored lines stretch the interval and reset restores it; the setting can switch it off', async () => {
  const { core, cleanup } = await make();
  try {
    const c = core as any;
    const t0 = Date.now() - 10 * 3600_000;
    // Four initiatives in the last hours, none answered.
    for (let i = 0; i < 4; i++) c.setPacing(c.pacing && (await import('../../runtime/core/pacing')).noteInitiative(c.pacing, ['window'], t0 + i * 3600_000));
    c.setPacing((await import('../../runtime/core/pacing')).settlePacing(c.pacing, Date.now()));
    let view = core.getSnapshot().pacing!;
    assert.equal(view.factor, 3);
    assert.ok(view.paused.some(p => p.topic === 'window'));
    assert.equal(c.paceFactor(), 3);
    await core.handle({ type: 'settings.update', settings: { adaptivePacing: false } });
    assert.equal(c.paceFactor(), 1, 'off means the user interval as set');
    assert.deepEqual(core.getSnapshot().pacing!.paused, []);
    await core.handle({ type: 'settings.update', settings: { adaptivePacing: true } });
    await core.handle({ type: 'pacing.reset' });
    view = core.getSnapshot().pacing!;
    assert.equal(view.factor, 1); assert.deepEqual(view.paused, []);
  } finally { await cleanup(); }
});

test('「TA 眼中的你」: the user can rewrite or clear the impression, see where a memory came from, and get an hourly rhythm', async () => {
  const { core, cleanup } = await make();
  try {
    await core.handle({ type: 'chat.send', text: '我喜欢不加糖的乌龙茶' });
    await core.handle({ type: 'memory.remember', text: '用户喜欢不加糖的乌龙茶' });
    const m = core.getSnapshot().memories.at(-1)!;
    const src = await core.handle({ type: 'memory.source', id: m.id });
    assert.equal(src.ok, true);
    assert.ok(['message', 'unknown', 'archive'].includes((src.data as any).kind));
    const rhythm = await core.handle({ type: 'profile.rhythm' });
    assert.equal((rhythm.data as any).messages >= 1, true);
    assert.equal((rhythm.data as any).hours.length, 24);
    assert.ok(!JSON.stringify(rhythm.data).includes('乌龙茶'), 'rhythm carries counts only');
    assert.equal((await core.handle({ type: 'portrait.update', text: '一个爱喝乌龙茶的夜猫子' })).ok, true);
    assert.deepEqual({ ...core.getSnapshot().portrait, updatedAt: undefined }, { text: '一个爱喝乌龙茶的夜猫子', updatedAt: undefined, userEdited: true });
    await core.handle({ type: 'portrait.clear' });
    assert.equal(core.getSnapshot().portrait, undefined);
  } finally { await cleanup(); }
});
