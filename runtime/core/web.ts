// Key-free web access for the executor (WebSearch / FetchURL) and the main character (web_search / read_webpage).
// Every hop is checked by the caller's guards (protocol, credentials in URL, PrivacyGuard URL check, public
// address only); pages are decoded by their declared charset so GBK/GB18030 sites read correctly.

export type WebGuards = {
  fetch?: typeof fetch;
  signal: AbortSignal;
  /** PrivacyGuard / allow-list check; throws to block. */
  checkUrl?: (url: URL) => void;
  /** Rejects loopback / LAN / link-local targets; throws to block. */
  assertPublic?: (url: URL) => Promise<void>;
};
export type FetchedPage = { url: string; status: number; contentType: string; text: string };
export type SearchResult = { title: string; url: string; snippet: string };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export const MAX_PAGE_BYTES = 2_000_000;

/** GET with manual redirects (≤5), each hop re-checked; body capped and decoded by declared or sniffed charset. */
export async function fetchText(input: string | URL, guards: WebGuards, options: { maxBytes?: number; timeoutMs?: number; accept?: string } = {}): Promise<FetchedPage> {
  const doFetch = guards.fetch || fetch, signal = AbortSignal.any([guards.signal, AbortSignal.timeout(options.timeoutMs ?? 30_000)]);
  let url = new URL(input), response!: Response;
  for (let hop = 0; ; hop++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL must be HTTP(S) without credentials');
    guards.checkUrl?.(url);
    await guards.assertPublic?.(url);
    response = await doFetch(url, { signal, redirect: 'manual', headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8', accept: options.accept || 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5' } });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {});
      if (hop >= 5) throw new Error('Too many redirects');
      url = new URL(location, url); continue;
    }
    break;
  }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('HTTP ' + response.status); }
  const max = options.maxBytes ?? MAX_PAGE_BYTES, chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body?.getReader();
  if (reader) try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length; if (bytes > max) throw new Error('Page exceeds size limit');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const body = new Uint8Array(bytes); let offset = 0; for (const c of chunks) { body.set(c, offset); offset += c.length; }
  const contentType = response.headers.get('content-type') || '';
  return { url: url.toString(), status: response.status, contentType, text: decode(body, contentType) };
}

/** Charset from the header, else a <meta charset> sniffed from the first bytes; unknown labels fall back to UTF-8. */
export function decode(body: Uint8Array, contentType = ''): string {
  let label = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!label) {
    const head = new TextDecoder('latin1').decode(body.subarray(0, 4096));
    label = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  if (label && /^(gb2312|gbk|x-gbk)$/i.test(label)) label = 'gb18030';
  try { return new TextDecoder(label || 'utf-8').decode(body); } catch { return new TextDecoder('utf-8').decode(body); }
}

const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', middot: '·', hellip: '…', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»', times: '×' };
export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') { const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all; }
    return named[code.toLowerCase()] ?? all;
  });
}
const strip = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Readable text of an HTML page: title plus the main content (article/main when substantial), with paragraph breaks kept. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  let body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|template|iframe|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  for (const tag of ['article', 'main']) {
    const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(body);
    if (match && strip(match[1]).length > 400) { body = match[1]; break; }
  }
  body = body.replace(/<(nav|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const text = decodeEntities(body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre|dd|dt|header)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text };
}

/** Bing sometimes wraps targets as bing.com/ck/a?…&u=a1<base64url>. */
function bingTarget(href: string): string {
  try {
    const url = new URL(decodeEntities(href), 'https://www.bing.com');
    const u = url.hostname.endsWith('bing.com') && url.pathname.startsWith('/ck/') ? url.searchParams.get('u') : null;
    if (u?.startsWith('a1')) return Buffer.from(u.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return url.toString();
  } catch { return ''; }
}
export function parseBing(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const end = block.indexOf('</li>'), item = end > 0 ? block.slice(0, end) : block.slice(0, 8000);
    const link = /<h2[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(item);
    if (!link) continue;
    const url = bingTarget(link[1]); if (!/^https?:\/\//.test(url)) continue;
    const para = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(item)?.[1] || /class="b_lineclamp\d*"[^>]*>([\s\S]*?)<\/(?:p|div)>/i.exec(item)?.[1] || '';
    out.push({ title: strip(link[2]), url, snippet: strip(para.replace(/<a\b[^>]*class="b_algoReadMore"[\s\S]*$/i, '')) });
  }
  return out;
}
export function parseDuckDuckGo(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const links = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)].map(m => strip(m[1]));
  links.forEach((m, i) => {
    let url = decodeEntities(m[1]);
    try { const u = new URL(url, 'https://duckduckgo.com'); url = u.searchParams.get('uddg') || u.toString(); } catch { return; }
    if (/^https?:\/\//.test(url)) out.push({ title: strip(m[2]), url, snippet: snippets[i] || '' });
  });
  return out;
}

type Engine = { name: string; url: (q: string) => string; parse: (html: string) => SearchResult[]; blocked: (html: string) => boolean };
export const ENGINES: Engine[] = [
  { name: 'Bing', url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-Hans&count=10`, parse: parseBing, blocked: html => /<title>[^<]*(验证|captcha|challenge)/i.test(html) },
  { name: 'DuckDuckGo', url: q => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, parse: parseDuckDuckGo, blocked: html => /anomaly-modal|challenge-form/i.test(html) },
];
/** Tries each engine in turn; results deduplicated by URL. Throws only when every engine fails. */
export async function webSearch(query: string, guards: WebGuards, limit = 6): Promise<{ engine: string; results: SearchResult[] }> {
  const q = query.trim().slice(0, 300); if (!q) throw new Error('Empty search query');
  const errors: string[] = [];
  for (const engine of ENGINES) {
    try {
      const page = await fetchText(engine.url(q), guards, { timeoutMs: 15_000, maxBytes: 3_000_000 });
      if (engine.blocked(page.text)) { errors.push(`${engine.name}: blocked by a bot check`); continue; }
      const seen = new Set<string>(), results = engine.parse(page.text).filter(r => !seen.has(r.url) && seen.add(r.url)).slice(0, Math.max(1, Math.min(10, limit)));
      if (results.length) return { engine: engine.name, results };
      errors.push(`${engine.name}: no results`);
    } catch (error) { if (guards.signal.aborted) throw error; errors.push(`${engine.name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  throw new Error('Web search failed — ' + errors.join('; '));
}
export const formatResults = (engine: string, query: string, results: SearchResult[]) =>
  `Search results for "${query}" (${engine}; snippets may be outdated — open a page before relying on details):\n` +
  results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet.slice(0, 300)}` : ''}`).join('\n');
