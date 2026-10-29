// Isolated packaged DUAL-CORE check (release/dual-core). Formal user data is never touched.
// A local fixture stands in for the K3 proxy: it answers the main character, the attention
// agent, the executor and the journal writer, and records what each one received.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const root = process.cwd(), dataDir = path.join(root, '.cache', 'dual-core-native-' + Date.now());
await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'companion.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL)');
const id = randomUUID();
db.prepare('INSERT INTO records VALUES(?,?,?)').run('identity', 'state', JSON.stringify({ id, name: '星棱', onboarding: 'ready', stage: 'S4' }));
db.close();
const seen = { chat: 0, attention: [], executor: 0, journal: 0, extract: 0, wake: [] }, errors = [];
let inflight = 0, peak = 0;
const server = createServer(async (req, res) => {
  inflight++; peak = Math.max(peak, inflight);
  try {
    let raw = ''; for await (const c of req) raw += c;
    if (req.url === '/v1/audio/speech') {
      const wav = Buffer.alloc(64);
      wav.write('RIFF', 0);
      wav.writeUInt32LE(56, 4);
      wav.write('WAVE', 8);
      res.writeHead(200, { 'Content-Type': 'audio/wav' });
      res.end(wav);
      return;
    }
    const body = JSON.parse(raw), system = String(body.messages[0].content);
    if (body.audio && String(body.model || '').startsWith('mimo-')) {
      const wav = Buffer.alloc(64);
      wav.write('RIFF', 0);
      wav.writeUInt32LE(56, 4);
      wav.write('WAVE', 8);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: null,
            audio: {
              id: 'audio_mimo_fixture',
              data: wav.toString('base64'),
              transcript: String(body.messages.at(-1)?.content || ''),
            },
          },
        }],
      }));
      return;
    }
    let message;
    if (body.tools) { seen.executor++; message = { role: 'assistant', content: '已核对 README.md：共 3 个章节，没有发现问题。' }; }
    else if (system.startsWith('你是GalAgent的后台注意力代理')) {
      const user = body.messages[1].content, text = typeof user === 'string' ? user : user[0].text, input = JSON.parse(text);
      seen.attention.push({ events: input.events.map(e => e.kind), screenAttached: Array.isArray(user) && user[1]?.type === 'image_url', hasMainContext: text.includes('状态数据') });
      const task = input.events.find(e => e.kind === 'task');
      message = { role: 'assistant', content: JSON.stringify(task ? { decision: 'wake', reason: '后台任务完成', evidence: [task.id], nextCheck: null, wakeHint: '告诉用户检查结果' } : { decision: 'observe', reason: '没有需要打扰的事', evidence: [], nextCheck: null, screenSummary: input.screen ? '桌面上有若干窗口' : undefined }) };
    }
    else if (system.includes('你在写自己的日记')) { seen.journal++; message = { role: 'assistant', content: JSON.stringify({ title: '十次对话', journal: '今天他陪我聊了十句话，我觉得他很耐心。我猜他今天心情不错，不过这只是我的感觉。' }) }; }
    else if (system.includes('facts每项')) { seen.extract++; message = { role: 'assistant', content: JSON.stringify({ ops: [], diary: '' }) }; }
    else {
      seen.chat++;
      const context = JSON.parse(system.split('\n状态数据：')[1]);
      if (context.wake) { seen.wake.push(context.wake); message = { role: 'assistant', content: JSON.stringify({ text: '[隔离] README 检查完啦，三个章节都没问题～', expression: 'pleased', action: 'celebrate' }) }; }
      else message = { role: 'assistant', content: JSON.stringify({ text: '[隔离] 嗯嗯。', expression: 'neutral', action: 'idle' }) };
    }
    await new Promise(r => setTimeout(r, 30));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message }], usage: { total_tokens: 20 } }));
  } catch (error) { errors.push(String(error)); res.writeHead(500); res.end('{}'); }
  finally { inflight--; }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const env = { ...process.env, GALAGENT_DATA_DIR: dataDir, GALAGENT_DEBUG_PORT: '9351', KIMI_API_KEY: '', MOONSHOT_API_KEY: '' }; delete env.ELECTRON_RUN_AS_NODE;
