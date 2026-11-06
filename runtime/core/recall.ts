// 回溯：主代理和并行代理查“以前的事”。聊天原话、梗概、执行任务、每日档案都永久留在本机 SQLite，这里只做检索。
// 搜索只给片段，要看全文再 read_history；被用户删除（tombstone）的内容永远搜不到。
import type { HistoryHit, HistoryScope, Message } from '../shared/contracts';
import type { Brief } from './helpers';
import type { DailyArchive } from './daily';
import { grams, type Store } from './store';

const KINDS: Record<HistoryScope, string[]> = { all: ['message', 'brief', 'task-run', 'daily-archive'], chat: ['message'], brief: ['brief'], task: ['task-run'], archive: ['daily-archive'] };
const LABEL: Record<string, HistoryHit['kind']> = { message: 'chat', brief: 'brief', 'task-run': 'task', 'daily-archive': 'archive' };
type TaskRecord = { id: string; task: string; summary?: string; startedAt?: string; completedAt?: string };
type Row = { id: string; kind: HistoryHit['kind']; at: string; who?: string; title?: string; text: string; channel?: string };

function toRow(store: Store, id: string): Row | undefined {
  const kind = store.kind(id), body = store.get<any>(id); if (!kind || !body) return undefined;
  if (kind === 'message') { const m = body as Message; return { id, kind: 'chat', at: m.createdAt, who: m.role === 'user' ? '用户' : m.speaker || '角色', text: m.text, ...(m.channel ? { channel: m.channel } : {}) }; }
  if (kind === 'brief') { const b = body as Brief; return { id, kind: 'brief', at: new Date(b.at).toISOString(), title: b.goal, text: [b.gist, ...b.points].join('\n') }; }
  if (kind === 'task-run') { const t = body as TaskRecord; return { id, kind: 'task', at: t.completedAt || t.startedAt || '', title: t.task.slice(0, 80), text: t.summary || t.task }; }
  if (kind === 'daily-archive') { const a = body as DailyArchive; const ms = Date.parse(a.day + 'T12:00:00'); return { id, kind: 'archive', at: Number.isFinite(ms) ? new Date(ms).toISOString() : a.day + 'T12:00:00Z', title: a.title, text: [a.summary, ...a.topics, ...a.highlights].join('\n') }; }
  return undefined;
}
/** A window of text around the first place the query appears. */
export function snippet(text: string, query: string, width = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim(), low = flat.toLowerCase(), q = query.trim().toLowerCase();
  let at = q ? low.indexOf(q) : -1;
  if (at < 0) for (const term of grams(query)) { at = low.indexOf(term); if (at >= 0) break; }
  if (at < 0 || flat.length <= width) return flat.slice(0, width) + (flat.length > width ? '…' : '');
  const start = Math.max(0, at - Math.floor(width / 3));
  return (start ? '…' : '') + flat.slice(start, start + width) + (start + width < flat.length ? '…' : '');
}
const dayStart = (day?: string) => day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day + 'T00:00:00') : undefined;

export function searchHistory(store: Store, query: string, o: { scope?: HistoryScope; since?: string; until?: string; limit?: number } = {}): HistoryHit[] {
  const q = query.trim(), scope = o.scope && KINDS[o.scope] ? o.scope : 'all', limit = Math.max(1, Math.min(50, o.limit ?? 12));
  const from = dayStart(o.since), toDay = dayStart(o.until), to = toDay === undefined ? undefined : toDay + 86400_000;
  const dead = store.deadIds();
  // With no words the list is simply the newest (the 「查过的资料」 shelf); messages need a query, there are too many to browse.
  const ids = q ? store.historyIds(q, KINDS[scope]) : KINDS[scope].filter(k => k !== 'message').flatMap(k => store.all<{ id: string }>(k).map(r => k === 'brief' ? 'brief:' + r.id : k === 'task-run' ? 'task-run:' + r.id : r.id));
  const rows = ids.filter(id => !dead.has(id)).map(id => toRow(store, id)).filter((r): r is Row => !!r).filter(r => { const t = Date.parse(r.at); return (from === undefined || t >= from) && (to === undefined || t < to); });
  const exact = (r: Row) => q && `${r.title || ''}\n${r.text}`.toLowerCase().includes(q.toLowerCase()) ? 1 : 0;
  // An exact phrase beats scattered bigrams; within each group keep the index's ranking (with no query, newest first).
  const sorted = q ? rows.map((r, i) => [r, i] as const).sort((a, b) => exact(b[0]) - exact(a[0]) || a[1] - b[1]).map(x => x[0]) : rows.sort((a, b) => b.at.localeCompare(a.at));
  return sorted.slice(0, limit).map(r => ({ id: r.id, kind: r.kind, at: r.at, ...(r.who ? { who: r.who } : {}), ...(r.title ? { title: r.title } : {}), ...(r.channel === 'wechat' ? { channel: 'wechat' as const } : {}), snippet: snippet(r.text, q) }));
}

/** The full record behind a hit; for chat, the conversation around it. */
export function readHistory(store: Store, rawId: string, around = 8): unknown {
  const id = ['', 'brief:', 'task-run:', 'daily:'].map(p => p ? p + rawId.replace(new RegExp('^' + p), '') : rawId).find(k => !store.dead(k) && !!store.kind(k));
  if (!id) return undefined;
  const kind = store.kind(id), body = store.get<any>(id); if (!kind || !body || !LABEL[kind]) return undefined;
  if (kind === 'message') {
    const dead = store.deadIds(), all = store.all<Message>('message').filter(m => !dead.has(m.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const at = all.findIndex(m => m.id === id); if (at < 0) return undefined;
    return { kind: 'chat', messages: all.slice(Math.max(0, at - around), at + around + 1).map(m => ({ id: m.id, at: m.createdAt, who: m.role === 'user' ? '用户' : m.speaker || '角色', text: m.text, ...(m.id === id ? { hit: true } : {}) })) };
  }
  if (kind === 'brief') { const b = body as Brief; return { kind: 'brief', id: b.id, by: b.by, at: new Date(b.at).toISOString(), goal: b.goal, gist: b.gist, points: b.points, sources: b.sources, ...(b.gaps ? { gaps: b.gaps } : {}) }; }
  if (kind === 'task-run') { const t = body as TaskRecord; return { kind: 'task', at: t.completedAt || t.startedAt, task: t.task, summary: t.summary }; }
  const a = body as DailyArchive; return { kind: 'archive', day: a.day, title: a.title, summary: a.summary, topics: a.topics, highlights: a.highlights, openThreads: a.openThreads };
}
