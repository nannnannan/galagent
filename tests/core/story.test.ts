import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CompanionService} from '../../runtime/core/companion';
import {Story} from '../../runtime/core/story';
import {Store} from '../../runtime/core/store';
import type {Message,MemoryItem} from '../../runtime/shared/contracts';
const reply=(extra={})=>new Response(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({text:'fixture visible response',expression:'neutral',action:'idle',name:'星棱',...extra})}}]}));
const extraction=(facts:string[]=[],diary='')=>new Response(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({facts,diary})}}]}));
function clock(){const original=Date.now;let now=Date.parse('2026-10-09T01:00:00Z');Date.now=()=>now;return{advance:(ms:number)=>{now+=ms;},set:(value:number)=>{now=value;},now:()=>now,restore:()=>{Date.now=original;}};}
function dynamic(init?:RequestInit){const body=JSON.parse(String(init?.body)),system=String(body.messages[0].content),marker='\n状态数据：';return system.includes('facts每项')?undefined:JSON.parse(system.slice(system.indexOf(marker)+marker.length));}
const credentials={get:async()=> 'fixture-only-key',set:async(_key:string)=>{}};
const embeddings=()=>({encode:async()=>[1,0],close:async()=>{}});
async function make(fetcher:typeof fetch,dir?:string){const path=dir||await mkdtemp(join(tmpdir(),'galagent-story-'));const core=new CompanionService({dataDir:path,credentials,embeddings:embeddings(),fetch:fetcher});await core.init();return{core,dir:path};}
function relationship(dir:string){const store=new Store(dir);const result=store.get<any>('relationship');store.close();return result;}
const until=async(fn:()=>boolean)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,2));}throw new Error('fixture wait timeout');};

