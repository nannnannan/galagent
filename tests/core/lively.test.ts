import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import { advance, circadianEnergy, freshVitality, react, view, LONELY_AFTER_MS } from '../../runtime/core/vitality';
import { dayOf, emptyLedger, markLife, nightOf, pickLife, recallCandidate, type LifeInput } from '../../runtime/core/life';
import { defaultRoutine, hobbies, normalizeRoutine, parseRoutineLines, routineAt } from '../../runtime/shared/routine';
import { splitReply } from '../../runtime/shared/reply';
import { Murmurer, murmurFor } from '../../runtime/renderer/fun';
import { normalizePersona } from '../../runtime/shared/personas';

const H = 3600_000;
const at = (h: number, m = 0, base = new Date(2026, 9, 31)) => { const d = new Date(base); d.setHours(h, m, 0, 0); return d; };

test('energy follows the clock; mood drifts back and sinks only when the user is around but ignoring the character', () => {
  assert.ok(circadianEnergy(10) > 80 && circadianEnergy(3) < 20 && circadianEnergy(14) < circadianEnergy(10));
  const night = freshVitality(at(23).getTime());
  assert.ok(advance(night, at(23).getTime() + 3 * H, false).energy < 25, 'tired by 2am');
  const start = { ...freshVitality(at(10).getTime()), mood: 62 };
  const ignored = advance(start, start.updatedAt + LONELY_AFTER_MS + 2 * H, true), away = advance(start, start.updatedAt + LONELY_AFTER_MS + 2 * H, false);
  assert.ok(ignored.mood < 50 && away.mood > 55, 'only lonely when you are right there');
  assert.equal(view(ignored).tone, 'sulky');
  const petted = react(ignored, 'pat', ignored.updatedAt);
  assert.ok(petted.mood > ignored.mood + 10, 'a pat helps most when sulky');
  const chatted = react(ignored, 'chat', ignored.updatedAt);
  assert.ok(chatted.mood >= ignored.mood + 10, 'talking after a long silence lifts the mood');
});
test('goodnight puts the character to sleep; a touch wakes it groggy; morning ends sleep by itself', () => {
  const t = at(23, 40).getTime();
  const asleep = react(freshVitality(t), 'goodnight', t);
  assert.equal(view(asleep).tone, 'asleep');
  const woken = react(asleep, 'tap', t + 60_000);
  assert.equal(woken.asleepSince, undefined); assert.equal(view(woken).tone, 'sleepy'); assert.match(view(woken).label, /叫醒/);
  assert.equal(advance(woken, t + 30 * 60_000, false).wokenAt, undefined, 'groggy only for a while');
  const morning = advance(asleep, at(8, 0, new Date(2026, 10, 1)).getTime(), false);
  assert.equal(morning.asleepSince, undefined);
});
test('routine: derived from likes, wraps past midnight, and a card may write its own', () => {
  assert.deepEqual(hobbies('星空、化石、做实验'), ['星空', '化石']);
  const derived = defaultRoutine('弹钢琴');
  assert.ok(derived.some(e => e.activity === '弹钢琴时间'));
  assert.equal(routineAt(derived, at(1, 0))!.current.activity, '睡觉');
  assert.equal(routineAt(derived, at(12, 50))!.current.action, 'sleep');
  const own = parseRoutineLines('20:00 练琴\n07:30 起床\n13:00 午睡');
  assert.deepEqual(own.map(e => e.at), ['07:30', '13:00', '20:00']);
  assert.equal(own[1].action, 'sleep');
  assert.throws(() => parseRoutineLines('早上 起床'), /07:30/);
  assert.throws(() => normalizeRoutine([{ at: '25:00', activity: 'x' }]), /日程时间无效/);
  assert.equal(normalizePersona({ name: '阿福', routine: own }).routine!.length, 3);
});
test('replies split into 2–3 short parts only for casual text', () => {
  assert.deepEqual(splitReply('嘿嘿\n\n今天怎么样？'), ['嘿嘿', '今天怎么样？']);
  assert.deepEqual(splitReply('a\n\nb\n\nc\n\nd'), ['a', 'b', 'c\nd']);
  assert.equal(splitReply('就一段'), undefined);
  assert.equal(splitReply('步骤：\n\n1. 打开\n2. 关闭'), undefined, 'lists stay whole');
  assert.equal(splitReply('```js\nx\n```\n\n好了'), undefined, 'code stays whole');
  assert.equal(splitReply('长'.repeat(200) + '\n\n短'), undefined, 'long paragraphs stay whole');
});
test('murmurs: by app kind only, after a dwell, with cooldowns', () => {
  assert.equal(murmurFor('Code.exe')?.category, 'code');
  assert.equal(murmurFor('C:\\Program Files\\Spotify\\Spotify.exe')?.category, 'music');
  assert.equal(murmurFor('notepad.exe'), undefined);
  const m = new Murmurer(1000, 10_000, 60_000);
  assert.equal(m.note('Code.exe', 0), undefined);
  assert.equal(m.note('Code.exe', 500), undefined, 'still dwelling');
  assert.ok(m.note('Code.exe', 1500), 'after the dwell');
  assert.equal(m.note('Code.exe', 3000), undefined, 'once per stay');
  m.note('chrome.exe', 4000); assert.equal(m.note('chrome.exe', 5500), undefined, 'global cooldown');
  m.note('Code.exe', 20_000); assert.equal(m.note('Code.exe', 21_500), undefined, 'category cooldown');
  m.note('chrome.exe', 30_000); assert.ok(m.note('chrome.exe', 31_500));
});

