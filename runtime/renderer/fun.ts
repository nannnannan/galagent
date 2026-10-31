// Little captions, gestures and easter eggs for the pet. Everything here is local and
// cosmetic: no model call, nothing leaves the machine. This module stays free of DOM
// access at load time so its pure helpers can be unit-tested under node.
import type { AppSnapshot, BondView, PetAction, VitalityTone } from '../shared/contracts';

export const idleWords = [
  '发呆中…', '数像素', '偷偷看你', '伸个懒腰', '听窗外的声音', '晒晒屏幕光', '整理小背包', '研究鼠标指针', '哼歌', '在想晚饭吃什么',
  '给像素掸灰', '数任务栏图标', '在桌面散步', '把影子踩平', '练习眨眼', '和光标赛跑', '抖抖耳朵', '看你的壁纸', '偷偷长高了 1 像素', '在想今天吃什么甜点',
  '打了个小喷嚏', '踮脚张望', '整理头发', '翻看昨天的回忆', '收集小星星', '给自己打气', '想念一朵云', '对着屏幕哈气', '画一个圈圈', '默默加油中',
  '拍拍身上的灰', '摆个酷姿势', '思考人生 0.5 秒', '数到一百', '偷偷练舞步', '等风来', '在桌面角落探险', '给你留一块小饼干', '在想你在想什么', '试着吹口哨',
];
/** After a long stretch without any petting, tapping or chat: a gentle bid for attention. */
export const boredWords = ['好无聊呀～陪我玩会儿？', '戳戳我嘛', '你是不是忘记我了…', '我在这儿哦～', '偷偷戳一下屏幕', '想被摸摸头', '一个人数像素好寂寞'];
/** Rotating "doing" words while a reply is cooking, Claude-Code style; shown with "…" and elapsed time. */
export const thinkingWords = [
  '琢磨', '酝酿', '沉思', '构思', '推敲', '斟酌', '盘算', '头脑风暴', '翻小本本', '搜肠刮肚',
  '灵光乍现', '冒泡泡', '打草稿', '掰手指', '抓耳挠腮', '咕嘟咕嘟', '煲汤', '发酵', '烘焙', '揉面团',
  '熬粥', '编织', '织毛衣', '拼拼图', '理毛线团', '翻字典', '观星', '解谜', '破案', '推理',
  '调频', '对暗号', '加载灵感', '蓄力', '憋大招', '折纸飞机', '酿蜂蜜', '剥橘子', '磨咖啡', '泡茶',
  '吹泡泡', '转笔', '托腮', '捋思路', '组织语言', '挑词', '押韵', '打腹稿', '翻记忆', '咀嚼',
  '嘀咕', '拨算盘', '调色', '画草图', '种灵感', '捕捉想法', '追蝴蝶', '摇骰子', '翻书', '烤棉花糖',
  '和脑细胞开会', '把想法排好队', '给句子穿衣服', '在脑海里散步', '偷偷练习回答', '把灵感捏圆', '筛掉废话', '熬一锅好话',
];
export const workingWords = [
  '敲代码', '翻文件', '搬砖', '拧螺丝', '跑腿', '打扫', '装订', '搬运数据', '查资料', '拆包裹',
  '修修补补', '施工', '排队', '盖章', '校对', '测量', '搭积木', '抄写', '打包', '走流程',
  '跑测试', '对账', '归档', '挖矿', '铺路', '穿针引线', '撸起袖子', '拼零件', '画蓝图', '贴标签',
];
export const initiativeWords = ['想跟你说点什么', '组织开场白', '鼓起勇气', '想话题', '清嗓子', '犹豫要不要打扰你', '挑个好时机', '练习打招呼', '在门口探头', '准备小惊喜'];

const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
const shuffled = <T,>(items: readonly T[]) => { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };

/** Elapsed time like Claude Code's spinner: 7s, 1m 05s. */
export const elapsedText = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
export type BusyKind = 'thinking' | 'working' | 'initiative';
export const BUSY_ROTATE_MS = 2800;
/**
 * One busy stretch: a fresh shuffle of the word pool (the character's own lines mixed in), a new word
 * every BUSY_ROTATE_MS, and the elapsed time once it passes 4 seconds.
 */
