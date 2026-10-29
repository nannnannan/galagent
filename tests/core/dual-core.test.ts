import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestPool } from '../../runtime/core/pool';
import { ScreenSampler, ClipboardRing, blockedBy, DEFAULT_CAPTURE_BLOCKLIST, type CaptureContext } from '../../runtime/desktop/perception';
import { AttentionLoop, parseDecision, type AttentionDeps, type AttentionEvent } from '../../runtime/core/attention';
import { parseExtraction, parseJournal, searchJournals, memoryBoost } from '../../runtime/core/memory-plus';
import { parseClipboard } from '../../runtime/desktop/observer';
import { Store } from '../../runtime/core/store';
import { CompanionService } from '../../runtime/core/companion';
import { BrowserPerception } from '../../runtime/desktop/browser';
import type { AgentRunner } from '../../runtime/core/kimi-agent';

const until = async (check: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

// ---------------- DC1 · pool ----------------
test('pool: 30 simultaneous requests never exceed the 20 ceiling, all complete, queue drains', async () => {
    const pool = new RequestPool(20);
    let active = 0, peak = 0;
    const jobs = Array.from({ length: 30 }, (_, i) => pool.run(i % 2 ? 'execution' : 'background', async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 15)); active--; return i; }));
    const results = await Promise.all(jobs);
    assert.equal(results.length, 30);
    assert.ok(peak <= 20, `peak ${peak}`);
    assert.equal(peak, 18, 'bulk work leaves two slots of headroom');
    assert.equal(pool.stats().inflight, 0);
    assert.equal(pool.stats().queued, 0);
    assert.equal(pool.stats().peak, 18);
});
test('pool: a swarm of executions cannot starve the user chat; chat may use the reserved slots', async () => {
    const pool = new RequestPool(20);
    const bulk = await Promise.all(Array.from({ length: 18 }, () => pool.acquire('execution')));
    const blocked = pool.acquire('execution');
    let late = false; void blocked.then(() => { late = true; });
    const chats = await Promise.all([pool.acquire('chat'), pool.acquire('attention')]);
    assert.equal(pool.stats().inflight, 20);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(late, false, 'the 19th execution waits even though chat got through');
    for (const release of [...bulk, ...chats]) release();
    (await blocked)();
    pool.close();
});
test('pool: user dialogue jumps the queue ahead of attention, execution and background', async () => {
    const pool = new RequestPool(1);
    const order: string[] = [];
    const hold = await pool.acquire('background');
    const waits = (['background', 'execution', 'attention', 'chat'] as const).map(p => pool.run(p, async () => { order.push(p); }));
    await new Promise(r => setTimeout(r, 5));
    hold();
    await Promise.all(waits);
    assert.deepEqual(order, ['chat', 'attention', 'execution', 'background']);
});
test('pool: aborting a queued request frees its place; throttling halves the usable ceiling temporarily', async () => {
    let now = 0;
    const pool = new RequestPool(20, () => now);
    const holds = await Promise.all([...Array.from({ length: 18 }, () => pool.acquire('execution')), pool.acquire('chat'), pool.acquire('chat')]);
    const controller = new AbortController();
    const queued = pool.acquire('background', controller.signal);
    assert.equal(pool.stats().queued, 1);
    controller.abort();
    await assert.rejects(queued, /已取消/);
    assert.equal(pool.stats().queued, 0);
    for (const release of holds) release();
    pool.penalize(60000);
    assert.equal(pool.effectiveLimit(), 10);
    now += 60001;
    assert.equal(pool.effectiveLimit(), 20);
    assert.throws(() => new RequestPool(21));
    pool.close();
});

// ---------------- DC2 · perception ----------------
const shot = (fill: number) => ({ dataUrl: 'data:image/jpeg;base64,AAAA', signature: Array(576).fill(fill) });
const ctx = (over: Partial<CaptureContext> = {}): CaptureContext => ({ enabled: true, paused: false, locked: false, idleSeconds: 0, appName: 'Code', blocklist: [...DEFAULT_CAPTURE_BLOCKLIST], ...over });
test('screen: blocked apps, idle, locked, fullscreen, paused or disabled never invoke the capturer', async () => {
    let calls = 0;
    const sampler = new ScreenSampler(async () => { calls++; return shot(10); });
    for (const [over, reason] of [[{ enabled: false }, 'disabled'], [{ paused: true }, 'paused'], [{ locked: true }, 'locked'], [{ locked: undefined }, 'locked'], [{ suspended: true }, 'locked'], [{ fullscreen: true }, 'fullscreen'], [{ idleSeconds: 900 }, 'idle'], [{ appName: 'KeePassXC' }, 'blocked'], [{ appName: 'chrome', title: '招商银行 网上银行' }, 'blocked'], [{ appName: '1Password' }, 'blocked']] as const)
        assert.equal((await sampler.sample(ctx(over as Partial<CaptureContext>))).skipped, reason);
    assert.equal(calls, 0);
    assert.equal(blockedBy({ appName: 'bitwarden', blocklist: DEFAULT_CAPTURE_BLOCKLIST }), 'Bitwarden');
});
test('screen: at most one changed screenshot per minute; unchanged screens are dropped', async () => {
    let now = 1_000_000, fill = 10;
    const sampler = new ScreenSampler(async () => shot(fill), { clock: () => now });
    const first = await sampler.sample(ctx());
    assert.ok(first.shot?.id.startsWith('screen:'));
    fill = 200; now += 30_000;
    assert.equal((await sampler.sample(ctx())).skipped, 'rate');
    fill = 10; now += 31_000;
    assert.equal((await sampler.sample(ctx())).skipped, 'unchanged');
    fill = 200; now += 1;
    assert.ok((await sampler.sample(ctx())).shot);
});
test('clipboard: 50-entry ring, sensitive entries skipped, duplicates collapsed, baseline primed', () => {
    const ring = new ClipboardRing(50);
    ring.prime({ text: '旧内容', excluded: false });
    assert.equal(ring.offer({ text: '旧内容', excluded: false }), undefined);
    assert.equal(ring.offer({ text: 'SECRET', excluded: true }), undefined);
    for (let i = 0; i < 60; i++) ring.offer({ text: `条目${i}`, excluded: false });
    assert.equal(ring.entries.length, 50);
    assert.equal(ring.entries[0].text, '条目10');
    assert.ok(!ring.entries.some(e => e.text.includes('SECRET')));
    ring.offer({ text: '条目20', excluded: false });
    assert.equal(ring.entries.length, 50);
    assert.equal(ring.entries.at(-1)!.text, '条目20');
    ring.clear();
    assert.equal(ring.entries.length, 0);
});
test('observer clipboard lines: excluded content never carries text; malformed lines ignored', () => {
    assert.deepEqual(parseClipboard(JSON.stringify({ clipboard: { excluded: true, text: 'pw', baseline: false } })), { text: '', excluded: true, baseline: false });
    assert.deepEqual(parseClipboard(JSON.stringify({ clipboard: { excluded: false, text: '你好', baseline: true } })), { text: '你好', excluded: false, baseline: true });
    assert.equal(parseClipboard('{"clipboard":{"text":"x"}}'), undefined);
    assert.equal(parseClipboard('not json'), undefined);
});

