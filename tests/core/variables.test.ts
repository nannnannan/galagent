import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../../runtime/core/store';
import {CharacterVariables} from '../../runtime/core/variables';
import {CompanionService} from '../../runtime/core/companion';
import type {AppSnapshot,Message} from '../../runtime/shared/contracts';

async function fixture(stage:AppSnapshot['identity']['stage']='S0',legacy=false) {
  const dir=await mkdtemp(join(tmpdir(),'galagent-variables-')),store=new Store(dir);
  let now=Date.parse('2026-10-09T02:00:00Z');
  const identity:AppSnapshot['identity']={id:randomUUID(),name:'星棱',onboarding:'ready',stage};
  const vars=new CharacterVariables(store,()=>now);vars.initialize(identity,legacy);
  const pair=(text:string)=>{
    const createdAt=new Date(now).toISOString();
    const u:Message={id:randomUUID(),role:'user',source:'chat',text,createdAt};
    const a:Message={id:randomUUID(),role:'assistant',source:'chat',text:'fixture reply',createdAt};
    store.put('message',u.id,u);store.put('message',a.id,a);vars.chat(identity,u,a);return [u,a];
  };
  const view=()=>vars.snapshot(identity,{expression:'neutral',strength:0,expiresAt:0});
  return {dir,store,identity,vars,pair,view,advance:(ms=86400000)=>{now+=ms;},set:(time:number)=>{now=time;},cleanup:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};
}

test('unified personality applies after naming and every legacy archive keeps identity and relationship',async()=>{
  const fresh=await fixture();try{fresh.pair('你好');assert.equal(fresh.view().expression.stage,'unified');assert.equal(fresh.identity.stage,'S0');assert.equal(fresh.view().expression.proficiency,2);}finally{await fresh.cleanup();}
  for(const [stage,expected,score] of [['S2','awkward',20],['S3','tsundere',50],['S4','settled',80]] as const){
    const f=await fixture(stage,true);try{f.store.put('state','relationship',{trust:33,familiarity:40,self_awareness:20,exposure:18});const before=f.view();f.vars.initialize(f.identity,true);f.vars.syncStage(f.identity);assert.equal(f.identity.name,'星棱');assert.equal(f.identity.stage,stage);assert.equal(before.expression.stage,'unified');assert.equal(before.expression.proficiency,score);assert.equal(f.view().relationship.trust,33);}finally{await f.cleanup();}
  }
});

test('interaction statistics remain bounded while personality stays unified across days and relationship changes',async()=>{
  const f=await fixture();try{
    const [u,a]=f.pair('你真棒');for(let i=0;i<30;i++){f.vars.chat(f.identity,u,a);f.pair('你真棒');}
    assert.equal(f.view().expression.proficiency,4);assert.equal(f.view().expression.stage,'unified');assert.equal(f.vars.export(f.identity).events.length,2);
    for(let day=0;day<2;day++){f.advance();f.pair('你有什么感受');f.pair('开玩笑，逗你');}
    assert.equal(f.view().expression.stage,'unified');assert.equal(f.identity.stage,'S0');
    for(let day=0;day<5;day++){f.advance();f.pair('你有什么感受');f.pair('我不同意，先澄清分歧');f.pair('逗你，开玩笑');}
    assert.equal(f.view().expression.stage,'unified','relationship values cannot switch personality');
    f.store.put('state','relationship',{trust:32,familiarity:32,self_awareness:20,exposure:20});f.vars.syncStage(f.identity);assert.equal(f.view().expression.stage,'unified');
    for(let day=0;day<12;day++){f.advance();f.pair('你怎么想');f.pair('这个误会解释一下');}
    assert.equal(f.view().expression.stage,'unified');assert.equal(f.identity.stage,'S0');assert.equal(f.view().expression.proficiency,100);
    f.advance(100*86400000);assert.equal(f.view().expression.proficiency,100);assert.equal(f.view().expression.practiceDays,20);assert.ok(f.view().time.elapsedSeconds>=100*86400);
  }finally{await f.cleanup();}
});

