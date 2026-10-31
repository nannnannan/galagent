import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LoopGuard, applyChunks, boundedMiddle, parsePatch, projectInstructions, workspaceOverview } from '../../runtime/core/agent-kit';
import { ToolHost, type HostSession } from '../../runtime/core/tool-host';
import { OpenAIToolAgent } from '../../runtime/core/openai-agent';
import { McpHub, qualify, validServers } from '../../runtime/core/mcp';
import { normalizeSandbox } from '../../runtime/core/privacy';

const signal = () => new AbortController().signal;
const tmp = (name: string) => mkdtemp(path.join(tmpdir(), `galagent-${name}-`));

test('patch parser: add / update with move / delete, with line-numbered errors', () => {
  const ops = parsePatch(['*** Begin Patch', '*** Add File: a.txt', '+one', '+two', '*** Update File: b.ts', '*** Move to: c.ts', '@@ function f', ' keep', '-old', '+new', '*** Delete File: d.md', '*** End Patch'].join('\n'));
  assert.deepEqual(ops.map(o => o.type), ['add', 'update', 'delete']);
  assert.equal((ops[0] as any).content, 'one\ntwo\n');
  assert.deepEqual((ops[1] as any).chunks[0], { header: 'function f', old: ['keep', 'old'], next: ['keep', 'new'], eof: false });
  assert.equal((ops[1] as any).moveTo, 'c.ts');
  assert.throws(() => parsePatch('*** Add File: x'), /Begin Patch/);
  assert.throws(() => parsePatch('*** Begin Patch\n*** Add File: x\nno plus\n*** End Patch'), /line 3: every line/);
  assert.throws(() => parsePatch('*** Begin Patch\n*** Update File: x\n-a\n*** Update File: x\n+b\n*** End Patch'), /twice/);
});
test('hunks match by context, tolerate whitespace drift, keep CRLF and the final newline, and refuse wrong context', () => {
  const src = 'function a() {\n  return 1;\n}\n\nfunction b() {\n  return 1;\n}\n';
  const chunks = parsePatch('*** Begin Patch\n*** Update File: f\n@@ function b() {\n-  return 1;\n+  return 2;\n*** End Patch')[0] as any;
  assert.equal(applyChunks(src, chunks.chunks), src.replace(/return 1;\n}\n$/, 'return 2;\n}\n'), 'the header picks the second occurrence');
  const crlf = 'a\r\nb  \r\nc\r\n';
  assert.equal(applyChunks(crlf, [{ old: ['a', 'b'], next: ['a', 'B'], eof: false }]), 'a\r\nB\r\nc\r\n', 'trailing spaces tolerated, CRLF kept');
  assert.equal(applyChunks('x\ny', [{ old: ['y'], next: ['z'], eof: true }]), 'x\nz', 'no final newline stays that way');
  assert.throws(() => applyChunks(src, [{ old: ['nope'], next: ['x'], eof: false }], 'f.ts'), /f\.ts: hunk 1 does not match/);
});
test('long output keeps the head and the tail', () => {
  const out = boundedMiddle('H'.repeat(100) + 'T'.repeat(100), 100);
  assert.ok(out.startsWith('H'.repeat(40)) && out.endsWith('T'.repeat(60)) && out.includes('omitted'));
  assert.equal(boundedMiddle('short', 100), 'short');
});
test('loop guard warns at 3 identical batches and stops at 5; any change resets', () => {
  const g = new LoopGuard(); const same = [{ name: 'Read', args: '{"path":"a"}' }];
  assert.deepEqual([g.note(same), g.note(same), g.note(same)], ['ok', 'ok', 'warn']);
  assert.equal(g.note([{ name: 'Read', args: '{"path":"b"}' }]), 'ok');
  for (let i = 0; i < 4; i++) g.note(same);
  assert.equal(g.note(same), 'stop');
});
test('project instructions: root-to-cwd AGENTS.md (override wins), global file first, sensitive paths excluded', async () => {
  const root = await tmp('agents'), home = await tmp('home');
  try {
    await mkdir(path.join(root, '.git')); await mkdir(path.join(root, 'pkg', 'src'), { recursive: true }); await mkdir(path.join(home, '.galagent'));
    await writeFile(path.join(root, 'AGENTS.md'), '根目录：用 pnpm');
    await writeFile(path.join(root, 'pkg', 'AGENTS.md'), '子包：普通');
    await writeFile(path.join(root, 'pkg', 'AGENTS.override.md'), '子包：覆盖版');
    await writeFile(path.join(home, '.galagent', 'AGENTS.md'), '全局：回答简短');
    await writeFile(path.join(root, 'package.json'), '{}'); await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const { files, text } = projectInstructions(path.join(root, 'pkg', 'src'), () => true, home);
    assert.deepEqual(files.map(f => path.relative(root, f).replace(/\\/g, '/')).slice(1), ['AGENTS.md', 'pkg/AGENTS.override.md']);
    assert.ok(text.indexOf('全局') < text.indexOf('根目录') && text.indexOf('根目录') < text.indexOf('覆盖版'));
    assert.ok(!text.includes('子包：普通'));
    assert.ok(!projectInstructions(path.join(root, 'pkg'), f => !f.startsWith(path.join(root, 'pkg')), home).text.includes('覆盖版'));
    const overview = workspaceOverview(root);
    assert.match(overview, /Git repository.*branch main/); assert.match(overview, /pkg\//); assert.match(overview, /package\.json — use their scripts/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

async function hostWith(dir: string, extra: Partial<ConstructorParameters<typeof ToolHost>[0]> = {}) {
  const host = new ToolHost({ save: () => {}, ask: async () => ({}), child: async () => '', sandbox: () => normalizeSandbox({}), checkpointDir: () => path.join(dir, '.ckpt'), protectedWritePaths: () => [path.join(dir, '.ckpt')], ...extra });
  const session = host.session(dir); session.runId = 'run-1'; session.runLabel = '改两个文件';
  return { host, session, run: (name: string, args: unknown, s: HostSession = session) => host.execute(s, name, args, signal()).then(r => r.content) };
}
test('ApplyPatch edits several files atomically, then the whole run can be undone (files changed afterwards are left alone)', async () => {
  const dir = await tmp('patch');
  const { host, session, run } = await hostWith(dir);
  try {
    await writeFile(path.join(dir, 'a.ts'), 'export const a = 1;\nexport const keep = true;\n');
    await writeFile(path.join(dir, 'b.ts'), 'old b\n'); await writeFile(path.join(dir, 'gone.md'), 'bye\n');
    const bad = await run('ApplyPatch', { patch: '*** Begin Patch\n*** Update File: a.ts\n-export const a = 1;\n+export const a = 2;\n*** Update File: b.ts\n-not there\n+x\n*** End Patch' });
    assert.match(bad, /b\.ts: hunk 1 does not match/);
    assert.equal(await readFile(path.join(dir, 'a.ts'), 'utf8'), 'export const a = 1;\nexport const keep = true;\n', 'nothing written when one hunk fails');
    const ok = await run('ApplyPatch', { patch: '*** Begin Patch\n*** Update File: a.ts\n-export const a = 1;\n+export const a = 2;\n export const keep = true;\n*** Add File: src/new.ts\n+hello\n*** Update File: b.ts\n*** Move to: c.ts\n-old b\n+new c\n*** Delete File: gone.md\n*** End Patch' });
    assert.match(ok, /M a\.ts[\s\S]*A src\/new\.ts[\s\S]*R b\.ts → c\.ts[\s\S]*D gone\.md/);
    assert.equal(await readFile(path.join(dir, 'a.ts'), 'utf8'), 'export const a = 2;\nexport const keep = true;\n');
    assert.equal(await readFile(path.join(dir, 'c.ts'), 'utf8'), 'new c\n'); assert.ok(!existsSync(path.join(dir, 'b.ts')) && !existsSync(path.join(dir, 'gone.md')));
    assert.match(await run('ApplyPatch', { patch: '*** Begin Patch\n*** Add File: ../escape.txt\n+x\n*** End Patch' }), /confines file tools/);
    assert.match(await run('ApplyPatch', { patch: '*** Begin Patch\n*** Add File: .env\n+K=1\n*** End Patch' }), /Sensitive|never readable/);
    assert.equal((await host.runChanges(session)).length, 5);
    // The user edits c.ts afterwards: undo restores everything else and leaves c.ts alone.
    await writeFile(path.join(dir, 'c.ts'), 'user edit\n');
    const undone = await host.undoRun();
    assert.equal(undone.label, '改两个文件');
    assert.deepEqual(undone.conflicts.map(f => path.basename(f)), ['c.ts']);
    assert.equal(await readFile(path.join(dir, 'a.ts'), 'utf8'), 'export const a = 1;\nexport const keep = true;\n');
    assert.equal(await readFile(path.join(dir, 'b.ts'), 'utf8'), 'old b\n'); assert.equal(await readFile(path.join(dir, 'gone.md'), 'utf8'), 'bye\n');
    assert.ok(!existsSync(path.join(dir, 'src', 'new.ts')), 'added files are removed');
    assert.equal(await readFile(path.join(dir, 'c.ts'), 'utf8'), 'user edit\n');
    await assert.rejects(host.undoRun(), /没有可撤销/);
  } finally { host.close(); await rm(dir, { recursive: true, force: true }); }
});
test('Write/Edit are checkpointed too; Bash is not undoable and says so in the plan', async () => {
  const dir = await tmp('ckpt');
  const { host, run } = await hostWith(dir);
  try {
    await writeFile(path.join(dir, 'n.txt'), 'v1');
    await run('Read', { path: 'n.txt' });
    assert.match(await run('Edit', { path: 'n.txt', old_string: 'v1', new_string: 'v2' }), /succeeded/);
    assert.match(await run('Write', { path: 'fresh.txt', content: 'x' }), /succeeded/);
    const r = await host.undoRun();
    assert.equal(r.restored.length, 2);
    assert.equal(await readFile(path.join(dir, 'n.txt'), 'utf8'), 'v1'); assert.ok(!existsSync(path.join(dir, 'fresh.txt')));
  } finally { host.close(); await rm(dir, { recursive: true, force: true }); }
});

const fakeServer = `
const rl = require('node:readline').createInterface({ input: process.stdin });
const send = m => process.stdout.write(JSON.stringify(m) + '\\n');
console.log('server banner on stdout is ignored');
rl.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo.upper', description: 'Uppercase text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(m.params.arguments.text).toUpperCase() }] } });
});`;
test('MCP: stdio server tools appear as mcp__server__tool, validate arguments, need approval once per task, vanish without Shell', async () => {
  const dir = await tmp('mcp'), script = path.join(dir, 'server.cjs');
  await writeFile(script, fakeServer);
  assert.throws(() => validServers([{ name: 'bad name', command: 'x' }]), /字母/);
  const hub = new McpHub(() => [{ name: 'fake', command: process.execPath, args: [script], enabled: true }], () => dir);
  let box = normalizeSandbox({}), asked = 0, answer = '本任务允许';
  const host = new ToolHost({ save: () => {}, ask: async q => { asked++; return { [q[0].question]: answer }; }, child: async () => '', sandbox: () => box, mcp: hub, outboundText: t => t.replace('sk-secret', '〔已隐藏·密钥〕') });
  try {
    await hub.ensure();
    const name = qualify('fake', 'echo.upper');
    assert.equal(name, 'mcp__fake__echo_upper');
    assert.ok(host.definitions.some(d => d.function.name === name));
    assert.deepEqual(hub.status(), [{ name: 'fake', state: 'ready', tools: 1, transport: 'stdio' }]);
    const session = host.session(dir);
    assert.match(JSON.stringify(await host.execute(session, name, {}, signal())), /Invalid parameters/);
    assert.match((await host.execute(session, name, { text: 'hi sk-secret' }, signal())).content, /HI 〔已隐藏·密钥〕/);
    await host.execute(session, name, { text: 'again' }, signal());
    assert.equal(asked, 1, 'approved once for this task');
    answer = '拒绝';
    assert.match((await host.execute(host.session(dir), name, { text: 'x' }, signal())).content, /declined/);
    box = normalizeSandbox({ shell: false });
    assert.ok(!host.definitions.some(d => d.function.name === name), 'hidden without Shell');
    assert.match((await host.execute(session, name, { text: 'x' }, signal())).content, /Shell is off/);
  } finally { host.close(); hub.close(); await rm(dir, { recursive: true, force: true }); }
});

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const say = (message: Record<string, unknown>) => json({ choices: [{ message: { role: 'assistant', ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { total_tokens: 10 } });
const toolCall = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
test('executor: project AGENTS.md in the prompt, history compacted into a summary when it grows, run reports changed files', async () => {
  const dir = await tmp('compact');
  await writeFile(path.join(dir, 'AGENTS.md'), '本项目的测试命令是 npm run check');
  await writeFile(path.join(dir, 'big.txt'), 'x'.repeat(30000));
  const bodies: any[] = []; let round = 0;
  const agent = new OpenAIToolAgent({ provider: () => ({ baseUrl: 'https://example.test/v1', model: 'gpt-test', mode: 'native-api' }), credentials: { get: async () => 'k' }, ask: async () => ({}), sandbox: () => normalizeSandbox({}), checkpointDir: () => path.join(dir, '.ckpt'), protectedWritePaths: () => [path.join(dir, '.ckpt')], compactAt: 8000,
    fetch: async (_u, init) => {
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      if (String(body.messages[0].content).startsWith('You are compacting')) return json({ choices: [{ message: { role: 'assistant', content: '交接摘要：已经读过 big.txt 三次，内容全是 x；下一步写 out.txt。' } }], usage: { total_tokens: 50 } });
      round++;
      if (round <= 3) return say({ content: null, tool_calls: [toolCall('r' + round, 'Read', { path: 'big.txt', n_lines: 1 + round })] });
      if (round === 4) return say({ content: null, tool_calls: [toolCall('w', 'Write', { path: 'out.txt', content: 'done' })] });
      return say({ content: '完成：写了 out.txt，npm run check 通过。' });
    } });
  try {
    const result = await agent.run('读 big.txt 然后写 out.txt', dir, signal());
    assert.equal(result.stopReason, 'end_turn');
    assert.match(String(bodies[0].messages[0].content), /npm run check/); assert.match(String(bodies[0].messages[0].content), /工作方法/);
    assert.ok(bodies[0].tools.some((t: any) => t.function.name === 'ApplyPatch'));
    const compactCall = bodies.findIndex(b => String(b.messages[0].content).startsWith('You are compacting'));
    assert.ok(compactCall > 0, 'a compaction request was made');
    const after = bodies[compactCall + 1];
    assert.match(String(after.messages[1].content), /交接摘要/);
    assert.ok(JSON.stringify(after.messages).length < JSON.stringify(bodies[compactCall - 1].messages).length, 'context shrank');
    assert.deepEqual(result.changedFiles?.map(f => path.basename(f)), ['out.txt']);
    const undone = await agent.undoLast();
    assert.deepEqual(undone.restored.map(f => path.basename(f)), ['out.txt']);
  } finally { agent.close(); await rm(dir, { recursive: true, force: true }); }
});
test('executor: the same tool call five rounds in a row stops the run as a loop', async () => {
  const dir = await tmp('loop'); await writeFile(path.join(dir, 'a.txt'), 'a');
  const sent: any[] = [];
  const agent = new OpenAIToolAgent({ provider: () => ({ baseUrl: 'https://example.test/v1', model: 'gpt-test', mode: 'native-api' }), credentials: { get: async () => 'k' }, ask: async () => ({}), sandbox: () => normalizeSandbox({}),
    fetch: async (_u, init) => { sent.push(JSON.parse(String(init?.body))); return say({ content: null, tool_calls: [toolCall('c' + sent.length, 'Read', { path: 'a.txt' })] }); } });
  try {
    const result = await agent.run('读 a.txt', dir, signal());
    assert.equal(result.stopReason, 'loop_detected');
    assert.equal(sent.length, 5);
    assert.ok(sent[3].messages.some((m: any) => typeof m.content === 'string' && m.content.includes('loop check')), 'warned before stopping');
  } finally { agent.close(); await rm(dir, { recursive: true, force: true }); }
});

test('完全放开: credential files readable (GalAgent keys never), LAN fetch allowed, Shell and MCP without asking, longer Bash timeout', async () => {
  const dir = await tmp('full');
  await mkdir(path.join(dir, '.ssh')); await writeFile(path.join(dir, '.ssh', 'config'), 'Host lab'); await writeFile(path.join(dir, 'provider-key.bin'), 'enc');
  let asked = 0; let box = normalizeSandbox({ level: 'full' });
  assert.deepEqual([box.fileScope, box.shell, box.shellConfirm, box.lanAccess, box.credentialFiles, box.redactSecrets], ['anywhere', true, false, true, true, true]);
  const host = new ToolHost({ save: () => {}, ask: async () => { asked++; return {}; }, child: async () => '', sandbox: () => box });
  const session = host.session(dir), run = (name: string, args: unknown) => host.execute(session, name, args, signal()).then(r => r.content);
  try {
    assert.match(await run('Read', { path: '.ssh/config' }), /Host lab/);
    assert.match(await run('Read', { path: 'provider-key.bin' }), /never accessible/);
    assert.match(await run('Bash', { command: 'echo free', timeout: 1200 }), /free/);
    assert.equal(asked, 0);
    assert.doesNotMatch(await run('FetchURL', { url: 'http://127.0.0.1:9/' }), /blocks local/, 'LAN/localhost allowed (the port itself is closed)');
    box = normalizeSandbox({ level: 'standard' }, box);
    assert.match(await run('FetchURL', { url: 'http://127.0.0.1:9/' }), /blocks local/);
    assert.equal(box.lanAccess, false); assert.equal(box.credentialFiles, false, 'leaving full closes its extra switches');
    assert.match(await run('Read', { path: '.ssh/config' }), /not readable/);
    assert.match(await run('Bash', { command: 'echo x', timeout: 1200 }), /timeout exceeds/);
  } finally { host.close(); await rm(dir, { recursive: true, force: true }); }
});

test('remote MCP over Streamable HTTP: JSON and SSE replies, session id, Authorization from encrypted secrets, gated by network', async () => {
  const seen: { headers: Record<string, string>; body: any }[] = [];
  const fakeFetch: typeof fetch = async (_url, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers || {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    const body = JSON.parse(String(init?.body)); seen.push({ headers, body });
    if (headers.authorization !== 'Bearer tok') return new Response('no', { status: 401 });
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'S1' } });
    if (!body.id) return new Response(null, { status: 202 });
    if (body.method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'search_repos', description: 'Search', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }] } }), { headers: { 'content-type': 'application/json' } });
    const sse = `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'found ' + body.params.arguments.q }] } })}\n\n`;
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  };
  let token = 'wrong';
  const hub = new McpHub(() => [{ name: 'gh', url: 'https://mcp.example/mcp', enabled: true, headerKeys: ['Authorization'] }], () => tmpdir(), { fetch: fakeFetch, secrets: async () => ({ headers: { Authorization: `Bearer ${token}` } }) });
  let box = normalizeSandbox({ level: 'open' });
  const host = new ToolHost({ save: () => {}, ask: async () => ({}), child: async () => '', sandbox: () => box, mcp: hub });
  try {
    await hub.ensure();
    assert.match(hub.status()[0].error || '', /需要授权/);
    token = 'tok'; hub.restart(); await hub.ensure();
    assert.deepEqual(hub.status()[0], { name: 'gh', state: 'ready', tools: 1, transport: 'http' });
    assert.equal(seen.at(-1)!.headers['mcp-session-id'], 'S1', 'session id carried after initialize');
    const out = await host.execute(host.session(tmpdir()), 'mcp__gh__search_repos', { q: 'galagent' }, signal());
    assert.match(out.content, /found galagent/);
    box = normalizeSandbox({ network: false }, box);
    assert.ok(!host.definitions.some(d => d.function.name === 'mcp__gh__search_repos'), 'remote MCP needs network');
    assert.ok(validServers([{ name: 'x', url: 'https://a.example/mcp' }])[0].url);
    assert.throws(() => validServers([{ name: 'x', url: 'https://user:pw@a.example' }]), /密码/);
  } finally { host.close(); hub.close(); }
});

