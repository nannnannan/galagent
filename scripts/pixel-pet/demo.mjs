#!/usr/bin/env node
// 构建像素小人渲染器演示页，并用无头 Chrome 截图 + 检查 API。
// 用法：node scripts/pixel-pet/demo.mjs [截图.png]（需要本机安装 Chrome / Chromium，可用 CHROME=路径 指定）
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROOT } from './lib.mjs';

const shot = resolve(process.argv[2] ?? join(ROOT, 'docs/evidence/pixel-pets/renderer-demo.png'));
const dir = mkdtempSync(join(tmpdir(), 'pixel-pet-demo-'));
await build({ entryPoints: [join(ROOT, 'scripts/pixel-pet/demo/demo.ts')], bundle: true, outfile: join(dir, 'demo.js'), format: 'iife', target: 'es2022', loader: { '.json': 'json' }, logLevel: 'warning' });
copyFileSync(join(ROOT, 'scripts/pixel-pet/demo/demo.html'), join(dir, 'demo.html'));
const chrome = process.env.CHROME ?? ['google-chrome', 'chromium', 'chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(c => { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return true; } catch { return existsSync(c); } });
if (!chrome) { console.error('未找到 Chrome，可用 CHROME=路径 指定；演示页已生成：' + join(dir, 'demo.html')); process.exit(2); }
const url = `file://${join(dir, 'demo.html')}?ms=1400`;
const flags = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1100,400', '--virtual-time-budget=2000'];
execFileSync(chrome, [...flags, `--screenshot=${shot}`, url], { stdio: 'ignore' });
const dom = execFileSync(chrome, [...flags, '--dump-dom', url], { encoding: 'utf8' });
const json = JSON.parse(dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)?.[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') ?? '{}');
rmSync(dir, { recursive: true, force: true });
console.log(`截图：${shot}`);
console.log(`命中测试：中心=${json.hitCenter}，角落=${json.hitCorner}；头顶锚点=${JSON.stringify(json.headAnchor)}`);
for (const d of json.diagnostics ?? []) console.log(`  ${d.pet.padEnd(15)} 动作=${String(d.action).padEnd(9)} 眼睛=${String(d.eyes).padEnd(9)} 嘴=${String(d.mouth).padEnd(6)} 帧数=${d.draws} 粒子=${d.particles} 单位=${d.unit}`);
console.log(json.ok ? '✓ 渲染器冒烟测试通过' : '✗ 渲染器冒烟测试失败');
process.exit(json.ok ? 0 : 1);
