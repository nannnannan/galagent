import { randomUUID } from 'node:crypto';
import type { Message } from '../shared/contracts';
import type { Store } from './store';

export type CareEvent = {
  id: string;
  title: string;
  quote: string;
  when?: string;
  followAt: number;
  status: 'open' | 'resolved' | 'paused';
  revision: number;
  askedRevision?: number;
  nextTryAt?: number;
  lastAskedAt?: number;
  updatedAt: number;
  sourceIds: string[];
};
const DAY = 86400_000;
const PAUSE = /不想.{0,5}聊|先别.{0,5}(聊|问|提)|别再.{0,5}(问|提|聊)|不要.{0,5}(问|提|聊)/;
const RESOLVED = /通过|没过|过了|结束|完成|搞定|解决|取消|录用|拒绝|落选|放弃/;

export const carePrompt = `
careEvents 是用户正在经历的事，latestQuote 与 when 均来自用户自己的话。可以自然接上，resolved 已结束，paused 不主动提。
仅在直接聊天中，用户明确提到一件有后续的事时，可附 careUpdates 数组（最多3条）：
{"id":"更新已有事件时填其id，新事件省略","title":"新事件的名称，必须逐字出现在用户本轮原话中","quote":"用户本轮相关原话的完整连续片段","when":"用户本轮给出的时间原话，可省略","status":"open|resolved|paused"}。
用户只是说爱好、引用别人、假设或提问，不创建事件。不确定两句话是不是同一件事，就先问清楚，不擅自关联。改期更新已有 id；已结束或不想聊的事更新 status。不要根据自己的回答、网页或观察创建事件。不代用户决定结果。`;

