// 自己的小日程 (活人感): what the character is "up to" at each time of day. A card may define its own
// routine; otherwise one is derived from the card's likes. It is presented as role-play colour, never as a
// record of things that really happened.
import type { PetAction } from './contracts';

export type RoutineEntry = { at: string; activity: string; action?: PetAction };
export const ROUTINE_LIMITS = { entries: 16, activity: 12 } as const;
const minutes = (at: string) => { const [h, m] = at.split(':').map(Number); return h * 60 + m; };
const clock = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Up to two short hobbies from the card's likes, e.g. "星空、化石、做实验" → ["星空", "化石"]. */
export function hobbies(likes: string): string[] {
  return likes.split(/[、，,；;\/和与\s]+/u).map(x => x.trim()).filter(x => x && [...x].length <= 8).slice(0, 2);
}
export function defaultRoutine(likes = ''): RoutineEntry[] {
  const [a = '发呆', b = a === '发呆' ? '看窗外的云' : a] = hobbies(likes);
  const time = (h: string) => (/时间$/.test(h) || [...h].length > 5 ? h : `${h}时间`);
  return [
    { at: '07:00', activity: '伸懒腰起床' }, { at: '08:00', activity: '吃早餐' }, { at: '09:30', activity: time(a) },
    { at: '11:40', activity: '想午饭吃什么' }, { at: '12:40', activity: '午睡', action: 'sleep' }, { at: '13:30', activity: time(b) },
    { at: '15:30', activity: '喝下午茶' }, { at: '18:00', activity: '吃晚饭' }, { at: '19:30', activity: time(a) },
    { at: '21:30', activity: '写今天的小日记', action: 'doodle' }, { at: '23:30', activity: '准备睡觉' }, { at: '00:30', activity: '睡觉', action: 'sleep' },
  ];
}
/** Validates a card's own routine; throws Chinese messages like the rest of the card. */
export function normalizeRoutine(raw: unknown): RoutineEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('日程格式无效');
  const out: RoutineEntry[] = [];
  for (const item of raw.slice(0, ROUTINE_LIMITS.entries)) {
    if (!item || typeof item !== 'object') throw new Error('日程格式无效');
    const r = item as Record<string, unknown>;
    const at = typeof r.at === 'string' ? r.at.trim().replace('：', ':') : '';
    if (!clock.test(at)) throw new Error(`日程时间无效：${String(r.at ?? '')}`);
    const activity = typeof r.activity === 'string' ? [...r.activity.trim()].slice(0, ROUTINE_LIMITS.activity).join('') : '';
    if (!activity) continue;
    const action = r.action === 'sleep' || r.action === 'doodle' ? r.action : undefined;
    out.push({ at: at.padStart(5, '0'), activity, ...(action ? { action } : {}) });
  }
  return out.sort((x, y) => minutes(x.at) - minutes(y.at));
}
/** "07:30 起床" lines (the editor's text form) → entries; "午睡" / "睡觉" imply the sleep pose. */
export function parseRoutineLines(text: string): RoutineEntry[] {
  return normalizeRoutine(text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = /^(\d{1,2}[:：]\d{2})\s*(.+)$/.exec(line);
    if (!m) throw new Error(`日程每行要写成“07:30 起床”：${line}`);
    return { at: m[1], activity: m[2], ...(/睡/.test(m[2]) ? { action: 'sleep' } : /日记|画|写/.test(m[2]) ? { action: 'doodle' } : {}) };
  }));
}
export const routineLines = (entries: RoutineEntry[]) => entries.map(e => `${e.at} ${e.activity}`).join('\n');

/** The entry in effect at local time `now` (the routine wraps around midnight) and the next one. */
export function routineAt(entries: RoutineEntry[], now: Date): { current: RoutineEntry; next: RoutineEntry } | undefined {
  if (!entries.length) return undefined;
  const sorted = [...entries].sort((x, y) => minutes(x.at) - minutes(y.at)), t = now.getHours() * 60 + now.getMinutes();
  let index = sorted.length - 1;
  for (let i = 0; i < sorted.length; i++) if (minutes(sorted[i].at) <= t) index = i;
  return { current: sorted[index], next: sorted[(index + 1) % sorted.length] };
}
