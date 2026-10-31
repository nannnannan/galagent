// 生活感主动时刻 (活人感): good morning (with weather), goodnight, sharing something found online, and
// bringing up a small thing the user mentioned days ago. This module only DECIDES; the host runs the chosen
// moment through the normal initiative path, so every moment shares the user's pacing (interval, hourly and
// daily caps), quiet hours, companion mode and topic switches, and at most one runs at a time.
import type { InitiativeTopic } from '../shared/contracts';

export type LifeKind = 'morning' | 'goodnight' | 'share' | 'recall';
export const LIFE_TOPIC = { morning: 'greeting', goodnight: 'greeting', share: 'share', recall: 'recall' } as const satisfies Record<LifeKind, InitiativeTopic>;
export type LifeLedger = {
  /** Local day of the last morning greeting. */ morning?: string;
  /** "Night" key (local day of now − 6 h) of the last goodnight, so 00:30 still belongs to the evening before. */ goodnight?: string;
  shareDay?: string; shares: number; lastShareAt?: number;
  lastRecallAt?: number; recalled: string[];
  /** Throttle for the random rolls and for retries after a failed attempt. */ lastRollAt?: number; lastAttemptAt?: number;
};
export const emptyLedger = (): LifeLedger => ({ shares: 0, recalled: [] });
export type LifeInput = {
  now: Date; ledger: LifeLedger;
  shareDailyLimit: number; recallEveryDays: number; goodnightAt: string;
  muted: (topic: InitiativeTopic) => boolean;
  networkAllowed: boolean; hasRecallCandidate: boolean;
  /** Yesterday's daily archive is still being written; the morning greeting waits for it until 10:30. */
  archivePending: boolean;
  random?: () => number;
};
const pad = (n: number) => String(n).padStart(2, '0');
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const nightOf = (d: Date) => dayOf(new Date(d.getTime() - 6 * 3600_000));
const ROLL_EVERY_MS = 20 * 60_000, RETRY_AFTER_MS = 20 * 60_000;

/** At most one moment, by priority: morning > goodnight > recall > share. */
export function pickLife(input: LifeInput): LifeKind | undefined {
  const { now, ledger } = input, t = now.getHours() * 60 + now.getMinutes(), ms = now.getTime(), random = input.random || Math.random;
  if (ledger.lastAttemptAt && ms - ledger.lastAttemptAt < RETRY_AFTER_MS) return undefined;
  // The day opens with the greeting: until it has happened (or its window closed), nothing else goes first.
  if (t >= 5 * 60 && t < 11 * 60 && ledger.morning !== dayOf(now) && !input.muted('greeting')) return input.archivePending && t < 10 * 60 + 30 ? undefined : 'morning';
  const [gh, gm] = input.goodnightAt.split(':').map(Number), bed = (gh || 0) * 60 + (gm || 0);
  // From bedtime until 04:00 (bedtime may itself be after midnight).
  const lateNight = bed >= 12 * 60 ? t >= bed || t < 4 * 60 : t >= bed && t < 4 * 60;
  if (lateNight && ledger.goodnight !== nightOf(now) && !input.muted('greeting')) return 'goodnight';
  // The rest are occasional: one roll per 20 minutes, daytime only.
  if (ledger.lastRollAt && ms - ledger.lastRollAt < ROLL_EVERY_MS) return undefined;
  if (t < 9 * 60 || t >= 22 * 60) return undefined;
  ledger.lastRollAt = ms;
  const recallDue = input.recallEveryDays > 0 && input.hasRecallCandidate && !input.muted('recall') && t >= 10 * 60 && t < 21 * 60 && (!ledger.lastRecallAt || ms - ledger.lastRecallAt >= input.recallEveryDays * 86400_000);
  if (recallDue && random() < 0.3) return 'recall';
  const sharesToday = ledger.shareDay === dayOf(now) ? ledger.shares : 0;
  const shareDue = input.shareDailyLimit > 0 && sharesToday < input.shareDailyLimit && input.networkAllowed && !input.muted('share') && (!ledger.lastShareAt || ms - ledger.lastShareAt >= 3 * 3600_000);
  if (shareDue && random() < 0.25) return 'share';
  return undefined;
}
/** Records that a moment ran (successfully or as a deliberate silence). */
export function markLife(ledger: LifeLedger, kind: LifeKind, now: Date, recalledId?: string): LifeLedger {
  const next = { ...ledger, recalled: [...ledger.recalled] };
  if (kind === 'morning') next.morning = dayOf(now);
  if (kind === 'goodnight') next.goodnight = nightOf(now);
  if (kind === 'share') { if (next.shareDay !== dayOf(now)) { next.shareDay = dayOf(now); next.shares = 0; } next.shares++; next.lastShareAt = now.getTime(); }
  if (kind === 'recall') { next.lastRecallAt = now.getTime(); if (recalledId) next.recalled = [...next.recalled, recalledId].slice(-60); }
  delete next.lastAttemptAt;
  return next;
}

