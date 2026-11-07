'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const vm=require('node:vm');
const {once}=require('node:events');

test('proxy contract with isolated credentials and a simulated upstream',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mira-proxy-test-'));
  let server, forwarded, expired=false;
  const nativeRuntime={
    build:{version:'0.0.771',sha256:'fixture'},
    native:{sign:()=>({}),seal:()=>{}},
    loadAuth:()=>({token:'fixture-token',exp:expired?0:Date.now()/1000+3600,device:{publicKeyB64:'fixture-public',deviceId:'fixture-device'}}),
  };
  try {
    const source=fs.readFileSync(path.join(__dirname,'proxy.cjs'),'utf8');
    vm.runInNewContext(source,{
      __dirname:directory, Buffer, AbortController, AbortSignal, setTimeout, clearTimeout,
      console:{log(){},error(){}},process:{env:{MIRA_PROXY_PORT:'0'},on(){}},
      require(name){
        if(name==='./native-runtime.cjs')return nativeRuntime;
        if(name==='node:http')return {createServer(handler){
          server=http.createServer(handler);
          const listen=server.listen;
          server.listen=function(_port,host,callback){return listen.call(this,0,host,callback);};
          return server;
        }};
        return require(name);
      },
      async fetch(url,options){
        assert.equal(new URL(url).origin,'https://relay.mirasim.ai');
        if(url.endsWith('/v1/device/session'))return Response.json({ticket:'fixture-ticket',expiresIn:300});
        forwarded=JSON.parse(options.body.toString());
        if(forwarded.stream)return new Response('data: {"choices":[{"delta":{"tool_calls":[{"id":"call_test","function":{"name":"Read","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
        return Response.json({choices:[{message:{role:'assistant',content:'fixture-reply'}}]});
      },
    },{filename:'proxy.cjs'});
    await once(server,'listening');
    const base='http://127.0.0.1:'+server.address().port;
    const key=fs.readFileSync(path.join(directory,'.local-api-key'),'utf8').trim();
    const request=(route,body,auth=key)=>fetch(base+route,{
      method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},
      body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),
    });
    await t.test('requires the generated local key',async()=>{
      assert.match(key,/^mira-local-[a-f0-9]{48}$/);
      assert.equal((await request('/health',undefined,'incorrect')).status,401);
      const health=await (await request('/health')).json();
      assert.equal(health.version,'0.0.771');assert.equal(health.defaultModel,'kimi-k3');
    });
    await t.test('lists model aliases',async()=>{
      const models=await (await request('/v1/models')).json();
      assert.ok(models.data.some(model=>model.id==='kimi-code/k3'));
    });
    await t.test('rejects invalid routes, JSON and model names',async()=>{
      assert.equal((await request('/unknown')).status,404);
      assert.equal((await request('/v1/chat/completions','invalid')).status,400);
      assert.equal((await request('/v1/chat/completions',{model:'unknown'})).status,400);
    });
    await t.test('forwards default model and ordinary replies',async()=>{
      const body={messages:[{role:'user',content:'fixture-question'}]};
      const result=await (await request('/v1/chat/completions',body)).json();
      assert.equal(result.choices[0].message.content,'fixture-reply');
      assert.equal(forwarded.model,'kimi-k3');assert.deepEqual(forwarded.messages,body.messages);
    });
    await t.test('preserves SSE tool calls and tool results',async()=>{
      const body={model:'kimi-code/k3',stream:true,tools:[{type:'function',function:{name:'Read'}}],messages:[{role:'tool',tool_call_id:'call_test',content:'fixture-result'}]};
      const result=await request('/v1/chat/completions',body);
      assert.match(result.headers.get('content-type'),/text\/event-stream/);
      assert.match(await result.text(),/tool_calls.*call_test/);
      assert.deepEqual(forwarded.tools,body.tools);assert.deepEqual(forwarded.messages,body.messages);
      assert.equal(forwarded.model,'kimi-k3');
    });
    await t.test('rejects expired login',async()=>{
      expired=true;
      assert.equal((await request('/v1/chat/completions',{messages:[]})).status,401);
    });
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
