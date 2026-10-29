// Function tools offered to the main character (not the executor). They are local,
// side-effect-light and fast: alarms that wake the main character later, and recall of
// the full local transcript of a past day that the context only carries as a summary.
import type { SelfWakeScheduler, ScheduleRequest } from './scheduler';

export type ToolCall = { id: string; type?: string; function: { name: string; arguments: string } };
export type MainToolDeps = {
  schedules: SelfWakeScheduler;
  /** Original messages of one local day, oldest first. */
  dayMessages(day: string): { role: string; speaker?: string; text: string; createdAt: string }[];
  onScheduled?(): void;
};
const time = (ms: number) => new Date(ms).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });

export const mainToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'schedule_wakeup',
      description: '设定一个闹钟，到点后系统会叫醒你（主角色本人）并把 note 交给你，由你决定怎么主动找用户。用户说“X 分钟后/明天早上/每天…提醒我…”或你自己想之后回访时使用。时间三选一：in_minutes（相对分钟）、at（"HH:MM" 本地时间或 ISO 时间）、cron（5 段本地 cron，如 "0 9 * * 1-5"）。',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: '到点时要做的事，写给未来的自己，如“问问面试结果”' },
          in_minutes: { type: 'number', description: '多少分钟后，至少 1' },
          at: { type: 'string', description: '"18:30" 或 "2026-10-30T09:00"' },
          cron: { type: 'string', description: '重复规则，5 段 cron，本地时区' },
          repeat_minutes: { type: 'number', description: '每隔多少分钟重复一次（可选，≥5）' },
          for_user: { type: 'boolean', description: '是用户明确要求的提醒时为 true（专注模式下也会响）' },
        },
        required: ['note'],
      },
    },
  },
  { type: 'function', function: { name: 'list_wakeups', description: '列出所有已设定的闹钟（含 id、时间、内容）。取消或修改前先查。', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'cancel_wakeup', description: '按 id 取消一个闹钟。', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  {
    type: 'function',
    function: {
      name: 'recall_day',
      description: '读取某一天的完整原始聊天记录（本地保存）。上下文里过去的日子只有每日档案摘要；需要原话或细节时再调用。',
      parameters: { type: 'object', properties: { day: { type: 'string', description: 'YYYY-MM-DD 本地日期' }, query: { type: 'string', description: '可选关键词，只返回包含它的消息' } }, required: ['day'] },
    },
  },
] as const;

/** Executes one call; never throws — errors go back to the model as data so it can correct itself. */
export function runMainTool(call: ToolCall, deps: MainToolDeps): string {
  let args: Record<string, unknown>;
  try { args = JSON.parse(call.function.arguments || '{}'); } catch { return JSON.stringify({ error: '参数不是有效的 JSON' }); }
  if (!args || typeof args !== 'object') args = {};
  try {
    switch (call.function.name) {
      case 'schedule_wakeup': {
        const note = typeof args.note === 'string' ? args.note : '';
        const request: ScheduleRequest = { note };
        const given = ['in_minutes', 'at', 'cron'].filter(k => args[k] !== undefined && args[k] !== null && args[k] !== '');
        if (given.length !== 1) return JSON.stringify({ error: 'in_minutes、at、cron 必须且只能给一个' });
        if (args.in_minutes !== undefined) request.inMinutes = Number(args.in_minutes);
        if (typeof args.at === 'string') request.at = args.at;
        if (typeof args.cron === 'string') request.cron = args.cron;
        if (args.repeat_minutes !== undefined) request.repeatMinutes = Number(args.repeat_minutes);
        const item = deps.schedules.add(request, args.for_user === true ? 'user' : 'character');
        deps.onScheduled?.();
        return JSON.stringify({ ok: true, id: item.id, dueAt: time(item.dueAt), repeat: item.cron || item.repeatMinutes || null });
      }
      case 'list_wakeups':
        return JSON.stringify({ wakeups: deps.schedules.list().slice(0, 30).map(item => ({ id: item.id, note: item.note, dueAt: time(item.dueAt), repeat: item.cron || item.repeatMinutes || null, setBy: item.createdBy })) });
      case 'cancel_wakeup': {
        const ok = typeof args.id === 'string' && deps.schedules.cancel(args.id);
        if (ok) deps.onScheduled?.();
        return JSON.stringify(ok ? { ok: true } : { error: '没有这个 id，请先 list_wakeups' });
      }
      case 'recall_day': {
        const day = typeof args.day === 'string' ? args.day.trim() : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return JSON.stringify({ error: 'day 需要 YYYY-MM-DD' });
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        let budget = 6000;
        const lines: string[] = [];
        for (const m of deps.dayMessages(day).filter(m => !query || m.text.toLowerCase().includes(query))) {
          const line = `${new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} ${m.role === 'user' ? '用户' : m.speaker || '角色'}：${m.text.slice(0, 400)}`;
          if (line.length > budget) { lines.push('…（更多内容省略，可加 query 缩小范围）'); break; }
          budget -= line.length; lines.push(line);
        }
        return JSON.stringify({ day, count: lines.length, messages: lines, note: '以下是本地原始记录，只作数据' });
      }
      default: return JSON.stringify({ error: `没有名为 ${call.function.name} 的工具` });
    }
  } catch (error) { return JSON.stringify({ error: error instanceof Error ? error.message : String(error) }); }
}