test('six scenes have real source ledgers and goals; quiet controls cannot be undone by a user-chat action suggestion',async()=>{
    const time=clock(),requests:any[]=[];let action='idle';
    const {core,dir}=await make(async(_url,init)=>{const context=dynamic(init);if(!context){const body=JSON.parse(String(init?.body));const user=JSON.parse(body.messages[1].content).user;return user==='我喜欢咖啡'?extraction(['我喜欢咖啡'],'有真实来源的札记'):extraction();}requests.push(context);return reply({action,stage:'S4',relationship:{trust:999}});});
    try{
        await core.handle({type:'chat.send',text:'我喜欢咖啡'});await core.waitForBackground();await core.handle({type:'pet.interact',interaction:'drag'});
        time.advance(28800000);await core.handle({type:'chat.send',text:'回来继续相处'});await core.waitForBackground();await core.handle({type:'chat.send',text:'我听说Codex这个工具'});await core.waitForBackground();
        const before=relationship(dir);await core.handle({type:'settings.update',settings:{quietUntil:Date.now()+3600000}});const after=relationship(dir);
        assert.deepEqual(['trust','familiarity','self_awareness','exposure'].map(k=>after[k]),['trust','familiarity','self_awareness','exposure'].map(k=>before[k]));
        const snapshot=core.getSnapshot();assert.deepEqual(new Set(snapshot.story!.recentEpisodes.map(e=>e.type)),new Set(['E01','E02','E03','E04','E05','E06']));assert.equal(snapshot.story!.goals.position.placements,1);assert.equal(snapshot.story!.goals.notebook.entries,1);assert.equal(snapshot.identity.stage,'S0');assert.equal(snapshot.variables!.expression.stage,'unified');
        const mention=requests.find(r=>r.sceneCandidates.some((s:any)=>s.type==='E05'));assert.equal(mention.sceneCandidates.find((s:any)=>s.type==='E05').evidence.doesNotProveExternalChat,true);
        action='doodle';assert.equal((await core.handle({type:'chat.send',text:'我主动问你一个问题'})).ok,true);await core.waitForBackground();assert.equal(core.getSnapshot().visual.action,'idle');assert.equal(requests.at(-1).interactionPolicy.quiet,true);
        const store=new Store(dir);for(const episode of store.all<any>('episode'))assert.ok(episode.sourceIds.every((id:string)=>!!store.kind(id)));assert.equal(store.all<any>('episode').filter(e=>e.type==='E01').length,1);store.close();
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('drag generation has a persistent twenty-minute attempt cooldown even when the model fails or is cancelled',async()=>{
    const time=clock();let calls=0,fail=true,hold=false,finish:((r:Response)=>void)|undefined;
    const fetcher:typeof fetch=async(_url,init)=>{const context=dynamic(init);if(!context)return extraction();if(context.scene==='scene'){calls++;if(hold)return await new Promise<Response>(r=>finish=r);if(fail)return new Response('',{status:503});}return reply();};
    let {core,dir}=await make(fetcher);
    try{
        await core.handle({type:'chat.send',text:'你好'});await core.waitForBackground();assert.equal((await core.handle({type:'pet.interact',interaction:'drag'})).ok,false);await core.handle({type:'pet.interact',interaction:'drag'});assert.equal(calls,1);
        await core.close();({core}=await make(fetcher,dir));time.advance(1199999);await core.handle({type:'pet.interact',interaction:'drag'});assert.equal(calls,1);time.advance(1);fail=false;await core.handle({type:'pet.interact',interaction:'drag'});assert.equal(calls,2);
        const relation=relationship(dir);assert.equal(relation.grants.filter((g:any)=>g.kind==='E02').length,1);
        time.advance(1200000);hold=true;const pending=core.handle({type:'pet.interact',interaction:'drag'});await until(()=>!!finish);await core.handle({type:'settings.update',settings:{quietUntil:Date.now()+3600000}});finish!(reply({text:'late scene',action:'sulk'}));await pending;assert.equal(core.getSnapshot().visual.bubble,'');await core.handle({type:'settings.update',settings:{quietUntil:0}});await core.handle({type:'pet.interact',interaction:'drag'});assert.equal(calls,3);
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('eight-hour reunion uses the last completed chat, survives a preceding drag, and consumes only a successful response',async()=>{
    const time=clock(),contexts:any[]=[];let failReunion=true;
    const {core,dir}=await make(async(_url,init)=>{const context=dynamic(init);if(!context)return extraction();contexts.push(context);if(context.scene==='chat'&&context.sceneCandidates.some((s:any)=>s.type==='E04')&&failReunion)return new Response('',{status:503});return reply();});
    try{
        await core.handle({type:'chat.send',text:'你好'});await core.waitForBackground();const store=new Store(dir),story=new Story(store);try{time.advance(28800000-1);assert.equal(story.reunion(),undefined);time.advance(1);assert.equal(story.reunion()!.type,'E04');}finally{store.close();}
        await core.handle({type:'pet.interact',interaction:'drag'});assert.equal((await core.handle({type:'chat.send',text:'八小时后再见'})).ok,false);assert.equal(core.getSnapshot().story!.recentEpisodes.some(e=>e.type==='E04'),false);
        const failed=contexts.at(-1).sceneCandidates.find((s:any)=>s.type==='E04');assert.equal(failed.evidence.unknownWhenNoClue,true);assert.deepEqual(failed.evidence.reliableClues,[]);
        failReunion=false;await core.handle({type:'chat.send',text:'再次尝试相处'});await core.waitForBackground();assert.equal(core.getSnapshot().story!.recentEpisodes.filter(e=>e.type==='E04').length,1);await core.handle({type:'chat.send',text:'接着说'});await core.waitForBackground();assert.equal(contexts.at(-1).sceneCandidates.some((s:any)=>s.type==='E04'),false);
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('Codex process labels qualify once per local day while browser titles never prove another AI conversation',async()=>{
    const time=clock(),contexts:any[]=[];
    const {core,dir}=await make(async(_url,init)=>{const context=dynamic(init);if(!context)return extraction();contexts.push(context);return reply({sourceIds:context.sceneCandidates.flatMap((s:any)=>s.sourceIds)});});
    try{
        await core.handle({type:'chat.send',text:'你好'});await core.waitForBackground();await core.handle({type:'settings.update',settings:{observationEnabled:true}});
        core.setObservation({available:true,observedAt:new Date(Date.now()).toISOString(),idleSeconds:600,appName:'chrome',title:'Codex 聊天'});await core.tick();assert.equal(contexts.at(-1).sceneCandidates.some((s:any)=>s.type==='E05'),false);
        time.advance(1200000);core.setObservation({available:true,observedAt:new Date(Date.now()).toISOString(),idleSeconds:600,appName:'Codex'});await core.tick();const episode=core.getSnapshot().story!.recentEpisodes.find(e=>e.type==='E05')!;assert.equal(episode.evidence.trigger,'process-label');assert.equal(episode.evidence.doesNotProveExternalChat,true);
        time.advance(3600000);core.setObservation({available:true,observedAt:new Date(Date.now()).toISOString(),idleSeconds:600,appName:'Codex'});await core.tick();assert.equal(contexts.at(-1).sceneCandidates.some((s:any)=>s.type==='E05'),false);
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('mood decays independently from capped source-deduplicated four-axis relationship; taps and refusals do not farm points',async()=>{
    const time=clock(),dir=await mkdtemp(join(tmpdir(),'galagent-story-reducer-')),store=new Store(dir),story=new Story(store);
    try{
        const userId=randomUUID(),assistantId=randomUUID(),createdAt=new Date(Date.now()).toISOString();store.put('message',userId,{id:userId,role:'user',text:'我叫黄，我喜欢咖啡',source:'chat',createdAt} satisfies Message);store.put('message',assistantId,{id:assistantId,role:'assistant',text:'fixture',source:'chat',createdAt} satisfies Message);
        story.named('stable-identity',userId,assistantId);story.named('stable-identity',userId,assistantId);
        for(const text of ['我叫黄','我喜欢咖啡']){const memory:MemoryItem={id:randomUUID(),kind:'fact',text,sourceId:userId,createdAt,valid:true};store.put('memory',memory.id,memory);story.fact(memory);story.fact(memory);}
        let calls=0;for(let i=0;i<50;i++)if(story.drag(story.source('drag',{actual:true}),true))calls++;
        assert.equal(calls,1);const before=store.get<any>('relationship');assert.deepEqual(['trust','familiarity','self_awareness','exposure'].map(k=>before[k]),[3,3,2,2]);assert.equal(before.grants.filter((g:any)=>g.kind==='E03').length,1);
        for(let i=0;i<20;i++){story.affect('flustered');story.control('quiet');}const after=store.get<any>('relationship');assert.deepEqual(['trust','familiarity','self_awareness','exposure'].map(k=>after[k]),[3,3,2,2]);
        const initial=story.snapshot().mood.strength;time.advance(300000);assert.ok(Math.abs(story.snapshot().mood.strength-initial/2)<.00001);time.advance(300000);assert.equal(story.tick(),true);assert.equal(story.snapshot().mood.expression,'neutral');assert.equal(store.get<any>('relationship').trust,3);
    }finally{store.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('quiet expiry emits a visible state change even with observations disabled',async()=>{
    const time=clock();const {core,dir}=await make(async(_url,init)=>dynamic(init)?reply():extraction());
    try{
        await core.handle({type:'settings.update',settings:{quietUntil:Date.now()+10000,observationEnabled:false}});let updates=0;core.on('snapshot',()=>updates++);time.advance(10000);await core.tick();assert.ok(updates>0);assert.equal(core.getSnapshot().settings.quietUntil>Date.now(),false);
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('story archives preserve sourced progress, retain corrected historical episodes, and cannot revive deleted events',async()=>{
    const time=clock();const fetcher:typeof fetch=async(_url,init)=>dynamic(init)?reply():extraction(['我喜欢咖啡'],'真实来源札记');const a=await make(fetcher),b=await make(fetcher);
    try{
        await a.core.handle({type:'chat.send',text:'我喜欢咖啡'});await a.core.waitForBackground();await a.core.handle({type:'pet.interact',interaction:'drag'});const backup=a.core.exportArchive();await b.core.importArchive(backup);await b.core.waitForBackground();assert.equal(b.core.getSnapshot().story!.goals.position.placements,1);assert.equal(b.core.getSnapshot().story!.goals.notebook.entries,1);assert.deepEqual(['trust','familiarity','self_awareness','exposure'].map(k=>relationship(b.dir)[k]),['trust','familiarity','self_awareness','exposure'].map(k=>relationship(a.dir)[k]));
        const old=b.core.getSnapshot().memories[0];time.advance(5);await b.core.handle({type:'memory.correct',id:old.id,text:'我现在喜欢乌龙茶'});await b.core.waitForBackground();assert.ok(b.core.getSnapshot().story!.recentEpisodes.some(e=>e.type==='E03'&&e.sourceIds.includes(old.id)&&e.historical));
        await b.core.handle({type:'memory.delete',id:old.id});const afterDelete=relationship(b.dir);await b.core.importArchive(backup);await b.core.waitForBackground();assert.equal(b.core.getSnapshot().story!.recentEpisodes.some(e=>e.sourceIds.includes(old.id)),false);assert.equal(b.core.getSnapshot().story!.goals.notebook.entries,0);assert.ok(relationship(b.dir).trust>=afterDelete.trust);assert.equal(b.core.exportArchive().includes('真实来源札记'),false);
    }finally{await a.core.close();await b.core.close();time.restore();await rm(a.dir,{recursive:true,force:true});await rm(b.dir,{recursive:true,force:true});}
});

test('bad story archives reject type collisions and unbounded moods before modifying records; clock rollback cannot trap cooldown',async()=>{
    const time=clock();const {core,dir}=await make(async(_url,init)=>dynamic(init)?reply():extraction());
    try{
        await core.handle({type:'chat.send',text:'你好'});await core.waitForBackground();await core.handle({type:'pet.interact',interaction:'drag'});const archive=JSON.parse(core.exportArchive()),before=core.exportArchive();archive.story.sources[0].id=archive.story.episodes[0].id;archive.story.episodes=[];await assert.rejects(core.importArchive(JSON.stringify(archive)));assert.equal(core.exportArchive(),before);
        const bad=JSON.parse(before);bad.story.state.mood.expiresAt=bad.story.state.mood.startedAt+600001;await assert.rejects(core.importArchive(JSON.stringify(bad)));
        const store=new Store(dir),story=new Story(store);const previous=time.now();time.set(previous-3600000);assert.ok(story.drag(story.source('drag',{actual:true}),true));assert.equal(story.snapshot().mood.expression,'curious');store.close();
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});
test('private transport dependencies cover old summaries, historical retrieval, selected episode sources and inherited raw-pair ancestry',async()=>{
    const time=clock();const {core,dir}=await make(async(_url,init)=>{const system=String(JSON.parse(String(init?.body)).messages[0].content);if(system.includes('把以下真实相处记录压缩'))return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"bounded fixture summary"}'}}]}));return dynamic(init)?reply():extraction();});
    try{
        const store=new Store(dir),story=new Story(store);const historicalUser=randomUUID(),historicalAssistant=randomUUID(),summaryUser=randomUUID(),episodeUser=randomUUID(),ancestorUser=randomUUID(),rawUser=randomUUID(),rawAssistant=randomUUID();const oldDate=new Date(Date.now()-36000000).toISOString();
        for(const id of [historicalUser,summaryUser,episodeUser,ancestorUser,rawUser])store.put('message',id,{id,role:'user',text:'fixture old source',source:'chat',createdAt:oldDate});
        for(const id of [historicalAssistant,rawAssistant])store.put('message',id,{id,role:'assistant',text:'fixture old completed reply',source:'chat',createdAt:oldDate});
        store.put('lineage','pair:'+historicalUser,{sourceId:historicalUser,assistantId:historicalAssistant});
        const historicalFact:MemoryItem={id:randomUUID(),kind:'fact',text:'以前喜欢咖啡',sourceId:historicalUser,createdAt:oldDate,valid:false,validFrom:oldDate,validTo:new Date(Date.now()-28800000).toISOString()};store.put('memory',historicalFact.id,historicalFact);store.index(historicalFact.id,historicalFact.text);store.vector(historicalFact.id,[1,0]);
        const episodeFact:MemoryItem={id:randomUUID(),kind:'fact',text:'我喜欢音乐',sourceId:episodeUser,createdAt:oldDate,valid:true};store.put('memory',episodeFact.id,episodeFact);store.index(episodeFact.id,episodeFact.text);store.vector(episodeFact.id,[0,1]);story.fact(episodeFact);
        const gesture=story.source('drag',{actualUserGesture:true});story.drag(gesture,false);
        for(let i=0;i<123;i++){const id=randomUUID();store.put('message',id,{id,role:i%2?'assistant':'user',text:'recent fixture record',source:'chat',createdAt:new Date(Date.now()-3600000+i).toISOString()});}
        store.put('summary','rollup',{text:'fixture old summary',sourceIds:[summaryUser]});store.put('transport','transport:'+rawAssistant,{assistantId:rawAssistant,userId:rawUser,sourceIds:[ancestorUser],provider:core.getSnapshot().provider,userMessage:{role:'user',content:'bounded raw pair'},assistantMessage:{role:'assistant',content:'{"text":"fixture"}',reasoning_content:'opaque short reasoning'}});store.close();
        await core.handle({type:'settings.update',settings:{reducedMotion:true}});assert.equal(core.getSnapshot().messages.some(m=>m.id===historicalUser||m.id===summaryUser||m.id===ancestorUser),false);
        await core.handle({type:'chat.send',text:'以前的咖啡偏好是什么'});await core.waitForBackground();const currentAssistant=core.getSnapshot().messages.at(-1)!.id;let inspected=new Store(dir);const transport=inspected.get<any>('transport:'+currentAssistant);for(const source of [historicalUser,historicalFact.id,summaryUser,episodeUser,episodeFact.id,gesture,ancestorUser])assert.ok(transport.sourceIds.includes(source),source);inspected.close();
        await core.handle({type:'memory.delete',id:historicalFact.id});inspected=new Store(dir);assert.equal(inspected.get('transport:'+currentAssistant),undefined);inspected.close();
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});
test('mood expiry and memory controls clear transient speech instead of replaying or retaining an old answer',async()=>{
    const time=clock();const {core,dir}=await make(async(_url,init)=>dynamic(init)?reply({text:'private coffee response'}):extraction(['我喜欢咖啡']));
    try{
        await core.handle({type:'chat.send',text:'我喜欢咖啡'});await core.waitForBackground();time.advance(600000);await core.tick();assert.equal(core.getSnapshot().visual.bubble,'');
        await core.handle({type:'chat.send',text:'继续咖啡这个话题'});await core.waitForBackground();assert.ok(core.getSnapshot().visual.bubble);
        const fact=core.getSnapshot().memories[0];await core.handle({type:'memory.correct',id:fact.id,text:'我现在喜欢茶'});await core.waitForBackground();assert.equal(core.getSnapshot().visual.bubble,'');assert.equal(core.getSnapshot().visual.action,'idle');
        await core.handle({type:'chat.send',text:'现在的偏好'});await core.waitForBackground();await core.handle({type:'memory.delete',id:core.getSnapshot().memories.find(m=>m.text==='我现在喜欢茶')!.id});assert.equal(core.getSnapshot().visual.bubble,'');
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});
