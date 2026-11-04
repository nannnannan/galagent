import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import { addFindings, addManual, anglesFor, appTotals, canRun, diverse, emptyResearch, gatherSignals, mergePlan, noteApp, parseFindings, parsePlan, pickInterest, rateFinding, removeInterest, shareable, RESEARCH_LIMITS, type Interest } from '../../runtime/core/research';

let n = 0; const id = () => 'id' + (++n);
const interest = (topic: string, extra: Partial<Interest> = {}): Interest => ({ id: id(), topic, kind: 'hobby', why: 'x', sources: ['chat'], weight: 3, angles: [{ angle: '新动态', query: topic + ' 最新' }, { angle: '活动与日程', query: topic + ' 活动' }, { angle: '社区讨论', query: topic + ' 讨论' }], createdAt: 0, ...extra });

test('signals gather every channel that has data, bounded, apps as names and minutes only', () => {
  const s = gatherSignals({ memories: [{ text: '用户喜欢胶片相机', kind: 'fact', valid: true }, { text: '我很担心他', kind: 'reflection', valid: true }, { text: '旧的', kind: 'fact', valid: false }], archives: [{ day: '2026-11-01', topics: ['胶片', '面试'], highlights: ['去了展览'], openThreads: ['面试结果'] }, { day: '2026-11-02', topics: ['胶片'], highlights: [], openThreads: [] }], apps: { 'Lightroom.exe': 120, 'Code.exe': 300 }, browser: { history: [{ title: '富士 X100VI 评测', url: 'https://www.dpreview.com/x' }, { title: '胶片冲洗', url: 'https://www.dpreview.com/y' }], bookmarks: [{ title: '胶片论坛' }] }, tasks: ['整理相册'], schedules: ['周六去冲胶卷'], manual: ['城市漫步'] });
  assert.deepEqual(s.chat, ['用户喜欢胶片相机']);
  assert.deepEqual((s.archive as any).topics.slice(0, 1), ['胶片×2']);
  assert.deepEqual(s.apps, ['Code.exe 300分钟', 'Lightroom.exe 120分钟']);
  assert.deepEqual((s.browser as any).domains, ['dpreview.com×2']);
  assert.deepEqual(Object.keys(s.counts).sort(), ['apps', 'archive', 'browser', 'chat', 'manual', 'schedule', 'tasks']);
  assert.deepEqual(Object.keys(gatherSignals({ memories: [], archives: [], tasks: [], schedules: [], manual: [] }).counts), []);
});

test('app usage keeps only names and minutes for 14 days, each sample capped', () => {
  let u = {};
  u = noteApp(u, '2026-11-01', 'Steam.exe', 2); u = noteApp(u, '2026-11-01', 'Steam.exe', 99); u = noteApp(u, '2026-11-02', 'Code.exe', 1);
  assert.deepEqual(appTotals(u), { 'Steam.exe': 7, 'Code.exe': 1 });
  for (let d = 1; d <= 20; d++) u = noteApp(u, `2026-10-${String(d).padStart(2, '0')}`, 'x', 1);
  assert.equal(Object.keys(u).length, 14);
});

test('plan parsing keeps only evidenced, searchable interests; merge honours blocks, pins and manual ones', () => {
  const plan = parsePlan(JSON.stringify({ interests: [{ topic: '胶片相机', kind: 'hobby', why: '聊天和浏览都出现', sources: ['chat', 'browser', 'bogus'], weight: 9, angles: [{ angle: '新动态', query: '胶片相机 新品' }] }, { topic: '没来源', sources: [] }, { topic: '前司八卦', sources: ['chat'], weight: 2 }], dailyLife: { summary: '夜猫子', routines: ['晚睡'], focus: ['面试'] } }));
  assert.equal(plan.interests.length, 2);
  assert.deepEqual(plan.interests[0].sources, ['chat', 'browser']); assert.equal(plan.interests[0].weight, 5);
  let l = addManual(emptyResearch(), '城市漫步', 0, id);
  l = { ...l, blocked: ['前司八卦'] };
  l = mergePlan(l, plan, 1000, id);
  assert.deepEqual(l.interests.map(i => i.topic).sort(), ['城市漫步', '胶片相机']);
  assert.equal(l.daily?.summary, '夜猫子');
  const film = l.interests.find(i => i.topic === '胶片相机')!;
  l = removeInterest(l, film.id);
  assert.ok(l.blocked.includes('胶片相机'));
  assert.ok(!mergePlan(l, plan, 2000, id).interests.some(i => i.topic === '胶片相机'), 'a removed interest never comes back');
});