const base = (over: Partial<LifeInput> = {}): LifeInput => ({ now: at(9), ledger: emptyLedger(), shareDailyLimit: 1, recallEveryDays: 3, goodnightAt: '23:30', muted: () => false, networkAllowed: true, hasRecallCandidate: false, archivePending: false, random: () => 0, ...over });
test('life moments: morning first, waits for yesterday\'s archive until 10:30, once a day', () => {
  assert.equal(pickLife(base()), 'morning');
  assert.equal(pickLife(base({ archivePending: true })), undefined, 'waits for the archive');
  assert.equal(pickLife(base({ archivePending: true, now: at(10, 40) })), 'morning', 'but not forever');
  const done = markLife(emptyLedger(), 'morning', at(9));
  assert.equal(done.morning, dayOf(at(9)));
  assert.notEqual(pickLife(base({ ledger: done })), 'morning');
  assert.equal(pickLife(base({ muted: t => t === 'greeting' })), 'share', 'greeting muted → the next moment');
});
test('goodnight after bedtime, counted per night across midnight; topics, network and limits gate the rest', () => {
  assert.equal(pickLife(base({ now: at(23, 45) })), 'goodnight');
  const said = markLife(emptyLedger(), 'goodnight', at(23, 45));
  assert.equal(nightOf(at(0, 30, new Date(2026, 10, 1))), said.goodnight, '00:30 belongs to the same night');
  assert.equal(pickLife(base({ now: at(0, 30, new Date(2026, 10, 1)), ledger: said })), undefined);
  assert.equal(pickLife(base({ now: at(1, 0), goodnightAt: '00:30' })), 'goodnight', 'bedtime after midnight');
  assert.equal(pickLife(base({ now: at(22, 0), goodnightAt: '00:30' })), undefined);
  const noon = { now: at(14), ledger: { ...emptyLedger(), morning: dayOf(at(14)) } };
  assert.equal(pickLife(base({ ...noon, hasRecallCandidate: true })), 'recall');
  assert.equal(pickLife(base({ ...noon, networkAllowed: false })), undefined, 'sharing needs the network');
  assert.equal(pickLife(base({ ...noon, shareDailyLimit: 0 })), undefined);
  const ledger = { ...noon.ledger, lastRollAt: at(13, 50).getTime() };
  assert.equal(pickLife(base({ ...noon, ledger })), undefined, 'one roll per 20 minutes');
  const shared = markLife(noon.ledger, 'share', at(14));
  assert.equal(pickLife(base({ now: at(18), ledger: { ...shared, lastRollAt: undefined } })), undefined, 'daily share limit');
  assert.equal(pickLife(base({ now: at(3) })), 'goodnight', 'still up at 3am');
  assert.equal(pickLife(base({ now: at(3), ledger: markLife(emptyLedger(), 'goodnight', at(3)) })), undefined, 'nothing else in the small hours');
});
test('recall candidates: plans and events 2–21 days old, never the same one twice', () => {
  const now = at(14).getTime(), ago = (d: number) => new Date(now - d * 86400_000).toISOString();
  const memories = [
    { id: 'a', text: '用户下周要去面试', createdAt: ago(5), valid: true, importance: 3 },
    { id: 'b', text: '用户喜欢蓝色', createdAt: ago(5), valid: true, importance: 5 },
    { id: 'c', text: '用户打算学吉他', createdAt: ago(1), valid: true },
    { id: 'd', text: '用户准备搬家', createdAt: ago(40), valid: true },
    { id: 'e', text: '用户计划去旅行', createdAt: ago(3), valid: false },
  ];
  assert.equal(recallCandidate(memories, [], now)?.id, 'a');
  assert.equal(recallCandidate(memories, ['a'], now), undefined);
});

