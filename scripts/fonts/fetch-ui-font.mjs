#!/usr/bin/env node
// Downloads the bundled UI typeface (Noto Sans SC, SIL Open Font License 1.1) as woff2 subsets and writes
// runtime/renderer/fonts.css with local paths.
//
// Why a bundled font: the UI used to fall back to whatever the OS had (Microsoft YaHei UI / PingFang), so the
// type looked different on every machine and read as generic. This one is the same everywhere, has a proper
// weight range for UI, and its Latin/numerals sit on the same baseline as the Chinese.
//
// The subset files are committed, so packaging and CI never need the network; run this only to refresh.
//   node scripts/fonts/fetch-ui-font.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'runtime/renderer/fonts');
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400..700&display=swap';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();
if (!css.includes('@font-face')) throw new Error('字体 CSS 没有返回 @font-face，可能被限流；稍后重试。');
await mkdir(OUT, { recursive: true });

const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]))];
const local = new Map();
let bytes = 0;
let done = 0;
await Promise.all(urls.map(async url => {
  const name = `noto-sans-sc-${path.basename(new URL(url).pathname)}`;
  const body = Buffer.from(await (await fetch(url)).arrayBuffer());
  bytes += body.length;
  local.set(url, name);
  await writeFile(path.join(OUT, name), body);
  done++;
  if (done % 20 === 0) console.log(`  ${done}/${urls.length}`);
}));

// Same unicode-range blocks as Google serves; only the URLs point at the local copies.
const family = css
  .replace(/\/\*[^*]*\*\/\s*/g, '')
  .replace(/url\(https:\/\/fonts\.gstatic\.com\/[^)]+\)/g, url => `url("./fonts/${local.get(url.replace(/^url\(|\)$/g, ''))}")`)
  .replace(/font-family: 'Noto Sans SC';/g, 'font-family: \'Gal Agent Sans\';')
  .trim();
const head = `/* GalAgent · 界面字体：Noto Sans SC（SIL Open Font License 1.1），按 unicode-range 分片，浏览器只加载用到的分片。
   由 scripts/fonts/fetch-ui-font.mjs 生成，不要手改；授权原文见 runtime/renderer/fonts/OFL.txt。 */
`;
await writeFile(path.join(ROOT, 'runtime/renderer/fonts.css'), head + family + '\n');
console.log(`✓ fonts.css · ${urls.length} 个分片 · ${(bytes / 1048576).toFixed(2)} MB`);
