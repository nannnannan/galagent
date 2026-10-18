// REAL K3 dual-core check on the packaged app (release/dual-core) with an isolated data dir.
// Uses the user's local Mira proxy (127.0.0.1:18890). No production data; the key is never printed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const root = process.cwd(), stamp = Date.now();
const dataDir = path.join(root, '.cache', 'dual-core-live-' + stamp), workDir = path.join(root, '.cache', 'dual-core-live-work-' + stamp);
await mkdir(dataDir, { recursive: true }); await mkdir(workDir, { recursive: true });
await writeFile(path.join(workDir, 'README.md'), '# 星图项目\n\n## 安装\n运行 npm install。\n\n## 使用\n双击启动。\n\n## 许可\nMIT\n');
const db = new DatabaseSync(path.join(dataDir, 'companion.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL)');
db.prepare('INSERT INTO records VALUES(?,?,?)').run('identity', 'state', JSON.stringify({ id: randomUUID(), name: '星棱', onboarding: 'ready', stage: 'S4' }));
db.close();
const key = (await readFile(((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/Desktop/mira反代/kimi-api/.local-api-key"), 'utf8')).trim();
const env = { ...process.env, GALAGENT_DATA_DIR: dataDir, GALAGENT_DEBUG_PORT: '9352', KIMI_API_KEY: '', MOONSHOT_API_KEY: '' }; delete env.ELECTRON_RUN_AS_NODE;
const exe = path.join(root, 'release/dual-core/win-unpacked/GalAgent.exe');
const until = async (fn, ms) => { const end = Date.now() + ms; while (!(await fn())) { if (Date.now() > end) return false; await new Promise(r => setTimeout(r, 1000)); } return true; };
let child, connection, pet; const t0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const report = { at: new Date().toISOString(), scope: 'actual dual-core packaged app, isolated data dir, REAL Mira platform K3 via 127.0.0.1:18890', productionDataUsed: false, chats: [], checks: {} };
try {
  const { openSync } = await import('node:fs'); const out = openSync(path.join(root, '.cache', 'dual-core-live-main.log'), 'w'); child = spawn(exe, ['--enable-logging'], { env: { ...env, ELECTRON_ENABLE_LOGGING: '1', ELECTRON_ENABLE_STACK_DUMPING: '1' }, windowsHide: true, stdio: ['ignore', out, out] }); child.on('exit', (code, sig) => log('app exited', code, sig));
  for (let i = 0; i < 150; i++) { try { await fetch('http://127.0.0.1:9352/json/version'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  connection = await chromium.connectOverCDP('http://127.0.0.1:9352');
  for (let i = 0; i < 100; i++) { pet = connection.contexts().flatMap(c => c.pages()).find(p => p.url().includes('view=pet')); if (pet) break; await new Promise(r => setTimeout(r, 100)); }
  await pet.waitForFunction(() => !!window.galagent);
  const send = async command => { let result; for (let i = 0; i < 3; i++) { result = await pet.evaluate(c => window.galagent.dispatch(c), command); if (result.ok || command.type !== 'chat.send') break; log('retry chat.send after:', result.error); await new Promise(r => setTimeout(r, 1500)); } assert.equal(result.ok, true, `${command.type}: ${result.error}`); };
  const snap = () => pet.evaluate(() => window.galagent.getSnapshot());
  await send({ type: 'config.save', baseUrl: 'http://127.0.0.1:18890/v1', model: 'kimi-code/k3', apiKey: key });
  await send({ type: 'agent.configure', cwd: workDir });
  await send({ type: 'settings.update', settings: { observationEnabled: true } });
  // 1) Ten real turns: memory ops + journal.
  const prompts = ['你好呀，我叫阿黄，今天刚下班。', '我最喜欢喝不加糖的乌龙茶。', '你最近在练什么钢琴曲？', '我周末打算去爬山。', '其实我不喝乌龙茶了，最近改喝美式咖啡。', '你还记得我现在喜欢喝什么吗？', '今天写代码写得有点累。', '给我讲一句鼓励的话吧。', '我养了一只叫团子的橘猫。', '好啦，今天就聊到这，谢谢你陪我。'];
  for (const text of prompts) {
    const started = Date.now();
    await send({ type: 'chat.send', text });
    const s = await snap();
    const reply = [...s.messages].reverse().find(m => m.role === 'assistant' && m.source === 'chat');
    report.chats.push({ user: text, reply: reply?.text, ms: Date.now() - started });
    log('chat ok', text.slice(0, 12), '→', reply?.text.slice(0, 40));
  }
  const journalOk = await until(async () => (await snap()).diary.some(d => d.kind === 'journal'), 180000);
  let s = await snap();
  report.checks.online = s.status.online;
  report.checks.journal = journalOk ? s.diary.filter(d => d.kind === 'journal').map(d => ({ title: d.title, sources: d.sourceIds.length, text: d.text })) : 'not written within 180s';
  await until(async () => (await snap()).status.tasks.every(t => t.state !== 'running' && t.state !== 'queued'), 120000);
  s = await snap();
  report.checks.memories = s.memories.map(m => ({ text: m.text, importance: m.importance, valid: m.valid }));
  log('journal', journalOk, 'memories', report.checks.memories.length);
  // 2) Real delegated task → attention → wake.
  const before = s.messages.filter(m => m.source === 'initiative').length;
  await send({ type: 'agent.run', task: '读取工作目录里的 README.md，告诉我它有几个二级章节，分别叫什么。不要修改任何文件。' });
  const agentDone = await until(async () => { const x = await snap(); return !x.agent.busy && !!x.agent.lastResult; }, 240000);
  s = await snap();
  report.checks.agent = { done: agentDone, status: s.agent.lastResult?.status, toolCount: s.agent.lastResult?.toolCount, summary: s.agent.lastResult?.summary };
  log('agent', report.checks.agent.status, report.checks.agent.toolCount);
  const woke = await until(async () => { const x = await snap(); return x.messages.filter(m => m.source === 'initiative').length > before || (x.status.attention.evaluations > 0 && !x.status.attention.running && x.status.attention.lastDecision && x.status.attention.lastDecision !== 'wake' && x.status.attention.pendingEvents === 0); }, 180000);
  s = await snap();
  report.checks.attention = { ...s.status.attention };
  report.checks.wakeReply = s.messages.filter(m => m.source === 'initiative').slice(before).map(m => m.text);
  report.checks.pool = s.status.pool;
  report.checks.tokensToday = s.stats.tokensToday;
  report.checks.error = s.status.error || null;
  log('attention', s.status.attention.lastDecision, s.status.attention.lastReason, 'wake replies', report.checks.wakeReply.length);
  report.passed = !!(report.checks.online && journalOk && agentDone && report.checks.agent.status === 'done' && woke && s.status.attention.evaluations > 0);
  await writeFile('docs/evidence/双核心真实K3验收.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.passed = false; report.failure = String(error?.message || error);
  await writeFile('docs/evidence/双核心真实K3验收.json', JSON.stringify(report, null, 2));
  console.log('FAILED', report.failure); process.exitCode = 1;
} finally {
  await pet?.evaluate(() => window.galagent.dispatch({ type: 'app.quit' })).catch(() => {});
  if (child?.exitCode === null) await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 5000))]);
  if (child?.exitCode === null) child.kill();
  await connection?.close().catch(() => {});
}