// ---- integration with the companion core ----
const credentials = { get: async () => 'k', set: async () => {} };
const embeddings = () => ({ encode: async () => [1, 0], close: async () => {} });
const answer = (body: Record<string, unknown>) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ expression: 'pleased', action: 'idle', ...body }) } }] }));
async function make(respond: (prompt: string, system: string) => Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-lively-'));
  const prompts: string[] = [];
  const core = new CompanionService({ dataDir: dir, credentials, embeddings: embeddings(), features: { life: true }, fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)), system = String(body.messages[0].content);
    if (system.includes('facts每项')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"facts":[],"diary":""}' } }] }));
    const prompt = String(body.messages.at(-1).content); prompts.push(prompt);
    return answer(respond(prompt, system));
  } });
  await core.init();
  return { core, prompts, cleanup: async () => { await core.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('a casual reply is stored once with its parts; an afterthought arrives only if the user has not spoken since', async () => {
  const { core, cleanup } = await make((prompt, system) => {
    assert.match(system, /空行/, 'the protocol mentions splitting');
    return prompt === '在吗' ? { text: '在呀\n\n刚刚在发呆', afterthought: '啊对了，今天记得喝水' } : { text: '好' };
  });
  try {
    await core.handle({ type: 'chat.send', text: '在吗' });
    const reply = core.getSnapshot().messages.at(-1)!;
    assert.deepEqual(reply.parts, ['在呀', '刚刚在发呆']);
    assert.equal(core.getSnapshot().messages.filter(m => m.role === 'assistant').length, 1, 'one record for memory and the daily archive');
    assert.equal(core.deliverAfterthought('啊对了，今天记得喝水', reply.id), true);
    const extra = core.getSnapshot().messages.at(-1)!;
    assert.equal(extra.afterthought, true); assert.equal(extra.source, 'chat');
    assert.equal(core.deliverAfterthought('再补一句', reply.id), false, 'only right after the reply it belongs to');
    await core.handle({ type: 'settings.update', settings: { splitReplies: false } });
    await core.handle({ type: 'chat.send', text: '在吗' });
    assert.equal(core.getSnapshot().messages.at(-1)!.parts, undefined, 'switch respected');
  } finally { await cleanup(); }
});
test('morning greeting runs through the initiative path once; pacing caps and muted topics stop it', async () => {
  const { core, prompts, cleanup } = await make(prompt => ({ text: /早上第一次见到用户/.test(prompt) ? '早呀！' : '你好' }));
  try {
    await core.handle({ type: 'chat.send', text: '你好' });
    const morning = at(8, 30, new Date()).getTime();
    await core.handle({ type: 'settings.update', settings: { observationEnabled: true } });
    core.setObservation({ available: true, observedAt: new Date(morning).toISOString(), idleSeconds: 5, appName: 'Code.exe' });
    await core.handle({ type: 'settings.update', settings: { proactiveHourlyLimit: 0 } });
    await core.lifeStep(morning);
    assert.ok(!prompts.some(p => /早上第一次/.test(p)), 'hourly cap 0 → nothing');
    await core.handle({ type: 'settings.update', settings: { proactiveHourlyLimit: 5, proactiveIntervalMinutes: 1 } });
    await core.handle({ type: 'initiative.topic', topic: 'greeting', enabled: false });
    await core.lifeStep(morning);
    assert.ok(!prompts.some(p => /早上第一次/.test(p)), 'greeting topic muted');
    await core.handle({ type: 'initiative.topic', topic: 'greeting', enabled: true });
    await core.lifeStep(morning);
    const said = core.getSnapshot().messages.at(-1)!;
    assert.equal(said.text, '早呀！'); assert.equal(said.source, 'initiative'); assert.deepEqual(said.initiativeTopics, ['greeting']);
    const count = prompts.length;
    await core.lifeStep(morning + 3 * 60_000);
    assert.equal(prompts.length, count, 'once a day');
  } finally { await cleanup(); }
});
test('goodnight sends the pet to sleep; talking wakes it up groggy; recall brings up an old plan', async () => {
  const { core, prompts, cleanup } = await make(prompt => ({ text: /晚安/.test(prompt) ? '晚安～我先睡啦' : /想起用户/.test(prompt) ? '上次你说要去面试，后来怎么样啦？' : '嗯嗯' }));
  try {
    await core.handle({ type: 'chat.send', text: '我下周要去面试' });
    await core.handle({ type: 'memory.remember', text: '用户下周要去面试' });
    await core.handle({ type: 'settings.update', settings: { proactiveIntervalMinutes: 1, proactiveHourlyLimit: 10, proactiveDailyLimit: 50 } });
    const night = at(23, 45, new Date()).getTime();
    await core.handle({ type: 'settings.update', settings: { observationEnabled: true } });
    core.setObservation({ available: true, observedAt: new Date(night).toISOString(), idleSeconds: 5 });
    await core.lifeStep(night);
    assert.equal(core.getSnapshot().messages.at(-1)!.text, '晚安～我先睡啦');
    assert.equal(core.getSnapshot().vitality!.tone, 'asleep');
    assert.equal(core.getSnapshot().activity!.kind, 'sleeping');
    await core.handle({ type: 'chat.send', text: '还没睡呢' });
    assert.match(prompts.at(-1)!, /还没睡呢/);
    assert.equal(core.getSnapshot().vitality!.tone, 'sleepy', 'woken up, groggy');
    // Three days later in the afternoon: the plan becomes a natural question.
    const later = at(14, 0, new Date(Date.now() + 3 * 86400_000)).getTime();
    core.setObservation({ available: true, observedAt: new Date(later).toISOString(), idleSeconds: 5 });
    const random = Math.random; Math.random = () => 0.05;
    try { await core.lifeStep(later); } finally { Math.random = random; }
    assert.match(core.getSnapshot().messages.at(-1)!.text, /面试/);
    assert.match(prompts.at(-1)!, /用户下周要去面试/);
    assert.deepEqual(core.getSnapshot().messages.at(-1)!.initiativeTopics, ['recall']);
  } finally { await cleanup(); }
});
test('routine shows in the idle status and the prompt; petting only lifts the mood', async () => {
  const { core, cleanup } = await make((_p, system) => { assert.match(system, /lively/); return { text: '嗯' }; });
  try {
    await core.handle({ type: 'chat.send', text: '你在干嘛' });
    const a = core.getSnapshot().activity!;
    if (a.kind === 'idle') assert.ok(a.routine && a.label.includes(a.routine));
    const before = core.getSnapshot().vitality!.mood, revision = core.getSnapshot().visual.revision;
    await core.handle({ type: 'pet.interact', interaction: 'pat' });
    assert.ok(core.getSnapshot().vitality!.mood > before);
    assert.equal(core.getSnapshot().visual.revision, revision, 'no bubble reset, no model call');
    await core.handle({ type: 'settings.update', settings: { moodEnabled: false, routineEnabled: false } });
    assert.equal(core.getSnapshot().vitality, undefined);
    assert.equal(core.getSnapshot().activity!.routine, undefined);
  } finally { await cleanup(); }
});
