// 心情与精力 (活人感). Purely local, no model call: energy follows a circadian curve, mood drifts back to a
// baseline and is nudged by how the two of you treat each other. The character only receives a short tone
// hint; how a tone shows (sulking, yawning, clinginess) comes from its own character card.
import type { VitalityTone, VitalityView } from '../shared/contracts';

export type Vitality = {
  energy: number; mood: number; updatedAt: number; lastTouchAt: number;
  /** Said goodnight and fell asleep; cleared by any interaction or the morning. */
  asleepSince?: number;
  /** Just woken up by the user (groggy for a while). */
  wokenAt?: number;
};
export type VitalityEvent = 'chat' | 'pat' | 'tap' | 'drag' | 'poked-dizzy' | 'goodnight' | 'wake';

const HOUR = 3600_000;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
/** Target energy for a local hour: low at night, high late morning, a post-lunch dip, tapering in the evening. */
export function circadianEnergy(hour: number): number {
  const curve = [18, 15, 12, 12, 14, 20, 35, 55, 72, 85, 88, 85, 72, 58, 55, 68, 75, 74, 70, 66, 60, 52, 42, 28];
  return curve[((Math.floor(hour) % 24) + 24) % 24];
}
export const BASE_MOOD = 62;
/** Time with no interaction (while the user is around, in daily mode) before the character starts to feel left out. */
export const LONELY_AFTER_MS = 3 * HOUR;

export const freshVitality = (now: number): Vitality => ({ energy: circadianEnergy(new Date(now).getHours()), mood: BASE_MOOD, updatedAt: now, lastTouchAt: now });

/** Advances the state to `now`. `present`: the user is at the computer and the character may expect attention. */
export function advance(v: Vitality, now: number, present: boolean): Vitality {
  const dt = Math.max(0, Math.min(48 * HOUR, now - v.updatedAt)) / HOUR;
  if (dt <= 0) return v;
  const next = { ...v, updatedAt: now };
  const target = next.asleepSince ? Math.max(circadianEnergy(new Date(now).getHours()), 40) : circadianEnergy(new Date(now).getHours());
  next.energy = clamp(v.energy + (target - v.energy) * (1 - Math.exp(-dt / 1.2)));
  next.mood = clamp(v.mood + (BASE_MOOD - v.mood) * (1 - Math.exp(-dt / 4)));
  // Left alone while you are right there: mood sinks slowly (never below 25), recovering as soon as you come back.
  if (present && !next.asleepSince && now - v.lastTouchAt > LONELY_AFTER_MS) next.mood = clamp(Math.max(25, next.mood - 5 * dt));
  // Sleep ends by itself in the morning.
  if (next.asleepSince && new Date(now).getHours() >= 6 && new Date(now).getHours() < 12 && now - next.asleepSince > 4 * HOUR) { delete next.asleepSince; next.energy = clamp(next.energy + 10); }
  if (next.wokenAt && now - next.wokenAt > 20 * 60_000) delete next.wokenAt;
  return next;
}

export function react(v: Vitality, event: VitalityEvent, now: number): Vitality {
  const next = { ...v, lastTouchAt: event === 'goodnight' ? v.lastTouchAt : now };
  const lonely = now - v.lastTouchAt > LONELY_AFTER_MS;
  switch (event) {
    // Being talked to after a long silence lifts the mood more ("finally!").
    case 'chat': next.mood = clamp(v.mood + (lonely ? 10 : 4)); next.energy = clamp(v.energy - 0.5); break;
    case 'pat': next.mood = clamp(v.mood + (v.mood < 45 ? 14 : 7)); break;
    case 'tap': next.mood = clamp(v.mood + 1); break;
    case 'drag': next.mood = clamp(v.mood + 2); next.energy = clamp(v.energy + 2); break;
    case 'poked-dizzy': next.mood = clamp(v.mood - 4); break;
    case 'goodnight': next.asleepSince = now; delete next.wokenAt; return next;
    case 'wake': break;
  }
  // Any interaction while asleep wakes the character up, groggy.
  if (next.asleepSince) { delete next.asleepSince; next.wokenAt = now; }
  return next;
}

export function view(v: Vitality): VitalityView {
  const energy = Math.round(v.energy), mood = Math.round(v.mood);
  const tone: VitalityTone = v.asleepSince ? 'asleep' : energy < 30 || v.wokenAt ? 'sleepy' : mood < 40 ? 'sulky' : energy < 48 ? 'tired' : mood > 78 ? 'happy' : energy >= 78 ? 'lively' : 'calm';
  const label = { asleep: '睡着了', sleepy: v.wokenAt ? '刚被叫醒，迷迷糊糊' : '困得睁不开眼', tired: '有点困', sulky: '有点委屈', happy: '心情很好', lively: '精神饱满', calm: '平静' }[tone];
  return { energy, mood, tone, label };
}

/** One line for the character's context. Says how the tone may colour the reply; never asks to report numbers. */
export function vitalityHint(tone: VitalityTone): string {
  return {
    asleep: '刚被叫醒，迷糊话短，很快清醒，不怪用户',
    sleepy: '回复短些，可打哈欠，正事照样说清',
    tired: '话少一点',
    sulky: '可带点小情绪等哄，一理就好；不指责，正事先帮',
    happy: '更活泼',
    lively: '更有活力',
    calm: '照常',
  }[tone];
}
