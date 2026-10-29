// Little captions, gestures and easter eggs for the pet. Everything here is local and
// cosmetic: no model call, nothing leaves the machine. This module stays free of DOM
// access at load time so its pure helpers can be unit-tested under node.
import type { AppSnapshot, BondView } from '../shared/contracts';

const generic = ['发呆中…', '数像素', '偷偷看你', '伸个懒腰', '听键盘声', '晒晒屏幕光', '整理小背包', '研究鼠标指针', '哼歌', '在想晚饭吃什么'];
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

/** Seasonal and clock-based lines; returns undefined most of the time so they stay special. */
export function timelyCaption(now = new Date()): string | undefined {
  const md = `${now.getMonth() + 1}-${now.getDate()}`, h = now.getHours(), dow = now.getDay();
  const days: Record<string, string> = { '1-1': '新年快乐！🎉', '2-14': '情人节快乐 ♥', '4-1': '今天说的话都可能是玩笑哦', '5-1': '劳动节快乐，记得休息', '6-1': '儿童节快乐！', '10-1': '国庆快乐！', '10-31': '不给糖就捣蛋 🎃', '12-24': '平安夜，吃苹果了吗', '12-25': '圣诞快乐 🎄', '12-31': '今年的最后一天，辛苦啦' };
  if (days[md] && Math.random() < 0.5) return days[md];
  if (h >= 0 && h < 5) return pick(['夜深了，该睡啦', '你也是夜猫子？', '月亮都困了']);
  if (h === 12 && Math.random() < 0.6) return '饭点到啦！';
  if (h >= 6 && h < 9 && Math.random() < 0.4) return pick(['早上好 ☀', '今天也要元气满满']);
  if (dow === 5 && h >= 16 && Math.random() < 0.5) return '周五啦，周末在招手';
  if (dow === 1 && h < 11 && Math.random() < 0.4) return '周一……一起加油吧';
  if (Math.random() < 0.02) return `今日幸运色：${pick(['薄荷绿', '奶油黄', '雾霾蓝', '樱花粉', '香芋紫', '橘子橙'])}`;
  return undefined;
}

export function idleCaption(snapshot: AppSnapshot): string {
  const own = snapshot.persona?.active.idleLines || [];
  return timelyCaption() || (own.length && Math.random() < 0.7 ? pick(own) : pick(generic));
}

/** Rapid taps make the pet dizzy; shaking it while dragging too. */
export class Mischief {
  private taps: number[] = [];
  private turns: number[] = [];
  private lastDx = 0;
  tap(now = performance.now()): { line: string; dizzy: boolean } | undefined {
    this.taps = [...this.taps.filter(t => now - t < 2200), now];
    if (this.taps.length === 5) return { line: pick(['别戳啦～会晕的', '再戳要生气了哦', '痒痒痒！']), dizzy: false };
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

export const patLines = ['嘿嘿，好舒服～', '再摸一下下', '头发要乱啦', '呼噜呼噜…', '被摸头了 (〃▽〃)'];
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