test('one run: two rotating angles, results from different sites, at most 4 runs a day with a gap', () => {
  const it = interest('胶片相机');
  assert.deepEqual(anglesFor(it, 0).map(a => a.angle), ['新动态', '活动与日程']);
  assert.deepEqual(anglesFor(it, 1).map(a => a.angle), ['活动与日程', '社区讨论']);
  assert.deepEqual(diverse([{ url: 'https://a.com/1' }, { url: 'https://www.a.com/2' }, { url: 'https://b.com/1' }, { url: 'bad' }], 3).map(r => r.url), ['https://a.com/1', 'https://b.com/1']);
  let l = { ...emptyResearch(), interests: [it] };
  const now = 10 * 86400_000;
  assert.ok(canRun(l, now));
  l = addFindings(l, it.id, [], now);
  assert.ok(!canRun(l, now + 60_000), 'gap between runs');
  l = { ...l, runs: Array.from({ length: RESEARCH_LIMITS.runsPerDay }, (_, i) => now - i * 3 * 3600_000) };
  assert.ok(!canRun(l, now + 2 * 3600_000), 'daily cap');
  assert.equal(pickInterest({ ...l, interests: [{ ...it, lastResearchedAt: now }] }, now + 3600_000), undefined, 'not again within 12 h');
});

test('findings must cite a URL that was really fetched; two sites raise confidence; ratings move the interest weight', () => {
  const it = interest('胶片相机');
  const allowed = new Set(['https://a.com/1', 'https://b.com/2']);
  const found = parseFindings(JSON.stringify({ findings: [
    { title: '富士发布新胶片', summary: '11 月上市，36 张', why: '你在用富士', sources: [{ title: 'A', url: 'https://a.com/1' }, { title: 'B', url: 'https://b.com/2' }], confidence: 5 },
    { title: '编的', summary: '没来源', sources: [{ title: 'X', url: 'https://made-up.com' }], confidence: 5 },
    { title: '单一来源', summary: '只有一家说', sources: [{ title: 'A', url: 'https://a.com/1' }], confidence: 5 },
  ] }), it, '新动态', allowed, 1000, id);
  assert.equal(found.length, 2);
  assert.equal(found[0].confidence, 5); assert.equal(found[1].confidence, 3, 'one site caps confidence at 3');
  let l = addFindings({ ...emptyResearch(), interests: [it] }, it.id, found, 1000);
  assert.equal(shareable(l, 2000)[0].title, '富士发布新胶片');
  l = rateFinding(l, found[0].id, 'down');
  assert.equal(l.interests[0].weight, 2);
  assert.ok(!shareable(l, 2000).some(f => f.id === found[0].id), 'a thumbs-down finding is never brought up');
  l = rateFinding(l, found[0].id, 'up');
  assert.equal(l.interests[0].weight, 4);
});

// ---------------------------------------------------------------- end to end, fake model and fake web
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const say = (content: unknown) => json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }] });
const bing = (items: [string, string, string][]) => `<html><ol id="b_results">${items.map(([href, title, snip]) => `<li class="b_algo"><h2><a href="${href}">${title}</a></h2><div class="b_caption"><p>${snip}</p></div></li>`).join('')}</ol></html>`;

