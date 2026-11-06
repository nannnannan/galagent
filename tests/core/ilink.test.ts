import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ILinkClient, ILinkError, encodeClientVersion, parseILinkJson, splitText } from '../../runtime/core/wechat/ilink';

interface Call { url: string; method: string; headers: Record<string, string>; body?: any }

function fakeFetch(responder: (c: Call) => { status?: number; body: string } | Promise<never>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const c: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    const r = await responder(c);
    return new Response(r.body, { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const TOKEN = 'secret-bot-token-123';

test('login: QR code then confirmed poll', async () => {
  let polls = 0;
  const { fn, calls } = fakeFetch((c) => {
    if (c.url.includes('get_bot_qrcode')) return { body: JSON.stringify({ qrcode: 'QR1', qrcode_img_content: 'https://liteapp.weixin.qq.com/q/abc' }) };
    polls++;
    if (polls === 1) return { body: JSON.stringify({ status: 'wait' }) };
    if (polls === 2) return { body: JSON.stringify({ status: 'scaned_but_redirect', redirect_host: 'idc2.example.com' }) };
    return { body: JSON.stringify({ status: 'confirmed', bot_token: TOKEN, ilink_bot_id: 'bot@im.bot', ilink_user_id: 'u1@im.wechat', baseurl: 'https://ilinkai.weixin.qq.com' }) };
  });
  const c = new ILinkClient({ fetch: fn });
  const qr = await c.getLoginQrcode();
  assert.deepEqual(qr, { qrcode: 'QR1', qrcodeContent: 'https://liteapp.weixin.qq.com/q/abc' });
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.url, 'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3');
  assert.deepEqual(calls[0]!.body, { local_token_list: [] });
  assert.equal(calls[0]!.headers.Authorization, undefined);

  assert.deepEqual(await c.pollLogin('QR1'), { status: 'wait' });
  assert.deepEqual(await c.pollLogin('QR1'), { status: 'scanned' });
  const done = await c.pollLogin('QR1');
  assert.deepEqual(done, { status: 'confirmed', token: TOKEN, botId: 'bot@im.bot', userId: 'u1@im.wechat', baseUrl: 'https://ilinkai.weixin.qq.com' });
  assert.equal(calls[1]!.method, 'GET');
  assert.equal(calls[1]!.url, 'https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=QR1');
  assert.equal(calls[1]!.headers['iLink-App-Id'], 'bot');
  assert.equal(calls[1]!.headers['iLink-App-ClientVersion'], String(encodeClientVersion('2.4.10')));
  assert.ok(calls[3]!.url.startsWith('https://idc2.example.com/'), 'follows IDC redirect');
});

test('pollLogin treats gateway errors as wait', async () => {
  const { fn } = fakeFetch(() => ({ status: 524, body: 'gateway' }));
  assert.deepEqual(await new ILinkClient({ fetch: fn }).pollLogin('Q'), { status: 'wait' });
});

test('getUpdates parses messages, kinds, context token and cursor', async () => {
  const raw = `{"ret":0,"get_updates_buf":"BUF2","longpolling_timeout_ms":30000,"msgs":[
    {"seq":1,"message_id":18446744073709551615,"from_user_id":"u1@im.wechat","create_time_ms":1700000000000,"message_type":1,"context_token":"CT1","item_list":[{"type":1,"text_item":{"text":"你好"}}]},
    {"seq":2,"message_id":2,"from_user_id":"u1@im.wechat","create_time_ms":1700000000001,"message_type":1,"item_list":[{"type":3,"voice_item":{"text":"语音转写","playtime":1200}}]},
    {"seq":3,"message_id":3,"from_user_id":"u1@im.wechat","message_type":1,"item_list":[{"type":2,"image_item":{"url":"x"}}]},
    {"seq":4,"message_id":4,"from_user_id":"u1@im.wechat","message_type":1,"item_list":[{"type":4,"file_item":{"file_name":"a.pdf"}}]},
    {"seq":5,"message_id":5,"from_user_id":"u1@im.wechat","message_type":1,"item_list":[{"type":11}]},
    {"seq":6,"message_id":6,"from_user_id":"bot@im.bot","message_type":2,"item_list":[{"type":1,"text_item":{"text":"echo"}}]}
  ]}`;
  const { fn, calls } = fakeFetch(() => ({ body: raw }));
  const c = new ILinkClient({ fetch: fn, token: TOKEN });
  const r = await c.getUpdates('BUF1');
  assert.equal(calls[0]!.url, 'https://ilinkai.weixin.qq.com/ilink/bot/getupdates');
  assert.equal(calls[0]!.body.get_updates_buf, 'BUF1');
  assert.equal(calls[0]!.body.base_info.channel_version, '2.4.10');
  assert.equal(r.cursor, 'BUF2');
  assert.equal(r.nextTimeoutMs, 30000);
  assert.equal(r.messages.length, 5);
  assert.deepEqual(r.messages[0], { id: '18446744073709551615', from: 'u1@im.wechat', text: '你好', contextToken: 'CT1', at: 1700000000000, kind: 'text' });
  assert.equal(r.messages[1]!.kind, 'voice');
  assert.equal(r.messages[1]!.text, '语音转写');
  assert.equal(r.messages[2]!.kind, 'image');
  assert.equal(r.messages[2]!.text, '');
  assert.equal(r.messages[3]!.kind, 'file');
  assert.equal(r.messages[3]!.fileName, 'a.pdf');
  assert.equal(r.messages[4]!.kind, 'other');
});

test('getUpdates keeps cursor when server returns empty buf, and on client timeout', async () => {
  const { fn } = fakeFetch(() => ({ body: '{"ret":0,"msgs":[]}' }));
  assert.deepEqual(await new ILinkClient({ fetch: fn, token: TOKEN }).getUpdates('KEEP'), { messages: [], cursor: 'KEEP' });
  const hang = (async (_u: unknown, init?: RequestInit) => new Promise((_, rej) => {
    init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
  })) as typeof fetch;
  assert.deepEqual(await new ILinkClient({ fetch: hang, token: TOKEN }).getUpdates('KEEP', undefined, 20), { messages: [], cursor: 'KEEP' });
  const ac = new AbortController();
  const p = new ILinkClient({ fetch: hang, token: TOKEN }).getUpdates('KEEP', ac.signal);
  ac.abort();
  await assert.rejects(p, (e: unknown) => e instanceof ILinkError && e.code === 'aborted');
});

test('sendText body shape, headers and chunking', async () => {
  let n = 0;
  const { fn, calls } = fakeFetch(() => ({ body: `{"ret":0,"message_id":9007199254740993${n++}}` }));
  const c = new ILinkClient({ fetch: fn, token: TOKEN, chunkLimit: 50 });
  const para1 = '第一段。'.repeat(8); // 32 chars
  const para2 = '第二段内容，比较长一些。'.repeat(3); // 36 chars
  const res = await c.sendText('u1@im.wechat', `${para1}\n\n${para2}`, 'CT1');
  assert.equal(res.length, 2);
  assert.equal(res[0]!.messageId, '90071992547409930');
  assert.equal(calls.length, 2);
  const call = calls[0]!;
  assert.equal(call.url, 'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage');
  assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(call.headers.AuthorizationType, 'ilink_bot_token');
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.equal(call.headers['iLink-App-Id'], 'bot');
  assert.match(Buffer.from(call.headers['X-WECHAT-UIN']!, 'base64').toString(), /^\d+$/);
  const msg = call.body.msg;
  assert.equal(msg.to_user_id, 'u1@im.wechat');
  assert.equal(msg.from_user_id, '');
  assert.equal(msg.message_type, 2);
  assert.equal(msg.message_state, 2);
  assert.equal(msg.context_token, 'CT1');
  assert.match(msg.client_id, /^galagent:\d+-[0-9a-f]{8}$/);
  assert.deepEqual(msg.item_list, [{ type: 1, text_item: { text: para1 } }]);
  assert.equal(calls[1]!.body.msg.item_list[0].text_item.text, para2);
  assert.notEqual(calls[0]!.body.msg.client_id, calls[1]!.body.msg.client_id);
  assert.ok(call.body.base_info);
});

test('splitText respects limit and boundaries', () => {
  assert.deepEqual(splitText('short', 1800), ['short']);
  const long = '这是一句话。'.repeat(500); // 3000 chars
  const parts = splitText(long, 1800);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.length <= 1800));
  assert.ok(parts[0]!.endsWith('。'));
  assert.equal(parts.join(''), long);
  const noBreak = 'a'.repeat(4500);
  assert.deepEqual(splitText(noBreak, 9999).map((p) => p.length), [4000, 500]);
  const emoji = '😀'.repeat(10);
  assert.ok(splitText(emoji, 5).every((p) => !/[\ud800-\udbff]$/.test(p)));
});

