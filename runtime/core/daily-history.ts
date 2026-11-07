import type { Store } from './store';
import type { Message } from '../shared/contracts';
import { archiveId, archiveMatches, localDay, CONTINUITY_MS, type DailyArchive } from './daily';
import { estimateTokens as tokens } from './token-estimate';

export class DailyHistory {
  constructor(private store: Store) {}

  /** Live user/assistant chat records of one local day, oldest first. */
  dayRecords(day: string): Message[] {
    const dead = this.store.deadIds();
    return this.store
      .all<Message>('message')
      .filter((m) => !dead.has(m.id) && m.source !== 'scene' && localDay(Date.parse(m.createdAt)) === day)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  /** An archive counts only while it still matches the day's records exactly (a deletion or correction invalidates it). */
  readyArchive(day: string): DailyArchive | undefined {
    const archive = this.store.get<DailyArchive>(archiveId(day));
    return archive && archiveMatches(archive, this.dayRecords(day)) ? archive : undefined;
  }
  /** Which messages enter the context verbatim: today's, the last two hours across midnight, and any day whose archive is not ready yet. */
  verbatimFilter(now = Date.now()) {
    const today = localDay(now),
      ready = new Map<string, boolean>();
    return (createdAt: string) => {
      const at = Date.parse(createdAt);
      if (!Number.isFinite(at)) return false;
      const day = localDay(at);
      if (day >= today || now - at < CONTINUITY_MS) return true;
      if (!ready.has(day)) ready.set(day, !!this.readyArchive(day));
      return !ready.get(day);
    };
  }
  recentArchives(count: number, budget: number) {
    const today = localDay(Date.now()),
      out: { day: string; title: string; summary: string; mood: string; openThreads: string[] }[] = [];
    for (const a of this.store
      .all<DailyArchive>('daily-archive')
      .filter((a) => a.day < today)
      .sort((x, y) => y.day.localeCompare(x.day))
      .slice(0, count)) {
      if (!this.readyArchive(a.day)) continue;
      const item = {
        day: a.day,
        title: a.title,
        summary: a.summary.slice(0, 400),
        mood: a.mood,
        openThreads: a.openThreads.slice(0, 3),
      };
      const cost = tokens(JSON.stringify(item));
      if (cost > budget) break;
      budget -= cost;
      out.unshift(item);
    }
    return out;
  }
}
