// 自适应节奏：主动开口按用户的真实反应自己学分寸。
//
// 规则只朝“更安静”的方向走——用户设的间隔、每小时 / 每天上限是硬上限，这里只会把间隔拉长、把某类话题暂停，
// 永远不会让 TA 比用户设定的更频繁。被冷落的话题按次数退避，用户一回应（或点「这种挺好」）就立刻恢复。
// 只记录时间戳、话题类别与“有没有回应”，不保存任何消息原文。
import type { InitiativeTopic, PacingView, Observation, Message } from '../shared/contracts';

/** 用户点名要的、或用户自己设的事：不参与退避（任务结果、关注事项、定时提醒、连接状态）。 */
export const EXEMPT_TOPICS: ReadonlySet<InitiativeTopic> = new Set<InitiativeTopic>(['task', 'watch', 'schedule', 'system']);
/** 主动开口后这么久内用户说了话，就算“回应了”。 */
export const REPLY_WINDOW_MS = 45 * 60_000;
/** 同一话题连续被冷落这么多次才开始退避。 */
export const IGNORE_THRESHOLD = 2;
const BASE_BACKOFF_MS = 2 * 3600_000;
const MAX_BACKOFF_MS = 72 * 3600_000;
const RECENT = 12;

export type PacingEntry = { at: number; topics: InitiativeTopic[]; answered: boolean | null };
export type TopicPacing = { ignored: number; backoffUntil: number };
export type PacingLedger = { version: 1; recent: PacingEntry[]; topics: Partial<Record<InitiativeTopic, TopicPacing>> };

export const emptyPacing = (): PacingLedger => ({ version: 1, recent: [], topics: {} });

export function readPacing(raw: unknown, isTopic: (t: unknown) => t is InitiativeTopic): PacingLedger {
  const out = emptyPacing();
  if (!raw || typeof raw !== 'object' || (raw as PacingLedger).version !== 1) return out;
  const r = raw as PacingLedger;
  if (Array.isArray(r.recent)) for (const e of r.recent.slice(-RECENT)) {
    if (!e || !Number.isFinite(e.at) || !Array.isArray(e.topics)) continue;
    out.recent.push({ at: e.at, topics: e.topics.filter(isTopic).slice(0, 10), answered: e.answered === true ? true : e.answered === false ? false : null });
  }
  if (r.topics && typeof r.topics === 'object') for (const [t, v] of Object.entries(r.topics)) {
    if (!isTopic(t) || !v || !Number.isFinite(v.ignored) || !Number.isFinite(v.backoffUntil)) continue;
    out.topics[t] = { ignored: Math.max(0, Math.min(50, Math.floor(v.ignored))), backoffUntil: v.backoffUntil };
  }
  return out;
}

const adaptive = (topics: InitiativeTopic[]) => topics.filter(t => !EXEMPT_TOPICS.has(t));

/** TA 刚主动说了一句话（真的说出口了才记）。 */
export function noteInitiative(ledger: PacingLedger, topics: InitiativeTopic[], at: number): PacingLedger {
  const kept = adaptive([...new Set(topics)]);
  if (!kept.length) return ledger;
  const recent = [...ledger.recent, { at, topics: kept, answered: null }].slice(-RECENT);
  return { ...ledger, recent };
}

/** 用户说话了：窗口内还没结论的主动开口都算回应，它们的话题清零恢复。 */
export function noteUserReply(ledger: PacingLedger, at: number): PacingLedger {
  const latest = [...ledger.recent].reverse().find(e => e.answered === null && at >= e.at && at - e.at <= REPLY_WINDOW_MS);
  if (!latest) return ledger;
  const topics = { ...ledger.topics };
  for (const topic of adaptive(latest.topics)) delete topics[topic];
  return { ...ledger, topics, recent: ledger.recent.map(e => e === latest ? { ...e, answered:true } : e) };
}

