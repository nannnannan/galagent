import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppSnapshot } from '../../runtime/shared/contracts';
import { ModelGateway } from '../../runtime/core/model-gateway';
import { RequestPool } from '../../runtime/core/pool';

const harmlessTool = {type:'function' as const,function:{name:'inspect',description:'Inspect a fixture',parameters:{type:'object'}}};

test('every declared call gets an ordered result, while denied and over-budget calls do not run', async () => {
  const calls = Array.from({ length: 9 }, (_, index) => ({
    id: 'call_' + index, type: 'function',
    function: { name: index === 2 ? 'not_offered' : 'inspect', arguments: '{}' },
  }));
  const handled: string[] = [];
  let requests = 0;
  const gateway = new ModelGateway({
    provider: () => ({ baseUrl: 'https://fixture.example/v1', model: 'fixture', configured: true }),
    getKey: async () => 'fixture', pool: new RequestPool(), outputLimit: () => 4096,
    guard: { messages: messages => messages }, recordUsage() {},
    mainToolset: () => ({
      defs: [harmlessTool], rounds: 1,
      run: async call => { handled.push(call.id); return 'ok'; },
    }),
    fetch: async (_url, init) => {
      if (requests++ === 0) return Response.json({ choices: [{
        finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: calls },
      }] });
      const results = JSON.parse(String(init?.body)).messages.filter((message: {role: string}) => message.role === 'tool');
      assert.deepEqual(results.map((result: {tool_call_id: string}) => result.tool_call_id), calls.map(call => call.id));
      assert.match(results[2].content, /本轮未开放/);
      assert.match(results[8].content, /未执行此项/);
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    },
  });
  assert.deepEqual(await gateway.request([], new AbortController().signal, 'chat', undefined, undefined, true), { ok: true });
  assert.deepEqual(handled, calls.filter((_, index) => index !== 2 && index < 8).map(call => call.id));
});

test('truncated and malformed tool batches fail before doing any work', async () => {
  let handled = 0;
  let finish = 'length';
  const gateway = new ModelGateway({
    provider: () => ({ baseUrl: 'https://fixture.example/v1', model: 'fixture', configured: true }),
    getKey: async () => 'fixture', pool: new RequestPool(), outputLimit: () => 4096,
    guard: { messages: messages => messages }, recordUsage() {},
    mainToolset: () => ({ defs: [harmlessTool], rounds: 1, run: async () => { handled++; return 'ok'; } }),
    fetch: async () => Response.json({ choices: [{
      finish_reason: finish, message: { role: 'assistant', tool_calls: [
        { id: 'good', function: { name: 'inspect', arguments: '{}' } },
        { id: 'bad', function: { name: 'inspect', arguments: '{' } },
      ] },
    }] }),
  });
  const request = () => gateway.request([], new AbortController().signal, 'chat', undefined, undefined, true);
  await assert.rejects(request, /截断/);
  finish = 'tool_calls';
  await assert.rejects(request, /JSON 对象/);
  assert.equal(handled, 0);
});

