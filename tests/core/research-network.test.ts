import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CompanionService} from '../../runtime/core/companion';

test('research honors explicit LAN access while default, domain and network restrictions still apply',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'research-net-'));let reads=0;
  const server=createServer((_req,res)=>{reads++;res.setHeader('content-type','text/html');res.end('<article>Verified source about photography.</article>');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/article`;
  const core=new CompanionService({dataDir:dir,workingDir:dir,credentials:{get:async()=>'fixture',set:async()=>{}},embeddings:{encode:async()=>[1,0],close:async()=>{}},
    fetch:async(_url,init)=>{
      const body=JSON.parse(String(init?.body));
      if(!body.messages.some((m:any)=>m.role==='tool'))return Response.json({choices:[{message:{role:'assistant',tool_calls:[{id:'page',type:'function',function:{name:'read_webpage',arguments:JSON.stringify({url})}}]},finish_reason:'tool_calls'}]});
      return Response.json({choices:[{message:{content:JSON.stringify({gist:'No usable source if the read failed',points:[],sources:[{title:'Source',url}]})}}]});
    }});
  const research=()=>core.runHelper('查资料',new AbortController().signal,'background',{by:'research',tools:['read_webpage']});
  try{
    await core.init();
    const blocked=await research();assert.equal(reads,0);assert.match(blocked.gist,/没查成.*private network/);assert.equal(blocked.sources.length,0);
    assert.equal((await core.handle({type:'settings.update',settings:{sandbox:{level:'full'}}})).ok,true);
    const allowed=await research();assert.equal(reads,1);assert.equal(allowed.sources[0].url,url);
    await core.handle({type:'settings.update',settings:{sandbox:{allowedDomains:['example.com']}}});
    const domainBlocked=await research();assert.equal(reads,1);assert.match(domainBlocked.gist,/没查成/);assert.equal(domainBlocked.sources.length,0);
    await core.handle({type:'settings.update',settings:{sandbox:{network:false,allowedDomains:[]}}});
    const offline=await research();assert.equal(reads,1);assert.equal(offline.sources.length,0);assert.match(offline.gist,/没查成/);
  }finally{await core.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});