/** Things worth asking about later: plans, events, wishes — not idle preferences. */
const RECALLABLE = /(打算|计划|准备|想要|想去|想买|要去|要考|面试|考试|比赛|旅行|出差|搬家|生日|看病|医院|体检|约会|聚会|报名|开学|入职|离职|装修|学[习会]|练|追|等)/u;
export type RecallCandidate = { id: string; text: string; createdAt: string; importance?: number; valid: boolean; recalls?: number };
/** A memory 2–21 days old that reads like a plan or event, not brought up before; most important first, then oldest. */
export function recallCandidate(memories: RecallCandidate[], recalled: readonly string[], now: number): RecallCandidate | undefined {
  return memories
    .filter(m => m.valid && !recalled.includes(m.id) && RECALLABLE.test(m.text))
    .filter(m => { const age = now - Date.parse(m.createdAt); return age >= 2 * 86400_000 && age <= 21 * 86400_000; })
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
}

/** The instruction for each moment; the character decides the words (or stays silent with an empty text). */
export function lifePrompt(kind: LifeKind, extra: { justWoke?: boolean; network: boolean; openThreads?: string[]; memory?: { text: string; createdAt: string } }): string {
  switch (kind) {
    case 'morning': return [
      `早上第一次见到用户。${extra.justWoke ? '你昨晚道过晚安睡下了，现在刚醒，' : ''}用你自己的口吻简短问早。`,
      extra.network ? '如果用户画像或可靠记忆里明确知道用户所在城市，可以用 web_search 查今天当地天气，给一句实用提醒（带伞、加衣、防晒）；不知道城市就不要查、不要猜，可以顺口问一句。' : '不要编造天气。',
      extra.openThreads?.length ? `昨天的待续：${extra.openThreads.slice(0, 3).join('；')}。合适的话自然接上其中一件，不要逐条清单式追问。` : '',
      '一两句话，不要长篇。',
    ].filter(Boolean).join('');
    case 'goodnight': return '夜深了，用户还在电脑前。用你自己的口吻道一声晚安，可以轻轻提醒早点休息（不说教、不催促），然后你要去睡了。一两句话。如果最近的对话显示用户正忙于要紧的事，就只说一句很短的晚安。';
    case 'share': return '现在有一次“分享新鲜事”的机会。依据用户画像和可靠记忆里用户真正感兴趣的东西，用 web_search 找一条最近的、真实的、用户可能想知道的新鲜事（新版本、新作品、相关新闻等），必要时 read_webpage 核实，用一两句话分享并提到来源网站。找不到合适的、不确定真假、或不知道用户兴趣时，返回空 text 保持安静。不要分享负面、敏感或带立场的内容。';
    case 'recall': return `你突然想起用户${extra.memory ? `在 ${extra.memory.createdAt.slice(0, 10)} 提到过：「${extra.memory.text.slice(0, 160)}」` : '之前提过的一件小事'}。像朋友冷不丁想起来那样，自然地问一句后续（例如“上次你说…，后来怎么样啦？”）。不要说“我在记忆里看到”。如果这件事明显已经聊完、或者此刻不合适，返回空 text 保持安静。`;
  }
}