/** Ask after the stated time/period; never turn an imprecise day into an invented appointment time. */
export function followupTime(text: string | undefined, now: number): number {
  if (!text) return now + 2 * DAY;
  const date = new Date(now);
  const explicit = /(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/.exec(text);
  const monthDay = /(\d{1,2})月(\d{1,2})日?/.exec(text);
  let known = true;
  if (explicit || monthDay) {
    const year = explicit ? +explicit[1] : date.getFullYear();
    const month = +(explicit ? explicit[2] : monthDay![1]);
    const day = +(explicit ? explicit[3] : monthDay![2]);
    date.setFullYear(year, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return now + 2 * DAY;
  } else if (/后天/.test(text)) date.setDate(date.getDate() + 2);
  else if (/明天/.test(text)) date.setDate(date.getDate() + 1);
  else if (/今天/.test(text)) {
    /* same date */
  } else {
    const weekday = /(?:(下|本|这)(?:个)?(?:周|星期)|周|星期)([一二三四五六日天])/.exec(text);
    if (weekday) {
      const target = '日一二三四五六'.indexOf(weekday[2] === '天' ? '日' : weekday[2]);
      const current = date.getDay();
      const delta =
        weekday[1] === '下'
          ? 7 - ((current + 6) % 7) + ((target + 6) % 7)
          : weekday[1]
            ? ((target + 6) % 7) - ((current + 6) % 7)
            : (target - current + 7) % 7;
      date.setDate(date.getDate() + delta);
    } else if (/下周|下星期/.test(text)) {
      date.setDate(date.getDate() + 14 - ((date.getDay() + 6) % 7));
      date.setHours(10, 0, 0, 0);
      return date.getTime();
    } else known = false;
  }
  if (!known) return now + 2 * DAY;
  const clock = /(\d{1,2})[:：点时](\d{1,2})?/.exec(text);
  if (clock && +clock[1] < 24 && +(clock[2] || 0) < 60) {
    let hour = +clock[1];
    if (/下午|晚上/.test(text) && hour < 12) hour += 12;
    date.setHours(hour, +(clock[2] || 0), 0, 0);
    return Math.max(now + 60000, date.getTime() + 2 * 3600_000);
  }
  if (/上午|早上/.test(text)) date.setHours(13, 0, 0, 0);
  else if (/下午/.test(text)) date.setHours(19, 0, 0, 0);
  else {
    date.setDate(date.getDate() + 1);
    date.setHours(10, 0, 0, 0);
  }
  return Math.max(now + 60000, date.getTime());
}

export function validateCareArchive(raw: unknown, source: (id: string) => Message | undefined): CareEvent[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 500) throw new Error('跟进事项存档格式无效');
  for (const event of raw) {
    if (
      !event ||
      typeof event.id !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(event.id) ||
      typeof event.title !== 'string' ||
      !event.title.trim() ||
      event.title.length > 60 ||
      typeof event.quote !== 'string' ||
      !event.quote.trim() ||
      event.quote.length > 300 ||
      !['open', 'paused', 'resolved'].includes(event.status) ||
      !Number.isInteger(event.revision) ||
      event.revision < 1 ||
      !Number.isFinite(event.followAt) ||
      !Number.isFinite(event.updatedAt) ||
      event.followAt < 0 ||
      event.followAt > event.updatedAt + 366 * DAY ||
      !Array.isArray(event.sourceIds) ||
      !event.sourceIds.length ||
      event.sourceIds.length > 60 ||
      event.sourceIds.some((id: unknown) => typeof id !== 'string' || source(id)?.role !== 'user') ||
      !event.sourceIds.some((id: string) => source(id)!.text.includes(event.quote)) ||
      (event.when !== undefined &&
        (typeof event.when !== 'string' ||
          event.when.length > 60 ||
          !event.sourceIds.some((id: string) => source(id)!.text.includes(event.when)))) ||
      ['nextTryAt', 'lastAskedAt', 'askedRevision'].some(
        (key) => event[key] !== undefined && !Number.isFinite(event[key]),
      )
    )
      throw new Error('跟进事项来源或字段无效');
  }
  return raw as CareEvent[];
}

export class CareEvents {
  constructor(private store: Store) {}
  private sources(prior: CareEvent | undefined, source: Message, when?: string) {
    const earlier = prior?.sourceIds || [];
    const timeSource = when && !source.text.includes(when)
      ? [...earlier].reverse().find(id => this.store.get<Message>(id)?.text.includes(when)) : undefined;
    // Keep the evidence behind the title and current time, even after many updates.
    return [...new Set([earlier[0], timeSource, ...earlier.slice(-57), source.id].filter((id): id is string => !!id))];
  }
  private valid(event: CareEvent) {
    return (
      Array.isArray(event.sourceIds) &&
      event.sourceIds.length > 0 &&
      event.sourceIds.every((id) => this.store.kind(id) === 'message' && !this.store.dead(id)) &&
      event.sourceIds.some(id => this.store.get<Message>(id)?.text.includes(event.quote)) &&
      (!event.when || event.sourceIds.some(id => this.store.get<Message>(id)?.text.includes(event.when!)))
    );
  }
  all() {
    return this.store.all<CareEvent>('care-event').filter((event) => this.valid(event));
  }
  purgeInvalid() {
    for (const event of this.store.all<CareEvent>('care-event')) if (!this.valid(event)) this.store.remove(event.id);
  }
  context() {
    return this.all()
      .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.updatedAt - a.updatedAt)
      .slice(0, 12)
      .map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        when: e.when,
        latestQuote: e.quote,
        alreadyAsked: e.askedRevision === e.revision,
      }));
  }
  apply(updates: unknown, source: Message, now = Date.parse(source.createdAt)) {
    if (source.role !== 'user' || source.source !== 'chat') return;
    const last = this.all()
      .filter((e) => e.status === 'open' && e.lastAskedAt && now - e.lastAskedAt < 45 * 60000)
      .sort((a, b) => b.lastAskedAt! - a.lastAskedAt!)[0];
    if (
      last &&
      /^(?:我)?(?:现在|今天|暂时)?(?:不想|先别|别再|不要)/.test(source.text.trim()) &&
      PAUSE.test(source.text)
    )
      this.save({
        ...last,
        status: 'paused',
        quote: source.text.slice(0, 300),
        sourceIds: this.sources(last, source, last.when),
        updatedAt: now,
        revision: last.revision + 1,
      });
    if (!Array.isArray(updates)) return;
    for (const raw of updates.slice(0, 3)) {
      if (!raw || typeof raw !== 'object') continue;
      const quote = typeof raw.quote === 'string' ? raw.quote.trim() : '';
      if (
        quote.length < 2 ||
        quote.length > 300 ||
        !source.text.includes(quote) ||
        /如果|假如|假设|举例|比如说/.test(source.text)
      )
        continue;
      if (!['open', 'resolved', 'paused'].includes(raw.status)) continue;
      if (raw.status === 'resolved' && !RESOLVED.test(quote)) continue;
      if (raw.status === 'paused' && !PAUSE.test(quote)) continue;
      const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 60) : '';
      const all = this.all();
      const prior =
        typeof raw.id === 'string'
          ? all.find((e) => e.id === raw.id)
          : all.find((e) => e.status === 'open' && e.title === title);
      if (raw.id && !prior) continue;
      if (
        !prior &&
        (!title ||
          !quote.includes(title) ||
          raw.status !== 'open' ||
          all.filter((e) => e.status === 'open').length >= 20)
      )
        continue;
      if (
        prior?.status === 'paused' &&
        raw.status === 'open' &&
        !/继续|接着|重新|可以聊|改到|改期|安排/.test(quote)
      )
        continue;
      if (prior?.status === 'resolved' && raw.status === 'open' && !/重新|又|复试|下一轮/.test(quote))
        continue;
      const when =
        typeof raw.when === 'string' && raw.when.length <= 60 && quote.includes(raw.when)
          ? raw.when
          : undefined;
      const changedTime = /改期|改到|推迟|提前|延期/.test(quote);
      if (prior && prior.quote === quote && prior.status === raw.status && (!when || prior.when === when))
        continue;
      const followAt = when || changedTime || !prior ? followupTime(when, now) : prior.followAt;
      if (followAt > now + 366 * DAY) continue;
      const event: CareEvent = {
        id: prior?.id || randomUUID(),
        title: prior?.title || title,
        quote,
        when: when ?? (changedTime ? undefined : prior?.when),
        status: raw.status,
        followAt,
        revision: (prior?.revision || 0) + 1,
        updatedAt: now,
        sourceIds: this.sources(prior, source, when ?? (changedTime ? undefined : prior?.when)),
        lastAskedAt: prior?.lastAskedAt,
      };
      this.save(event);
    }
  }
  candidate(now: number) {
    return this.all()
      .filter(
        (e) =>
          e.status === 'open' &&
          e.askedRevision !== e.revision &&
          e.followAt <= now &&
          (e.nextTryAt || 0) <= now &&
          (!e.lastAskedAt || now - e.lastAskedAt >= DAY),
      )
      .sort((a, b) => a.followAt - b.followAt)[0];
  }
  current(id: string, revision: number) {
    return this.all().find((e) => e.id === id && e.revision === revision && e.status === 'open');
  }
  attempt(e: CareEvent, now: number) {
    this.save({ ...e, nextTryAt: now + 2 * 3600_000 });
  }
  asked(id: string, revision: number, now: number) {
    const e = this.current(id, revision);
    if (e) this.save({ ...e, askedRevision: revision, lastAskedAt: now });
  }
  private save(e: CareEvent) {
    this.store.put('care-event', e.id, e);
  }
}
