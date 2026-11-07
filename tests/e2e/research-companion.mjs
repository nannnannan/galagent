// Real packaged app and heartbeat; isolated profile, seeded finding and loopback model.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const { _electron } = await import(
  pathToFileURL(
    process.env.PLAYWRIGHT_MODULE ||
      path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',
      ),
  ).href
);
const profile = await mkdtemp(path.join(tmpdir(), 'gal-research-smoke-'));
const start = new Date();
start.setHours(14, 0, 0, 0);
const at = start.getTime();
const url = 'https://fixture.example/film-news';
const db = new DatabaseSync(path.join(profile, 'companion.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL)');
const save = db.prepare('INSERT INTO records VALUES (?, ?, ?)');
save.run(
  'settings',
  'state',
  JSON.stringify({
    observationEnabled: false,
    screenCaptureEnabled: false,
    clipboardEnabled: false,
    ttsEnabled: false,
  }),
);
save.run(
  'research',
  'state',
  JSON.stringify({
    version: 1,
    blocked: [],
    lastPlanAt: at,
    runs: [at],
    interests: [
      {
        id: 'film',
        topic: '胶片',
        kind: 'hobby',
        why: '手动关注',
        sources: ['manual'],
        weight: 4,
        pinned: true,
        angles: [],
        createdAt: at,
      },
    ],
    findings: [
      {
        id: 'news',
        interestId: 'film',
        topic: '胶片',
        title: '测试胶片',
        summary: '一卷 36 张',
        why: '想试拍',
        sources: [{ title: '公告', url }],
        angle: '新品',
        confidence: 3,
        freshness: 'new',
        at,
      },
    ],
  }),
);
db.close();
let sourceReturned = false,
  unexpected = '';
const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.end(JSON.stringify({ data: [{ id: 'fixture' }] }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const b = JSON.parse(raw),
      sys = String(b.messages[0].content);
    let answer;
    if (sys.includes('facts每项')) answer = { facts: [], diary: '' };
    else if (sys.includes('状态数据：')) {
      const ctx = JSON.parse(sys.split('\n状态数据：')[1]);
      if (ctx.scene === 'initiative') {
        assert.match(b.messages.at(-1).content, /fixture\.example/);
        answer = {
          text: '你想试拍的那款胶卷，一卷是 36 张。',
          sharedFindingId: 'news',
          expression: 'pleased',
          action: 'idle',
        };
      } else {
        if (b.messages.at(-1).content === '原文在哪？')
          sourceReturned =
            ctx.researchNotes?.[0]?.alreadyShared === true && ctx.researchNotes[0].sources[0].url === url;
        answer = {
          text: b.messages.at(-1).content === '原文在哪？' && sourceReturned
            ? '就是这份公告：' + ctx.researchNotes[0].sources[0].url : '好呀。',
          expression: 'neutral', action: 'idle',
        };
      }
    } else answer = { decision: 'silent', reason: '无事件', evidence: [], nextCheck: null };
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer) } }],
      }),
    );
  } catch (error) {
    unexpected = String(error);
    res.writeHead(500).end('{}');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  GALAGENT_DATA_DIR: profile,
  GALAGENT_API_KEY: '',
  KIMI_API_KEY: '',
  MOONSHOT_API_KEY: '',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  async function launch(now) {
    app = await _electron.launch({
      executablePath: path.resolve(process.env.GALAGENT_TEST_EXE || 'release/win-unpacked/GalAgent.exe'),
      env,
      timeout: 60000,
    });
    await app.evaluate((_electron, n) => {
      Date.now = () => n;
    }, now);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.galagent);
    return {
      page,
      send: async (c) => {
        const r = await page.evaluate((c) => window.galagent.dispatch(c), c);
        assert.equal(r.ok, true, r.error);
      },
    };
  }
  let f = await launch(at);
  await f.send({
    type: 'config.save',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model: 'fixture',
    apiKey: 'loopback-fixture',
  });
  await f.send({ type: 'chat.send', text: '你好' });
  const later = at + 21 * 60000;
  await app.evaluate((_electron, n) => {
    Date.now = () => n;
  }, later);
  const deadline = Date.now()+45000;
  let shared = false;
  while (Date.now() < deadline) {
    const snap = await f.page.evaluate(() => window.galagent.getSnapshot());
    if (snap.messages.some(m => m.source === 'initiative' && m.text.includes('36 张'))) {shared=true; break;}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(shared, 'heartbeat must deliver the finding before restart: '+unexpected);
  await app.close();
  app = undefined;
  f = await launch(later);
  await f.send({ type: 'chat.send', text: '原文在哪？' });
  assert.equal(sourceReturned, true);
  const reply = await f.page.evaluate(() => window.galagent.getSnapshot());
  assert.ok(reply.messages.at(-1).text.includes(url), 'the visible answer contains the same source');
  await f.send({ type: 'chat.send', text: '先别聊这个了' });
  const snap = await f.page.evaluate(() => window.galagent.getSnapshot());
  assert.ok(Date.parse(snap.research.interests[0].restUntil) > later);
  assert.equal(snap.messages.filter((m) => m.source === 'initiative').length, 1);
  assert.equal(unexpected, '');
  console.log(
    JSON.stringify({
      passed: true,
      heartbeatShared: true,
      sourceAfterRestart: true,
      pinnedInterestPaused: true,
      model: 'loopback fixture',
    }),
  );
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