test('presentation uses work and quiet controls without personality-stage limits',async()=>{
  const f=await fixture();try{
    f.pair('你有什么感受');const p=f.view().expression.proficiency;
    assert.deepEqual(f.vars.present(f.identity,'daily','pleased','celebrate',false,true),{expression:'pleased',action:'celebrate',intensity:0.85});
    assert.equal(f.vars.present(f.identity,'work','pleased','wave',false,true).action,'idle');assert.equal(f.view().scene.face,'work');
    const quiet=f.vars.present(f.identity,'daily','flustered','sulk',true,true);assert.equal(quiet.action,'idle');assert.equal(quiet.intensity,0.2);
    f.advance(120001);assert.equal(f.view().scene.expiresAt,0);assert.equal(f.view().presentation.expression,'neutral');assert.equal(f.view().expression.proficiency,p);
    f.vars.present(f.identity,'disagreement','annoyed','sulk',false,true);f.advance(-3600000);assert.equal(f.view().scene.face,'daily');assert.equal(f.view().presentation.action,'idle');assert.equal(f.view().time.elapsedSeconds,0);
  }finally{await f.cleanup();}
});

test('archive round-trip is idempotent; deleting evidence preserves attained growth without restoring private sources',async()=>{
  const f=await fixture();try{
    const [u,a]=f.pair('你喜欢这里吗');const saved=f.vars.export(f.identity),before=f.view();
    const validated=f.vars.validate(saved,f.identity.id,id=>f.store.get<Message>(id),id=>f.store.kind(id));f.vars.import(f.identity,validated);f.vars.import(f.identity,validated);assert.equal(f.view().expression.proficiency,before.expression.proficiency);
    f.store.tombstone(u.id);f.store.remove(u.id);f.store.tombstone(a.id);f.store.remove(a.id);f.vars.reconcile(f.identity);assert.equal(f.view().expression.proficiency,before.expression.proficiency);assert.equal(f.vars.export(f.identity).events.length,0);
    f.vars.import(f.identity,saved);assert.equal(f.vars.export(f.identity).events.length,0);assert.equal(f.view().expression.proficiency,before.expression.proficiency);assert.equal(JSON.stringify(f.vars.export(f.identity)).includes(u.id),false);
  }finally{await f.cleanup();}
});

test('deleting and re-adding interactions cannot evade daily growth caps; placement counts only authenticated drag sources',async()=>{
  const f=await fixture();try{
    for(let i=0;i<20;i++){const [u,a]=f.pair('你怎么想');f.store.tombstone(u.id);f.store.remove(u.id);f.store.tombstone(a.id);f.store.remove(a.id);f.vars.reconcile(f.identity);}
    assert.equal(f.view().expression.proficiency,6);assert.equal(f.view().expression.practiceDays,1);
    assert.equal(f.vars.export(f.identity).events.length,0);assert.equal(f.vars.export(f.identity).retired.reduce((s,c)=>s+c.points,0),6);
    const source=randomUUID();f.store.put('story-source',source,{id:source,kind:'tap',createdAt:'2026-10-09T02:00:00Z',data:{}});assert.throws(()=>f.vars.placement(f.identity,source));
    f.advance();for(let i=0;i<20;i++){const id=randomUUID();f.store.put('story-source',id,{id,kind:'drag',createdAt:'2026-10-10T02:00:00Z',data:{actualUserGesture:true}});f.vars.placement(f.identity,id);}
    assert.equal(f.view().expression.proficiency,7);assert.equal(f.vars.export(f.identity).events.length,1);
  }finally{await f.cleanup();}
});

const credentials={get:async()=> 'isolated-fixture-key',set:async()=>{}};
const embeddings=()=>({encode:async()=>[1,0],close:async()=>{}});
const response=(extra={})=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({text:'fixture response',name:'星棱',expression:'pleased',action:'celebrate',...extra})}}]}));