export class BusyTicker {
  private order: string[];
  constructor(readonly kind: BusyKind, readonly startedAt: number, own: readonly string[] = []) {
    const pool = kind === 'working' ? workingWords : kind === 'initiative' ? initiativeWords : thinkingWords;
    const mine = shuffled(own.filter(Boolean)), rest = shuffled(pool);
    // Interleave so the character's own words show up early and often, not only after 60 generic ones.
    this.order = [];
    while (mine.length || rest.length) { if (mine.length) this.order.push(mine.shift()!); if (rest.length) this.order.push(rest.shift()!); if (rest.length) this.order.push(rest.shift()!); }
  }
  word(now: number) { return this.order[Math.floor(Math.max(0, now - this.startedAt) / BUSY_ROTATE_MS) % this.order.length]; }
  text(now: number) { const elapsed = now - this.startedAt; return `${this.word(now)}…${elapsed >= 4000 ? ` ${elapsedText(elapsed)}` : ''}`; }
}

type Activity = NonNullable<AppSnapshot['activity']>;
/**
 * Keeps one BusyTicker per busy stretch: returns the rotating text while the activity is thinking/working
 * (a new shuffle each time a new stretch starts), undefined otherwise.
 */
export function busyLabeler() {
  let ticker: BusyTicker | undefined, key = '';
  return (a: Activity | undefined, own: readonly string[] = [], now = Date.now()): string | undefined => {
    if (!a || a.waiting || (a.kind !== 'thinking' && a.kind !== 'working')) { ticker = undefined; key = ''; return undefined; }
    const next = a.kind + (a.initiative ? ':initiative' : '');
    if (next !== key) { key = next; ticker = new BusyTicker(a.kind === 'working' ? 'working' : a.initiative ? 'initiative' : 'thinking', now, a.kind === 'thinking' && !a.initiative ? own : []); }
    return ticker!.text(now);
  };
}

/** Seasonal and clock-based lines; returns undefined most of the time so they stay special. */
export function timelyCaption(now = new Date()): string | undefined {
  const md = `${now.getMonth() + 1}-${now.getDate()}`, h = now.getHours(), dow = now.getDay();
  const days: Record<string, string> = {
    '1-1': '新年快乐！🎉', '2-14': '情人节快乐 ♥', '2-29': '四年一次的今天，要许个愿吗', '3-8': '女神节快乐 🌷', '3-12': '植树节，给桌面种棵像素树', '3-14': '白色情人节，回礼准备好了吗', '3-21': '春分，昼夜一样长',
    '4-1': '今天说的话都可能是玩笑哦', '4-22': '地球日，谢谢这颗星球', '4-23': '世界读书日，今天读点什么？', '5-1': '劳动节快乐，记得休息', '5-20': '520，悄悄说一句：有你真好', '6-1': '儿童节快乐！', '6-21': '夏至，白天最长的一天',
    '7-7': '七月七，看星星吗', '8-8': '八月八，伸伸懒腰', '9-10': '教师节，谢谢每一位老师', '9-13': '程序员日，代码零 bug！', '10-1': '国庆快乐！', '10-24': '1024，程序员节快乐 💻', '10-31': '不给糖就捣蛋 🎃',
    '11-1': '十一月第一天，加件衣服', '11-11': '双十一，购物车冷静一下', '12-21': '冬至，吃饺子还是汤圆？', '12-24': '平安夜，吃苹果了吗', '12-25': '圣诞快乐 🎄', '12-31': '今年的最后一天，辛苦啦',
  };
  if (days[md] && Math.random() < 0.5) return days[md];
  if (h >= 0 && h < 5) return pick(['夜深了，该睡啦', '你也是夜猫子？', '月亮都困了', '星星在打哈欠', '再不睡天就亮啦']);
  if (h === 12 && Math.random() < 0.6) return pick(['饭点到啦！', '午饭吃什么呀', '肚子咕咕叫了']);
  if (h >= 6 && h < 9 && Math.random() < 0.4) return pick(['早上好 ☀', '今天也要元气满满', '早餐吃了吗？', '新的一天开张啦']);
  if (h >= 14 && h < 16 && Math.random() < 0.25) return pick(['下午犯困时间…', '来点下午茶吧', '眼皮在打架']);
  if (h >= 18 && h < 20 && Math.random() < 0.3) return pick(['晚饭时间到～', '天快黑啦', '今天辛苦了']);
  if (h >= 22 && Math.random() < 0.3) return pick(['准备洗洗睡了吗', '今天过得怎么样？', '夜色真好']);
  if (dow === 5 && h >= 16 && Math.random() < 0.5) return '周五啦，周末在招手';
  if (dow === 1 && h < 11 && Math.random() < 0.4) return '周一……一起加油吧';
  if ((dow === 0 || dow === 6) && Math.random() < 0.15) return pick(['周末快乐！', '周末也要好好休息']);
  if (Math.random() < 0.02) return `今日幸运色：${pick(['薄荷绿', '奶油黄', '雾霾蓝', '樱花粉', '香芋紫', '橘子橙', '星空蓝', '抹茶绿'])}`;
  if (Math.random() < 0.015) return `今日幸运数字：${1 + Math.floor(Math.random() * 99)}`;
  return undefined;
}