// ---------------- DC3/DC4 · attention ----------------
test('decision parser keeps only real evidence, downgrades unsupported wakes and clamps schedule', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    const known = new Set(['task:1']);
    const d = parseDecision({ decision: 'wake', reason: 'r', evidence: ['task:1', 'invented'], nextCheck: '2026-10-17T12:00:05Z', wakeHint: '任务完成了' }, known, now);
    assert.deepEqual(d.evidence, ['task:1']);
    assert.equal(d.decision, 'wake');
    assert.equal(d.nextCheck, '2026-10-17T12:01:00.000Z');
    assert.equal(parseDecision({ decision: 'wake', reason: 'r', evidence: ['invented'], nextCheck: null, wakeHint: 'x' }, known, now).decision, 'observe');
    assert.equal(parseDecision({ decision: 'schedule', reason: 'r', evidence: [], nextCheck: '2030-01-01T00:00:00Z' }, known, now).nextCheck, '2026-10-18T12:00:00.000Z');
    assert.throws(() => parseDecision({ decision: 'shout', reason: 'r' }, known, now));
});
async function attentionFixture(over: Partial<AttentionDeps> = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'galagent-attention-'));
    const store = new Store(dir);
    let now = Date.parse('2026-10-17T12:00:00Z');
    const calls: any[] = [], wakes: any[] = [];
    let reply: unknown = { decision: 'silent', reason: '无事', evidence: [], nextCheck: null };
    let screen: any = { skipped: 'disabled' };
    const deps: AttentionDeps = {
        store, clock: () => now,
        evaluate: async input => { calls.push(input); return typeof reply === 'function' ? await (reply as any)(input) : reply; },
        eligible: () => undefined, canWake: () => true,
        wake: async request => { wakes.push(request); return true; },
        sampleScreen: async () => screen, clipboard: () => [], brief: async () => ({ summary: '' }),
        ...over,
    };
    const loop = new AttentionLoop(deps);
    return { dir, store, loop, calls, wakes, deps, advance: (ms: number) => { now += ms; }, now: () => now, setReply: (r: unknown) => { reply = r; }, setScreen: (s: any) => { screen = s; }, cleanup: async () => { loop.close(); store.close(); await rm(dir, { recursive: true, force: true }); } };
}
const taskEvent = (id: string, now: number): AttentionEvent => ({ id, kind: 'task', at: now, important: true, summary: '后台任务已结束', expiresAt: now + 3600_000 });
test('attention: a heartbeat with no new events, no changed screen and nothing due makes no model call', async () => {
    const f = await attentionFixture();
    await f.loop.tick(); f.advance(60_000); await f.loop.tick(); f.advance(10_000); await f.loop.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.loop.status.skippedHeartbeats, 2);
    await f.cleanup();
});
test('attention: important task result is judged at once and wakes the main character exactly once', async () => {
    const f = await attentionFixture();
    f.setReply((input: any) => ({ decision: 'wake', reason: '任务结束', evidence: [input.events[0].id], nextCheck: null, wakeHint: '告诉用户任务完成' }));
    f.loop.push(taskEvent('task:a', f.now()));
    f.loop.push(taskEvent('task:a', f.now()));
    await until(() => f.wakes.length === 1);
    await f.loop.idle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].events.length, 1);
    f.loop.push(taskEvent('task:a', f.now()));     // already handled: ignored forever
    f.advance(60_000); await f.loop.tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.wakes[0].events[0].id, 'task:a');
    await f.cleanup();
});
test('attention: user input during evaluation discards the late conclusion; events stay queued for the next look', async () => {
    let release!: (v: unknown) => void;
    const f = await attentionFixture();
    f.setReply(() => new Promise(r => { release = r; }));
    f.loop.push(taskEvent('task:b', f.now()));
    await until(() => !!release);
    f.loop.invalidate('user-input');
    release({ decision: 'wake', reason: 'x', evidence: ['task:b'], nextCheck: null, wakeHint: 'h' });
    await f.loop.idle();
    assert.equal(f.wakes.length, 0);
    assert.equal(f.loop.pending().length, 1);
    await f.cleanup();
});
test('attention: wake waits while the main character is busy and expires after ten minutes', async () => {
    let busy = true;
    const f = await attentionFixture({ canWake: () => !busy });
    f.setReply((input: any) => ({ decision: 'wake', reason: 'r', evidence: [input.events[0].id], nextCheck: null, wakeHint: 'h' }));
    f.loop.push(taskEvent('task:c', f.now()));
    await until(() => f.calls.length === 1); await f.loop.idle();
    assert.equal(f.wakes.length, 0);
    busy = false; f.advance(10_000); await f.loop.tick();
    assert.equal(f.wakes.length, 1);
    busy = true;
    f.loop.push(taskEvent('task:d', f.now())); await until(() => f.calls.length === 2); await f.loop.idle();
    f.advance(11 * 60_000); busy = false; await f.loop.tick();
    assert.equal(f.wakes.length, 1);
    await f.cleanup();
});
test('attention: quiet/paused blocks evaluation without losing task results; watches persist across restart', async () => {
    let blocked: string | undefined = 'quiet';
    const f = await attentionFixture({ eligible: () => blocked });
    f.loop.push(taskEvent('task:e', f.now()));
    await new Promise(r => setTimeout(r, 1300)); await f.loop.idle();
    assert.equal(f.calls.length, 0);
    assert.equal(f.loop.status.paused, 'quiet');
    blocked = undefined;
    f.setReply({ decision: 'schedule', reason: '等用户忙完', evidence: ['task:e'], nextCheck: new Date(f.now() + 30 * 60_000).toISOString(), watch: { title: '稍后汇报构建结果', condition: '用户空闲时' } });
    f.advance(60_000); await f.loop.tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.loop.watches().length, 1);
    f.loop.close();
    const restarted = new AttentionLoop({ ...f.deps });
    assert.equal(restarted.watches()[0].title, '稍后汇报构建结果');
    assert.equal(restarted.pending().length, 0, 'handled task event does not come back after restart');
    f.advance(31 * 60_000);
    await restarted.tick();
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls[1].events.some((e: AttentionEvent) => e.kind === 'watch'));
    restarted.close();
    await f.cleanup();
});
test('attention: screenshots are summarised as text only; pixels never reach storage', async () => {
    const f = await attentionFixture();
    f.setScreen({ shot: { id: 'screen:1', at: f.now(), dataUrl: 'data:image/jpeg;base64,UElYRUxT', signature: [] } });
    f.setReply({ decision: 'observe', reason: '用户在写代码', evidence: ['screen:1'], nextCheck: null, screenSummary: '编辑器里打开着一个TypeScript文件' });
    await f.loop.tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].screen.dataUrl.startsWith('data:image/'), true);
    assert.equal(f.loop.recentNotes()[0].text, '编辑器里打开着一个TypeScript文件');
    f.store.close();
    const bytes = await readFile(join(f.dir, 'companion.sqlite'));
    const wal = await readFile(join(f.dir, 'companion.sqlite-wal')).catch(() => Buffer.alloc(0));
    assert.equal(Buffer.concat([bytes, wal]).includes('UElYRUxT'), false);
    f.loop.close();
    await rm(f.dir, { recursive: true, force: true });
});