test('error mapping: -14 expired, -2 rate-limited, token never in error text', async () => {
  const { fn } = fakeFetch((c) => c.url.includes('getupdates')
    ? { body: JSON.stringify({ ret: -14, errcode: -14, errmsg: `session timeout ${TOKEN}` }) }
    : { body: JSON.stringify({ ret: -2, errmsg: 'freq limit' }) });
  const c = new ILinkClient({ fetch: fn, token: TOKEN });
  await assert.rejects(c.getUpdates(''), (e: unknown) => {
    assert.ok(e instanceof ILinkError);
    assert.equal(e.kind, 'expired');
    assert.equal(e.code, -14);
    assert.ok(!e.message.includes(TOKEN));
    assert.ok(!String(e.stack).includes(TOKEN));
    return true;
  });
  await assert.rejects(c.sendText('u', 'hi'), (e: unknown) => {
    assert.ok(e instanceof ILinkError);
    assert.equal(e.kind, 'rate-limited');
    assert.equal(e.code, -2);
    assert.deepEqual(e.sent, []);
    assert.ok(!e.message.includes(TOKEN));
    return true;
  });
  const http = fakeFetch(() => ({ status: 429, body: TOKEN }));
  await assert.rejects(new ILinkClient({ fetch: http.fn, token: TOKEN }).sendText('u', 'x'),
    (e: unknown) => e instanceof ILinkError && e.kind === 'rate-limited' && !e.message.includes(TOKEN));
  const net = (async () => { throw new TypeError(`fetch failed ${TOKEN}`); }) as typeof fetch;
  await assert.rejects(new ILinkClient({ fetch: net, token: TOKEN }).getUpdates(''),
    (e: unknown) => e instanceof ILinkError && e.kind === 'network' && !e.message.includes(TOKEN));
});

