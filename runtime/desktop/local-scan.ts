// 深度了解这台电脑（用户 2026-11-05 授权）：「研究 → 深度访问」打开后，直接从本机读浏览器记录、文件名、已装软件与游戏，
// 只读、不落盘、不进长期记忆；结果只在内存里交给兴趣规划与并行代理。
//
// 这几样无论开关都碰不到（红线，不是配置项）：
//   · 浏览器的 Login Data / Cookies / Web Data（已存密码、登录态、表单）——这里只开 History/places.sqlite 与书签
//   · 凭据与密钥文件（sensitivePath）、GalAgent 自己的数据（galagentSecret）、用户的禁止目录
//   · 聊天软件的数据目录（AGENTS.md：不读 IM 正文）、AppData 下的一切（各应用的令牌都放这里）
import { open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { browserProfiles, readProfileBookmarks, readProfileHistory, type VisitedPage } from './browser-profiles';
export { browserProfiles, cleanUrl, readProfileBookmarks, readProfileHistory, type VisitedPage } from './browser-profiles';
import { galagentSecret, inWeChatInbox, sensitivePath } from '../core/privacy';
import { isForbiddenPath } from '../core/file-policy';

export const LOCAL_LIMITS = { walkEntries: 20_000, walkMs: 8000, walkDepth: 6, fileChars: 60_000, fileBytes: 4 * 1024 * 1024, recentFiles: 40, searchResults: 30 } as const;
export type LocalPaths = { home: string; appData?: string; localAppData?: string; programFiles?: string[]; drives?: string[]; dataDir?: string };
export type LocalPolicy = { forbidden: string[]; blocklist?: string[] };
export type LocalSnapshot = {
  browser: { history: { title: string; url: string }[]; bookmarks: { title: string; url?: string }[]; searches: string[] };
  files: { folders: string[]; recent: string[]; types: string[] };
  software: { apps: string[]; games: string[] };
};

const IM_DIRS = /(^|\/)(wechat files|xwechat_files|tencent files|wxwork|whatsapp|telegram desktop|qq|nt_qq|dingtalk|feishu|lark)(\/|$)/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)', 'programdata', 'appdata', 'library', '.cache', '.venv', 'venv', '__pycache__', 'dist', 'build', 'target']);
const TEXT_EXT = new Set('.txt .md .markdown .rst .csv .tsv .json .jsonl .yaml .yml .toml .ini .log .xml .html .htm .css .js .mjs .cjs .ts .tsx .jsx .py .java .c .h .cpp .hpp .cs .go .rs .rb .php .sh .ps1 .bat .sql .tex .srt .ass .lrc'.split(' '));
const norm = (p: string) => p.replace(/\\/g, '/');
/** Refused whatever the sandbox says; tools and scans all come through here. */
export function refusedPath(file: string, policy: LocalPolicy, dataDir?: string): boolean {
  const n = norm(file), nl = n.toLowerCase();
  if (galagentSecret(file, dataDir) || sensitivePath(file) || isForbiddenPath(file, policy.forbidden)) return true;
  if (inWeChatInbox(file, dataDir)) return false; // what the user sent TA over WeChat stays readable
  const dl = dataDir ? norm(dataDir).replace(/\/+$/, '').toLowerCase() : '';
  return IM_DIRS.test(n) || /\/appdata(\/|$)/i.test(n) || (!!dl && (nl === dl || nl.startsWith(dl + '/')));
}

// ---------------------------------------------------------------- files
type Walked = { path: string; name: string; mtime: number; size: number };
async function walk(roots: string[], policy: LocalPolicy, dataDir: string | undefined, visit: (f: Walked) => boolean | void, limits: { depth?: number; ms?: number } = {}) {
  const deadline = Date.now() + (limits.ms ?? LOCAL_LIMITS.walkMs), maxDepth = limits.depth ?? LOCAL_LIMITS.walkDepth;
  const queue = roots.map(path => ({ path, depth: 0 }));
  let seen = 0;
  while (queue.length && seen < LOCAL_LIMITS.walkEntries && Date.now() < deadline) {
    const { path, depth } = queue.shift()!;
    for (const e of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      if (++seen >= LOCAL_LIMITS.walkEntries) break;
      const full = join(path, e.name);
      if (e.name.startsWith('.') || e.isSymbolicLink() || refusedPath(full, policy, dataDir)) continue;
      if (e.isDirectory()) { if (depth < maxDepth && !SKIP_DIRS.has(e.name.toLowerCase())) queue.push({ path: full, depth: depth + 1 }); continue; }
      if (!e.isFile()) continue;
      const info = await stat(full).catch(() => undefined); if (!info) continue;
      if (visit({ path: full, name: e.name, mtime: info.mtimeMs, size: info.size }) === true) return;
    }
  }
}

