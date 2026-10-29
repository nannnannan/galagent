// Renderer side of the bond/achievement loop: report client-side achievements once,
// remember which pets were worn (for 'collector') and celebrate fresh unlocks.
import type { AppSnapshot } from '../shared/contracts';
import { clientAchievement } from '../shared/achievements';
import { addSeen, dayKey } from './fun';
import { command } from './ui';

const reported = new Set<string>();
/** Sends achievement.unlock for a client id at most once per window session, and never for an already unlocked one. */
export function reportAchievement(id: string, snapshot?: AppSnapshot) {
  if (!clientAchievement(id) || reported.has(id)) return;
  if (snapshot?.bond?.achievements.some(a => a.id === id && a.unlockedAt)) return;
  reported.add(id);
  void command({ type: 'achievement.unlock', id }, true);
}

const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* storage may be unavailable */ } },
};
/** Records the pet currently worn; reports 'collector' once five different pets have been worn. */
export function trackPet(id: string, snapshot: AppSnapshot) {
  let seen: string[] = [];
  try { const parsed = JSON.parse(store.get('galagent.petsSeen') || '[]'); if (Array.isArray(parsed)) seen = parsed.filter(x => typeof x === 'string'); } catch { /* corrupt entry: start over */ }
  const next = addSeen(seen, id);
  if (next.length !== seen.length) store.set('galagent.petsSeen', JSON.stringify(next));
  if (next.length >= 5) reportAchievement('collector', snapshot);
}

/** True once per local day (shared by both windows through localStorage). */
export function firstVisitToday(now = new Date()): boolean {
  const today = dayKey(now);
  if (store.get('galagent.lastSeenDay') === today) return false;
  store.set('galagent.lastSeenDay', today);
  return true;
}