/** Idle captions coloured by the character's current energy and mood. */
export const toneLines: Partial<Record<VitalityTone, string[]>> = {
  sleepy: ['哈——欠', '眼皮好重…', '困困…', '（揉眼睛）', '再眯五分钟…'],
  tired: ['有点没电了', '想喝杯热饮', '伸个懒腰续续命'],
  sulky: ['哼…', '都不理我…', '（偷偷看你一眼）', '我才没有在等你', '戳戳我嘛…'],
  happy: ['今天心情超好！', '嘿嘿嘿', '想转个圈圈～', '♪～'],
  lively: ['元气满满！', '有什么好玩的吗？', '精神十足！'],
};
const routineCaption = (activity: string) => /时间$/.test(activity) ? `${activity}～` : `在${activity}…`;
export const BORED_AFTER_MS = 25 * 60_000;
/** `sinceInteraction`: ms since the last pat, tap, drag or chat; after BORED_AFTER_MS the pet sometimes asks for attention. */
export function idleCaption(snapshot: AppSnapshot, sinceInteraction = 0): string {
  const own = snapshot.persona?.active.idleLines || [];
  if (sinceInteraction >= BORED_AFTER_MS && Math.random() < 0.35) return pick(boredWords);
  const tone = snapshot.vitality?.tone, moody = tone ? toneLines[tone] : undefined;
  if (moody && Math.random() < 0.4) return pick(moody);
  if (snapshot.activity?.routine && Math.random() < 0.25) return routineCaption(snapshot.activity.routine);
  return timelyCaption() || (own.length && Math.random() < 0.7 ? pick(own) : pick(idleWords));
}

/**
 * 头顶小嘀咕 (活人感): one-line reactions to the KIND of app in front, from its process name only (never window
 * contents). Shown above the pet, never stored and never a chat message, so they cost no model call or initiative.
 */
