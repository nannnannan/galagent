import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppSnapshot } from '../../runtime/shared/contracts';
import { ModelGateway } from '../../runtime/core/model-gateway';
import { RequestPool } from '../../runtime/core/pool';

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
    mainToolset: () => ({defs:[], rounds:1, run: async () => { executed++; return '{}'; }}),
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
    mainToolset:()=>({defs:[],rounds:3,run:async()=> '{}'}),
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
    mainToolset:()=>({defs:[],rounds:3,run:async()=> '{}'}),
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
