import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export const KEYWORD_INDEX_VERSION = '2-han-runs-latin-words';
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
      CREATE TABLE IF NOT EXISTS vectors(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS index_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
        try { this.ensureKeywordIndex(); } catch (error) { this.db.close(); throw error; }
    }
    private ensureKeywordIndex() {
        if (this.db.prepare('SELECT value FROM index_metadata WHERE key=?').get('keyword-version')?.value === KEYWORD_INDEX_VERSION) return;
        this.transaction(() => {
            const dead = this.deadIds(); this.db.exec('DELETE FROM memory_fts');
            for (const row of this.db.prepare("SELECT id,body FROM records WHERE kind='memory' ORDER BY id").all()) {
                const memory = JSON.parse(String(row.body));
                if (typeof memory.text !== 'string') throw new Error('记忆正文损坏，无法重建关键词索引');
                if (!dead.has(String(row.id)) && !dead.has(memory.sourceId)) this.index(String(row.id), memory.text);
            }
            this.db.prepare('INSERT OR REPLACE INTO index_metadata VALUES(?,?)').run('keyword-version', KEYWORD_INDEX_VERSION);
        });
    }
    put(kind: string, id: string, body: unknown) { this.db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(id, kind, JSON.stringify(body)); }
    get<T>(id: string): T | undefined { const row = this.db.prepare('SELECT body FROM records WHERE id=?').get(id); return row ? JSON.parse(String(row.body)) : undefined; }
    all<T>(kind: string): T[] { return this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row => JSON.parse(String(row.body))); }
    remove(id: string) { this.db.prepare('DELETE FROM records WHERE id=?').run(id); this.db.prepare('DELETE FROM memory_fts WHERE id=?').run(id); this.db.prepare('DELETE FROM vectors WHERE id=?').run(id); }
    tombstone(id: string) { this.db.prepare('INSERT OR IGNORE INTO tombstones VALUES(?)').run(id); }
    dead(id: string): boolean { return !!this.db.prepare('SELECT id FROM tombstones WHERE id=?').get(id); }
    deadIds(): Set<string> { return new Set(this.db.prepare('SELECT id FROM tombstones').all().map(row => String(row.id))); }
    index(id: string, text: string) { this.db.prepare('DELETE FROM memory_fts WHERE id=?').run(id); this.db.prepare('INSERT INTO memory_fts VALUES(?,?)').run(id, grams(text).join(' ')); }
    keyword(query: string, allowed?: Set<string>): string[] { const terms = grams(query).slice(0, 64); if (!terms.length)return [];const ids:string[]=[];for(const row of this.db.prepare('SELECT id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank').iterate(terms.map(t=>'"'+t+'"').join(' OR '))){const id=String(row.id);if(allowed&&!allowed.has(id))continue;ids.push(id);if(ids.length>=24)break;}return ids; }
    vector(id: string, values: number[]) { this.db.prepare('INSERT OR REPLACE INTO vectors VALUES(?,?)').run(id, JSON.stringify(values)); }
    hasVectors(): boolean { return !!this.db.prepare('SELECT id FROM vectors LIMIT 1').get(); }
    hasVector(id: string): boolean { return !!this.db.prepare('SELECT id FROM vectors WHERE id=?').get(id); }
    kind(id: string): string | undefined { const row = this.db.prepare('SELECT kind FROM records WHERE id=?').get(id); return row ? String(row.kind) : undefined; }
    *vectorEntries(): Generator<[string, Float32Array]> { for (const row of this.db.prepare('SELECT id,body FROM vectors').iterate()) yield [String(row.id), new Float32Array(JSON.parse(String(row.body)))]; }
    vectors(): {
        id: string;
        values: number[];
    }[] { return this.db.prepare('SELECT * FROM vectors').all().map(r => ({ id: String(r.id), values: JSON.parse(String(r.body)) })); }
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