const exe = path.join(root, 'release/dual-core/win-unpacked/GalAgent.exe');
let child, connection, pet;
const until = async (fn, ms) => { const end = Date.now() + ms; while (!(await fn())) { if (Date.now() > end) return false; await new Promise(r => setTimeout(r, 250)); } return true; };
try {
  child = spawn(exe, [], { env, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 150; i++) { try { await fetch('http://127.0.0.1:9351/json/version'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  connection = await chromium.connectOverCDP('http://127.0.0.1:9351');
  for (let i = 0; i < 100; i++) { pet = connection.contexts().flatMap(c => c.pages()).find(p => p.url().includes('view=pet')); if (pet) break; await new Promise(r => setTimeout(r, 100)); }
  await pet.waitForFunction(() => !!window.galagent);
  const send = async command => { const result = await pet.evaluate(c => window.galagent.dispatch(c), command); assert.equal(result.ok, true, result.error); };
  const snap = () => pet.evaluate(() => window.galagent.getSnapshot());
  await send({ type: 'config.save', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'kimi-code/k3', apiKey: 'isolated-fixture' });
  await send({ type: 'settings.update', settings: { observationEnabled: true, screenCaptureEnabled: true, clipboardEnabled: true, forbiddenPaths: [path.join(dataDir, 'forbidden-vault')] } });
  await send({ type: 'tts.configure', ttsEnabled: true, ttsBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, ttsModel: 'mimo-v2.5-tts', ttsVoice: '冰糖', ttsSpeed: 1.0, ttsApiKey: 'tts-fixture' });
  await send({ type: 'pet.roam', active: true, direction: 1 });
  const ttsRes = await pet.evaluate(() => window.galagent.synthesizeSpeech('你好，很高兴认识你。'));
  assert.equal(ttsRes.ok, true);
  assert.equal(ttsRes.provider, 'http');
  await send({ type: 'watch.add', title: '留意 CI 构建结果', condition: 'Build succeeded' });
  await send({ type: 'browser.report', report: { activeTab: { url: 'https://example.com/ci', title: 'CI Build' }, openTabs: [{ url: 'https://example.com/ci', title: 'CI Build', active: true }], pageContent: { url: 'https://example.com/ci', title: 'CI Build', text: 'Build succeeded', readable: true } } });
  const loaded = await until(() => pet.evaluate(() => Boolean(document.querySelector('canvas.pixel-pet-canvas')?.getPixelPetDiagnostics?.()?.pet)), 10000);
  const petDiag = await pet.evaluate(() => document.querySelector('canvas.pixel-pet-canvas')?.getPixelPetDiagnostics?.());
  assert.ok(loaded, `pixel pet rendered in pet window: ${JSON.stringify(petDiag)}`);
  assert.equal(petDiag.renderer, 'pixel-canvas');
  assert.ok(petDiag.draws > 0);
  let state = await snap();
  assert.equal(state.settings.screenCaptureEnabled, true);
  assert.equal(state.settings.roamingEnabled, true);
  assert.equal(state.settings.ttsEnabled, true);
  assert.equal(state.settings.ttsModel, 'mimo-v2.5-tts');
  assert.equal(state.settings.ttsVoice, '冰糖');
  assert.equal(state.status.pool.limit, 20);
  assert.ok(state.settings.captureBlocklist.includes('KeePass'));
  assert.equal(state.agent.mode, 'directory-guarded');
  assert.ok(state.agent.policyVersion >= 2);
  assert.equal(state.watches.length, 1);
  assert.equal(state.browser.connected, true);
  assert.equal(state.browser.pageContent.readable, true);
  // 10 chat turns → one journal.
  for (let i = 0; i < 10; i++) await send({ type: 'chat.send', text: `隔离对话第${i + 1}句` });
  assert.ok(await until(async () => (await snap()).diary.some(d => d.kind === 'journal'), 15000), 'journal written after 10 turns');
  // Delegated task → attention → wake → main character reports.
  await send({ type: 'agent.run', task: '检查 README.md 的章节结构' });
  assert.ok(await until(async () => (await snap()).messages.some(m => m.source === 'initiative' && m.text.includes('README')), 30000), 'main character reported the task result');
  state = await snap();
  const report = {
    at: new Date().toISOString(), passed: true, scope: 'actual dual-core packaged app, isolated data dir, local fixture model (no real K3: proxy unavailable)',
    productionDataUsed: false,
    pixelPet: { pet: petDiag.pet, unit: petDiag.unit, draws: petDiag.draws },
    tts: {
      enabled: state.settings.ttsEnabled,
      provider: ttsRes.provider,
      voice: state.settings.ttsVoice,
    },
    directoryGuard: {
      mode: state.agent.mode,
      policyVersion: state.agent.policyVersion,
      forbiddenCount: state.agent.forbiddenPaths.length,
    },
    browserPerception: {
      connected: state.browser.connected,
      activeTab: state.browser.activeTab,
      readable: state.browser.pageContent?.readable,
      watches: state.watches.length,
    },
    journal: state.diary.filter(d => d.kind === 'journal').map(d => ({ title: d.title, sources: d.sourceIds.length })),
    attention: { evaluations: state.status.attention.evaluations, wakes: state.status.attention.wakes, lastDecision: state.status.attention.lastDecision, requests: seen.attention, separateFromMainContext: seen.attention.every(a => !a.hasMainContext) },
    wakeEvents: seen.wake.map(w => w.events.map(e => e.kind)),
    pool: state.status.pool, fixturePeakConcurrency: peak,
    counts: { chat: seen.chat, executor: seen.executor, journal: seen.journal, extract: seen.extract },
    lastScreenAt: state.status.attention.lastScreenAt || null, lastSkip: state.status.attention.lastSkip || null,
    reply: state.messages.filter(m => m.source === 'initiative').at(-1)?.text, errors,
  };
  assert.equal(report.journal.length, 1);
  assert.equal(report.journal[0].sources, 20);
  assert.ok(report.attention.wakes >= 1);
  assert.ok(report.attention.separateFromMainContext);
  assert.ok(peak <= 20);
  assert.deepEqual(errors, []);
  await mkdir('docs/evidence', { recursive: true });
  await writeFile('docs/evidence/双核心原生验收.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pet?.evaluate(() => window.galagent.dispatch({ type: 'app.quit' })).catch(() => {});
  if (child?.exitCode === null) await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 5000))]);
  if (child?.exitCode === null) child.kill();
  await connection?.close().catch(() => {});
  await new Promise(r => server.close(r));
}
// Raw screenshots must never be persisted: scan the isolated database files.
const files = ['companion.sqlite', 'companion.sqlite-wal'].map(f => path.join(dataDir, f));
let leaked = false;
for (const f of files) { const bytes = await readFile(f).catch(() => Buffer.alloc(0)); if (bytes.includes('data:image/')) leaked = true; }
assert.equal(leaked, false, 'no image data in the database');
console.log('no screenshot bytes in database: ok');
