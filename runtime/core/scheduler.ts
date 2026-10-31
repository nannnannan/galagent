// Self-wake alarms: the character (or the user) sets "wake me in N minutes and
// remind me of X". When one comes due the host wakes the character with the note,
// which is how a reply-only model gets to speak first without polling.
import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { ScheduleView } from '../shared/contracts';

export type SelfWake = { id: string; note: string; dueAt: number; repeatMinutes?: number; cron?: string; createdBy: 'character' | 'user'; createdAt: number };
export type ScheduleRequest = { note: string; inMinutes?: number; at?: string; cron?: string; repeatMinutes?: number };
export const SCHEDULE_LIMITS = { active: 30, note: 300, minMinutes: 1, maxMinutes: 60 * 24 * 30, minRepeat: 5, staleAfterMs: 12 * 3600_000 } as const;

/** Taught to the character in its system prompt; kept short on purpose. */
export const schedulePrompt = `定时自唤醒：想过一段时间再主动找用户（用户让你提醒、追问进展、约好的事），调用工具 schedule_wakeup（note + in_minutes / at / cron 三选一；用户明确要求的提醒设 for_user:true）；查看用 list_wakeups，取消用 cancel_wakeup。到点系统会叫醒你本人并把 note 交给你。若当前没有工具可用，也可以在 JSON 里加 "schedule":{"inMinutes":分钟数,"note":"到时要做的事"}（或 "at":"HH:MM"、"cron":"5段"、"repeatMinutes":N），取消用 "cancelSchedule":["id"]。确有需要才设，设好后用一句话告诉用户时间。过去日子的完整原话需要时用 recall_day 读取。
用户提到之后的具体事（面试、考试、看病等），用 schedule_wakeup 在事后设一次回访（note 写要问什么）。`;

/** "HH:MM" → next local occurrence; ISO strings as given. */
export function resolveAt(at: string, now: number): number {
  const clock = /^\s*(\d{1,2})[:：](\d{2})\s*$/.exec(at);
  if (clock) {
    const [h, m] = [Number(clock[1]), Number(clock[2])];
    if (h > 23 || m > 59) throw new Error('时间格式无效');
    const target = new Date(now); target.setHours(h, m, 0, 0);
    if (target.getTime() <= now) target.setDate(target.getDate() + 1);
    return target.getTime();
  }
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) throw new Error('时间格式无效');
  return parsed;
}

/** Lenient reading of the model's JSON field; anything malformed is ignored rather than failing the reply. */
export function readScheduleField(raw: unknown): ScheduleRequest | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const r = raw as Record<string, unknown>;
  const note = typeof r.note === 'string' ? r.note.trim() : typeof r.reason === 'string' ? r.reason.trim() : '';
  if (!note) return;
  const minutes = Number(r.inMinutes ?? r.minutes ?? r.afterMinutes);
  const at = typeof r.at === 'string' && r.at.trim() ? r.at.trim() : undefined;
  const cron = typeof r.cron === 'string' && r.cron.trim() ? r.cron.trim() : undefined;
  const repeat = Number(r.repeatMinutes);
  if (!at && !cron && !Number.isFinite(minutes)) return;
  return { note, ...(cron ? { cron } : at ? { at } : { inMinutes: minutes }), ...(Number.isFinite(repeat) && repeat > 0 ? { repeatMinutes: repeat } : {}) };
}

/** Next local fire time of a 5-field cron expression (shared with the executor's CronCreate). */
export function cronNext(expression:string,after:number):number {
 const parts=expression.trim().split(/\s+/);if(parts.length!==5)throw new Error('cron须为5个字段');
 const ranges=[[0,59],[0,23],[1,31],[1,12],[0,7]];
 const sets=parts.map((part,index)=>{const [min,max]=ranges[index],values=new Set<number>();for(const item of part.split(',')){const [base,stepRaw,...extra]=item.split('/'),step=stepRaw===undefined?1:Number(stepRaw);if(extra.length||!Number.isInteger(step)||step<1)throw new Error('cron步长无效');let first=min,last=max;if(base!=='*'){const terms=base.split('-');if(terms.length>2||terms.some(t=>!/^\d+$/.test(t)))throw new Error('cron字段无效');first=Number(terms[0]);last=terms.length===2?Number(terms[1]):stepRaw===undefined?first:max;}if(first<min||last>max||last<first)throw new Error('cron范围无效');for(let n=first;n<=last;n+=step)values.add(index===4&&n===7?0:n);}return values;});
 // User's local zone is Asia/Shanghai; a cron job stores local minute fields.
 for(let time=Math.floor(after/60000)*60000+60000,end=time+5*366*86400000;time<end;time+=60000){const d=new Date(time+8*3600000),dom=sets[2].has(d.getUTCDate()),dow=sets[4].has(d.getUTCDay());const dateMatch=parts[2]==='*'?dow:parts[4]==='*'?dom:dom||dow;if(sets[0].has(d.getUTCMinutes())&&sets[1].has(d.getUTCHours())&&sets[3].has(d.getUTCMonth()+1)&&dateMatch)return time;}
 throw new Error('未来5年没有匹配时间');
}