test('end to end: TA plans interests from its channels, researches one from several sites, and the notes reach chat context', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-research-'));
  const prompts: string[] = [], queries: string[] = []; let helpers = 0;
  const core = new CompanionService({ dataDir: dir, workingDir: dir, features: { research: true }, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} },
    webFetch: (async (url: string) => {
      const u = new URL(url);
      if (u.hostname.includes('bing.com')) { queries.push(u.searchParams.get('q') || ''); return new Response(bing([['https://film.example/news', '富士新胶片', '11 月上市'], ['https://cam.example/review', '胶片评测', '对比'], ['https://film.example/other', '同站', '重复']]), { headers: { 'content-type': 'text/html' } }); }
      return new Response(`<html><title>${u.hostname}</title><article>富士 11 月推出新款胶片，每卷 36 张。</article></html>`, { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch,
    fetch: async (_u, init) => {
      const body = JSON.parse(String(init?.body)), system = String(body.messages[0].content), user = String(body.messages.at(-1).content);
      prompts.push(system.slice(0, 20));
      if (system.includes('facts每项')) return json({ choices: [{ message: { content: '{"facts":[],"diary":""}' } }] });
      if (system.startsWith('你是桌面陪伴角色的“兴趣研究员”。下面 signals')) { assert.match(user, /胶片/); return say({ interests: [{ topic: '胶片相机', kind: 'hobby', why: '聊天里说过', sources: ['chat'], weight: 4, angles: [{ angle: '新动态', query: '胶片相机 新品' }, { angle: '社区讨论', query: '胶片相机 讨论' }] }], dailyLife: { summary: '喜欢拍照的夜猫子', routines: [], focus: [] } }); }
      if (system.startsWith('你是桌面陪伴角色（主代理）派出去的并行助手')) {
        helpers++;
        const tools = body.messages.filter((m: any) => m.role === 'tool'), goal = JSON.parse(String(body.messages[1].content)).goal as string;
        const query = /搜索「([^」]+)」/.exec(goal)![1];
        const callTool = (name: string, args: unknown) => json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't' + tools.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
        if (tools.length === 0) return callTool('web_search', { query });
        if (tools.length === 1) return callTool('read_webpage', { url: JSON.parse(tools[0].content).results[tools.length === 1 && query.includes('讨论') ? 1 : 0].url });
        assert.match(String(tools[1].content), /富士 11 月推出新款胶片/);
        const read = JSON.parse(tools[1].content).url;
        return say({ gist: '富士 11 月出新胶片，每卷 36 张', points: ['11 月上市'], sources: [{ title: read, url: read }] });
      }
      if (system.startsWith('你是桌面陪伴角色的“兴趣研究员”，在替用户研究')) { assert.match(user, /富士 11 月出新胶片/); assert.ok(!user.includes('<article>') && !user.includes('富士 11 月推出新款胶片，每卷'), 'the synthesizer sees helper points, not raw pages'); return say({ findings: [{ title: '富士 11 月出新胶片', summary: '每卷 36 张', why: '你喜欢胶片', sources: [{ title: 'A', url: 'https://film.example/news' }, { title: 'B', url: 'https://cam.example/review' }], confidence: 5 }] }); }
      return say({ text: '好呀', expression: 'neutral', action: 'idle' });
    } });
  await core.init();
  try {
    await core.handle({ type: 'memory.remember', text: '用户喜欢胶片相机' });
    (core as any).state.identity.onboarding = 'ready';
    await core.researchStep(Date.now(), true); // plan + first research in one forced step
    const r = core.getSnapshot().research!;
    assert.equal(r.interests[0].topic, '胶片相机');
    assert.equal(r.daily?.summary, '喜欢拍照的夜猫子');
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].confidence, 5);
    assert.deepEqual(queries.sort(), ['胶片相机 新品', '胶片相机 讨论'].sort(), 'two angles, interest words only');
    assert.equal(helpers, 6, 'one helper per angle, three rounds each');
    assert.ok(r.channels.find(c => c.id === 'chat')!.count >= 1);
    // the note is offered to TA in chat
    let context = '';
    (core as any).options.fetch = async (_u: string, init: RequestInit) => { const b = JSON.parse(String(init.body)); context = String(b.messages[0].content); return say({ text: '对了，富士出新胶片了', expression: 'pleased', action: 'idle' }); };
    await core.handle({ type: 'chat.send', text: '最近有啥新鲜事' });
    assert.match(context, /researchNotes/); assert.match(context, /富士 11 月出新胶片/);
    // switching research off blocks it; removing the interest drops its notes
    await core.handle({ type: 'settings.update', settings: { researchEnabled: false } });
    assert.equal(core.getSnapshot().research!.blocked, '主动研究已关闭');
    await core.handle({ type: 'research.removeInterest', id: r.interests[0].id });
    assert.equal(core.getSnapshot().research!.findings.length, 0);
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});
