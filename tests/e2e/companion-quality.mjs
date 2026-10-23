// Owned Electron instance, local model/TTS fixtures, fresh data directory. No production account or observation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const root = process.cwd(), dataDir = path.join(root, '.cache', 'companion-quality-' + Date.now());
const exe = process.env.GALAGENT_TEST_EXE || path.join(root, 'release/companion-quality/win-unpacked/GalAgent.exe');
const sandboxDiagnostic = process.env.GALAGENT_TEST_NO_SANDBOX === '1';
await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'companion.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL)');
db.prepare('INSERT INTO records VALUES(?,?,?)').run('identity', 'state', JSON.stringify({ id: randomUUID(), name: '星棱', onboarding: 'ready', stage: 'S4' }));
db.close();
let slowRequests = 0, attentionCalls = 0;
const wav = Buffer.alloc(44 + 24000); // half a second of silent 24kHz mono PCM, real decoder input.
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(24000, 40);
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (req.url === '/v1/audio/speech') {
      if (body.input === 'slow') {
        slowRequests++;
        const timer = setTimeout(() => { if (!res.destroyed) { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(wav); } }, 10000);
        res.on('close', () => clearTimeout(timer)); return;
      }
      res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(wav); return;
    }
    const system = String(body.messages[0].content);
    let reply;
    if (body.tools) reply = '隔离检查完成，没有修改文件。';
    else if (system.startsWith('你是GalAgent的后台注意力代理')) {
      attentionCalls++;
      const input = JSON.parse(body.messages[1].content), event = input.events.find(e => e.kind === 'task');
      reply = event ? { decision: 'wake', reason: '委派任务已完成', evidence: [event.id], nextCheck: null, wakeHint: '汇报结果' } : { decision: 'silent', reason: '无需打扰', evidence: [], nextCheck: null };
    } else if (system.includes('facts每项')) reply = { ops: [], diary: '' };
    else reply = { text: '[隔离验收] 我在这里，事情已经记下了。', expression: 'pleased', action: 'idle' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }], usage: { total_tokens: 10 } }));
  } catch { res.writeHead(500); res.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const portProbe = createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const debugPort = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
const env = { ...process.env, GALAGENT_DATA_DIR: dataDir, GALAGENT_DEBUG_PORT: String(debugPort), KIMI_API_KEY: '', MOONSHOT_API_KEY: '', TTS_API_KEY: '', MIMO_API_KEY: '' };
delete env.ELECTRON_RUN_AS_NODE;
let child, connection, pet, chat, startupLog = '';
const errors = [];
async function until(fn, message, ms = 15000) {
  const end = Date.now() + ms;
  while (!(await fn())) { if (Date.now() > end) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 100)); }
}
async function launch() {
  startupLog = '';
  child = spawn(exe, sandboxDiagnostic ? ['--no-sandbox'] : [], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { startupLog = (startupLog + chunk).slice(-4000); });
  child.stderr.on('data', chunk => { startupLog = (startupLog + chunk).slice(-4000); });
  child.on('error', error => errors.push(String(error)));
  try { await until(async () => { try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; } }, 'Electron did not start'); }
  catch { throw new Error(`Electron did not start (exit ${child.exitCode}): ${startupLog}; ${errors.join('; ')}`); }
  connection = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  await until(() => { const pages = connection.contexts().flatMap(c => c.pages()); pet = pages.find(p => p.url().includes('view=pet')); chat = pages.find(p => p.url().includes('view=chat')); return pet && chat; }, 'Views not loaded');
  await pet.waitForFunction(() => Boolean(window.galagent));
  for (const page of [pet, chat]) page.on('pageerror', error => errors.push(String(error)));
}
const snapshot = () => pet.evaluate(() => window.galagent.getSnapshot());
async function send(command) { const result = await pet.evaluate(command => window.galagent.dispatch(command), command); assert.equal(result.ok, true, result.error); }
async function close() {
  await pet?.evaluate(() => window.galagent.dispatch({ type: 'app.quit' })).catch(() => {});
  if (child?.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child?.exitCode === null) child.kill();
  await connection?.close().catch(() => {}); connection = undefined;
}
const checks = {};
try {
  await launch();
  await send({ type: 'config.save', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', mode: 'native-api', apiKey: 'fixture' });
  await send({ type: 'shell.chat', open: true });
  await chat.locator('[data-page=settings]').click();
  await chat.getByRole('radio', { name: /专注时光/ }).click();
  assert.equal((await snapshot()).settings.companionMode, 'focus');
  await send({ type: 'agent.run', task: '隔离测试，检查完成状态，不修改文件' });
  await until(async () => !(await snapshot()).agent.busy, 'Task did not finish');
  await send({ type: 'initiative.check' });
  assert.equal((await snapshot()).messages.filter(m => m.source === 'initiative').length, 0);
  assert.equal(attentionCalls, 0);
  await send({ type: 'chat.send', text: '专注时仍可以聊天' });
  assert.ok((await snapshot()).messages.some(m => m.role === 'assistant' && m.source === 'chat'));
  checks.focusAllowsChatWithoutInterruption = true;

  await chat.getByRole('radio', { name: /日常陪伴/ }).click();
  await send({ type: 'initiative.check' });
  await until(async () => (await snapshot()).messages.some(m => m.source === 'initiative'), 'No task wake');
  const wake = (await snapshot()).messages.find(m => m.source === 'initiative');
  assert.deepEqual(wake.initiativeTopics, ['task']);
  await chat.locator('[data-page=chat]').click();
  await chat.getByRole('button', { name: '这类先别提醒', exact: true }).click();
  assert.equal((await snapshot()).companionship.topics.task, 'mute');
  await chat.getByRole('button', { name: '这种提醒挺好', exact: true }).click();
  assert.equal((await snapshot()).companionship.topics.task, 'welcome');
  checks.feedbackButtons = true;

  await send({ type: 'settings.update', settings: { companionMode: 'rest', observationEnabled: true } });
  await send({ type: 'browser.report', report: { activeTab: { url: 'https://example.com', title: 'fixture' } } });
  assert.equal((await snapshot()).browser.connected, false);
  assert.equal((await snapshot()).observation.available, false);
  await send({ type: 'settings.update', settings: { observationEnabled: false, companionMode: 'daily' } });
  checks.restPausesObservation = true;

  await send({ type: 'tts.configure', ttsEnabled: true, ttsBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, ttsModel: 'tts-1', ttsVoice: 'fixture', ttsApiKey: 'fixture' });
  await pet.evaluate(() => { window.pendingSpeech = window.galagent.synthesizeSpeech('slow'); });
  await until(() => slowRequests === 1, 'TTS request not received');
  await chat.evaluate(() => window.galagent.dispatch({ type: 'tts.stop' }));
  assert.equal((await pet.evaluate(() => window.pendingSpeech)).ok, false);
  checks.crossWindowStopCancelsHttp = true;
  await pet.evaluate(() => { window.pendingSpeech = window.galagent.synthesizeSpeech('slow'); });
  await until(() => slowRequests === 2, 'Second TTS request not received');
  assert.equal((await pet.evaluate(() => window.galagent.synthesizeSpeech('new'))).ok, true);
  assert.equal((await pet.evaluate(() => window.pendingSpeech)).ok, false);
  checks.newSpeechAbortsPreviousHttp = true;

  // Delay actual Web Audio decoding and stop from the other window before it returns.
  await pet.evaluate(() => {
    const original = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function(...args) {
      const decoded = await original.apply(this, args);
      await new Promise(resolve => { window.releaseDecode = resolve; });
      return decoded;
    };
  });
  await send({ type: 'chat.send', text: '验证停止后不会恢复播放' });
  await until(() => pet.evaluate(() => Boolean(window.releaseDecode)), 'Audio decode was not reached');
  await send({ type: 'tts.stop' });
  await pet.evaluate(() => window.releaseDecode());
  await new Promise(resolve => setTimeout(resolve, 150));
  const diagnostics = await pet.evaluate(() => document.querySelector('canvas.living-canvas').getLivingDiagnostics());
  assert.equal(diagnostics.ttsActive, false); assert.equal(diagnostics.live2d, true);
  checks.stopDuringRealAudioDecode = true;

  await send({ type: 'settings.update', settings: { companionMode: 'focus' } });
  await chat.locator('[data-page=settings]').click();
  await chat.getByRole('radio', { name: /专注时光/ }).waitFor();
  await chat.getByRole('radio', { name: /专注时光/ }).focus();
  await chat.keyboard.press('ArrowRight');
  assert.equal((await snapshot()).settings.companionMode, 'rest');
  await chat.keyboard.press('ArrowLeft');
  assert.equal((await snapshot()).settings.companionMode, 'focus');
  checks.keyboardModeSelection = true;
  await chat.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'));
  await chat.waitForFunction(() => getComputedStyle(document.querySelector('#toast')).opacity === '0');
  await mkdir('docs/evidence', { recursive: true });
  await chat.screenshot({ path: 'docs/evidence/companionship-settings-20261023.png' });
  await close(); await launch();
  assert.equal((await snapshot()).settings.companionMode, 'focus');
  assert.equal((await snapshot()).companionship.topics.task, 'welcome');
  assert.equal((await snapshot()).companionship.ratings[wake.id], 'welcome');
  checks.modeAndFeedbackSurviveNativeRestart = true;
  assert.deepEqual(errors, []);
  const report = { at: new Date().toISOString(), passed: true, scope: 'isolated packaged Electron, fixture model and silent PCM TTS; real IPC, UI, Web Audio decode and restart', sandboxDiagnostic, productionDataUsed: false, checks, live2d: { parameters: diagnostics.live2dParameters, drawables: diagnostics.live2dDrawables, physicsLoaded: diagnostics.physicsLoaded }, errors };
  await writeFile('docs/evidence/companionship-quality-20261023.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await close(); await new Promise(resolve => server.close(resolve)); }