test('sendTyping fetches ticket once, best-effort', async () => {
  const { fn, calls } = fakeFetch((c) => c.url.includes('getconfig')
    ? { body: JSON.stringify({ ret: 0, typing_ticket: 'TT' }) }
    : { body: '{"ret":0}' });
  const c = new ILinkClient({ fetch: fn, token: TOKEN });
  assert.equal(await c.sendTyping('u1', 'CT'), true);
  assert.equal(await c.sendTyping('u1', 'CT'), true);
  assert.equal(calls.filter((x) => x.url.includes('getconfig')).length, 1);
  assert.deepEqual(calls[0]!.body.ilink_user_id, 'u1');
  assert.equal(calls[0]!.body.context_token, 'CT');
  const typing = calls[1]!.body;
  assert.equal(typing.typing_ticket, 'TT');
  assert.equal(typing.status, 1);
  const bad = fakeFetch(() => ({ status: 500, body: '' }));
  assert.equal(await new ILinkClient({ fetch: bad.fn, token: TOKEN }).sendTyping('u1'), false);
});

test('parseILinkJson keeps uint64 ids lossless and leaves strings alone', () => {
  const r = parseILinkJson<{ message_id: string; t: string }>('{"t":"\\"message_id\\":1","message_id":12345678901234567890}');
  assert.equal(r.message_id, '12345678901234567890');
  assert.equal(r.t, '"message_id":1');
});

test('media: images and files are found on inbound messages, downloaded from Tencent only, and decrypted', async () => {
  const { createCipheriv, randomBytes } = await import('node:crypto');
  const { ILinkClient, mediaUrl, parseAesKey, ILINK_CDN_URL } = await import('../../runtime/core/wechat/ilink');
  const key = randomBytes(16), plain = Buffer.from('hello media'), cipher = createCipheriv('aes-128-ecb', key, null), encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  assert.deepEqual(parseAesKey(key.toString('base64')), key);
  assert.deepEqual(parseAesKey(Buffer.from(key.toString('hex')).toString('base64')), key, 'files use base64 of the hex spelling');
  assert.throws(() => parseAesKey(Buffer.from('short').toString('base64')));
  assert.throws(() => mediaUrl({ kind: 'file', fullUrl: 'https://evil.example/x' }), /腾讯/);
  assert.throws(() => mediaUrl({ kind: 'file', fullUrl: 'http://novac2c.cdn.weixin.qq.com/x' }), /腾讯/);
  assert.equal(mediaUrl({ kind: 'image', fullUrl: 'https://novac2c.cdn.weixin.qq.com/c2c/download?x=1' }), 'https://novac2c.cdn.weixin.qq.com/c2c/download?x=1');
  assert.equal(mediaUrl({ kind: 'image', param: 'a b' }), `${ILINK_CDN_URL}/download?encrypted_query_param=a%20b`);
  let fetched = '';
  const update = { ret: 0, get_updates_buf: 'n', msgs: [{ from_user_id: 'u@im.wechat', message_id: '1', item_list: [{ type: 2, image_item: { aeskey: key.toString('hex'), media: { encrypt_query_param: 'p' } } }] }, { from_user_id: 'u@im.wechat', message_id: '2', item_list: [{ type: 4, file_item: { file_name: 'a.txt', media: { encrypt_query_param: 'q', aes_key: key.toString('base64') } } }] }] };
  const client = new ILinkClient({ fetch: (async (url: string) => { fetched = String(url); return String(url).includes('getupdates') ? new Response(JSON.stringify(update)) : new Response(encrypted); }) as any } as any);
  client.setSession({ token: 't' });
  const { messages } = await client.getUpdates('');
  assert.equal(messages[0].media?.kind, 'image'); assert.equal(messages[1].media?.fileName, 'a.txt');
  assert.deepEqual(Buffer.from(await client.downloadMedia(messages[0].media!)), plain); assert.match(fetched, /encrypted_query_param=p/);
  assert.deepEqual(Buffer.from(await client.downloadMedia(messages[1].media!)), plain);
});