const murmurTable: [string, RegExp, string[]][] = [
  ['code', /^(code|cursor|windsurf|idea64|idea|pycharm64|pycharm|webstorm64|webstorm|clion64|goland64|rider64|devenv|sublime_text|zed|hbuilderx|studio64|trae)(\.exe)?$/i, ['又在写代码呀', 'bug 退散！', '今天的代码也很努力', '要不要我帮你看看？', '写累了就歇会儿']],
  ['terminal', /^(windowsterminal|wt|powershell|pwsh|cmd|conhost|mintty|alacritty|wezterm-gui|terminal|iterm2)(\.exe)?$/i, ['黑黑的窗口…好酷', '在敲命令呀', '命令行大师！']],
  ['browser', /^(chrome|msedge|firefox|brave|opera|vivaldi|arc|360se|360chrome|qqbrowser|sogouexplorer|safari)(\.exe)?$/i, ['在看什么好东西', '网上冲浪中～', '别忘了喝水哦', '看到好玩的分享给我']],
  ['music', /^(spotify|cloudmusic|qqmusic|kugou|kwmusic|foobar2000|aimp|musicbee|applemusic|itunes)(\.exe)?$/i, ['这首好听吗', '跟着节奏晃一晃♪', '也放给我听听']],
  ['video', /^(potplayer(mini)?(64)?|vlc|mpv|mpc-hc(64)?|bilibili|iqiyi|youku|qqlive|tencentvideo|netflix|douyin)(\.exe)?$/i, ['看什么呢，带我一个', '零食准备好了吗', '好看吗好看吗']],
  ['game', /^(steam|steamwebhelper|epicgameslauncher|wegame|yuanshen|genshinimpact|starrail|zenlesszonezero|leagueclient|league of legends|valorant|minecraft(launcher)?|javaw|battle\.net|riotclientservices)(\.exe)?$/i, ['带我一起玩！', '加油，赢下来！', '我在旁边给你加油']],
  ['office', /^(winword|excel|powerpnt|wps|et|wpp|onenote|notion|obsidian|typora|logseq|wpsoffice|pages|numbers|keynote)(\.exe)?$/i, ['在写文档呀，加油', '排版辛苦了', '写完给我看看？']],
  ['chat', /^(wechat|weixin|qq|tim|dingtalk|feishu|lark|telegram|discord|slack|teams|ms-teams|whatsapp)(\.exe)?$/i, ['有人找你啦？', '在和朋友聊天呀']],
  ['design', /^(photoshop|figma|illustrator|blender|krita|clipstudiopaint|sai2?|aseprite|affinity\w*|inkscape)(\.exe)?$/i, ['在画画！好厉害', '能画我一张吗', '配色好好看']],
];
export function murmurFor(appName: string): { category: string; line: string } | undefined {
  const name = appName.trim().split(/[\\/]/).pop() || '';
  const hit = murmurTable.find(([, pattern]) => pattern.test(name));
  return hit ? { category: hit[0], line: pick(hit[2]) } : undefined;
}
/** The app has to stay in front `dwellMs` first (no alt-tab flicker); then one line, with per-category and global cooldowns. */
export class Murmurer {
  private app = ''; private since = 0; private done = true; private lastAt = -Infinity; private byCategory = new Map<string, number>();
  constructor(private dwellMs = 20_000, private globalMs = 4 * 60_000, private categoryMs = 15 * 60_000) {}
  note(appName: string | undefined, now: number): string | undefined {
    const app = appName || '';
    if (app !== this.app) { this.app = app; this.since = now; this.done = !app; return undefined; }
    if (this.done || now - this.since < this.dwellMs) return undefined;
    this.done = true;
    const hit = murmurFor(app); if (!hit) return undefined;
    if (now - this.lastAt < this.globalMs || now - (this.byCategory.get(hit.category) ?? -Infinity) < this.categoryMs) return undefined;
    this.lastAt = now; this.byCategory.set(hit.category, now);
    return hit.line;
  }
}

/** Little reactions to words in the user's own message; purely local particles, never a model call. */
export type ChatReaction = { effect: 'hearts' | 'sparkles' | 'jump' | 'confetti'; action: PetAction; line: string };
const reactions: [RegExp, ChatReaction][] = [
  [/生日快乐|happy birthday/i, { effect: 'confetti', action: 'celebrate', line: '生日快乐！🎂' }],
  [/新年快乐|happy new year/i, { effect: 'confetti', action: 'celebrate', line: '新年快乐！🎉' }],
  [/我爱你|喜欢你|爱你|love you/i, { effect: 'hearts', action: 'love', line: '心、心跳加速了…' }],
  [/抱抱|贴贴|摸摸头?/, { effect: 'hearts', action: 'love', line: '抱抱～' }],
  [/谢谢|感谢|thank/i, { effect: 'hearts', action: 'nod', line: '嘿嘿，不客气' }],
  [/晚安|good ?night/i, { effect: 'sparkles', action: 'sleep', line: '晚安，好梦 🌙' }],
  [/早安|早上好|good ?morning/i, { effect: 'sparkles', action: 'wave', line: '早安 ☀' }],
  [/哈哈哈|笑死|233/, { effect: 'jump', action: 'celebrate', line: '哈哈哈！' }],
  [/加油|冲鸭|冲冲冲/, { effect: 'sparkles', action: 'celebrate', line: '一起加油！' }],
  [/好累|累死|好困/, { effect: 'hearts', action: 'love', line: '辛苦啦，摸摸' }],
];
export function chatReaction(text: string): ChatReaction | undefined {
  const clean = text.trim(); if (!clean || clean.length > 200) return undefined;
  return reactions.find(([pattern]) => pattern.test(clean))?.[1];
}