export class SelfWakeScheduler {
  constructor(private store: Store, private clock = () => Date.now()) {}
  list(): SelfWake[] { return this.store.all<SelfWake>('self-wake').sort((a, b) => a.dueAt - b.dueAt); }
  add(request: ScheduleRequest, createdBy: SelfWake['createdBy']): SelfWake {
    const now = this.clock();
    const note = request.note.trim().slice(0, SCHEDULE_LIMITS.note);
    if (!note) throw new Error('提醒内容不能为空');
    let dueAt: number;
    const cron = typeof request.cron === 'string' && request.cron.trim() ? request.cron.trim().replace(/\s+/g, ' ') : undefined;
    if (cron) dueAt = cronNext(cron, now);
    else if (request.at !== undefined) dueAt = resolveAt(request.at, now);
    else {
      const minutes = Number(request.inMinutes);
      if (!Number.isFinite(minutes) || minutes < SCHEDULE_LIMITS.minMinutes) throw new Error(`至少 ${SCHEDULE_LIMITS.minMinutes} 分钟后`);
      dueAt = now + minutes * 60_000;
    }
    if (dueAt <= now) throw new Error('提醒时间需要在未来');
    if (!cron && dueAt - now > SCHEDULE_LIMITS.maxMinutes * 60_000) throw new Error('最多提前 30 天');
    let repeatMinutes: number | undefined;
    if (request.repeatMinutes !== undefined) {
      repeatMinutes = Math.round(Number(request.repeatMinutes));
      if (!Number.isFinite(repeatMinutes) || repeatMinutes < SCHEDULE_LIMITS.minRepeat || repeatMinutes > SCHEDULE_LIMITS.maxMinutes) throw new Error(`重复间隔需在 ${SCHEDULE_LIMITS.minRepeat} 分钟到 30 天之间`);
    }
    const items = this.list();
    // The model tends to re-issue the same alarm on consecutive turns; keep one.
    // Only future alarms count: a snooze issued while an alarm rings must not merge into the one being completed.
    const duplicate = items.find(item => item.dueAt > now && item.note === note && Math.abs(item.dueAt - dueAt) < 5 * 60_000);
    if (duplicate) return duplicate;
    if (items.length >= SCHEDULE_LIMITS.active) throw new Error(`最多同时保留 ${SCHEDULE_LIMITS.active} 个定时提醒`);
    const item: SelfWake = { id: randomUUID(), note, dueAt, ...(cron ? { cron } : repeatMinutes ? { repeatMinutes } : {}), createdBy, createdAt: now };
    this.store.put('self-wake', item.id, item);
    return item;
  }
  cancel(id: string): boolean { if (this.store.kind(id) !== 'self-wake') return false; this.store.remove(id); return true; }
  due(now = this.clock()): SelfWake[] { return this.list().filter(item => item.dueAt <= now); }
  /** After delivery: repeating alarms move to their next future slot, one-shots disappear. */
  complete(item: SelfWake, now = this.clock()) {
    if (item.cron) { try { this.store.put('self-wake', item.id, { ...item, dueAt: cronNext(item.cron, now) }); } catch { this.store.remove(item.id); } return; }
    if (!item.repeatMinutes) { this.store.remove(item.id); return; }
    const step = item.repeatMinutes * 60_000;
    const dueAt = item.dueAt + Math.max(1, Math.ceil((now - item.dueAt + 1) / step)) * step;
    this.store.put('self-wake', item.id, { ...item, dueAt });
  }
  /** The character's own alarms that waited too long (quiet hours, app closed) are dropped; reminders the user set always ring, late if need be. */
  expire(now = this.clock()): SelfWake[] {
    const stale = this.due(now).filter(item => item.createdBy === 'character' && now - item.dueAt > SCHEDULE_LIMITS.staleAfterMs);
    for (const item of stale) this.complete(item, now);
    return stale;
  }
  view(now = this.clock()): ScheduleView[] {
    return this.list().map(item => ({ id: item.id, note: item.note, dueAt: new Date(item.dueAt).toISOString(), ...(item.repeatMinutes ? { repeatMinutes: item.repeatMinutes } : {}), ...(item.cron ? { cron: item.cron } : {}), createdBy: item.createdBy, createdAt: new Date(item.createdAt).toISOString(), ...(item.dueAt < now ? { lateBy: Math.round((now - item.dueAt) / 60_000) } : {}) }));
  }
  clear() { for (const item of this.list()) this.store.remove(item.id); }
}