/** 用户点了「这种挺好」：这些话题立刻恢复。 */
export function noteWelcome(ledger: PacingLedger, topics: InitiativeTopic[]): PacingLedger {
  const next = { ...ledger.topics };
  for (const t of topics) delete next[t];
  const recent = ledger.recent.map(e => e.answered === null && e.topics.some(t => topics.includes(t)) ? { ...e, answered: true } : e);
  return { ...ledger, recent, topics: next };
}

/** 过了回应窗口还没人理的，记为冷落；同一话题连续冷落达到阈值后按 2h、4h、8h… 退避，最长 3 天。 */
export function settlePacing(ledger: PacingLedger, now: number): PacingLedger {
  let changed = false;
  const topics = { ...ledger.topics };
  const recent = ledger.recent.map(e => {
    if (e.answered !== null || now - e.at <= REPLY_WINDOW_MS) return e;
    changed = true;
    for (const t of adaptive(e.topics)) {
      const ignored = (topics[t]?.ignored ?? 0) + 1;
      const backoff = ignored >= IGNORE_THRESHOLD ? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (ignored - IGNORE_THRESHOLD)) : 0;
      topics[t] = { ignored, backoffUntil: backoff ? Math.max(topics[t]?.backoffUntil ?? 0, e.at + REPLY_WINDOW_MS + backoff) : topics[t]?.backoffUntil ?? 0 };
    }
    return { ...e, answered: false };
  });
  return changed ? { ...ledger, recent, topics } : ledger;
}

export const topicPaused = (ledger: PacingLedger, topic: InitiativeTopic, now: number) => !EXEMPT_TOPICS.has(topic) && (ledger.topics[topic]?.backoffUntil ?? 0) > now;

/** 最近有结论的主动开口里被冷落的比例 → 间隔倍数（只会 ≥ 1）。样本少于 4 条时不调整。 */
export function intervalFactor(ledger: PacingLedger): { factor: number; ignoreRate: number; samples: number } {
  const settled = ledger.recent.filter(e => e.answered !== null && adaptive(e.topics).length);
  if (settled.length < 4) return { factor: 1, ignoreRate: 0, samples: settled.length };
  const ignoreRate = settled.filter(e => e.answered === false).length / settled.length;
  return { factor: ignoreRate >= 0.75 ? 3 : ignoreRate >= 0.5 ? 2 : 1, ignoreRate, samples: settled.length };
}

export function pacingView(ledger: PacingLedger, enabled: boolean, now: number): PacingView {
  const { factor, ignoreRate, samples } = intervalFactor(ledger);
  const paused = (Object.entries(ledger.topics) as [InitiativeTopic, TopicPacing][])
    .filter(([t, v]) => !EXEMPT_TOPICS.has(t) && v.backoffUntil > now)
    .map(([topic, v]) => ({ topic, until: v.backoffUntil, ignored: v.ignored }))
    .sort((a, b) => a.until - b.until);
  return enabled ? { enabled, factor, ignoreRate, samples, paused } : { enabled, factor: 1, ignoreRate, samples, paused: [] };
}


export function optionalInterruption(observation: Observation, observing: boolean, messages: Message[], changedAt: number, now: number): string | undefined {
  const recent = observing && observation.available && Math.abs(now-Date.parse(observation.observedAt))<=30000;
  if (recent && observation.fullscreen) return 'fullscreen';
  if (observing && changedAt && now>=changedAt && now-changedAt<30000) return 'switching-apps';
  const user = [...messages].reverse().find(m => m.role==='user' && m.source==='chat');
  if (user && now>=Date.parse(user.createdAt) && now-Date.parse(user.createdAt)<90000) return 'conversation-active';
  const last = [...messages].reverse().find(m => m.source!=='scene');
  if (last?.role==='assistant' && last.source==='initiative' && now>=Date.parse(last.createdAt) && now-Date.parse(last.createdAt)<20*60000)
    return 'waiting-for-reply';
  return undefined;
}
