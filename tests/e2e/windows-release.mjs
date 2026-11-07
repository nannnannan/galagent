// Packaged Windows smoke: isolated profile and loopback fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { _electron } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const root = process.cwd();
const folder = path.join(root, '.cache', `release-smoke-${Date.now()}`);
const profile = path.join(folder, 'profile'), workspace = path.join(folder, 'workspace');
await mkdir(profile, { recursive: true }); await mkdir(workspace, { recursive: true });
await writeFile(path.join(workspace, 'probe.txt'), 'WINDOWS_READ_OK');
const seen = { chat: 0, executor: 0, read: false, k31: false };
const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'kimi-k3.1-pro' }] }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); seen.k31 ||= body.model === 'kimi-k3.1-pro';
  let message, finish = 'stop';
  if (body.tools?.some(t => t.function.name === 'ApplyPatch')) {
    seen.executor++;
    const returned = body.messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes('WINDOWS_READ_OK'));
    if (returned) { seen.read = true; message = { role: 'assistant', content: 'WINDOWS_READ_OK' }; }
    else { finish = 'tool_calls'; message = { role: 'assistant', content: null, tool_calls: [{ id: 'read-probe', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ path: path.join(workspace, 'probe.txt') }) } }] }; }
  } else {
    seen.chat++;
    message = { role: 'assistant', content: JSON.stringify({ text: 'WINDOWS_CHAT_OK', expression: 'neutral', action: 'idle', facts: [], ops: [], diary: '' }) };
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: finish, message }], usage: { total_tokens: 10 } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, GALAGENT_DATA_DIR: profile, GALAGENT_API_KEY: '', KIMI_API_KEY: '', MOONSHOT_API_KEY: '' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({ executablePath: path.resolve(process.env.GALAGENT_TEST_EXE || 'release/win-unpacked/GalAgent.exe'), env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.galagent);
  const send = async command => { const r = await page.evaluate(c => window.galagent.dispatch(c), command); assert.equal(r.ok, true, r.error); };
  await send({ type: 'config.save', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'kimi-k3.1-pro', mode: 'mira-proxy', apiKey: 'isolated-fixture' });
  await send({ type: 'settings.update', settings: { initiativeEnabled: false, observationEnabled: false, screenCaptureEnabled: false, clipboardEnabled: false, ttsEnabled: false } });
  await send({ type: 'chat.send', text: 'Windows packaged chat smoke test' });
  await page.waitForFunction(async () => (await window.galagent.getSnapshot()).messages.some(m => m.role === 'assistant' && m.text.includes('WINDOWS_CHAT_OK')));
  await send({ type: 'agent.configure', cwd: workspace });
  await send({ type: 'agent.run', task: 'Read probe.txt and report its text.' });
  const deadline = Date.now() + 30000;
  while (!seen.read && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  await page.waitForFunction(async () => !(await window.galagent.getSnapshot()).agent.busy, null, { timeout: 30000 });
  if (!seen.read) console.log(JSON.stringify({seen, agent:(await page.evaluate(() => window.galagent.getSnapshot())).agent}));
  assert.equal(seen.read, true, 'packaged executor must round-trip the Read result');
  const snapshot = await page.evaluate(() => window.galagent.getSnapshot());
  assert.equal(snapshot.status.contextBudget, 1_000_000);
  assert.equal(seen.k31, true);
  const report = { passed: true, version: await app.evaluate(({ app }) => app.getVersion()), ...seen, contextBudget: snapshot.status.contextBudget, isolatedProfile: true };
  await writeFile(path.join(folder, 'smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
