#!/usr/bin/env node
// Screenshots the renderer (pet window + every notebook page) in headless Chrome with a fake bridge.
// Usage: node scripts/ui-preview.mjs [outDir]   (CHROME=path to override the browser)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(process.argv[2] || join(root, 'docs/evidence/ui'));
const dir = mkdtempSync(join(tmpdir(), 'galagent-ui-'));
await build({ entryPoints: [join(root, 'scripts/ui-preview/entry.ts')], bundle: true, outfile: join(dir, 'app.js'), format: 'esm', target: 'es2022', loader: { '.json': 'json' }, logLevel: 'warning' });
// Headless Chrome barely advances CSS transitions/animations under a virtual-time budget, so the
// preview jumps every finite one to its end state (preview only; the app itself is untouched).
const settle = '<style>*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;animation-delay:-30s!important}</style>';
writeFileSync(join(dir, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css">${settle}</head><body><div id="app"></div><script type="module" src="app.js"></script></body></html>`);
const chrome = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser'].find(c => { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return true; } catch { return existsSync(c); } });
if (!chrome) { console.error('Chrome not found; set CHROME=path'); process.exit(2); }
mkdirSync(out, { recursive: true });
// [name, query, window size, virtual-time budget ms?, dark?]
const pages = ['chat', 'persona', 'pets', 'companion', 'schedule', 'privacy', 'memory', 'diary', 'achievements', 'config'];
const shots = [
  ['pet', 'view=pet', '320,440'], ['pet-busy', 'view=pet&busy=1&bubble=', '320,440'], ['pet-sleep', 'view=pet&sleep=1&bubble=&pet=mochi-cat&action=idle', '320,440'],
  ['pet-unlock', 'view=pet&bubble=&unlock=1&action=idle', '320,440', 1100], ['pet-pat', 'view=pet&bubble=&action=idle&gesture=pat', '320,440', 1800], ['pet-snow', 'view=pet&bubble=&season=snow&action=idle', '320,440'], ['pet-fireflies', 'view=pet&bubble=&season=fireflies&action=idle&pet=mochi-cat', '320,440'],
  ...pages.map(page => [`page-${page}`, `page=${page}`, '1100,800']),
  ['chat-busy', 'page=chat&busy=1', '1100,800'], ['chat-empty', 'page=chat&empty=1', '1100,800'], ['memory-empty', 'page=memory&empty=1', '1100,800'],
  ['palette', 'page=chat&palette=1', '1100,800'], ['unlock', 'page=achievements&unlock=1', '1100,800', 1100], ['narrow', 'page=achievements', '760,700'],
  ...['chat', 'diary', 'achievements'].map(page => [`page-${page}-dark`, `page=${page}`, '1100,800', 2500, true]),
  ['palette-dark', 'page=chat&palette=1', '1100,800', 2500, true], ['pet-dark', 'view=pet&season=petals', '320,440', 2500, true],
  // character-card editor (tavern method) and the lingering pet menu handle
  ['editor-tavern', 'page=persona&editor=builtin:kimi&mode=tavern', '1100,2300'], ['editor-tavern-dark', 'page=persona&editor=builtin:kimi&mode=tavern', '1100,2300', 2500, true],
  ['editor-full', 'page=persona&editor=custom-kiri&mode=tavern&open=1&guide=1', '1100,3600'], ['editor-simple', 'page=persona&editor=builtin:baiyan&mode=simple', '1100,1300'], ['editor-ai', 'page=persona&aidraft=1', '1100,1500'],
  // rotating thinking words (orange shimmer) with the elapsed timer
  ['page-companion-full', 'page=companion', '1100,2400'],
  ['pet-thinking', 'view=pet&busy=1&bubble=', '320,440', 7000], ['pet-thinking-dark', 'view=pet&busy=1&bubble=', '320,440', 7000, true], ['chat-thinking', 'page=chat&busy=1', '1100,800', 7000],
  ['pet-handle', 'view=pet&bubble=&action=idle&handle=1', '320,440', 1500], ['pet-handle-dark', 'view=pet&bubble=&action=idle&handle=1', '320,440', 1500, true],
  ...['persona', 'companion', 'memory', 'privacy', 'schedule', 'config', 'pets'].map(page => [`page-${page}-dark`, `page=${page}`, '1100,800', 2500, true]),
];
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : undefined;
// Pet shots go through a fixed-size iframe over a desktop-like backdrop: headless Chrome lays the page
// out at its default viewport before resizing for the capture, which would skew the pet layout.
const page = (name, query, size) => {
  if (!query.startsWith('view=pet')) return `file://${join(dir, 'index.html')}?${query}`;
  const [w, h] = size.split(',');
  writeFileSync(join(dir, `${name}.html`), `<!doctype html><meta name="color-scheme" content="light dark"><body style="margin:0;background:linear-gradient(135deg,#3b4a6b,#8a6f9e)"><iframe src="index.html?${query}" width="${w}" height="${h}" style="border:0;display:block;background:transparent" allowtransparency="true"></iframe></body>`);
  return `file://${join(dir, name + '.html')}`;
};
for (const [name, query, size, budget = 2500, dark = false] of shots) {
  if (only && !only.test(name)) continue;
  execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${size}`, `--virtual-time-budget=${budget}`, '--allow-file-access-from-files', ...(dark ? ['--force-dark-mode'] : []), `--screenshot=${join(out, name + '.png')}`, page(name, query, size)], { stdio: 'ignore' });
  console.log('✓', name);
}