test('service uses unified persona without legacy stage leakage and preserves state across restart and failure',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'galagent-vars-service-'));const contexts:any[]=[];let mode:'good'|'fail'|'hold'='good',deliver:((r:Response)=>void)|undefined;
  const fetcher:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body)),system=String(body.messages[0].content);if(system.includes('facts每项'))return new Response(JSON.stringify({choices:[{message:{content:'{"facts":[],"diary":""}'}}]}));contexts.push(JSON.parse(system.split('\n状态数据：')[1]));if(mode==='fail')return new Response('',{status:503});if(mode==='hold')return await new Promise<Response>(r=>{deliver=r;});return response({stage:'S4',variables:{expression:{proficiency:999}}});};
  const create=async()=>{const c=new CompanionService({dataDir:dir,credentials,embeddings:embeddings(),fetch:fetcher});await c.init();return c;};let core=await create();
  try {
    assert.equal((await core.handle({type:'chat.send',text:'你有什么感受'})).ok,true);await core.waitForBackground();const first=core.getSnapshot();assert.equal(first.identity.onboarding,'ready');assert.equal(first.identity.stage,'S0');assert.equal(first.variables!.expression.stage,'unified');assert.equal(first.visual.action,'celebrate');assert.equal(first.visual.intensity,0.85);assert.equal(first.variables!.expression.proficiency,5);assert.equal(contexts[0].variables.numericUpdatesAllowed,false);assert.equal('stage' in contexts[0].identity,false);assert.equal('stage' in contexts[0].variables,false);assert.equal('proficiency' in contexts[0].variables,false);assert.equal('core' in contexts[0].variables,false);
    await core.close();core=await create();assert.equal(core.getSnapshot().variables!.expression.proficiency,5);assert.equal(core.getSnapshot().identity.name,first.identity.name);assert.equal(core.getSnapshot().visual.intensity,0.85);
    assert.equal((await core.handle({type:'chat.send',text:'解释这段代码'})).ok,true);await core.waitForBackground();assert.equal(contexts.at(-1).variables.face,'work');assert.equal(core.getSnapshot().visual.action,'idle');assert.equal(core.getSnapshot().visual.intensity,0.2);
    const earned=core.getSnapshot().variables!.expression.proficiency;mode='fail';assert.equal((await core.handle({type:'chat.send',text:'你怎么想'})).ok,false);assert.equal(core.getSnapshot().variables!.expression.proficiency,earned);
    mode='hold';const pending=core.handle({type:'chat.send',text:'这个误会说清楚'});for(let i=0;i<100&&!deliver;i++)await new Promise(r=>setTimeout(r,2));assert.ok(deliver);await core.handle({type:'chat.cancel'});deliver!(response());await pending;assert.equal(core.getSnapshot().variables!.expression.proficiency,earned);
  }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});

test('service imports legacy archives, rejects malformed variables before mutation and restores same events once',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'galagent-vars-archive-'));const core=new CompanionService({dataDir:dir,credentials,embeddings:embeddings(),fetch:async(_url,init)=>String(init?.body).includes('facts每项')?new Response(JSON.stringify({choices:[{message:{content:'{"facts":[],"diary":""}'}}]})):response()});await core.init();
  try {
    await core.handle({type:'chat.send',text:'你有什么感受'});await core.waitForBackground();const backup=core.exportArchive(),earned=core.getSnapshot().variables!.expression.proficiency;
    await core.importArchive(backup);await core.importArchive(backup);assert.equal(core.getSnapshot().variables!.expression.proficiency,earned);
    for(const mutate of [(a:any)=>{a.variables.baseline.proficiency=Infinity;},(a:any)=>{a.variables.transient.expiresAt=a.variables.transient.startedAt+120001;},(a:any)=>{a.variables.events[0].sourceIds=['unknown'];},(a:any)=>{a.variables.identityId=randomUUID();},(a:any)=>{a.variables.events.push(a.variables.events[0]);}]){const bad=JSON.parse(backup);mutate(bad);const before=core.exportArchive();await assert.rejects(core.importArchive(JSON.stringify(bad)));assert.deepEqual(JSON.parse(core.exportArchive()).variables,JSON.parse(before).variables);assert.equal(core.getSnapshot().messages.length,2);}
    const legacy=JSON.parse(backup);delete legacy.variables;legacy.identity.stage='S3';await core.importArchive(JSON.stringify(legacy));assert.equal(core.getSnapshot().variables!.expression.stage,'unified');assert.ok(core.getSnapshot().variables!.expression.proficiency>=50);assert.equal(core.getSnapshot().identity.onboarding,'ready');
    legacy.identity.id=randomUUID();await core.importArchive(JSON.stringify(legacy));assert.equal(core.getSnapshot().variables!.expression.stage,'unified');assert.equal(core.getSnapshot().variables!.expression.proficiency,50);
  }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