/** Rapid taps make the pet dizzy; shaking it while dragging too. */
export class Mischief {
  private taps: number[] = [];
  private turns: number[] = [];
  private lastDx = 0;
  tap(now = performance.now()): { line: string; dizzy: boolean } | undefined {
    this.taps = [...this.taps.filter(t => now - t < 2200), now];
    if (this.taps.length === 5) return { line: pick(['别戳啦～会晕的', '再戳要生气了哦', '痒痒痒！', '戳戳怪出现了！', '我不是按钮啦']), dizzy: false };
    if (this.taps.length >= 9) { this.taps = []; return { line: '@_@ 晕了晕了', dizzy: true }; }
    return undefined;
  }
  drag(dx: number, now = performance.now()): string | undefined {
    if (Math.abs(dx) < 3) return undefined;
    if (this.lastDx && Math.sign(dx) !== Math.sign(this.lastDx)) this.turns = [...this.turns.filter(t => now - t < 1300), now];
    this.lastDx = dx;
    if (this.turns.length >= 6) { this.turns = []; return pick(['别晃啦！转晕了@_@', '地、地震了吗？', '呜哇——放我下来']); }
    return undefined;
  }
}

export const patLines = ['嘿嘿，好舒服～', '再摸一下下', '头发要乱啦', '呼噜呼噜…', '被摸头了 (〃▽〃)', '再摸就要融化了', '今天的摸头额度 +1', '你的手好暖'];
export const tickleLines = ['脚底好痒！', '哈哈哈别挠脚心！', '那里不行啦～', '痒痒痒痒痒', '要、要站不稳了'];
export const stareLines = ['盯——', '你在看我吗？', '(〃∀〃) 被看得不好意思了', '我脸上有像素吗？', '对视三秒…你先眨眼！'];
export const orbitLines = ['眼睛跟不上啦 @_@', '你在给我施魔法吗', '转圈圈～转圈圈～', '我也要转！'];
export const welcomeBackLines = ['你回来啦！', '欢迎回来～', '我一直在这儿等你', '去哪儿啦？想你了', '回来就好～'];
export const wallLines = ['哎哟，撞墙了！', '咚！', '边界在这里…', '屏幕好硬'];
export const holdLines = ['还不松手吗～', '手不酸吗？', '被抓住了…', '放我下来嘛'];

/** Pointer resting on the pet: fires once after `ms` of continuous hover, re-arms after the pointer leaves. */
export class Stare {
  private since?: number; private fired = false;
  constructor(private ms = 3500) {}
  move(over: boolean, now = performance.now()): boolean {
    if (!over) { this.since = undefined; this.fired = false; return false; }
    this.since ??= now;
    if (!this.fired && now - this.since >= this.ms) { this.fired = true; return true; }
    return false;
  }
  reset() { this.since = undefined; this.fired = false; }
}

/**
 * Cursor circling around the pet: the unwrapped angle around the centre accumulates while the pointer
 * stays inside `maxRadius`; two full turns within `windowMs` count. Small radii (hovering on the face) don't.
 */