test('executor settings: separate model, output budget and turn limit reach the request; MCP secrets are stored encrypted and only names are kept', async () => {
  const { CompanionService } = await import('../../runtime/core/companion');
  const dir = await tmp('exec-settings'), bodies: any[] = [], store = new Map<string, any>();
  const core = new CompanionService({ dataDir: dir, workingDir: dir, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} },
    mcpSecrets: { get: async n => store.get(n) || {}, set: async (n, v) => { store.set(n, v); } },
    fetch: async (_u, init) => { const body = JSON.parse(String(init?.body)); if (body.tools?.some((t: any) => t.function.name === 'ApplyPatch')) { bodies.push(body); return say({ content: '完成' }); } return json({ choices: [{ message: { role: 'assistant', content: '{"facts":[],"diary":"","text":"好","expression":"neutral","action":"idle"}' } }] }); } });
  await core.init();
  try {
    await core.handle({ type: 'settings.update', settings: { executor: { model: 'coder-pro', maxOutputTokens: 999999, maxTurns: 2 }, mcpServers: [{ name: 'gh', url: 'https://mcp.example/mcp', enabled: true }] } });
    assert.deepEqual(core.getSnapshot().settings.executor, { model: 'coder-pro', maxOutputTokens: 131072, maxTurns: 4 });
    await core.handle({ type: 'agent.run', task: '看看目录' }); await core.waitForAgent();
    assert.equal(bodies[0].model, 'coder-pro'); assert.equal(bodies[0].max_completion_tokens ?? bodies[0].max_tokens, 131072);
    assert.equal((await core.handle({ type: 'mcp.secret', server: 'gh', headers: { Authorization: 'Bearer secret-token' } })).ok, true);
    assert.deepEqual(store.get('gh'), { headers: { Authorization: 'Bearer secret-token' } });
    const settings = JSON.stringify(core.getSnapshot().settings);
    assert.ok(settings.includes('"headerKeys":["Authorization"]') && !settings.includes('secret-token'), 'snapshot holds names, never values');
    assert.equal((await core.handle({ type: 'mcp.secret', server: 'nope', env: {} })).ok, false);
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});
