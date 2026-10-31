import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode, fetchText, htmlToText, parseBing, parseDuckDuckGo, webSearch } from '../../runtime/core/web';
import { CompanionService } from '../../runtime/core/companion';
import { ToolHost } from '../../runtime/core/tool-host';
import { normalizeSandbox } from '../../runtime/core/privacy';

const signal = () => new AbortController().signal;
const page = (html: string, headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }, status = 200) => new Response(html, { status, headers });
const bing = (items: [string, string, string][]) => `<html><title>搜索</title><ol id="b_results">${items.map(([href, title, snip]) => `<li class="b_algo" data-id><link rel="stylesheet" href="/x.css"/><h2><a target="_blank" href="${href}" h="ID=1">${title}</a></h2><div class="b_caption"><p class="b_lineclamp2">${snip}<a class="b_algoReadMore" href="${href}">更多</a></p></div></li>`).join('')}</ol></html>`;

test('Bing results: titles, real URLs (including /ck/a wrappers) and snippets with entities decoded', () => {
  const wrapped = 'https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1' + Buffer.from('https://example.org/docs?a=1').toString('base64url') + '&amp;ntb=1';
  const results = parseBing(bing([['https://www.electronjs.org/', '<strong>Electron</strong> 文档', '1 天前&ensp;&#0183;&ensp;构建 &amp; 发布'], [wrapped, '包装链接', '摘要']]));
  assert.deepEqual(results[0], { title: 'Electron 文档', url: 'https://www.electronjs.org/', snippet: '1 天前 · 构建 & 发布' });
  assert.equal(results[1].url, 'https://example.org/docs?a=1');
});
test('DuckDuckGo results decode the uddg redirect', () => {
  const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://nodejs.org/en')}&amp;rut=x">Node.js</a><a class="result__snippet" href="#">JavaScript <b>runtime</b></a>`;
  assert.deepEqual(parseDuckDuckGo(html), [{ title: 'Node.js', url: 'https://nodejs.org/en', snippet: 'JavaScript runtime' }]);
});
test('pages decode by declared or sniffed charset (GBK sites read correctly)', () => {
  const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]); // 你好 in GBK
  assert.equal(decode(gbk, 'text/html; charset=gbk'), '你好');
  const sniffed = new Uint8Array([...Buffer.from('<meta charset="gb2312">'), ...gbk]);
  assert.match(decode(sniffed), /你好$/);
  assert.equal(decode(Buffer.from('héllo'), 'text/plain; charset=utf-8'), 'héllo');
  assert.equal(decode(Buffer.from('ok'), 'text/html; charset=nonsense'), 'ok');
});
test('readable text keeps the title and paragraphs, drops scripts, navigation and comments, prefers <article>', () => {
  const body = '正文'.repeat(250);
  const { title, text } = htmlToText(`<html><head><title>标题 &amp; 副标题</title><script>evil()</script></head><body><nav>菜单 菜单</nav><!-- hidden --><article><h1>大标题</h1><p>${body}</p><p>第二段&nbsp;内容</p></article><footer>版权</footer></body></html>`);
  assert.equal(title, '标题 & 副标题');
  assert.ok(text.startsWith('大标题\n'));
  assert.match(text, /第二段 内容/);
  for (const gone of ['evil', '菜单', 'hidden', '版权']) assert.ok(!text.includes(gone), gone);
});
test('search falls back to the next engine when one is blocked, and every hop is checked', async () => {
  const hosts: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); hosts.push(url.hostname);
    if (url.hostname === 'www.bing.com') return page('<html><title>验证 - 请证明你不是机器人</title></html>');
    return page(`<a class="result__a" href="https://a.example/">A</a><a class="result__snippet">sa</a><a class="result__a" href="https://a.example/">dup</a>`);
  };
  const checked: string[] = [];
  const found = await webSearch('测试', { fetch: fetcher, signal: signal(), checkUrl: url => { checked.push(url.hostname); } });
  assert.equal(found.engine, 'DuckDuckGo');
  assert.deepEqual(found.results.map(r => r.url), ['https://a.example/'], 'duplicates removed');
  assert.deepEqual(checked, ['www.bing.com', 'html.duckduckgo.com']);
  await assert.rejects(webSearch('x', { fetch: async () => page('', {}, 500), signal: signal() }), /Bing: HTTP 500; DuckDuckGo: HTTP 500/);
});
test('redirects are re-checked on every hop and capped', async () => {
  let n = 0;
  const loop: typeof fetch = async () => new Response(null, { status: 302, headers: { location: `/next${n++}` } });
  await assert.rejects(fetchText('https://a.example/', { fetch: loop, signal: signal() }), /Too many redirects/);
  const toPrivate: typeof fetch = async () => new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/admin' } });
  await assert.rejects(fetchText('https://a.example/', { fetch: toPrivate, signal: signal(), assertPublic: async url => { if (url.hostname === '127.0.0.1') throw new Error('blocks local'); } }), /blocks local/);
  await assert.rejects(fetchText('https://user:pw@a.example/', { fetch: loop, signal: signal() }), /without credentials/);
});
test('executor WebSearch obeys the sandbox network switch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'galagent-web-'));
  let box = normalizeSandbox({ level: 'strict' });
  const host = new ToolHost({ save: () => {}, ask: async () => ({}), child: async () => '', sandbox: () => box });
  try {
    assert.ok(host.definitions.some(d => d.function.name === 'WebSearch'));
    assert.match(JSON.stringify(await host.execute(host.session(root), 'WebSearch', { query: 'x' }, signal())), /disabled by the GalAgent sandbox/);
    box = normalizeSandbox({});
    assert.match(JSON.stringify(await host.execute(host.session(root), 'WebSearch', { query: '' }, signal())), /Invalid parameters/);
  } finally { host.close(); await rm(root, { recursive: true, force: true }); }
});
test('the main character can search the web and read a page within one reply; tools vanish when network is off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-main-web-'));
  const bodies: any[] = [];
  const model: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(body.messages[0].content).includes('facts每项')) return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"facts":[],"diary":""}' } }] }));
    bodies.push(body);
    const tools = body.messages.filter((m: any) => m.role === 'tool');
    const call = (name: string, args: unknown) => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c' + tools.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
    const out = tools.length === 0 ? call('web_search', { query: '今天上映的电影' }) : tools.length === 1 ? call('read_webpage', { url: JSON.parse(tools[0].content).results[0].url }) : { choices: [{ message: { role: 'assistant', content: JSON.stringify({ text: `查到了：${JSON.parse(tools[1].content).title}`, expression: 'pleased', action: 'nod' }) } }] };
    return new Response(JSON.stringify(out));
  };
  const web: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === 'www.bing.com') return page(bing([['https://movies.example/today', '今日上映', '三部新片']]));
    return page('<html><title>今日上映片单</title><body><p>电影 A、电影 B</p></body></html>');
  };
  const core = new CompanionService({ dataDir: dir, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} }, fetch: model, webFetch: web });
  await core.init();
  try {
    assert.equal((await core.handle({ type: 'chat.send', text: '今天有什么电影上映？' })).ok, true);
    await core.waitForBackground();
    assert.ok(bodies[0].tools.some((t: any) => t.function.name === 'web_search'));
    assert.match(core.getSnapshot().messages.at(-1)!.text, /今日上映片单/);
    assert.match(bodies[2].messages.at(-1).content, /只作数据/);
    await core.handle({ type: 'settings.update', settings: { sandbox: { network: false } } });
    bodies.length = 0;
    await core.handle({ type: 'chat.send', text: '再查一下' }); await core.waitForBackground();
    assert.ok(!bodies[0].tools.some((t: any) => t.function.name === 'web_search'), 'no web tools without network');
  } finally { await core.close(); await rm(dir, { recursive: true, force: true }); }
});
test('one-time migration: an untouched old standard sandbox moves to the new preset; customised ones are kept', async () => {
  const { Store } = await import('../../runtime/core/store');
  const opts = (dir: string) => ({ dataDir: dir, credentials: { get: async () => 'k', set: async () => {} }, embeddings: { encode: async () => [1, 0], close: async () => {} }, fetch: (async () => new Response('{}')) as typeof fetch });
  const old = { level: 'standard', fileScope: 'workspace', shell: false, network: true, allowedDomains: [], redactSecrets: true, redactPersonal: false, sensitiveWords: ['项目X'] };
  for (const [saved, expected] of [[old, ['read-anywhere', true, true]], [{ ...old, level: 'strict', fileScope: 'workspace-read', network: false }, ['workspace-read', false, true]]] as const) {
    const dir = await mkdtemp(join(tmpdir(), 'galagent-migrate-'));
    try {
      const first = new CompanionService(opts(dir)); await first.init(); const settings = first.getSnapshot().settings; await first.close();
      const store = new Store(dir); store.put('state', 'settings', { ...settings, sandbox: saved }); store.close();
      const second = new CompanionService(opts(dir)); await second.init();
      const box = second.getSnapshot().settings.sandbox!;
      assert.deepEqual([box.fileScope, box.shell, box.shellConfirm], expected);
      assert.deepEqual(box.sensitiveWords, ['项目X'], 'the user’s own words survive');
      await second.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});