// ---------------- memory ----------------
test('extraction ops: verbatim ADD/UPDATE/DELETE only on offered candidates; legacy facts still accepted', () => {
    const user = '我现在不喝咖啡了，改喝乌龙茶';
    const r = parseExtraction({ ops: [{ op: 'UPDATE', id: 'm1', text: '改喝乌龙茶', importance: 4 }, { op: 'DELETE', id: 'm1' }, { op: 'ADD', text: '喜欢绿茶', importance: 3 }, { op: 'UPDATE', id: 'invented', text: '改喝乌龙茶' }, { op: 'NOOP' }], diary: '' }, user, new Set(['m1']));
    assert.deepEqual(r.ops.map(o => o.op), ['UPDATE', 'DELETE']);
    assert.deepEqual(parseExtraction({ facts: ['改喝乌龙茶'], diary: '好' }, user, new Set()).ops, [{ op: 'ADD', text: '改喝乌龙茶', importance: 3 }]);
    assert.throws(() => parseExtraction({ ops: 'x', diary: '' }, user, new Set()));
    assert.throws(() => parseJournal({ journal: '短' }));
    assert.equal(parseJournal({ title: '今天', journal: '今天他和我聊了很多关于钢琴的事情，我觉得很开心。'.repeat(2) }).title, '今天');
    const old = { id: 'a', kind: 'fact' as const, text: 'x', sourceId: 's', createdAt: '2020-01-01T00:00:00Z', valid: true };
    assert.ok(memoryBoost({ ...old, importance: 5 }, Date.now()) > memoryBoost(old, Date.now()));
    assert.ok(Math.abs(memoryBoost({ ...old, importance: 5 }, Date.now()) - memoryBoost(old, Date.now())) < 0.0003, 'boost stays below about one RRF rank');
    assert.equal(searchJournals('钢琴', [{ id: 'j', kind: 'journal', text: '今天弹钢琴给他听', createdAt: '', sourceIds: [] }, { id: 'n', text: '钢琴', createdAt: '', sourceIds: [] }])[0].id, 'j');
});

