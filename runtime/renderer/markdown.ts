// Tiny, safe markdown for chat bubbles. Every character of the source is HTML-escaped
// first; the only markup that can come out is the fixed tag set built here, with no
// attributes except an escaped title on links (links are shown as text, never navigable).

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const emphasis = (text: string) => text
  .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')
  .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

function inline(escaped: string): string {
  // Code spans and links become opaque tokens first, so emphasis can never reach inside them.
  const tokens: string[] = [], codes: string[] = [];
  const token = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  const raw = (text: string) => text.replace(/\u0001(\d+)\u0001/g, (_, i: string) => `\`${codes[Number(i)]}\``);
  let out = escaped.replace(/`([^`\n]+)`/g, (_, code: string) => { codes.push(code); return `\u0001${codes.length - 1}\u0001`; });
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, text: string, url: string) => token(`<span class="md-link" title="${raw(url)}">${emphasis(raw(text))}</span>`));
  out = emphasis(out).replace(/\u0001(\d+)\u0001/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => tokens[Number(i)]);
}

/** Markdown subset → HTML string: paragraphs, line breaks, **bold**, *italic*, ~~strike~~, `code`, ``` blocks ```, lists, quotes, headings. */
export function renderMarkdown(source: string): string {
  const lines = escapeHtml(String(source ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000\u0001]/g, '')).split('\n');
  const html: string[] = [];
  let paragraph: string[] = [], list: { tag: 'ul' | 'ol'; items: string[] } | undefined, quote: string[] = [];
  const flush = () => {
    if (paragraph.length) { html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = []; }
    if (list) { html.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = undefined; }
    if (quote.length) { html.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); quote = []; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i]);
      const lang = fence[1].trim().replace(/[^\w+#.-]/g, '').slice(0, 20);
      html.push(`<pre${lang ? ` data-lang="${lang}"` : ''}><code>${body.join('\n')}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const bullet = /^\s*[-*+•]\s+(.*)$/.exec(line), ordered = /^\s*\d{1,3}[.)、]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const tag = bullet ? 'ul' : 'ol';
      if (paragraph.length || quote.length || (list && list.tag !== tag)) flush();
      list ??= { tag, items: [] };
      list.items.push((bullet || ordered)![1]);
      continue;
    }
    const q = /^\s*&gt;\s?(.*)$/.exec(line);
    if (q) { if (paragraph.length || list) flush(); quote.push(q[1]); continue; }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) { flush(); html.push(`<p class="md-h">${inline(heading[1])}</p>`); continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); html.push('<hr>'); continue; }
    if (list || quote.length) flush();
    paragraph.push(line);
  }
  flush();
  return html.join('');
}
