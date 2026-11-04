// 「TA 眼中的你」：把已有的记忆、每日档案和聊天时间整理成一页可读、可纠正的画像。
// 全部在本机按规则归类与统计，不额外调用模型；每一条都能追溯到原始记忆或档案，用户可以纠正或删除。
import type { DailyArchiveView, MemoryItem } from './contracts';

export type ProfileGroup = 'likes' | 'rhythm' | 'busy' | 'people' | 'us' | 'other';
export const PROFILE_GROUPS: { id: ProfileGroup; title: string; hint: string }[] = [
  { id: 'likes', title: '喜好与习惯', hint: '你喜欢什么、不碰什么' },
  { id: 'rhythm', title: '作息', hint: '你说过的作息与日常节奏' },
  { id: 'busy', title: '在忙的事', hint: '工作、学习和正在推进的事' },
  { id: 'people', title: '身边的人和小动物', hint: '你提起过的人' },
  { id: 'us', title: '我们之间', hint: '一起经历过的事' },
  { id: 'other', title: '其他', hint: '还没归类的事实' },
];
const RULES: [ProfileGroup, RegExp][] = [
  ['rhythm', /起床|早起|晚睡|熬夜|失眠|午睡|睡觉|入睡|作息|通勤|上班时间|下班|早上|晚上|夜里|凌晨|每天|周末/],
  ['people', /朋友|家人|妈|爸|父母|爷爷|奶奶|外公|外婆|哥|姐|弟|妹|女朋友|男朋友|对象|老婆|老公|同事|同学|室友|老板|领导|孩子|儿子|女儿|猫|狗|宠物/],
  ['busy', /工作|项目|面试|考试|复习|学习|论文|毕设|上课|作业|公司|加班|上线|需求|汇报|周报|deadline|ddl|备考|实习|求职|代码|写代码/i],
  ['likes', /喜欢|爱吃|爱喝|爱看|爱玩|最爱|讨厌|不喜欢|不吃|不喝|过敏|偏好|口味|习惯|常听|常看|常玩|收藏|擅长|害怕|怕/],
];

/** Which group a memory belongs to: shared experiences are 我们之间, facts go by keyword, the character's own feelings are left out. */
export function profileGroup(m: Pick<MemoryItem, 'kind' | 'text'>): ProfileGroup | undefined {
  if (m.kind === 'reflection') return undefined;
  if (m.kind === 'episode') return 'us';
  for (const [group, re] of RULES) if (re.test(m.text)) return group;
  return 'other';
}

export function groupMemories(memories: MemoryItem[]): Record<ProfileGroup, MemoryItem[]> {
  const out = Object.fromEntries(PROFILE_GROUPS.map(g => [g.id, [] as MemoryItem[]])) as Record<ProfileGroup, MemoryItem[]>;
  for (const m of memories) { if (!m.valid) continue; const g = profileGroup(m); if (g) out[g].push(m); }
  for (const list of Object.values(out)) list.sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3) || b.createdAt.localeCompare(a.createdAt));
  return out;
}

/** What has been on the user's plate lately: topics and open threads from the last `days` archives, most frequent first. */
export function recentFocus(archives: DailyArchiveView[], days = 7, now = Date.now()): { topics: { text: string; days: number }[]; threads: { text: string; day: string }[] } {
  const since = new Date(now - days * 86400_000).toLocaleDateString('en-CA');
  const recent = archives.filter(a => a.day >= since);
  const count = new Map<string, number>();
  for (const a of recent) for (const t of new Set(a.topics.map(x => x.trim()).filter(Boolean))) count.set(t, (count.get(t) || 0) + 1);
  const topics = [...count].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([text, n]) => ({ text, days: n }));
  const newest = [...recent].sort((a, b) => b.day.localeCompare(a.day));
  const seen = new Set<string>(), threads: { text: string; day: string }[] = [];
  for (const a of newest) for (const t of a.openThreads) if (!seen.has(t)) { seen.add(t); threads.push({ text: t, day: a.day }); }
  return { topics, threads: threads.slice(0, 8) };
}

export type Rhythm = { days: number; messages: number; hours: number[]; peak?: [number, number]; lateNights: number; weekend: number; weekday: number };
/** When the user actually talks to TA (local hours of their own messages). Only counts — no text. */
export function rhythmOf(times: number[], now = Date.now(), windowDays = 30): Rhythm {
  const since = now - windowDays * 86400_000, hours = Array(24).fill(0) as number[], days = new Set<string>(), late = new Set<string>();
  let weekend = 0, weekday = 0, messages = 0;
  for (const t of times) {
    if (!Number.isFinite(t) || t < since || t > now) continue;
    const d = new Date(t), h = d.getHours();
    hours[h]++; messages++; days.add(d.toLocaleDateString('en-CA'));
    if (h < 4) late.add(new Date(t - 4 * 3600_000).toLocaleDateString('en-CA'));
    if (d.getDay() === 0 || d.getDay() === 6) weekend++; else weekday++;
  }
  // The busiest 4-hour stretch (wrapping past midnight).
  let peak: [number, number] | undefined, best = 0;
  if (messages >= 10) for (let start = 0; start < 24; start++) { let sum = 0; for (let k = 0; k < 4; k++) sum += hours[(start + k) % 24]; if (sum > best) { best = sum; peak = [start, (start + 4) % 24]; } }
  return { days: days.size, messages, hours, ...(peak ? { peak } : {}), lateNights: late.size, weekend, weekday };
}
