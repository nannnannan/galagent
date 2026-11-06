import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export const KEYWORD_INDEX_VERSION = '2-han-runs-latin-words';
export const HISTORY_INDEX_VERSION = '1';
/** Records the 回溯 search covers; the text of each is indexed on every put, so no write path can forget it. */
const HISTORY_TEXT: Record<string, (b: any) => string> = {
    message: b => String(b.text ?? ''),
    brief: b => [b.goal, b.gist, ...(Array.isArray(b.points) ? b.points : []), b.gaps].filter(Boolean).join('\n'),
    'task-run': b => [b.task, b.summary].filter(Boolean).join('\n'),
    'daily-archive': b => [b.title, b.summary, ...(b.topics || []), ...(b.highlights || []), ...(b.openThreads || [])].filter(Boolean).join('\n'),
};
const englishFunctionWords = new Set('a an the and or but to of in on at by for from with as is am are was were be been being do does did have has had will would shall should can could may might must i me my we our us you your he him his she her it its they them their this that these those what which who when where why how s'.split(' '));
export function grams(text: string): string[] {
    const terms: string[] = [];
    for (const run of text.normalize('NFKC').toLowerCase().match(/\p{Script=Han}+|[\p{Script=Latin}\p{N}]+/gu) || []) {
        if (/^\p{Script=Han}/u.test(run)) { const chars = [...run]; if (chars.length === 1) terms.push(run); else for (let i = 0; i + 1 < chars.length; i++) terms.push(chars[i] + chars[i + 1]); }
        else if (!englishFunctionWords.has(run)) terms.push(run);
    }
    return [...new Set(terms)];
}
export class Store {
    db: DatabaseSync;
    constructor(dir: string) {
        mkdirSync(dir, { recursive: true });
        this.db = new DatabaseSync(join(dir, 'companion.sqlite'));
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tombstones(id TEXT PRIMARY KEY);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, terms);
      CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(id UNINDEXED, kind UNINDEXED, terms);
      CREATE TABLE IF NOT EXISTS vectors(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS index_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_kind ON records(kind);`);
        try { this.ensureKeywordIndex(); this.ensureHistoryIndex(); } catch (error) { this.db.close(); throw error; }
    }
    // Prepared statements are cached: re-preparing on every call dominated hot paths such as snapshot refreshes.
    private statements = new Map<string, StatementSync>();
    private sql(text: string): StatementSync { let statement = this.statements.get(text); if (!statement) { statement = this.db.prepare(text); this.statements.set(text, statement); } return statement; }
    private ensureKeywordIndex() {
        if (this.sql('SELECT value FROM index_metadata WHERE key=?').get('keyword-version')?.value === KEYWORD_INDEX_VERSION) return;
        this.transaction(() => {
            const dead = this.deadIds(); this.db.exec('DELETE FROM memory_fts');
            for (const row of this.sql("SELECT id,body FROM records WHERE kind='memory' ORDER BY id").all()) {
                const memory = JSON.parse(String(row.body));
                if (typeof memory.text !== 'string') throw new Error('记忆正文损坏，无法重建关键词索引');
                if (!dead.has(String(row.id)) && !dead.has(memory.sourceId)) this.index(String(row.id), memory.text);
            }
            this.sql('INSERT OR REPLACE INTO index_metadata VALUES(?,?)').run('keyword-version', KEYWORD_INDEX_VERSION);
        });
    }
    /** Backfills the search index once, for records written before it existed. */
    private ensureHistoryIndex() {
        if (this.sql('SELECT value FROM index_metadata WHERE key=?').get('history-version')?.value === HISTORY_INDEX_VERSION) return;
        this.transaction(() => {
            this.db.exec('DELETE FROM history_fts');
            for (const kind of Object.keys(HISTORY_TEXT)) for (const row of this.sql('SELECT id,body FROM records WHERE kind=?').all(kind)) this.indexHistory(kind, String(row.id), JSON.parse(String(row.body)));
            this.sql('INSERT OR REPLACE INTO index_metadata VALUES(?,?)').run('history-version', HISTORY_INDEX_VERSION);
        });
    }
    private indexHistory(kind: string, id: string, body: unknown) {
        this.sql('DELETE FROM history_fts WHERE id=?').run(id);
        const terms = grams(HISTORY_TEXT[kind](body)); if (terms.length) this.sql('INSERT INTO history_fts VALUES(?,?,?)').run(id, kind, terms.join(' '));
    }
    /** Record ids matching any term of the query, best match first. */
    historyIds(query: string, kinds: string[], limit = 200): string[] {
        const terms = grams(query).slice(0, 64); if (!terms.length || !kinds.length) return [];
        const allowed = new Set(kinds), ids: string[] = [];
        for (const row of this.sql('SELECT id,kind FROM history_fts WHERE history_fts MATCH ? ORDER BY rank').iterate(terms.map(t => '"' + t + '"').join(' OR '))) { if (!allowed.has(String(row.kind))) continue; ids.push(String(row.id)); if (ids.length >= limit) break; }
        if (!ids.length && terms.some(t => /^\p{Script=Han}$/u.test(t))) {
            for (const t of terms.filter(x => /^\p{Script=Han}$/u.test(x))) for (const row of this.sql('SELECT id,kind FROM history_fts WHERE terms LIKE ? ORDER BY rowid DESC').iterate(`%${t}%`)) { const id = String(row.id); if (!allowed.has(String(row.kind)) || ids.includes(id)) continue; ids.push(id); if (ids.length >= limit) break; }
        }
        return ids;
    }
    put(kind: string, id: string, body: unknown) { this.sql('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(id, kind, JSON.stringify(body)); if (HISTORY_TEXT[kind]) this.indexHistory(kind, id, body); }
    get<T>(id: string): T | undefined { const row = this.sql('SELECT body FROM records WHERE id=?').get(id); return row ? JSON.parse(String(row.body)) : undefined; }
    all<T>(kind: string): T[] { return this.sql('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row => JSON.parse(String(row.body))); }
    remove(id: string) { this.sql('DELETE FROM records WHERE id=?').run(id); this.sql('DELETE FROM memory_fts WHERE id=?').run(id); this.sql('DELETE FROM history_fts WHERE id=?').run(id); this.sql('DELETE FROM vectors WHERE id=?').run(id); }
    tombstone(id: string) { this.sql('INSERT OR IGNORE INTO tombstones VALUES(?)').run(id); }
    dead(id: string): boolean { return !!this.sql('SELECT id FROM tombstones WHERE id=?').get(id); }
    deadIds(): Set<string> { return new Set(this.sql('SELECT id FROM tombstones').all().map(row => String(row.id))); }
    index(id: string, text: string) { this.sql('DELETE FROM memory_fts WHERE id=?').run(id); this.sql('INSERT INTO memory_fts VALUES(?,?)').run(id, grams(text).join(' ')); }
    keyword(query: string, allowed?: Set<string>): string[] {
        const terms = grams(query).slice(0, 64); if (!terms.length) return [];
        const ids: string[] = [];
        for (const row of this.sql('SELECT id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank').iterate(terms.map(t => '"' + t + '"').join(' OR '))) { const id = String(row.id); if (allowed && !allowed.has(id)) continue; ids.push(id); if (ids.length >= 24) break; }
        if (!ids.length && terms.some(t => /^\p{Script=Han}$/u.test(t))) {
            for (const t of terms.filter(x => /^\p{Script=Han}$/u.test(x))) for (const row of this.sql('SELECT id FROM memory_fts WHERE terms LIKE ? ORDER BY rowid DESC').iterate(`%${t}%`)) { const id = String(row.id); if ((allowed && !allowed.has(id)) || ids.includes(id)) continue; ids.push(id); if (ids.length >= 24) break; }
        }
        return ids;
    }
    removeVector(id: string) { this.sql('DELETE FROM vectors WHERE id=?').run(id); }
    vector(id: string, values: number[]) { this.sql('INSERT OR REPLACE INTO vectors VALUES(?,?)').run(id, JSON.stringify(values)); }
    hasVectors(): boolean { return !!this.sql('SELECT id FROM vectors LIMIT 1').get(); }
    hasVector(id: string): boolean { return !!this.sql('SELECT id FROM vectors WHERE id=?').get(id); }
    kind(id: string): string | undefined { const row = this.sql('SELECT kind FROM records WHERE id=?').get(id); return row ? String(row.kind) : undefined; }
    *vectorEntries(): Generator<[string, Float32Array]> { for (const row of this.sql('SELECT id,body FROM vectors').iterate()) yield [String(row.id), new Float32Array(JSON.parse(String(row.body)))]; }
    vectors(): {
        id: string;
        values: number[];
    }[] { return this.sql('SELECT * FROM vectors').all().map(r => ({ id: String(r.id), values: JSON.parse(String(r.body)) })); }
    transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try {
        const result = fn();
        this.db.exec('COMMIT');
        return result;
    }
    catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
    } }
    close() { this.db.close(); }
}