// ---------------- companion integration ----------------
const isAttention = (body: any) => String(body.messages[0].content).startsWith('你是GalAgent的后台注意力代理');
const isJournal = (body: any) => String(body.messages[0].content).includes('你在写自己的日记');
const isExtract = (body: any) => String(body.messages[0].content).includes('facts每项');
const json = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }], usage: { total_tokens: 10 } }), { status: 200 });
async function service(handler: (body: any) => unknown, runner?: AgentRunner, existingDir?: string) {
    const dir = existingDir || await mkdtemp(join(tmpdir(), 'galagent-dual-'));
    const bodies: any[] = [];
    const core = new CompanionService({
        dataDir: dir, workingDir: dir, agentRunner: runner,
        features: { attention: true, journal: true },
        credentials: { get: async () => 'fixture-key', set: async () => {} },
        embeddings: { encode: async (t: string) => t.includes('咖啡') ? [1, 0] : [0, 1], close: async () => {} },
        fetch: async (_url, init) => { const body = JSON.parse(String(init?.body)); bodies.push(body); return json(await handler(body)); },
    });
    await core.init();
    return { core, dir, bodies, cleanup: async () => { await core.close(); await rm(dir, { recursive: true, force: true }); } };
}
const chatReply = (text = '嗯嗯，我在呢。') => ({ text, expression: 'pleased', action: 'idle', name: '星棱' });
test('closed loop: delegated task result → attention judges → main character reports in her own voice', async () => {
    const runner: AgentRunner = { run: async () => ({ summary: '已把 notes.md 整理成三段并保存。', stopReason: 'end_turn', sessionId: 's', tools: [{ id: 't', title: 'Write', status: 'completed' }] }), probe: async () => ({ name: 'fixture', version: '1' }), close() {} };
    let wakeContext: any;
    const f = await service(body => {
        if (isExtract(body)) return { ops: [], diary: '' };
        if (isAttention(body)) { const input = JSON.parse(body.messages[1].content); const task = input.events.find((e: any) => e.kind === 'task'); return task ? { decision: 'wake', reason: '任务完成，值得告诉用户', evidence: [task.id], nextCheck: null, wakeHint: '整理任务完成了' } : { decision: 'silent', reason: '无', evidence: [], nextCheck: null }; }
        const dynamic = JSON.parse(String(body.messages[0].content).split('状态数据：')[1]);
        if (dynamic.wake) { wakeContext = dynamic.wake; return chatReply('notes.md 我帮你整理好啦，分成了三段～'); }
        return { ...chatReply('好，我交给后台去做。'), delegate: { task: '整理 notes.md' } };
    }, runner);
    assert.equal((await f.core.handle({ type: 'chat.send', text: '帮我整理一下 notes.md' })).ok, true);
    await f.core.waitForAgent();
    await until(() => f.core.getSnapshot().messages.some(m => m.source === 'initiative'), 5000);
    const snapshot = f.core.getSnapshot();
    assert.equal(snapshot.messages.at(-1)!.text, 'notes.md 我帮你整理好啦，分成了三段～');
    assert.equal(wakeContext.events[0].kind, 'task');
    assert.match(wakeContext.events[0].summary, /三段/);
    assert.equal(snapshot.status.attention!.wakes, 1);
    assert.ok(snapshot.status.pool!.peak >= 1 && snapshot.status.pool!.limit === 20);
    const attentionBody = f.bodies.find(isAttention);
    assert.equal(JSON.stringify(attentionBody).includes('状态数据'), false, 'attention context is separate from the main character context');
    await f.cleanup();
});
test('daily archive: a finished day is archived once after midnight, replaces yesterday’s transcript in context, survives restart and stays idempotent', async () => {
    const realNow = Date.now; let now = new Date(2026, 9, 28, 21, 0).getTime(); Date.now = () => now;
    let archives = 0; const contexts: any[] = [];
    const isDaily = (body: any) => String(body.messages[0].content).includes('每日档案');
    const handler = (body: any) => {
        if (isExtract(body)) return { ops: [], diary: '' };
        if (isDaily(body)) { archives++; return { title: '面试前夜', summary: '用户说明天上午有面试，有点紧张，想早点睡。', diary: '今天他说明天要面试，我陪他聊了一会儿，希望他睡个好觉。', mood: '期待', topics: ['面试'], highlights: ['约好明天问结果'], openThreads: ['问面试结果'], portrait: '正在找工作，认真又容易紧张。' }; }
        if (isAttention(body)) return { decision: 'silent', reason: '无', evidence: [], nextCheck: null };
        const system = String(body.messages[0].content); if (system.includes('状态数据：')) contexts.push(JSON.parse(system.split('\n状态数据：')[1]));
        return chatReply();
    };
    let f = await service(handler);
    try {
        for (const text of ['明天上午我要面试', '有点紧张', '我先去睡了']) assert.equal((await f.core.handle({ type: 'chat.send', text })).ok, true);
        await f.core.waitForBackground();
        await f.core.tick(); await f.core.waitForBackground();
        assert.equal(archives, 0, 'the day is not over yet');
        now = new Date(2026, 9, 29, 0, 0, 20).getTime();
        await f.core.tick(); await f.core.waitForBackground();
        assert.equal(archives, 1, 'archived right after midnight');
        const snap = f.core.getSnapshot();
        assert.equal(snap.archives![0].day, '2026-10-28');
        assert.equal(snap.archives![0].messageCount, 6);
        assert.equal(snap.diary.filter(d => d.kind === 'journal').length, 1);
        assert.ok(snap.bond!.achievements.find(a => a.id === 'archivist')!.unlockedAt);
        await f.core.close();
        f = await service(handler, undefined, f.dir);
        now += 120_000; await f.core.tick(); await f.core.waitForBackground();
        assert.equal(archives, 1, 'restart does not archive the same day again');
        const again = await f.core.handle({ type: 'archive.rebuild', day: '2026-10-28' });
        assert.equal(again.ok, true);
        const twice = await f.core.handle({ type: 'archive.rebuild', day: '2026-10-28' });
        assert.equal(twice.ok, true); await f.core.waitForBackground();
        assert.equal(archives, 2, 'double-click rebuild runs once');
        assert.equal((await f.core.handle({ type: 'archive.rebuild', day: '2026-10-29' })).ok, false, 'today cannot be archived early');
        now = new Date(2026, 9, 29, 9, 0).getTime();
        await f.core.handle({ type: 'chat.send', text: '我面试回来了' }); await f.core.waitForBackground();
        const ctx = contexts.at(-1);
        assert.equal(ctx.visibleHistoryData.some((m: any) => m.text === '明天上午我要面试'), false, 'yesterday is summarised, not verbatim');
        assert.equal(ctx.dailyArchives[0].title, '面试前夜');
        assert.match(ctx.userPortrait, /找工作/);
        assert.ok(f.core.getSnapshot().messages.some(m => m.text === '明天上午我要面试'), 'the full transcript is still stored locally');
        assert.equal(f.core.getSnapshot().memories.length, 0, 'a diary never becomes a user fact');
    } finally { Date.now = realNow; await f.core.close(); await rm(f.dir, { recursive: true, force: true }); }
});
test('daily archive: deleting a source record drops the archive at once and falls back to the verbatim day', async () => {
    const realNow = Date.now; let now = new Date(2026, 9, 28, 20, 0).getTime(); Date.now = () => now;
    const contexts: any[] = [];
    const handler = (body: any) => {
        const system = String(body.messages[0].content);
        if (isExtract(body)) return { ops: [{ op: 'ADD', text: '我叫阿青', importance: 4 }], diary: '' };
        if (system.includes('每日档案')) return { title: '认识', summary: '用户自我介绍叫阿青。', diary: '认识了阿青。', mood: '开心', topics: [], highlights: [], openThreads: [], portrait: '' };
        if (system.includes('状态数据：')) contexts.push(JSON.parse(system.split('\n状态数据：')[1]));
        return chatReply();
    };
    const f = await service(handler);
    try {
        await f.core.handle({ type: 'chat.send', text: '我叫阿青' }); await f.core.waitForBackground();
        now = new Date(2026, 9, 29, 10, 0).getTime(); await f.core.tick(); await f.core.waitForBackground();
        assert.equal(f.core.getSnapshot().archives!.length, 1);
        const memory = f.core.getSnapshot().memories.find(m => m.text === '我叫阿青')!;
        await f.core.handle({ type: 'memory.delete', id: memory.id });
        await f.core.handle({ type: 'chat.send', text: '你好' }); await f.core.waitForBackground();
        assert.deepEqual(contexts.at(-1).dailyArchives, [], 'the stale archive is never shown to the model');
        assert.equal(JSON.stringify(contexts.at(-1)).includes('阿青'), false);
    } finally { Date.now = realNow; await f.core.close(); await rm(f.dir, { recursive: true, force: true }); }
});
test('memory ops: UPDATE supersedes with history, DELETE invalidates without erasing source', async () => {
    let step = 0;
    const f = await service(body => {
        if (isExtract(body)) {
            const payload = JSON.parse(body.messages[1].content);
            step++;
            if (step === 1) return { ops: [{ op: 'ADD', text: '我喜欢咖啡', importance: 4 }], diary: '' };
            const old = payload.existing.find((m: any) => m.text === '我喜欢咖啡');
            if (step === 2) return { ops: [{ op: 'UPDATE', id: old.id, text: '我现在只喝乌龙茶', importance: 4 }], diary: '' };
            return { ops: [], diary: '' };
        }
        return isAttention(body) ? { decision: 'silent', reason: '无', evidence: [], nextCheck: null } : chatReply();
    });
    await f.core.handle({ type: 'chat.send', text: '我喜欢咖啡' }); await f.core.waitForBackground();
    assert.deepEqual(f.core.getSnapshot().memories.map(m => [m.text, m.importance]), [['我喜欢咖啡', 4]]);
    await f.core.handle({ type: 'chat.send', text: '其实咖啡我戒了，我现在只喝乌龙茶' }); await f.core.waitForBackground();
    assert.deepEqual(f.core.getSnapshot().memories.map(m => m.text), ['我现在只喝乌龙茶']);
    const history = await f.core.retrieve('咖啡', { includeHistorical: true });
    assert.ok(history.some(m => m.text === '我喜欢咖啡' && !m.valid && m.validTo));
    await f.cleanup();
});
test('companion: quiet and observation pause invalidate attention; clipboard ring cleared; blocklist sanitised', async () => {
    const f = await service(body => isAttention(body) ? { decision: 'silent', reason: '无', evidence: [], nextCheck: null } : chatReply());
    await f.core.handle({ type: 'chat.send', text: '你好' });
    await f.core.handle({ type: 'settings.update', settings: { observationEnabled: true } });
    f.core.offerClipboard({ text: '一段复制的文字', excluded: false });
    f.core.offerClipboard({ text: 'hunter2', excluded: true });
    assert.equal(f.core.getSnapshot().status.perception!.clipboardEntries, 1);
    await f.core.handle({ type: 'settings.update', settings: { observationEnabled: false } });
    assert.equal(f.core.getSnapshot().status.perception!.clipboardEntries, 0);
    f.core.offerClipboard({ text: '暂停时复制', excluded: false });
    assert.equal(f.core.getSnapshot().status.perception!.clipboardEntries, 0, 'paused observation collects nothing');
    await f.core.handle({ type: 'settings.update', settings: { captureBlocklist: [' KeePass ', 'KeePass', '', 'x'.repeat(200)] } });
    assert.deepEqual(f.core.getSnapshot().settings.captureBlocklist, ['KeePass', 'x'.repeat(80)]);
    await f.core.handle({ type: 'settings.update', settings: { quietUntil: Date.now() + 3600_000 } });
    assert.equal(f.core.getSnapshot().status.attention!.lastSkip, 'quiet');
    await f.core.tick();
    assert.equal(f.core.getSnapshot().status.attention!.paused, 'quiet');
    assert.equal(f.bodies.filter(isAttention).length, 0);
    await f.cleanup();
});
test('companion: screenshot sent to attention as image input only; raw pixels absent from the database', async () => {
    const f = await service(body => isAttention(body) ? { decision: 'observe', reason: '在写代码', evidence: [], nextCheck: null, screenSummary: '屏幕上是代码编辑器' } : chatReply());
    await f.core.handle({ type: 'chat.send', text: '你好' });
    f.core.setCapture(async () => ({ dataUrl: 'data:image/jpeg;base64,UkFXUElYRUxT', signature: Array(576).fill(3) }));
    await f.core.handle({ type: 'settings.update', settings: { observationEnabled: true } });
    f.core.setObservation({ available: true, observedAt: new Date().toISOString(), locked: false, appName: 'Code', idleSeconds: 3 });
    await f.core.tick();
    await f.core.attentionIdle();
    const body = f.bodies.find(isAttention);
    assert.ok(body, 'attention evaluated the changed screen');
    assert.equal(body.messages[1].content[1].type, 'image_url');
    assert.equal(f.core.getSnapshot().status.attention!.lastDecision, 'observe');
    const dir = f.dir;
    await f.core.close();
    const all = Buffer.concat([await readFile(join(dir, 'companion.sqlite')), await readFile(join(dir, 'companion.sqlite-wal')).catch(() => Buffer.alloc(0))]);
    assert.equal(all.includes('UkFXUElYRUxT'), false);
    assert.equal(all.includes(Buffer.from('屏幕上是代码编辑器')), true, 'only the text summary is kept');
    await rm(dir, { recursive: true, force: true });
});
test('browser perception: 4 metadata categories, active-tab pageContent navigation expiry, background/bookmark rejection, blocklist filtering', () => {
    let now = Date.parse('2026-10-17T12:00:00Z');
    const bp = new BrowserPerception(() => now);
    const sigs1 = bp.ingest({
        activeTab: { url: 'https://docs.moonshot.cn/guide/kimi-k2-5', title: 'Kimi K2.5 Docs', tabId: 1 },
        openTabs: [
            { tabId: 1, url: 'https://docs.moonshot.cn/guide/kimi-k2-5', title: 'Kimi K2.5 Docs', active: true },
            { tabId: 2, url: 'https://1password.com/vault', title: '1Password Vault', active: false },
            { tabId: 3, url: 'https://github.com/MoonshotAI/kimi-cli', title: 'kimi-cli', active: false },
        ],
        history: [
            { url: 'https://docs.moonshot.cn/guide/kimi-k2-5', title: 'Kimi K2.5 Docs', visitedAt: '2026-10-17T11:55:00Z' },
            { url: 'https://keepass.info/secret', title: 'KeePass', visitedAt: '2026-10-17T11:50:00Z' },
            { url: 'https://arxiv.org/abs/2501.00001', title: 'Multimodal Paper', visitedAt: '2026-10-17T10:00:00Z' },
        ],
        bookmarks: [
            { id: 'b1', title: 'Moonshot Docs', url: 'https://docs.moonshot.cn/' },
            { id: 'b2', title: '招商银行网上银行', url: 'https://cmbchina.com/' },
        ],
        bookmarkChange: { kind: 'added', id: 'b3', title: 'Kimi CLI Repo', url: 'https://github.com/MoonshotAI/kimi-cli' },
        pageContent: { url: 'https://docs.moonshot.cn/guide/kimi-k2-5', title: 'Kimi K2.5 Docs', text: 'Native multimodal video_url and ms:// support.', readable: true },
    }, { enabled: true });
    assert.equal(sigs1.length, 2, 'activeTab change + bookmark added');
    const snap1 = bp.snapshot();
    assert.equal(snap1.connected, true);
    assert.equal(snap1.tabCount, 2, '1Password tab filtered by blocklist');
    assert.equal(snap1.bookmarkCount, 2, 'online banking bookmark filtered, b1 + b3 kept');
    assert.equal(snap1.historyCount, 2, 'KeePass history filtered');
    assert.equal(snap1.pageContent?.readable, true);
    assert.match(snap1.pageContent?.excerpt || '', /video_url/);
    assert.equal(bp.queryHistory({ keyword: 'arxiv' }).length, 1);
    assert.equal(bp.queryHistory({ since: '2026-10-17T11:00:00Z' }).length, 1);
    // Background tab or bookmark/history must never masquerade as current pageContent
    bp.ingest({
        pageContent: { url: 'https://github.com/MoonshotAI/kimi-cli', title: 'kimi-cli', text: 'background text', fromBackgroundTab: true },
    }, { enabled: true });
    assert.equal(bp.getPageContent()?.url, 'https://docs.moonshot.cn/guide/kimi-k2-5');
    // Navigating activeTab to another URL immediately expires old pageContent
    now += 5000;
    bp.ingest({ activeTab: { url: 'https://github.com/MoonshotAI/kimi-cli', title: 'kimi-cli', tabId: 3 } }, { enabled: true });
    assert.equal(bp.getPageContent(), undefined, 'old pageContent expired on navigation');
});
test('companion: watch.add/dismiss, model watch output, window title change, browser.report, crash reunion and network recovery', async () => {
    let failNext = 0;
    const f = await service(body => {
        // Transient network errors are retried; only an outage outlasting every attempt fails the turn.
        if (failNext > 0) { failNext--; throw new Error('network down'); }
        if (isExtract(body)) return { ops: [], diary: '' };
        if (isAttention(body)) return { decision: 'silent', reason: '已知悉', evidence: [], nextCheck: null };
        return { ...chatReply('好的，我帮你盯着这个构建页面～'), watch: { title: '留意 CI 构建结果', condition: '页面显示成功或失败时' } };
    });
    // 1. Model returns watch in chat reply + manual watch.add / watch.dismiss
    assert.equal((await f.core.handle({ type: 'chat.send', text: '帮我留意一下 CI 构建结果' })).ok, true);
    assert.equal(f.core.getSnapshot().watches?.length, 1);
    assert.equal(f.core.getSnapshot().watches?.[0].title, '留意 CI 构建结果');
    assert.equal((await f.core.handle({ type: 'watch.add', title: '提醒我喝水', condition: '半小时后', checkAfterMinutes: 30 })).ok, true);
    assert.equal(f.core.getSnapshot().watches?.length, 2);
    const waterId = f.core.getSnapshot().watches!.find(w => w.title === '提醒我喝水')!.id;
    assert.equal((await f.core.handle({ type: 'watch.dismiss', id: waterId })).ok, true);
    assert.equal(f.core.getSnapshot().watches?.length, 1);

    // 2. Window title change within same appName triggers window event when windowTitlesEnabled=true
    await f.core.handle({ type: 'settings.update', settings: { observationEnabled: true, windowTitlesEnabled: true } });
    f.core.setObservation({ available: true, observedAt: new Date().toISOString(), locked: false, appName: 'Code', title: 'companion.ts - galagent', idleSeconds: 1 });
    f.core.setObservation({ available: true, observedAt: new Date(Date.now() + 1000).toISOString(), locked: false, appName: 'Code', title: 'browser.ts - galagent', idleSeconds: 1 });
    assert.ok(f.core.getSnapshot().status.attention!.pendingEvents >= 1);

    // 3. Browser report & disconnect
    await f.core.handle({ type: 'browser.report', report: { activeTab: { url: 'https://example.com/ci', title: 'CI Build #42' }, openTabs: [{ url: 'https://example.com/ci', title: 'CI Build #42', active: true }], pageContent: { url: 'https://example.com/ci', title: 'CI Build #42', text: 'Build running...', readable: true } } });
    assert.equal(f.core.getSnapshot().browser?.connected, true);
    assert.equal(f.core.getSnapshot().browser?.pageContent?.readable, true);
    await f.core.handle({ type: 'browser.disconnect' });
    assert.equal(f.core.getSnapshot().browser?.connected, false);

    // 4. Network error & online recovery event
    failNext = 3;
    const failed = await f.core.handle({ type: 'chat.send', text: '测试断网' });
    assert.equal(failed.ok, false);
    assert.equal(f.core.getSnapshot().status.online, false);
    const recovered = await f.core.handle({ type: 'chat.send', text: '测试恢复' });
    assert.equal(recovered.ok, true);
    assert.equal(f.core.getSnapshot().status.online, true);

    // 5. Simulate abnormal crash (session-lifecycle left active=true) and verify crash-reunion on restart
    const dir = f.dir;
    await f.core.close();
    const tempStore = new Store(dir);
    tempStore.put('state', 'session-lifecycle', { active: true, startedAt: new Date(Date.now() - 60_000).toISOString() });
    tempStore.close();
    const attentionInputs: any[] = [];
    const restarted = new CompanionService({
        dataDir: dir, workingDir: dir,
        features: { attention: true, journal: true },
        credentials: { get: async () => 'fixture-key', set: async () => {} },
        embeddings: { encode: async () => [1, 0], close: async () => {} },
        fetch: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            if (isAttention(body)) { attentionInputs.push(JSON.parse(body.messages[1].content)); return json({ decision: 'silent', reason: '重逢已记录', evidence: [], nextCheck: null }); }
            return json(chatReply());
        },
    });
    await restarted.init();
    await until(() => attentionInputs.length >= 1, 4000);
    assert.ok(attentionInputs[0].events.some((e: any) => e.kind === 'reunion' && String(e.id).startsWith('crash-reunion:')));
    await restarted.close();
    await rm(dir, { recursive: true, force: true });
});