export class Orbit {
  private last?: number; private total = 0; private startedAt = 0;
  constructor(private turns = 2, private windowMs = 4000, private minRadius = 30, private maxRadius = 220) {}
  move(x: number, y: number, cx: number, cy: number, now = performance.now()): boolean {
    const r = Math.hypot(x - cx, y - cy);
    if (r < this.minRadius || r > this.maxRadius) { this.reset(); return false; }
    const angle = Math.atan2(y - cy, x - cx);
    if (this.last === undefined || now - this.startedAt > this.windowMs) { this.last = angle; this.total = 0; this.startedAt = now; return false; }
    let d = angle - this.last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    this.last = angle;
    // Reversing direction starts over: back-and-forth wiggles are petting, not circling.
    if (this.total && Math.sign(d) !== Math.sign(this.total) && Math.abs(d) > 0.05) { this.total = d; this.startedAt = now; return false; }
    this.total += d;
    if (Math.abs(this.total) >= this.turns * 2 * Math.PI) { this.reset(); return true; }
    return false;
  }
  reset() { this.last = undefined; this.total = 0; }
}
/**
 * Hover strokes: the cursor sweeping back and forth over the head (no button pressed).
 * Returns 'pat' once enough strokes land in a short window, then 'stroke' for each further
 * sweep during the cooldown so continued petting keeps a trickle of hearts.
 */
export class Petting {
  private lastX?: number; private dir = 0; private travel = 0; private strokes: number[] = []; private cooldownUntil = 0; private outsideSince?: number;
  constructor(private needed = 4, private windowMs = 1800, private cooldownMs = 6000) {}
  move(x: number, overHead: boolean, now = performance.now()): 'pat' | 'stroke' | undefined {
    if (!overHead) { this.outsideSince ??= now; if (now - this.outsideSince > 350) this.reset(); return undefined; }
    this.outsideSince = undefined;
    if (this.lastX === undefined) { this.lastX = x; return undefined; }
    const dx = x - this.lastX; this.lastX = x;
    if (Math.abs(dx) < 0.5) return undefined;
    const sign = Math.sign(dx);
    if (sign === this.dir) { this.travel += Math.abs(dx); return undefined; }
    // A reversal completes one stroke if the sweep was hand-sized (not a twitch, not a pass-by).
    const counted = this.dir !== 0 && this.travel >= 6 && this.travel <= 140;
    this.dir = sign; this.travel = Math.abs(dx);
    if (!counted) return undefined;
    if (now < this.cooldownUntil) return 'stroke';
    this.strokes = [...this.strokes.filter(t => now - t < this.windowMs), now];
    if (this.strokes.length >= this.needed) { this.strokes = []; this.cooldownUntil = now + this.cooldownMs; return 'pat'; }
    return undefined;
  }
  reset() { this.lastX = undefined; this.dir = 0; this.travel = 0; this.outsideSince = undefined; }
}

