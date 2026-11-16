import type { Store } from './store';
import type { MemoryItem, Message } from '../shared/contracts';
import type { CorrectionRecord } from './companion-archive';
import { archiveId, archiveMatches, localDay, CONTINUITY_MS, type DailyArchive, type DailyCorrection } from './daily';
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
    if (!archive) return undefined;
    const records = this.dayRecords(day);
    return archiveMatches(archive, records, this.corrections(records)) ? archive : undefined;
  }
  correctionsBySource() {
    const memories = this.store.all<MemoryItem>('memory');
    const byId = new Map(memories.map(memory => [memory.id, memory]));
    const replacements = new Map(this.store.all<CorrectionRecord>('correction').map(record => [record.oldId, record.replacementId]));
    const bySource = new Map<string, DailyCorrection[]>();
    for (const old of memories) {
      if (old.valid || !old.validTo) continue;
      const visited = new Set([old.id]);
      let id = replacements.get(old.id);
      while (id && !visited.has(id) && replacements.has(id)) {
        visited.add(id);
        id = replacements.get(id);
      }
      const latest = id && !visited.has(id) ? byId.get(id) : undefined;
      const notes = bySource.get(old.sourceId) ?? [];
      notes.push({ oldId: old.id, previous: old.text, correctedAt: old.validTo, ...(latest?.valid ? { replacement: latest.text } : {}) });
      bySource.set(old.sourceId, notes);
    }
    return bySource;
  }
  corrections(records: Message[], bySource = this.correctionsBySource()) {
    return records.flatMap(message => bySource.get(message.id) ?? []).sort((a, b) => a.oldId.localeCompare(b.oldId));
  }
  validArchives(since?: string): DailyArchive[] {
    const archives = this.store.all<DailyArchive>('daily-archive')
      .filter(a => !since || a.day >= since);
    if (!archives.length) return [];
    const records = new Map(archives.map(a => [a.day, [] as Message[]]));
    const dead = this.store.deadIds();
    for (const message of this.store.all<Message>('message')) {
      if (message.source !== 'scene' && !dead.has(message.id)) {
        records.get(localDay(Date.parse(message.createdAt)))?.push(message);
      }
    }
    const bySource = this.correctionsBySource();
    return archives.filter(a => {
      const messages = records.get(a.day)!.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
      return archiveMatches(a, messages, this.corrections(messages, bySource));
    });
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