test('directory guard (Master Design 9.3) and Edge Native Messaging bridge/manifest helper work end-to-end', async () => {
    const f = await service(() => chatReply());
    const secretFolder = join(f.dir, 'private-notes');
    try {
        assert.equal(f.core.getSnapshot().agent?.mode, 'full-access');
        assert.equal(f.core.getSnapshot().agent?.policyVersion, 1);

        const updated = await f.core.handle({
            type: 'settings.update',
            settings: { forbiddenPaths: [secretFolder] },
        });
        assert.equal(updated.ok, true);
        assert.equal(f.core.getSnapshot().agent?.mode, 'directory-guarded');
        assert.equal(f.core.getSnapshot().agent?.policyVersion, 2);
        assert.deepEqual(f.core.getSnapshot().agent?.forbiddenPaths, [secretFolder]);

        // Configuring agent cwd inside forbidden folder is rejected
        const rejectedCwd = await f.core.handle({
            type: 'agent.configure',
            cwd: join(secretFolder, 'sub'),
        });
        assert.equal(rejectedCwd.ok, false);
        assert.match(rejectedCwd.error || '', /禁止访问/);

        // Clearing forbiddenPaths returns mode to full-access and increments policyVersion
        await f.core.handle({
            type: 'settings.update',
            settings: { forbiddenPaths: [] },
        });
        assert.equal(f.core.getSnapshot().agent?.mode, 'full-access');
        assert.equal(f.core.getSnapshot().agent?.policyVersion, 3);

        // Edge Native Messaging bridge writer & manifest builder
        // @ts-expect-error untyped mjs script
        const { writeBrowserBridgeReport } = await import('../../extensions/edge-companion/native-host.mjs');
        // @ts-expect-error untyped mjs script
        const { buildEdgeCompanionManifest } = await import('../../scripts/register-edge-companion.mjs');
        const bridgePath = writeBrowserBridgeReport(
            { activeTab: { url: 'https://example.com/bridge', title: 'Bridge Test' } },
            f.dir,
        );
        const savedBridge = JSON.parse(await readFile(bridgePath, 'utf8'));
        assert.equal(savedBridge.activeTab.url, 'https://example.com/bridge');
        assert.ok(savedBridge.observedAt);

        const manifestInfo = buildEdgeCompanionManifest({
            extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            outputDir: f.dir,
        });
        assert.equal(manifestInfo.manifest.name, 'com.galagent.edge_companion');
        assert.deepEqual(manifestInfo.manifest.allowed_origins, [
            'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/',
        ]);
    } finally {
        await f.core.close();
        await rm(f.dir, { recursive: true, force: true });
    }
});