export type MoveSample = { x: number; y: number; t: number };
/** Release velocity (px/ms) from the last few pointer samples; zero if the pointer paused before letting go. */
export function releaseVelocity(samples: readonly MoveSample[], now: number, windowMs = 90): { vx: number; vy: number } {
  const recent = samples.filter(s => now - s.t <= windowMs);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const a = recent[0], b = recent[recent.length - 1];
  if (now - b.t > 70) return { vx: 0, vy: 0 };
  const dt = Math.max(8, b.t - a.t);
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
}
export const FLING_MIN_SPEED = 0.9;
/** A thrown window glides with exponential friction; step() yields whole-pixel deltas for shell.drag. */
export class Fling {
  private fx = 0; private fy = 0; private elapsed = 0;
  readonly startSpeed: number;
  constructor(public vx: number, public vy: number, private friction = 4.2, private maxMs = 1100, maxSpeed = 4) {
    const speed = Math.hypot(vx, vy);
    if (speed > maxSpeed) { this.vx = (vx / speed) * maxSpeed; this.vy = (vy / speed) * maxSpeed; }
    this.startSpeed = Math.min(speed, maxSpeed);
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  step(dtMs: number): { dx: number; dy: number; done: boolean } {
    const dt = Math.max(0, Math.min(64, dtMs));
    this.elapsed += dt;
    // Exact integral of v·e^(−f·t) over the step, so the glide distance doesn't depend on frame rate.
    const k = Math.exp((-this.friction * dt) / 1000), travel = ((1 - k) / this.friction) * 1000;
    this.fx += this.vx * travel; this.fy += this.vy * travel;
    this.vx *= k; this.vy *= k;
    const dx = Math.trunc(this.fx), dy = Math.trunc(this.fy);
    this.fx -= dx; this.fy -= dy;
    return { dx, dy, done: this.speed < 0.05 || this.elapsed >= this.maxMs };
  }
  bounce(axis: 'x' | 'y', damping = 0.55) { if (axis === 'x') this.vx = -this.vx * damping; else this.vy = -this.vy * damping; }
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day, e.g. 2026-10-29. */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isMidnight = (d = new Date()) => d.getHours() === 0 && d.getMinutes() <= 1;
export const midnightCaption = '零点整！新的一天，第一个见到的是你 🌙';
const milestones = [7, 30, 50, 100, 200, 365, 500, 520, 1000];
/** Caption for the first interaction of the day: anniversaries and milestones first, else time of day. */
export function firstGreeting(now = new Date(), bond?: Pick<BondView, 'daysTogether' | 'firstMetAt'>): string {
  const met = bond?.firstMetAt ? new Date(bond.firstMetAt) : undefined;
  if (met && !Number.isNaN(met.getTime()) && met.getMonth() === now.getMonth() && met.getDate() === now.getDate() && now.getFullYear() > met.getFullYear()) return `今天是我们认识 ${now.getFullYear() - met.getFullYear()} 周年！🎂`;
  if (bond && milestones.includes(bond.daysTogether)) return `陪伴第 ${bond.daysTogether} 天啦，谢谢你一直在 ✨`;
  const h = now.getHours();
  const part = h >= 5 && h < 11 ? '早上好' : h < 13 && h >= 11 ? '中午好' : h >= 13 && h < 18 ? '下午好' : h >= 18 && h < 23 ? '晚上好' : '这么晚才来呀';
  return `${part}！今天第一次见到你～`;
}
const chineseHour = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
/** Top-of-the-hour line (minute 0 only); 1–4 am turns into a gentle nudge to rest. */
export function chimeCaption(now = new Date()): string | undefined {
  if (now.getMinutes() !== 0) return undefined;
  const h = now.getHours(), h12 = h % 12 || 12;
  if (h >= 1 && h <= 4) return pick([`凌晨${chineseHour[h]}点了，早点休息吧 🌙`, `已经${chineseHour[h]}点啦，眼睛也要睡觉`, '这么晚还在，要照顾好自己哦']);
  const special: Record<number, string> = { 0: '零点啦，新的一天 ✨', 7: '七点啦，早安 ☀', 12: '十二点，午饭时间！', 15: '三点了，来杯下午茶？', 18: '六点啦，辛苦一天了', 22: '十点了，准备收尾吧' };
  return special[h] || `叮——${chineseHour[h12]}点整`;
}

export type Season = 'snow' | 'petals' | 'fireflies' | 'leaves' | 'none';
/** Ambient particles: snow Dec–Feb, petals Mar–Apr, fireflies on summer nights, leaves in autumn. */
export function seasonFor(d = new Date()): Season {
  const m = d.getMonth() + 1, h = d.getHours();
  if (m === 12 || m <= 2) return 'snow';
  if (m <= 4) return 'petals';
  if (m <= 8) return h >= 19 || h < 5 ? 'fireflies' : 'none';
  return 'leaves';
}

type Achievement = BondView['achievements'][number];
/** Diffs bond snapshots; the first bond seen is the baseline so old unlocks never re-celebrate. */
export class AchievementWatcher {
  private known?: Set<string>;
  update(bond?: Pick<BondView, 'achievements'>): Achievement[] {
    if (!bond) return [];
    const unlocked = bond.achievements.filter(a => a.unlockedAt);
    if (!this.known) { this.known = new Set(unlocked.map(a => a.id)); return []; }
    const fresh = unlocked.filter(a => !this.known!.has(a.id));
    for (const a of fresh) this.known.add(a.id);
    return fresh;
  }
}
/** Distinct pets the user has worn; capped so storage stays tiny. */
export const addSeen = (list: readonly string[], id: string) => (!id || list.includes(id) ? [...list] : [...list, id].slice(-40));

/** ↑↑↓↓←→←→BA anywhere in the window. */
export function konami(onUnlock: () => void) {
  const code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let index = 0;
  window.addEventListener('keydown', event => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    index = key === code[index] ? index + 1 : key === code[0] ? 1 : 0;
    if (index === code.length) { index = 0; onUnlock(); }
  });
}
