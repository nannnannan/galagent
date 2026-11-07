import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prepareResearchMcp} from '../../runtime/core/research-mcp';
import {McpHub,validServers,type McpServerConfig} from '../../runtime/core/mcp';
import {PrivacyGuard,normalizeSandbox} from '../../runtime/core/privacy';
import {CompanionService} from '../../runtime/core/companion';
import {Store} from '../../runtime/core/store';
import {emptyResearch,addManual} from '../../runtime/core/research';

const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const schema={type:'object',properties:{query:{type:'string'},path:{type:'string'}},required:['query'],additionalProperties:false};
const catalog=[
  {name:'lookup',description:'Search the catalog',inputSchema:schema,annotations:{readOnlyHint:true}},
  {name:'delete',description:'Delete',inputSchema:schema,annotations:{readOnlyHint:true,destructiveHint:true}},
  {name:'unknown',description:'Unknown effect',inputSchema:schema},
];
function fixture() {
  let servers:McpServerConfig[]=[{name:'library',url:'https://mcp.example/tools',enabled:true,researchTools:['lookup','delete','unknown']}];
  let box=normalizeSandbox({level:'open'}),revision=1;
  let answer=true,approvals=0,calls=0,received:unknown;
  const statuses:string[]=[];
  const fake:typeof fetch=async(_url,init)=>{
    assert.equal(init?.redirect,'error');
    const body=JSON.parse(String(init?.body));
    if(!body.id)return new Response(null,{status:202});
    const result=body.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{}}:body.method==='tools/list'?{tools:catalog}:(calls++,received=body.params.arguments,{content:[{type:'text',text:'Result password=private-fixture https://example.com/not-opened'}]});
    return json({jsonrpc:'2.0',id:body.id,result});
  };
  const hub=new McpHub(()=>servers,()=>tmpdir(),{fetch:fake});
  const options={hub,servers:()=>servers,sandbox:()=>box,forbidden:()=>[] as string[],policyVersion:()=>revision,cwd:()=>tmpdir(),dataDir:path.join(tmpdir(),'gal-research-secrets'),guard:new PrivacyGuard(()=>box),approve:async()=>{approvals++;return answer;}};
  const controller=new AbortController();
  return {options,hub,controller,statuses,prepare:()=>prepareResearchMcp(options,controller.signal,m=>statuses.push(m)),setBox:(b:typeof box)=>box=b,setServers:(s:McpServerConfig[])=>servers=s,setAnswer:(value:boolean)=>answer=value,revision:()=>revision++,stats:()=>({calls,approvals,received})};
}
const call=(query='topic',extra={})=>({id:'tool',type:'function' as const,function:{name:'mcp__library__lookup',arguments:JSON.stringify({query,...extra})}});

