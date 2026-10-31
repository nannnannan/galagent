// Fake desktop bridge for screenshotting the renderer without Electron.
// Query flags: busy=1, sleep=1, bubble=, pet=, action=, empty=1 (no messages/archives/diary),
// unlock=1 (push a fresh achievement after load), palette=1 (open Ctrl+K), season=snow|petals|fireflies|leaves,
// editor=<persona id> (open the card editor on the 角色 page; mode=simple|tavern), aidraft=1 (new card + AI draft with questions),
// handle=1 (hover the pet, then move away: the menu handle lingers).
import type { AppCommand, AppSnapshot, BondView, GalAgentBridge } from '../../runtime/shared/contracts';
import { achievements } from '../../runtime/shared/achievements';
import { previewSnapshot } from '../../runtime/renderer/ui';
import { builtinPixelPets } from '../../runtime/shared/pixel-pets';
import { builtinPersonas, emptyCard, type PersonaProfile } from '../../runtime/shared/personas';

const now = Date.now(), iso = (offset: number) => new Date(now + offset).toISOString();
const day = (offset: number) => { const d = new Date(now + offset * 86400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const params = new URLSearchParams(location.search), emptyState = params.get('empty') === '1', busy = params.get('busy') === '1';
const unlocked: Record<string, number> = { 'first-chat': -12, 'streak-3': -9, 'streak-7': -5, 'night-owl': -7, 'first-schedule': -11, archivist: -1, poke: -3, dizzy: -3, konami: -6 };
const bond = (extra: string[] = []): BondView => ({
  firstMetAt: iso(-12 * 86400_000), daysTogether: 13, streakDays: 8, activeDays: 11, todayChats: 6,
  achievements: achievements.map(a => ({ id: a.id, icon: a.icon, title: a.title, description: a.description, hidden: a.hidden, unlockedAt: a.id in unlocked ? iso(unlocked[a.id] * 86400_000) : extra.includes(a.id) ? iso(0) : undefined })),
});
// A custom card that exercises every tavern section (phases, facets, NPCs); Kimi is the built-in tavern card.
const kiri: PersonaProfile = {
  id: 'custom-kiri', name: '雾岛', pronoun: '他', avatar: 'scholar-boy', tagline: '深夜便利店的店员，话少，会给你留一份关东煮。',
  personality: '', speakingStyle: '短句，偶尔停顿很久才接话。', background: '', relationship: '常去的便利店店员', userTitle: '', likes: '雨夜、热饮', boundaries: '不追问你为什么这么晚还不睡。',
  greeting: '……欢迎光临。老样子？', idleLines: ['补货中', '擦柜台'], voiceStyle: '低、慢、带点沙哑', createdAt: iso(-20 * 86400_000), updatedAt: iso(-86400_000),
  card: { ...emptyCard(), age: '二十五六', gender: '男', identity: '深夜便利店店员', appearance: '左手总缠着创可贴；制服第二颗扣子永远扣错一格。',
    base: '温柔', main: ['沉默'], accents: ['嘴硬'],
    derivations: [{ trait: '温柔', text: '你说不饿，他还是把关东煮多煮一份放在收银台边，说是“煮多了”。' }, { trait: '温柔', text: '下雨时把店里的伞递给你，不提还的事。' }, { trait: '沉默', text: '你讲很长的事时他不插话，只在你停下来时“嗯”一声。' }],
    lines: ['……老样子？', '煮多了，别浪费。', '伞，拿着。'],
    facets: [{ name: '营业模式', trigger: '店里有其他客人', energy: '低耗、礼貌', lines: ['欢迎光临。'], body: '站得很直，只看收银机。', purpose: '把自己藏在流程后面' }],
    notes: [{ topic: '沉默', text: '不是冷淡，是在认真听。他只在你需要时开口。' }],
    phases: [{ name: '熟客', fromDays: 7, main: ['沉默', '照顾'], accents: [], derivations: [{ trait: '照顾', text: '开始记得你常买的东西，提前放到你手边。' }], notes: [] }, { name: '朋友', fromDays: 30, main: ['照顾'], accents: ['话多一点'], derivations: [], notes: [] }],
    npcs: [{ name: '店长', role: '便利店店长', look: '', traits: '爱唠叨', relation: '偶尔会问你“又是你啊”', lines: [] }] },
};
const snapshot: AppSnapshot = structuredClone(previewSnapshot);
snapshot.persona = { active: builtinPersonas[0], list: [...builtinPersonas, kiri], greeted: true };
Object.assign(snapshot, {
  provider: { configured: true, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', mode: 'native-api', toolCount: 26 },
  status: { ...snapshot.status, online: true, busy, embedding: 'ready', contextTokens: 3120, journal: { lastDay: day(-1), pendingDays: [], failedDays: [day(-4)], nextRunAt: new Date(new Date(now).setHours(24, 0, 30, 0)).toISOString() } },
  activity: busy ? { kind: 'thinking', label: '思考中…' } : params.get('sleep') === '1' ? { kind: 'sleeping', label: '你不在，先眯一会儿' } : { kind: 'idle', label: '星野 · 星空时间', routine: '星空时间' },
  vitality: { energy: 46, mood: 81, tone: 'tired', label: '有点困' },
  pets: { catalog: builtinPixelPets.map(p => ({ id: p.id, name: p.name, description: p.description, builtin: true })), revision: 1 },
  settings: { ...snapshot.settings, petId: params.get('pet') || '' },
  visual: { expression: 'pleased', action: params.get('action') || 'wave', bubble: params.get('bubble') ?? '嘿！今天也一起加油吧～要不要先喝口水？', revision: 1, intensity: 0.85 },
  stats: { conversations: 42, memories: 7, proactiveToday: 2, tokensToday: 12000 },
  bond: bond(),
  messages: emptyState ? [] : [
    { id: 'a', role: 'user', text: '我一会儿要去面试，有点紧张', createdAt: iso(-3600_000), source: 'chat' },
    { id: 'b', role: 'assistant', text: '欸！加油加油～深呼吸三次，把准备好的内容想一遍就好。\n\n**出门前检查一下：**\n- 简历打印 *两份*\n- 作品集链接：[我的作品集](https://example.com/portfolio)\n- 提前 `15 分钟` 到\n\n一小时后我来问你结果哦！', createdAt: iso(-3590_000), source: 'chat', speaker: '星野', personaId: 'builtin:xingye' },
    { id: 'c', role: 'assistant', text: '面试怎么样啦？我一直在等你的好消息～', createdAt: iso(-60_000), source: 'initiative', initiativeTopics: ['schedule'], speaker: '星野', personaId: 'builtin:xingye' },
    { id: 'c2', role: 'user', text: '还在等通知……', createdAt: iso(-50_000), source: 'chat' },
    { id: 'c3', role: 'assistant', text: '欸，那就是在认真考虑你！\n\n先别想啦，去吃点好吃的？', parts: ['欸，那就是在认真考虑你！', '先别想啦，去吃点好吃的？'], createdAt: iso(-45_000), source: 'chat', speaker: '星野', personaId: 'builtin:xingye' },
    { id: 'c4', role: 'assistant', text: '啊对了，结果出来第一个告诉我哦', afterthought: true, createdAt: iso(-20_000), source: 'chat', speaker: '星野', personaId: 'builtin:xingye' },
    ...(busy ? [{ id: 'd', role: 'user', text: '过啦！！下周入职，帮我写个入职准备清单？', createdAt: iso(-5_000), source: 'chat' }] : []),
  ],
  schedules: emptyState ? [] : [
    { id: 's1', note: '提醒喝水', dueAt: iso(25 * 60_000), repeatMinutes: 60, createdBy: 'user', createdAt: iso(-1e6) },
    { id: 's2', note: '问问周报写完没有', dueAt: iso(3 * 3600_000), createdBy: 'character', createdAt: iso(-1e5) },
  ],
  privacy: { redactedToday: 5, blockedToday: 1, recent: [{ at: iso(-120_000), channel: 'chat', action: 'redacted', kinds: ['api-key'], count: 1 }, { at: iso(-900_000), channel: 'executor-fetch', action: 'blocked', kinds: ['domain'], count: 1 }] },
  memories: emptyState ? [] : [{ id: 'm1', kind: 'fact', text: '用户喜欢不加糖的乌龙茶', sourceId: 'a', createdAt: iso(-86400_000), valid: true, importance: 4 }, { id: 'm2', kind: 'fact', text: '用户下午有一场面试', sourceId: 'a', createdAt: iso(-3600_000), valid: true }],
  diary: emptyState ? [] : [{ id: 'd1', kind: 'journal', title: '面试日', text: '今天陪他准备面试。他嘴上说紧张，其实准备得很充分。我约好一小时后去问结果，希望是好消息！', createdAt: iso(-5 * 86400_000), sourceIds: ['a', 'b'] }],
  archives: emptyState ? [] : [
    { day: day(-1), title: '面试前的一天', summary: '一起准备了明天的面试：梳理了自我介绍、把作品集重新排了顺序，还约好面试后第一时间报告结果。晚上聊了会儿喜欢的乌龙茶。', diary: '他今天一直在念叨面试的事，嘴上说着“肯定不行”，手上却把作品集改了三遍。我假装没看出来他紧张，只提醒他早点睡。希望明天是个好天气。', mood: '期待', topics: ['面试', '作品集', '乌龙茶'], highlights: ['把自我介绍从 3 分钟压到了 90 秒', '决定面试穿那件蓝衬衫'], openThreads: ['面试结果还没揭晓', '周报还没写完'], messageCount: 38, createdAt: iso(-20 * 3600_000) },
    { day: day(-2), title: '下雨的周二', summary: '下了一整天雨。聊了周末想去的展览，顺手定了每小时喝水的提醒。', diary: '雨声很好听。他说下雨天最适合写代码，然后写了一下午 bug。', mood: '平静', topics: ['展览', '喝水'], highlights: ['第一次定下每小时喝水的提醒'], openThreads: [], messageCount: 17, createdAt: iso(-44 * 3600_000) },
    { day: day(-3), title: '夜猫子之夜', summary: '凌晨还在赶项目，聊了几句就去睡了。', diary: '凌晨一点半，他终于说了晚安。', mood: '担心', topics: ['熬夜'], highlights: [], openThreads: ['答应以后早点睡'], messageCount: 9, createdAt: iso(-68 * 3600_000) },
  ],
  watches: [{ id: 'w1', title: '快递到了没', createdAt: now, nextCheckAt: now + 1e6, expiresAt: now + 1e7, status: 'active', dedupeKey: 'x' }],
  agent: { backend: 'openai-kimi-tools', mode: 'full-access', cwd: 'C:\\Users\\me\\Documents', busy: false },
});
// Previews start fresh: the daily greeting and pet history live in localStorage.
try { localStorage.clear(); } catch { /* file:// may refuse storage */ }
const listeners: ((s: AppSnapshot) => void)[] = [];
const bridge: GalAgentBridge = {
  getSnapshot: async () => snapshot,
  onSnapshot: listener => { listeners.push(listener); return () => {}; },
  dispatch: async (command: AppCommand) => {
    if (command.type === 'pet.get') return { ok: true, data: builtinPixelPets.find(p => p.id === command.id) };
    if (command.type === 'persona.generate') return { ok: true, data: { name: '阿澄', pronoun: '她', tagline: '会做饭的狼人管家，嘴硬心软。', card: { ...emptyCard(), identity: '狼人管家', base: '责任感', main: ['嘴硬', '会照顾人'], accents: ['怕打雷'] }, questions: ['她被你夸做饭好吃时，第一反应是什么动作？', '“嘴硬”在什么场合会突然失效？', '有没有一件她绝对不会替你做的事？为什么？'] } };
    return { ok: true };
  },
};
(window as unknown as { galagent: GalAgentBridge }).galagent = bridge;
if (params.get('unlock') === '1') setTimeout(() => { const next = { ...snapshot, bond: bond(['pat']) }; for (const l of listeners) l(next); }, 300);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const editor = params.get('editor'), aidraft = params.get('aidraft') === '1';
if (editor || aidraft) void (async () => {
  await wait(300);
  if (aidraft) document.querySelector<HTMLElement>('.persona-card.create')?.click();
  else document.querySelector<HTMLElement>(`.persona-card[data-id="${CSS.escape(editor!)}"] [data-action="edit"]`)?.click();
  await wait(50);
  const mode = params.get('mode'); if (mode) document.querySelector<HTMLElement>(`.editor .tab[data-mode="${mode}"]`)?.click();
  if (params.get('guide') === '1') [...document.querySelectorAll<HTMLElement>('.editor .btn')].find(b => b.textContent === '写卡指南')?.click();
  if (params.get('open') === '1') document.querySelectorAll<HTMLDetailsElement>('.editor details.fold').forEach(d => { d.open = true; });
  if (aidraft) { const input = document.querySelector<HTMLInputElement>('.ai-draft input')!; input.value = '会做饭的狼人管家，嘴硬心软'; document.querySelector<HTMLElement>('.ai-draft .btn')?.click(); }
  await wait(80); (document.activeElement as HTMLElement | null)?.blur(); document.querySelector('.content-page')!.scrollTop = 0;
})();
if (params.get('handle') === '1') setTimeout(() => {
  const body = document.querySelector<HTMLElement>('#pet-body'); if (!body) return;
  const r = body.getBoundingClientRect(), app = document.querySelector('#app')!;
  app.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.7, bubbles: true }));
  setTimeout(() => app.dispatchEvent(new MouseEvent('mousemove', { clientX: 8, clientY: 8, bubbles: true })), 120);
}, 600);
if (params.get('palette') === '1') setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })), 300);
// gesture=pat: sweep the cursor back and forth over the pet's head (exercises the real hover-stroke path).
if (params.get('gesture') === 'pat') setTimeout(() => {
  const body = document.querySelector<HTMLElement>('#pet-body'); if (!body) return;
  const r = body.getBoundingClientRect(), y = r.top + r.height * 0.3, cx = r.left + r.width / 2;
  let i = 0;
  const timer = setInterval(() => {
    const x = cx + Math.sin(i / 3) * 22; i++;
    document.querySelector('#app')!.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    if (i > 60) clearInterval(timer);
  }, 16);
}, 400);