test('Mira proxy auto-start, TTS voice synthesis, and desktop Live2D roaming commands work end-to-end', async () => {
    const { resolveLocalProxyDir, ensureLocalProxyRunning } = await import('../../runtime/main/proxy-autostart');
    const {
        cleanTtsText,
        isXiaomiMimoTts,
        resolveMimoVoice,
        buildMimoStyleInstruction,
        resolveTtsEndpoint,
        synthesizeTtsSpeech,
    } = await import('../../runtime/main/tts');
    const { validateCommand } = await import('../../runtime/main/validation');

    // 1. Proxy auto-start checks
    assert.equal(resolveLocalProxyDir('https://api.moonshot.cn/v1', 'C:/Users/User/Desktop'), null);
    assert.deepEqual(resolveLocalProxyDir('http://127.0.0.1:18890/v1', 'C:/Users/User/Desktop'), {
        port: 18890,
        dir: join('C:/Users/User/Desktop', 'mira反代', 'kimi-api'),
    });
    const nonLocalRes = await ensureLocalProxyRunning({
        baseUrl: 'https://api.moonshot.cn/v1',
        desktopDir: 'C:/Users/User/Desktop',
    });
    assert.equal(nonLocalRes.ok, true);
    assert.equal(nonLocalRes.status, 'not-local-proxy');

    const localHealthy = await ensureLocalProxyRunning({
        baseUrl: 'http://127.0.0.1:18890/v1',
        desktopDir: 'C:/Users/User/Desktop',
        fetchImpl: async () => new Response('{"ok":true,"upstream":"https://api.kimi.com/coding/v1"}', { status: 200 }),
    });
    assert.equal(localHealthy.ok, true);
    assert.equal(localHealthy.status, 'already-running');
    assert.equal(localHealthy.port, 18890);

    // 2. TTS text cleaning, endpoint resolution, and HTTP / Xiaomi MiMo synthesis
    assert.equal(cleanTtsText('```js\nconsole.log(1)\n```\n哼，*这首曲子*只弹给你听！'), '哼，这首曲子只弹给你听！');
    assert.equal(resolveTtsEndpoint('http://127.0.0.1:9880/v1', 'tts-1'), 'http://127.0.0.1:9880/v1/audio/speech');
    assert.equal(resolveTtsEndpoint('https://api.xiaomimimo.com/v1', 'mimo-v2.5-tts'), 'https://api.xiaomimimo.com/v1/chat/completions');
    assert.equal(resolveTtsEndpoint('http://127.0.0.1:9880/tts'), 'http://127.0.0.1:9880/tts');
    assert.equal(isXiaomiMimoTts('https://api.xiaomimimo.com/v1', 'mimo-v2.5-tts'), true);
    assert.equal(resolveMimoVoice('冰糖'), '冰糖');
    assert.equal(resolveMimoVoice('茉莉'), '茉莉');
    assert.equal(resolveMimoVoice('unknown-custom-voice'), '冰糖');
    assert.ok(buildMimoStyleInstruction('flustered', 1).includes('害羞'));
    const directed = buildMimoStyleInstruction('neutral', 1, undefined, { name: '团子', tagline: '猫室友', voiceStyle: '慵懒声线' });
    assert.ok(directed.includes('团子') && directed.includes('慵懒声线') && !directed.includes('可黎'));

    const fakeWav = new Uint8Array(64);
    fakeWav.set([82, 73, 70, 70, 56, 0, 0, 0, 87, 65, 86, 69]);
    const ttsHttp = await synthesizeTtsSpeech({
        text: '哼，这首刚练好的曲子，我只弹给你一个人听哦。',
        ttsBaseUrl: 'http://127.0.0.1:9880/v1',
        ttsModel: 'tts-1',
        ttsVoice: 'zh-CN-XiaoxiaoNeural',
        ttsSpeed: 1.05,
        fetchImpl: async () => new Response(fakeWav, { status: 200, headers: { 'content-type': 'audio/wav' } }),
    });
    assert.equal(ttsHttp.ok, true);
    assert.equal(ttsHttp.provider, 'http');
    assert.equal(ttsHttp.mimeType, 'audio/wav');
    assert.ok(ttsHttp.audioBase64 && ttsHttp.audioBase64.length > 32);

    let capturedMimoPayload: any = null;
    const ttsMimo = await synthesizeTtsSpeech({
        text: '哼，这首刚练好的曲子，我只弹给你一个人听哦。',
        ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
        ttsModel: 'mimo-v2.5-tts',
        ttsVoice: '冰糖',
        ttsSpeed: 1,
        expression: 'pleased',
        ttsApiKey: 'sk-mimo-fixture',
        fetchImpl: async (_url, init) => {
            capturedMimoPayload = JSON.parse(String(init?.body || '{}'));
            return new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                role: 'assistant',
                                audio: {
                                    id: 'audio_1',
                                    data: Buffer.from(fakeWav).toString('base64'),
                                },
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
            );
        },
    });
    assert.equal(ttsMimo.ok, true);
    assert.equal(ttsMimo.provider, 'http');
    assert.equal(ttsMimo.mimeType, 'audio/wav');
    assert.equal(capturedMimoPayload.model, 'mimo-v2.5-tts');
    assert.equal(capturedMimoPayload.audio.voice, '冰糖');
    assert.equal(capturedMimoPayload.messages[1].role, 'assistant');
    assert.equal(capturedMimoPayload.messages[1].content, '哼，这首刚练好的曲子，我只弹给你一个人听哦。');

    // 3. CompanionService pet.roam & tts.configure commands
    const f = await service(() => chatReply());
    try {
        const validRoam = validateCommand({ type: 'pet.roam', active: true, direction: 1 });
        assert.equal(validRoam.type, 'pet.roam');
        const roamRes = await f.core.handle(validRoam);
        assert.equal(roamRes.ok, true);
        assert.equal(f.core.getSnapshot().visual.action, 'run');
        assert.equal(f.core.getSnapshot().settings.roamingEnabled, true);

        const validTtsCfg = validateCommand({
            type: 'tts.configure',
            ttsEnabled: true,
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            ttsModel: 'mimo-v2.5-tts',
            ttsVoice: '冰糖',
            ttsSpeed: 1.0,
        });
        const ttsCfgRes = await f.core.handle(validTtsCfg);
        assert.equal(ttsCfgRes.ok, true);
        const snap = f.core.getSnapshot();
        assert.equal(snap.settings.ttsEnabled, true);
        assert.equal(snap.settings.ttsBaseUrl, 'https://api.xiaomimimo.com/v1');
        assert.equal(snap.settings.ttsModel, 'mimo-v2.5-tts');
        assert.equal(snap.settings.ttsVoice, '冰糖');
        assert.equal(snap.settings.ttsSpeed, 1.0);

        const validNativeCfg = validateCommand({
            type: 'config.save',
            baseUrl: 'https://api.moonshot.cn/v1',
            model: 'kimi-k2.5',
            mode: 'native-api',
            apiKey: 'sk-native-fixture',
        });
        const nativeRes = await f.core.handle(validNativeCfg);
        assert.equal(nativeRes.ok, true);
        const nativeSnap = f.core.getSnapshot();
        assert.equal(nativeSnap.provider.mode, 'native-api');
        assert.equal(nativeSnap.provider.baseUrl, 'https://api.moonshot.cn/v1');
        assert.equal(nativeSnap.provider.model, 'kimi-k2.5');
        assert.equal(nativeSnap.provider.toolCount, 25);

        const { OpenAIToolAgent } = await import('../../runtime/core/openai-agent');
        let capturedNativeToolBody: any = null;
        const nativeAgent = new OpenAIToolAgent({
            provider: () => ({ baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.5', mode: 'native-api' }),
            credentials: { get: async () => 'sk-native-fixture' },
            ask: async () => ({}),
            fetch: async (_url, init) => {
                capturedNativeToolBody = JSON.parse(String(init?.body || '{}'));
                return new Response(
                    JSON.stringify({
                        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '原生API已通过GalAgent本地挂载25工具完成执行' } }],
                        usage: { total_tokens: 15 },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } }
                );
            },
        });
        const nativeRun = await nativeAgent.run('测试原生API本地工具绑定', f.dir, new AbortController().signal);
        nativeAgent.close();
        assert.equal(nativeRun.stopReason, 'end_turn');
        assert.equal(capturedNativeToolBody.tools.length, 25);
        assert.equal('thinking' in capturedNativeToolBody, false);
        assert.equal(capturedNativeToolBody.max_tokens, 4096);
        assert.ok(String(capturedNativeToolBody.messages[0].content).includes('25个本地工具'));
    } finally {
        await f.core.close();
        await rm(f.dir, { recursive: true, force: true });
    }
});