test('research exposes selected read-only tools, validates args and records only actual MCP provenance',async()=>{
  const f=fixture();try{
    const groups=await f.prepare();assert.equal(groups.length,1);assert.deepEqual(groups[0].tools.defs.map(t=>t.function.name),['mcp__library__lookup']);
    assert.equal(f.hub.status()[0].researchTools?.length,1);
    const result=await groups[0].tools.run(call('password=private-fixture'));
    assert.ok(!JSON.stringify(f.stats().received).includes('private-fixture'));
    assert.ok(!result.content.includes('private-fixture'));
    assert.match(result.sources[0],/^mcp:\/\/library\/lookup\//);
    assert.ok(!result.sources.includes('https://example.com/not-opened'));
    await assert.rejects(()=>groups[0].tools.run({...call(),function:{name:'mcp__library__delete',arguments:'{}'}}),/授权/);
    await assert.rejects(()=>groups[0].tools.run({...call(),function:{name:'mcp__library__lookup',arguments:'{}'}}),/格式/);
    assert.equal(f.stats().calls,1);
    f.setServers([{...f.options.servers()[0],researchTools:['lookup']}]);
    assert.equal(f.hub.status()[0].state,'ready','changing research selection keeps the connection and catalog');
  }finally{f.hub.close();}
});

test('standard mode asks once per research pass and denial makes no connection',async()=>{
  const f=fixture();f.setBox(normalizeSandbox({level:'standard'}));f.setAnswer(false);
  try{
    assert.deepEqual(await f.prepare(),[]);assert.equal(f.hub.status()[0].state,'stopped');
    f.setAnswer(true);const groups=await f.prepare();await groups[0].tools.run(call());await groups[0].tools.run(call());
    assert.equal(f.stats().approvals,2);assert.equal(f.stats().calls,2);
  }finally{f.hub.close();}
});

test('research MCP rechecks revocation, sandbox and protected paths',async()=>{
  const f=fixture();try{
    const [group]=await f.prepare();
    await assert.rejects(()=>group.tools.run(call('topic',{path:path.join(f.options.dataDir,'secret.bin')})),/不允许/);
    f.revision();await assert.rejects(()=>group.tools.run(call()),/授权/);
    assert.equal(f.stats().calls,0);
    f.setBox(normalizeSandbox({network:false},f.options.sandbox()));assert.deepEqual(await f.prepare(),[]);
    f.setServers([{name:'local',command:'never-launch',enabled:true,researchTools:['lookup']}]);f.options.forbidden=()=>[tmpdir()];
    assert.deepEqual(await f.prepare(),[]);assert.equal(f.hub.status()[0].state,'stopped');
  }finally{f.hub.close();}
});

test('cancel releases an MCP call even if the transport ignores abort',async()=>{
  const f=fixture();let resolve!: (value:any)=>void;
  try{
    const [group]=await f.prepare();f.options.hub.call=()=>new Promise(r=>{resolve=r;});
    const pending=group.tools.run(call());f.controller.abort();
    await assert.rejects(pending,/取消/);resolve({text:'late',isError:false,images:[]});
  }finally{f.hub.close();}
});

test('cancel while waiting for MCP approval never starts the server',async()=>{
  const f=fixture();f.setBox(normalizeSandbox({level:'standard'}));
  f.options.approve=()=>new Promise<boolean>(()=>{});
  try{const pending=f.prepare();f.controller.abort();await assert.rejects(pending,/取消/);assert.equal(f.hub.status()[0].state,'stopped');}
  finally{f.hub.close();}
});

test('MCP research selections are bounded and retained in sanitized server settings',()=>{
  assert.deepEqual(validServers([{name:'s',url:'https://example.com',researchTools:['lookup','lookup']}])[0].researchTools,['lookup']);
  assert.throws(()=>validServers([{name:'s',url:'https://example.com',researchTools:['']}]),/列表/);
});

test('companion research uses an isolated MCP helper and retains its source through synthesis',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'gal-research-mcp-'));const seed=new Store(dir),now=Date.now();
  const ledger=addManual(emptyResearch(),'胶片摄影',now,()=> 'film');ledger.lastPlanAt=now;
  ledger.findings.push({id:'private-old',interestId:'film',topic:'胶片摄影',angle:'MCP library',title:'旧资料',summary:'PRIVATE_CATALOG_DETAIL',why:'',sources:[{title:'MCP library',url:'mcp://library/lookup/previous'}],freshness:'evergreen',confidence:2,at:now-60_000});
  seed.put('state','research',ledger);seed.close();let called=0,provenance='';
  const core=new CompanionService({dataDir:dir,workingDir:dir,credentials:{get:async()=> 'fixture',set:async()=>{}},features:{research:true},embeddings:{encode:async()=>[1,0],close:async()=>{}},
    mcpFetch:async(_url,init)=>{
      const body=JSON.parse(String(init?.body));if(!body.id)return new Response(null,{status:202});
      const result=body.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{}}:body.method==='tools/list'?{tools:catalog}:(called++,{content:[{type:'text',text:'展览周六开幕。'}]});return json({jsonrpc:'2.0',id:body.id,result});
    },
    fetch:async(_url,init)=>{
      const body=JSON.parse(String(init?.body)),system=String(body.messages[0].content);let result:unknown={text:'你好',expression:'neutral',action:'idle'};
      if(system.includes('facts每项'))result={facts:[],diary:''};
      else if(system.includes('派出去的并行助手')){
        const defs=body.tools||[];
        if(defs.some((t:any)=>t.function.name.startsWith('mcp__'))){
          assert.deepEqual(defs.map((t:any)=>t.function.name),['mcp__library__lookup']);
          if(!body.messages.some((m:any)=>m.role==='tool'))return json({choices:[{message:{role:'assistant',tool_calls:[call()]},finish_reason:'tool_calls'}]});
          const output=JSON.parse(body.messages.find((m:any)=>m.role==='tool').content);provenance=output.sources[0].url;
          result={gist:'展览周六开幕',points:['周六开幕'],sources:output.sources};
        }else { assert.ok(!JSON.stringify(body.messages).includes('PRIVATE_CATALOG_DETAIL'),'connector notes never enter a web helper');result={gist:'没有网页原文',points:[],sources:[]}; }
      }else if(system.includes('在替用户研究')){
        assert.ok(String(body.messages.at(-1).content).includes(provenance));
        result={findings:[{title:'周六展览',summary:'展览周六开幕',sources:[{title:'MCP library',url:provenance}],confidence:3}]};
      }
      return json({choices:[{message:{content:JSON.stringify(result)}}]});
    }});
  try{
    await core.init();await core.handle({type:'chat.send',text:'你好'});await core.waitForBackground();
    const changed=await core.handle({type:'settings.update',settings:{sandbox:{level:'open'},mcpServers:[{name:'library',url:'https://mcp.example/tools',enabled:true,researchTools:['lookup']}]}});assert.equal(changed.ok,true);
    await core.researchStep(now,true);
    assert.equal(called,1);assert.match(provenance,/^mcp:\/\//);
    assert.equal(core.getSnapshot().research?.findings[0]?.sources[0].url,provenance);
    assert.equal(core.getSnapshot().research?.progress?.stage,'done');
  }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