test('changing endpoints while reading the credential cancels the request before sending', async () => {
  const provider: AppSnapshot['provider'] = {
    baseUrl: 'https://before.example/v1', model: 'test', configured: true,
  };
  let calls = 0;
  const gateway = new ModelGateway({
    provider: () => provider,
    getKey: async () => { provider.baseUrl = 'https://after.example/v1'; return 'fixture'; },
    fetch: async () => { calls++; throw new Error('unexpected network call'); },
    outputLimit: () => 4096,
    pool: new RequestPool(),
    guard: { messages: messages => messages },
    mainToolset: () => { throw new Error('unexpected tool lookup'); },
    recordUsage: () => { throw new Error('unexpected usage'); },
  });
  await assert.rejects(gateway.request([], new AbortController().signal), /模型配置已更新/);
  assert.equal(calls, 0);
});
test('queued requests apply the current outbound policy and never follow a redirect', async () => {
  const pool = new RequestPool(1);
  const release = await pool.acquire('chat');
  let ready!: () => void;
  const keyRead = new Promise<void>(resolve => { ready = resolve; });
  let redact = false;
  const sent: RequestInit[] = [];
  const gateway = new ModelGateway({
    provider: () => ({ baseUrl: 'https://fixture.example/v1', model: 'fixture', configured: true }),
    getKey: async () => { ready(); return 'fixture'; }, pool, outputLimit: () => 4096,
    guard: { messages: messages => messages.map(message => redact ? { ...message, content: '已隐藏' } : message) },
    mainToolset: () => ({ defs: [], rounds: 1, run: async () => '' }), recordUsage() {},
    fetch: async (_url, init) => {
      sent.push(init!);
      return new Response(null, { status: 307, headers: { Location: 'https://elsewhere.example/v1/chat/completions' } });
    },
  });
  try {
    const result = gateway.request([{ role: 'user', content: '旧规则允许的原文' }], new AbortController().signal);
    await keyRead;
    assert.equal(sent.length, 0);
    redact = true;
    release();
    await assert.rejects(result, /307/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].redirect, 'manual');
    assert.equal(JSON.parse(String(sent[0].body)).messages[0].content, '已隐藏');
  } finally { release(); pool.close(); }
});
test('a cancelled model response cannot still invoke tools', async () => {
  const abort = new AbortController();
  let executed = 0;
  const gateway = new ModelGateway({
    provider: () => ({baseUrl:'https://fixture.example/v1', model:'fixture', configured:true}),
    getKey: async () => 'fixture', pool: new RequestPool(), outputLimit: () => 4096,
    guard: {messages: messages => messages}, recordUsage() {},
    fetch: async () => {
      abort.abort();
      return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'late',function:{name:'late',arguments:'{}'}}]}}]}));
    },
    mainToolset: () => ({defs:[harmlessTool], rounds:1, run: async () => { executed++; return '{}'; }}),
  });
  await assert.rejects(gateway.request([], abort.signal, 'chat', undefined, undefined, true));
  assert.equal(executed, 0);
});
test('unsupported JSON mode falls back once without disabling tools; an unrelated 400 stays actionable',async()=>{
  const bodies:any[]=[];let reject=false;
  const gateway=new ModelGateway({
    provider:()=>({baseUrl:'https://fixture.example/v1',model:'model',configured:true}),
    getKey:async()=>'secret-fixture-key',outputLimit:()=>4096,pool:new RequestPool(),
    guard:{messages:m=>m},recordUsage(){},
    mainToolset:()=>({defs:[harmlessTool],rounds:3,run:async()=> '{}'}),
    fetch:async(_url,init)=>{
      const b=JSON.parse(String(init?.body));bodies.push(b);
      if(reject)return new Response(JSON.stringify({error:{message:'bad model secret-fixture-key',param:'model'}}),{status:400});
      if(b.response_format)return new Response(JSON.stringify({error:{message:'response_format is not supported',param:'response_format'}}),{status:400});
      return new Response(JSON.stringify({choices:[{message:{content:'```json\n{"text":"ok"}\n```'}}]}));
    },
  });
  assert.deepEqual(await gateway.request([],new AbortController().signal,'chat',undefined,undefined,true),{text:'ok'});
  assert.ok(bodies[0].tools && bodies[1].tools);assert.equal(bodies.length,2);
  await gateway.request([],new AbortController().signal,'chat',undefined,undefined,true);
  assert.equal(bodies.length,3);assert.equal(bodies[2].response_format,undefined);
  reject=true;
  await assert.rejects(gateway.request([],new AbortController().signal,'chat',undefined,undefined,true),(error:Error)=>{
    assert.match(error.message,/400/);assert.match(error.message,/bad model/);assert.ok(!error.message.includes('secret-fixture-key'));return true;
  });
  assert.equal(bodies.length,4,'bad model errors do not trigger blind capability retries');
});
test('main chat accepts SSE and adapts a native model requiring max_completion_tokens', async()=>{
  let requests=0;
  const gateway=new ModelGateway({
    provider:()=>({baseUrl:'https://native.example/v1',model:'reasoning',mode:'native-api',configured:true}),
    getKey:async()=>'fixture',outputLimit:()=>4096,pool:new RequestPool(),guard:{messages:m=>m},recordUsage(){},
    mainToolset:()=>({defs:[harmlessTool],rounds:3,run:async()=> '{}'}),
    fetch:async(_url,init)=>{
      requests++;const b=JSON.parse(String(init?.body));
      if(b.max_tokens)return new Response(JSON.stringify({error:{param:'max_tokens',message:'Unsupported parameter max_tokens'}}),{status:400});
      assert.equal(b.max_completion_tokens,4096);
      const chunks=[{choices:[{index:0,delta:{role:'assistant',content:'{"text":"直连成功"}'},finish_reason:'stop'}]}];
      return new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',
        {headers:{'content-type':'text/event-stream'}});
    },
  });
  assert.deepEqual(await gateway.request([],new AbortController().signal,'chat'),{text:'直连成功'});
  assert.equal(requests,2);
});

test('empty or invalid-schema HTTP 400 does not poison tool support for later research',async()=>{
  let failure='empty';const offered:boolean[]=[];
  const gateway=new ModelGateway({
    provider:()=>({baseUrl:'https://fixture.example/v1',model:'fixture',configured:true}),
    getKey:async()=>'fixture',outputLimit:()=>4096,pool:new RequestPool(),guard:{messages:m=>m},recordUsage(){},
    mainToolset:()=>({defs:[harmlessTool],rounds:2,run:async()=> '{}'}),
    fetch:async(_url,init)=>{
      offered.push(!!JSON.parse(String(init?.body)).tools);
      if(failure)return new Response(failure==='empty'?'{}':JSON.stringify({error:{message:'Invalid tools schema'}}),{status:400});
      return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}));
    },
  });
  await assert.rejects(()=>gateway.request([],new AbortController().signal,'background',undefined,undefined,true),/400/);
  failure='schema';await assert.rejects(()=>gateway.request([],new AbortController().signal,'background',undefined,undefined,true),/400/);
  failure='';assert.deepEqual(await gateway.request([],new AbortController().signal,'background',undefined,undefined,true),{ok:true});
  assert.deepEqual(offered,[true,true,true]);
});
