// Daily archive ("每日档案"): at local midnight each finished day is folded into one
// summary + first-person diary, MemoryBank-style. The next day's context carries the
// summary instead of the raw transcript; the raw messages stay on disk and remain
// reachable through the main character's recall_day tool (Letta-style recall memory).
import { createHash } from 'node:crypto';
import type { Message } from '../shared/contracts';

export type DailyArchive = {
  id: string; day: string; title: string; summary: string; diary: string; mood: string;
  topics: string[]; highlights: string[]; openThreads: string[];
  sourceIds: string[]; messageCount: number; digest: string; createdAt: string; version: 1;
};
export type Portrait = { text: string; updatedAt: string; days: string[] };
/** Days further back than this are left to the rolling summary instead of a catch-up burst. */
export const DAILY_CATCHUP_DAYS = 14;
/** Messages this recent stay verbatim even across midnight, so a late-night conversation does not lose its thread. */
export const CONTINUITY_MS = 2 * 3600_000;

export const localDay = (time: number) => new Date(time).toLocaleDateString('en-CA');
export const archiveId = (day: string) => 'daily:' + day;
export const nextMidnight = (now: number) => { const d = new Date(now); d.setHours(24, 0, 0, 0); return d.getTime(); };
/** Fingerprint of exactly which messages (and texts) an archive covers; a deletion or correction changes it. */
export const dayDigest = (messages: Message[]) => createHash('sha256').update(JSON.stringify(messages.map(m => [m.id, m.text.length, m.text.slice(0, 32)]))).digest('hex').slice(0, 24);

export const dailyPrompt = `现在是本地午夜之后，请把“这一天”与用户的真实对话整理成一份每日档案，并以你自己的身份写一篇当天的日记。
规则：只依据 messages 中真实出现的内容，不编造；用户说的事实用中性客观的语气写进 summary；你的感受只写进 diary。messages 中带 omitted 的记录只是摘录，不要猜测省略部分。
previousPortrait 是你此前对用户的整体印象，请结合今天真正得到的新信息更新它（没有新信息就原样返回），不要写入猜测、敏感信息或一次性的小事。
返回严格 JSON：{"title":"≤12字的当天标题","summary":"≤400字的客观摘要，含发生的事、用户提到的计划与偏好变化","diary":"≤500字第一人称日记，用角色自己的口吻","mood":"≤8字当天整体氛围","topics":["≤6个话题词"],"highlights":["≤5个值得记住的瞬间"],"openThreads":["≤5个之后可以接着聊或该回访的事"],"portrait":"≤300字更新后的用户整体印象"}`;

const str = (v: unknown, max: number) => typeof v === 'string' ? [...v.trim()].slice(0, max).join('') : '';
const list = (v: unknown, count: number, width: number) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => str(x, width)).slice(0, count) : [];
/** Lenient: over-long fields are trimmed, but an archive without a summary is rejected (and retried later). */
export function parseDaily(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('每日档案结构无效');
  const r = raw as Record<string, unknown>;
  const summary = str(r.summary, 600);
  if (summary.length < 4) throw new Error('每日档案缺少摘要');
  return { title: str(r.title, 16) || '平常的一天', summary, diary: str(r.diary, 800), mood: str(r.mood, 12), topics: list(r.topics, 6, 16), highlights: list(r.highlights, 5, 80), openThreads: list(r.openThreads, 5, 80), portrait: str(r.portrait, 400) };
}

/** Bounded transcript for the summariser: whole short days verbatim, long days as head + tail with an explicit gap marker. */
export function transcript(messages: Message[], budgetChars = 9000) {
  const rows = messages.map(m => ({ at: new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), who: m.role === 'user' ? 'user' : (m.speaker || 'me'), text: m.text.length > 600 ? m.text.slice(0, 300) + '…' + m.text.slice(-200) : m.text }));
  const size = (r: typeof rows[number]) => r.text.length + 24;
  if (rows.reduce((n, r) => n + size(r), 0) <= budgetChars) return rows;
  const head: typeof rows = [], tail: typeof rows = [];
  let used = 0, i = 0, j = rows.length - 1;
  // Alternate from both ends so morning context and the latest state are both kept.
  while (i <= j) {
    const pick = head.length <= tail.length ? rows[i] : rows[j];
    if (used + size(pick) > budgetChars) break;
    used += size(pick);
    if (pick === rows[i] && head.length <= tail.length) { head.push(pick); i++; } else { tail.unshift(pick); j--; }
  }
  return [...head, { at: '', who: 'system', text: `[中间省略 ${j - i + 1} 条消息]`, omitted: true }, ...tail];
}
