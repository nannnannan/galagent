import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { blockedBy, DEFAULT_CAPTURE_BLOCKLIST } from './perception';
import type { LocalPaths } from './local-scan';

export type VisitedPage = { title: string; url: string; visits: number; lastVisit: string; browser: string };
type Profile = { browser: string; dir: string; firefox?: boolean };
const WEBKIT_EPOCH_US = 11644473600_000_000n;

/** Browser URLs can carry session tokens in the query, so only origin + path ever leaves this module. */
export function cleanUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return ['http:', 'https:'].includes(u.protocol) ? `${u.origin}${u.pathname}`.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}
// ---------------------------------------------------------------- browsers
export async function browserProfiles(p: LocalPaths): Promise<Profile[]> {
  const out: Profile[] = [];
  const chromium: [string, string | undefined][] = [
    ['Chrome', p.localAppData && join(p.localAppData, 'Google/Chrome/User Data')],
    ['Edge', p.localAppData && join(p.localAppData, 'Microsoft/Edge/User Data')],
    ['Brave', p.localAppData && join(p.localAppData, 'BraveSoftware/Brave-Browser/User Data')],
  ];
  for (const [browser, root] of chromium) {
    if (!root) continue;
    for (const name of await readdir(root).catch(() => [] as string[]))
      if ((name === 'Default' || /^Profile \d+$/.test(name)) && existsSync(join(root, name, 'History')))
        out.push({ browser, dir: join(root, name) });
  }
  const firefox = p.appData && join(p.appData, 'Mozilla/Firefox/Profiles');
  if (firefox)
    for (const name of await readdir(firefox).catch(() => [] as string[]))
      if (existsSync(join(firefox, name, 'places.sqlite')))
        out.push({ browser: 'Firefox', dir: join(firefox, name), firefox: true });
  return out;
}
/** The browser keeps its database open, so we read a temp copy (plus its WAL) and delete it right away. */
async function withCopy<T>(file: string, read: (db: DatabaseSync) => T): Promise<T | undefined> {
  const info = await stat(file).catch(() => undefined);
  if (!info || info.size > 256 * 1024 * 1024) return undefined;
  const dir = await mkdtemp(join(tmpdir(), 'galagent-scan-'));
  try {
    const copy = join(dir, 'copy.sqlite');
    await copyFile(file, copy);
    const wal = await stat(file + '-wal').catch(() => undefined);
    if (wal && wal.size <= 64 * 1024 * 1024) await copyFile(file + '-wal', copy + '-wal').catch(() => {});
    const db = new DatabaseSync(copy);
    try {
      return read(db);
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
export async function readProfileHistory(
  profile: Profile,
  o: { since: number; limit: number; keyword?: string; blocklist?: string[] },
): Promise<{ pages: VisitedPage[]; searches: string[] }> {
  const like = o.keyword ? `%${o.keyword.replace(/[%_\\]/g, '\\$&')}%` : '%';
  const rows = await withCopy(join(profile.dir, profile.firefox ? 'places.sqlite' : 'History'), (db) => {
    if (profile.firefox)
      return {
        pages: db
          .prepare(
            String.raw`SELECT url, title, visit_count AS visits, last_visit_date AS t FROM moz_places WHERE last_visit_date >= ? AND hidden = 0 AND (title LIKE ? ESCAPE '\' OR url LIKE ? ESCAPE '\') ORDER BY last_visit_date DESC LIMIT ?`,
          )
          .all(o.since * 1000, like, like, o.limit),
        searches: [] as Record<string, unknown>[],
      };
    const since = (BigInt(o.since) * 1000n + WEBKIT_EPOCH_US).toString();
    const pages = db
      .prepare(
        String.raw`SELECT url, title, visit_count AS visits, last_visit_time / 1000 AS t FROM urls WHERE last_visit_time >= CAST(? AS INTEGER) AND hidden = 0 AND (title LIKE ? ESCAPE '\' OR url LIKE ? ESCAPE '\') ORDER BY last_visit_time DESC LIMIT ?`,
      )
      .all(since, like, like, o.limit);
    let searches: Record<string, unknown>[] = [];
    try {
      searches = db
        .prepare(
          'SELECT k.term AS term FROM keyword_search_terms k JOIN urls u ON u.id = k.url_id WHERE u.last_visit_time >= CAST(? AS INTEGER) ORDER BY u.last_visit_time DESC LIMIT 200',
        )
        .all(since);
    } catch {
      /* older schema */
    }
    return { pages, searches };
  });
  if (!rows) return { pages: [], searches: [] };
  const pages: VisitedPage[] = [];
  for (const r of rows.pages) {
    const url = cleanUrl(String(r.url)),
      title = String(r.title ?? '')
        .trim()
        .slice(0, 200);
    if (!url) continue;
    if (blockedBy({ appName: url, title, blocklist: o.blocklist ?? DEFAULT_CAPTURE_BLOCKLIST })) continue;
    const ms = profile.firefox ? Number(r.t) / 1000 : Number(r.t) - 11644473600_000; // Chromium's µs exceed 2^53, so the query divides first
    pages.push({
      title,
      url,
      visits: Number(r.visits) || 1,
      lastVisit: new Date(ms).toISOString(),
      browser: profile.browser,
    });
  }
  return {
    pages,
    searches: [...new Set(rows.searches.map((s) => String(s.term ?? '').trim()).filter(Boolean))].slice(
      0,
      80,
    ),
  };
}
export async function readProfileBookmarks(
  profile: Profile,
  blocklist?: string[],
): Promise<{ title: string; url?: string }[]> {
  const out: { title: string; url?: string }[] = [];
  const add = (title: unknown, raw: unknown) => {
    const url = cleanUrl(String(raw ?? '')),
      t = String(title ?? '')
        .trim()
        .slice(0, 120);
    if (t && url && !blockedBy({ appName: url, title: t, blocklist: blocklist ?? DEFAULT_CAPTURE_BLOCKLIST }))
      out.push({ title: t, url });
  };
  if (profile.firefox) {
    const rows = await withCopy(join(profile.dir, 'places.sqlite'), (db) =>
      db
        .prepare(
          'SELECT b.title AS title, p.url AS url FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1 ORDER BY b.dateAdded DESC LIMIT 400',
        )
        .all(),
    );
    for (const r of rows || []) add(r.title, r.url);
    return out;
  }
  try {
    const walk = (n: any) => {
      if (!n || out.length >= 400) return;
      if (n.type === 'url') add(n.name, n.url);
      for (const c of n.children || []) walk(c);
    };
    for (const root of Object.values(
      JSON.parse(await readFile(join(profile.dir, 'Bookmarks'), 'utf8')).roots || {},
    ))
      walk(root);
  } catch {
    /* no bookmarks file */
  }
  return out;
}