export class LocalAccess {
  constructor(private paths: LocalPaths) {}
  private userDirs() { return ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music'].map(d => join(this.paths.home, d)).filter(existsSync); }
  private searchRoots() { return [this.paths.home, ...(this.paths.drives || [])].filter(existsSync); }

  /** Pages visited across every installed browser, without needing the extension. */
  async browserHistory(o: { keyword?: string; days?: number; limit?: number; blocklist?: string[] }) {
    const since = Date.now() - Math.max(1, Math.min(3650, o.days ?? 30)) * 86400_000, limit = Math.max(1, Math.min(300, o.limit ?? 40));
    const pages: VisitedPage[] = [], searches: string[] = [];
    for (const profile of await browserProfiles(this.paths)) { const r = await readProfileHistory(profile, { since, limit, keyword: o.keyword, blocklist: o.blocklist }); pages.push(...r.pages); searches.push(...r.searches); }
    const unique = [...new Map(pages.sort((a, b) => b.lastVisit.localeCompare(a.lastVisit)).map(p => [p.url, p])).values()];
    return { pages: unique.slice(0, limit), searches: [...new Set(searches)].filter(s => !o.keyword || s.includes(o.keyword)).slice(0, 40) };
  }
  async searchFiles(query: string, policy: LocalPolicy) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean); if (!terms.length) return [];
    const hits: Walked[] = [];
    await walk(this.searchRoots(), policy, this.paths.dataDir, f => { const n = f.path.toLowerCase(); if (terms.every(t => n.includes(t))) { hits.push(f); if (hits.length >= 200) return true; } });
    return hits.sort((a, b) => b.mtime - a.mtime).slice(0, LOCAL_LIMITS.searchResults).map(f => ({ path: f.path, size: f.size, modified: new Date(f.mtime).toISOString() }));
  }
  /** Text files only. Paths are resolved first, so a shortcut or symlink cannot lead into a refused place. */
  async readFile(path: string, policy: LocalPolicy) {
    if (!isAbsolute(path)) throw new Error('需要完整路径');
    const real = await realpath(resolve(path)).catch(() => { throw new Error('找不到这个文件'); });
    if (refusedPath(real, policy, this.paths.dataDir) || refusedPath(path, policy, this.paths.dataDir)) throw new Error('这个位置不开放（密钥、聊天软件、程序数据或禁止目录）');
    if (!TEXT_EXT.has(extname(real).toLowerCase())) throw new Error('只能读文本类文件，其他格式请交给执行代理');
    const info = await stat(real).catch(() => undefined);
    const handle = await open(real, 'r');
    try {
      const cap = Math.max(1, Math.min(LOCAL_LIMITS.fileBytes, info?.size || LOCAL_LIMITS.fileBytes));
      const buffer = Buffer.alloc(cap), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      let text: string;
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
      else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
      else { if (bytes.includes(0)) throw new Error('这不是文本文件'); text = bytes.toString('utf8'); }
      return { path: real, name: basename(real), text: text.slice(0, LOCAL_LIMITS.fileChars), truncated: text.length > LOCAL_LIMITS.fileChars || (info ? info.size > bytesRead : bytesRead === buffer.length) };
    } finally { await handle.close(); }
  }
  private async listShortcuts() {
    const out = new Set<string>();
    const roots = [this.paths.appData && join(this.paths.appData, 'Microsoft/Windows/Start Menu/Programs'), process.env.ProgramData && join(process.env.ProgramData, 'Microsoft/Windows/Start Menu/Programs')].filter(Boolean) as string[];
    const scan = async (dir: string, depth: number) => { for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) { if (e.isDirectory() && depth < 2) await scan(join(dir, e.name), depth + 1); else if (/\.lnk$/i.test(e.name) && !/uninstall|卸载|readme|help|帮助/i.test(e.name)) out.add(e.name.replace(/\.lnk$/i, '')); } };
    for (const r of roots) await scan(r, 0);
    return [...out].sort().slice(0, 150);
  }
  private async steamGames() {
    const libs = new Set((this.paths.programFiles || []).map(p => join(p, 'Steam')));
    for (const root of [...libs]) { const vdf = await readFile(join(root, 'steamapps/libraryfolders.vdf'), 'utf8').catch(() => ''); for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\')); }
    const games = new Set<string>();
    for (const lib of libs) for (const f of await readdir(join(lib, 'steamapps')).catch(() => [] as string[])) {
      if (!/^appmanifest_\d+\.acf$/.test(f)) continue;
      const name = (await readFile(join(lib, 'steamapps', f), 'utf8').catch(() => '')).match(/"name"\s+"([^"]+)"/)?.[1];
      if (name && !/Steamworks|Redistributable|Proton|Steam Linux Runtime/i.test(name)) games.add(name);
    }
    return [...games].sort().slice(0, 100);
  }
  /** One bounded picture of the computer, for the interest planner. Kept in memory only. */
  async snapshot(policy: LocalPolicy, days = 30): Promise<LocalSnapshot> {
    const { pages, searches } = await this.browserHistory({ days, limit: 300, blocklist: policy.blocklist });
    const bookmarks: { title: string; url?: string }[] = [];
    for (const profile of await browserProfiles(this.paths)) bookmarks.push(...await readProfileBookmarks(profile, policy.blocklist));
    const recent: Walked[] = [], types = new Map<string, number>(), folders = new Map<string, number>(), roots = this.userDirs();
    await walk(roots, policy, this.paths.dataDir, f => {
      recent.push(f); const ext = extname(f.name).toLowerCase(); if (ext) types.set(ext, (types.get(ext) || 0) + 1);
      const top = roots.find(r => f.path.startsWith(r)); const rest = top ? f.path.slice(top.length + 1).split(/[\\/]/) : []; if (rest.length > 1) folders.set(rest[0], (folders.get(rest[0]) || 0) + 1);
    }, { depth: 3, ms: 5000 });
    return {
      browser: { history: pages.map(p => ({ title: p.title, url: p.url })), bookmarks: [...new Map(bookmarks.map(b => [b.url, b])).values()].slice(0, 120), searches },
      files: { folders: [...folders].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([n, c]) => `${n}×${c}`), recent: recent.sort((a, b) => b.mtime - a.mtime).slice(0, LOCAL_LIMITS.recentFiles).map(f => f.name), types: [...types].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => `${n}×${c}`) },
      software: { apps: await this.listShortcuts(), games: await this.steamGames() },
    };
  }
}
