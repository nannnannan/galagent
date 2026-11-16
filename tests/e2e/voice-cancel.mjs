// Packaged Windows regression with generated audio. No physical microphone or external service is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const playwright = process.env.PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { _electron } = await import(pathToFileURL(playwright).href);
const profile = await mkdtemp(path.join(process.cwd(), '.cache', 'voice-cancel-'));
const db = new DatabaseSync(path.join(profile, 'companion.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL)');
db.prepare('INSERT INTO records VALUES (?, ?, ?)').run('settings', 'state', JSON.stringify({
  observationEnabled: false, screenCaptureEnabled: false, clipboardEnabled: false, initiativeEnabled: false, researchEnabled: false,
}));
db.close();

const requests = [];
const server = createServer(async (request, response) => {
  if (request.url !== '/v1/audio/transcriptions') { response.writeHead(404).end(); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const entry = { wav: Buffer.concat(chunks).includes('RIFF'), closed: false };
  requests.push(entry);
  response.once('close', () => { entry.closed = true; });
  if (requests.length === 1) {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ text: '合成录音通过' }));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let app;
async function until(check) {
  for (let i = 0; i < 120; i++) {
    if (check()) return;
    await wait(50);
  }
  throw new Error('Fixture never received or cancelled the transcription');
}
try {
  const env = { ...process.env, GALAGENT_DATA_DIR: profile, GALAGENT_API_KEY: '', OPENAI_API_KEY: '', KIMI_API_KEY: '', MOONSHOT_API_KEY: '', STT_API_KEY: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: path.resolve(process.env.GALAGENT_TEST_EXE || 'release/win-unpacked/GalAgent.exe'),
    args: ['--open-chat', '--autoplay-policy=no-user-gesture-required'], env, timeout: 60000,
  });
  let chat;
  await until(() => Boolean(chat = app.windows().find(page => page.url().includes('view=chat'))));
  await chat.locator('#mic').waitFor({ state: 'attached' });
  await chat.evaluate(() => {
    const fixture = { deferred: false };
    window.voiceFixture = fixture;
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const sink = audio.createMediaStreamDestination();
      oscillator.connect(sink);
      oscillator.start();
      const [track] = sink.stream.getAudioTracks();
      const stop = track.stop.bind(track);
      track.stop = () => { stop(); void audio.close(); };
      fixture.track = track;
      if (fixture.deferred) await new Promise(resolve => { fixture.resolve = resolve; });
      await audio.resume().catch(() => {});
      return sink.stream;
    };
  });
  const send = async command => {
    const result = await chat.evaluate(value => window.galagent.dispatch(value), command);
    assert.equal(result.ok, true, result.error);
  };
  const enable = async () => {
    await send({ type: 'stt.configure', voiceInputEnabled: true, sttBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, sttModel: 'synthetic-audio', sttApiKey: 'fixture-token' });
    await chat.locator('#mic').waitFor({ state: 'visible' });
  };
  const press = async () => {
    await chat.locator('#mic').focus();
    await chat.keyboard.down('Space');
  };
  const release = () => chat.keyboard.up('Space');
  const ended = () => chat.waitForFunction(() => window.voiceFixture.track?.readyState === 'ended');
  const recording = () => chat.waitForFunction(() => document.querySelector('#mic')?.dataset.state === 'recording');

  await enable();
  await chat.evaluate(() => { window.voiceFixture.deferred = true; });
  await press();
  await chat.waitForFunction(() => typeof window.voiceFixture.resolve === 'function');
  await send({ type: 'privacy.lockdown' });
  await chat.locator('#mic').waitFor({ state: 'hidden' });
  await chat.evaluate(() => { window.voiceFixture.resolve(); window.voiceFixture.deferred = false; });
  await ended();
  await release();
  assert.equal(requests.length, 0);

  await enable();
  await press();
  await recording();
  await wait(550);
  await send({ type: 'stt.configure', voiceInputEnabled: false });
  await ended();
  await release();
  assert.equal(requests.length, 0);

  await enable();
  await press();
  await recording();
  await wait(550);
  await release();
  await ended();
  await chat.waitForFunction(() => document.querySelector('#input').value === '合成录音通过');
  assert.equal(requests[0].wav, true);

  await press();
  await recording();
  await wait(550);
  await release();
  await ended();
  await until(() => requests.length === 2);
  assert.equal(requests[1].wav, true);
  await send({ type: 'privacy.lockdown' });
  await until(() => requests[1].closed);
  assert.equal(await chat.locator('#input').inputValue(), '合成录音通过');
  assert.deepEqual(await chat.evaluate(async () => (await window.galagent.getSnapshot()).messages), []);
  console.log(JSON.stringify({ passed: true, lateMicrophoneGrantStopped: true, disableStoppedRecording: true, releaseStoppedRecording: true, cancelledUpstream: true, transcriptStayedInDraft: true, syntheticAudio: true }));
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
