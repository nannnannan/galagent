import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CompanionService} from '../../runtime/core/companion';
import {Store} from '../../runtime/core/store';
type Job={id:string;kind:'extract'|'index';sourceIds:string[];state:string;attempts:number;nextAttemptAt:number};
const response=(output:unknown)=>new Response(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(output)}}]}));
const chat=()=>response({text:'一次真正完成的相遇',expression:'neutral',action:'idle',name:'星棱'});
const isExtraction=(init?:RequestInit)=>String(JSON.parse(String(init?.body)).messages[0].content).includes('facts每项');
const localEmbedding=()=>({encode:async(text:string)=>text.includes('咖啡')||text.includes('饮料')?[1,0]:[0,1],close:async()=>{}});
const until=async(predicate:()=>boolean)=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,2));}throw new Error('fixture wait timeout');};
function clock(){const original=Date.now;let now=original();Date.now=()=>now;return{advance:(ms:number)=>{now+=ms;},now:()=>now,restore:()=>{Date.now=original;}};}
function rows(dir:string){const store=new Store(dir);const jobs=store.all<Job>('work-job');store.close();return jobs;}
function held(signal?:AbortSignal|null){let resolve!: (r:Response)=>void;const promise=new Promise<Response>((ok,reject)=>{resolve=ok;const abort=()=>reject(new Error('fixture request aborted'));if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});return{promise,resolve};}
function markPending(dir:string){const store=new Store(dir);const job=store.all<Job>('work-job').find(j=>j.kind==='extract')!;store.put('work-job',job.id,{...job,state:'pending',attempts:0,nextAttemptAt:0});store.close();}

test('a cancelled extraction survives exit, resumes once after restart, and stores only source IDs in its checkpoint',async()=>{
    const time=clock(),dir=await mkdtemp(join(tmpdir(),'galagent-recovery-'));let active:ReturnType<typeof held>|undefined,calls=0;
    const credentials={get:async()=> 'fixture-only-key',set:async(_key:string)=>{}};
    const stalled:typeof fetch=async(_url,init)=>isExtraction(init)?(active=held(init?.signal),active.promise):chat();
    let core=new CompanionService({dataDir:dir,credentials,embeddings:localEmbedding(),fetch:stalled});
    try{
        await core.init();await core.handle({type:'chat.send',text:'我喜欢咖啡'});await until(()=>!!active);
        const messages=core.getSnapshot().messages;await core.close();const pending=rows(dir).find(j=>j.kind==='extract')!;
        assert.equal(pending.state,'pending');assert.deepEqual(pending.sourceIds,messages.map(m=>m.id));assert.equal(JSON.stringify(pending).includes('咖啡'),false);
        time.advance(6000);
        const resumed:typeof fetch=async(_url,init)=>{assert.ok(isExtraction(init));calls++;return response({facts:['我喜欢咖啡'],diary:'一次有来源的札记'});};
        core=new CompanionService({dataDir:dir,credentials,embeddings:localEmbedding(),fetch:resumed});await core.init();await core.waitForBackground();
        assert.equal(calls,1);assert.equal(core.getSnapshot().memories.length,1);assert.equal(core.getSnapshot().diary.length,1);assert.equal(rows(dir).find(j=>j.kind==='extract')!.state,'done');
        await core.close();core=new CompanionService({dataDir:dir,credentials,embeddings:localEmbedding(),fetch:resumed});await core.init();await core.waitForBackground();assert.equal(calls,1);assert.equal(core.getSnapshot().diary.length,1);
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('pending work waits for configured credentials and explicit config completion resumes it',async()=>{
    const time=clock(),dir=await mkdtemp(join(tmpdir(),'galagent-config-recovery-'));let key:string|undefined='fixture-only-key',active:ReturnType<typeof held>|undefined,calls=0;
    const credentials={get:async()=>key,set:async(value:string)=>{key=value||undefined;}};
    let core=new CompanionService({dataDir:dir,credentials,embeddings:localEmbedding(),fetch:async(_url,init)=>isExtraction(init)?(active=held(init?.signal),active.promise):chat()});
    try{
        await core.init();await core.handle({type:'chat.send',text:'我喜欢咖啡'});await until(()=>!!active);await core.close();time.advance(6000);key=undefined;
        core=new CompanionService({dataDir:dir,credentials,embeddings:localEmbedding(),fetch:async()=>{calls++;return response({facts:['我喜欢咖啡'],diary:'配置后续接'});}});await core.init();await core.waitForBackground();assert.equal(calls,0);
        await core.handle({type:'config.save',apiKey:'fixture-restored-key',baseUrl:'https://api.moonshot.cn/v1',model:'kimi-k3'});await core.waitForBackground();assert.equal(calls,1);assert.equal(core.getSnapshot().memories.length,1);
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('failed extraction has persistent exponential backoff, stops after three attempts, and never polls every tick',async()=>{
    const time=clock(),dir=await mkdtemp(join(tmpdir(),'galagent-bounded-retry-'));let attempts=0,failing=true;
    const credentials={get:async()=> 'fixture-only-key',set:async(_key:string)=>{}};
    const fetcher:typeof fetch=async(_url,init)=>{if(!isExtraction(init))return chat();attempts++;return failing?new Response('',{status:400}):response({facts:['我喜欢咖啡'],diary:''});};
    let core=new CompanionService({dataDir:dir,credentials,embeddings:localEmbedding(),fetch:fetcher});
    try{
        await core.init();await core.handle({type:'chat.send',text:'我喜欢咖啡'});await core.waitForBackground();assert.equal(attempts,1);assert.equal(rows(dir)[0].nextAttemptAt,time.now()+60000);
        for(let i=0;i<10;i++)await core.tick();await core.waitForBackground();assert.equal(attempts,1);
        time.advance(60000);await core.tick();await core.waitForBackground();assert.equal(attempts,2);assert.equal(rows(dir)[0].nextAttemptAt,time.now()+120000);
        time.advance(120000);await core.tick();await core.waitForBackground();assert.equal(attempts,3);assert.equal(rows(dir)[0].state,'failed');
        time.advance(3600000);await core.tick();await core.waitForBackground();assert.equal(attempts,3);
        await core.close();core=new CompanionService({dataDir:dir,credentials,embeddings:localEmbedding(),fetch:fetcher});await core.init();await core.waitForBackground();assert.equal(attempts,3);assert.ok(core.getSnapshot().status.tasks.some(task=>task.state==='failed'&&task.detail?.includes('连接设置')));
        failing=false;await core.handle({type:'config.save',apiKey:'fixture-retry-key',baseUrl:'https://api.moonshot.cn/v1',model:'kimi-k3'});await core.waitForBackground();assert.equal(attempts,4);assert.equal(rows(dir).find(j=>j.kind==='extract')!.state,'done');assert.equal(rows(dir).find(j=>j.kind==='extract')!.attempts,1);assert.equal(core.getSnapshot().memories.length,1);
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('deleting a source aborts and removes its pending extraction; reopening cannot resurrect it',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'galagent-delete-job-'));let pending:ReturnType<typeof held>|undefined,stall=false,calls=0;
    const credentials={get:async()=> 'fixture-only-key',set:async(_key:string)=>{}};
    const fetcher:typeof fetch=async(_url,init)=>{if(!isExtraction(init))return chat();calls++;if(stall){pending=held(init?.signal);return pending.promise;}return response({facts:['我喜欢咖啡'],diary:'旧札记'});};
    let core=new CompanionService({dataDir:dir,credentials,embeddings:localEmbedding(),fetch:fetcher});
    try{
        await core.init();await core.handle({type:'chat.send',text:'我喜欢咖啡'});await core.waitForBackground();const fact=core.getSnapshot().memories[0];markPending(dir);stall=true;await core.tick();await until(()=>!!pending);
        await core.handle({type:'memory.delete',id:fact.id});await core.waitForBackground();assert.equal(rows(dir).some(j=>j.kind==='extract'),false);assert.equal(core.getSnapshot().diary.length,0);
        const count=calls;await core.close();core=new CompanionService({dataDir:dir,credentials,embeddings:localEmbedding(),fetch:fetcher});await core.init();await core.waitForBackground();assert.equal(calls,count);assert.equal(core.getSnapshot().memories.length,0);
    }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});

test('recovery never duplicates sourced facts or diary and cannot revive a corrected fact',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'galagent-correct-job-'));let pending:ReturnType<typeof held>|undefined,stall=false;
    const fetcher:typeof fetch=async(_url,init)=>{if(!isExtraction(init))return chat();if(stall){pending=held(init?.signal);return pending.promise;}return response({facts:['我叫黄','我喜欢咖啡'],diary:'保留初遇的札记'});};
    const core=new CompanionService({dataDir:dir,credentials:{get:async()=> 'fixture-only-key',set:async()=>{}},embeddings:localEmbedding(),fetch:fetcher});
    try{
        await core.init();await core.handle({type:'chat.send',text:'我叫黄，我喜欢咖啡'});await core.waitForBackground();const original=core.getSnapshot();markPending(dir);stall=true;await core.tick();await until(()=>!!pending);
        await core.handle({type:'memory.correct',id:original.memories.find(m=>m.text==='我喜欢咖啡')!.id,text:'我现在喜欢乌龙茶'});
        pending!.resolve(response({facts:['我叫黄','喜欢咖啡'],diary:'不应覆盖旧札记'}));await core.waitForBackground();
        assert.deepEqual(core.getSnapshot().memories.map(m=>m.text).sort(),['我叫黄','我现在喜欢乌龙茶'].sort());assert.equal(core.getSnapshot().diary.length,1);assert.equal(core.getSnapshot().diary[0].text,'保留初遇的札记');assert.equal(rows(dir).find(j=>j.kind==='extract')!.state,'done');
    }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});

test('restoring different text into the same source ID discards an old extraction response and resumes using the new text',async()=>{
    const time=clock(),dir=await mkdtemp(join(tmpdir(),'galagent-source-revision-'));let pending:ReturnType<typeof held>|undefined,stall=true;const sent:string[]=[];
    const fetcher:typeof fetch=async(_url,init)=>{if(!isExtraction(init))return chat();const user=JSON.parse(JSON.parse(String(init?.body)).messages[1].content).user;sent.push(user);if(stall){pending=held(init?.signal);return pending.promise;}return response({facts:[user],diary:'新的来源札记'});};
    const core=new CompanionService({dataDir:dir,credentials:{get:async()=> 'fixture-only-key',set:async()=>{}},embeddings:localEmbedding(),fetch:fetcher});
    try{
        await core.init();await core.handle({type:'chat.send',text:'我喜欢咖啡'});await until(()=>!!pending);
        const archive=JSON.parse(core.exportArchive());archive.messages.find((m:any)=>m.role==='user').text='我喜欢乌龙茶';await core.importArchive(JSON.stringify(archive));
        pending!.resolve(response({facts:['我喜欢咖啡'],diary:'旧来源结果'}));await core.waitForBackground();assert.equal(core.getSnapshot().memories.length,0);assert.equal(core.getSnapshot().diary.length,0);assert.equal(rows(dir).find(j=>j.kind==='extract')!.state,'pending');
        stall=false;time.advance(5000);await core.tick();await core.waitForBackground();assert.deepEqual(sent,['我喜欢咖啡','我喜欢乌龙茶']);assert.equal(core.getSnapshot().memories[0].text,'我喜欢乌龙茶');
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('a stale in-flight vector is not committed after same-ID text restoration',async()=>{
    const time=clock(),dir=await mkdtemp(join(tmpdir(),'galagent-index-revision-'));let finish:((v:number[])=>void)|undefined;const encoded:string[]=[];
    const embedding={encode:async(text:string)=>{encoded.push(text);return encoded.length===1?await new Promise<number[]>(r=>finish=r):[0,1];},close:async()=>{finish?.([1,0]);}};
    const core=new CompanionService({dataDir:dir,credentials:{get:async()=>undefined,set:async()=>{}},embeddings:embedding,fetch:async()=>{throw new Error('unexpected API call');}});
    try{
        await core.init();await core.handle({type:'memory.remember',text:'我喜欢咖啡'});await until(()=>!!finish);const archive=JSON.parse(core.exportArchive()),id=archive.memories[0].id;archive.memories[0].text='我喜欢乌龙茶';archive.messages[0].text='我喜欢乌龙茶';await core.importArchive(JSON.stringify(archive));finish!([1,0]);await core.waitForBackground();
        let store=new Store(dir);assert.equal(store.hasVector(id),false);store.close();time.advance(5000);await core.tick();await core.waitForBackground();assert.deepEqual(encoded,['我喜欢咖啡','我喜欢乌龙茶']);store=new Store(dir);assert.deepEqual(store.vectors()[0].values,[0,1]);store.close();
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});

test('startup repairs a legacy fact with no vector without re-extracting legacy conversations',async()=>{
    const time=clock(),dir=await mkdtemp(join(tmpdir(),'galagent-legacy-index-'));let rejectIndex:((error:Error)=>void)|undefined,apiCalls=0;
    const credentials={get:async()=>undefined,set:async()=>{}};
    const fetcher:typeof fetch=async()=>{apiCalls++;throw new Error('legacy conversations must not trigger API');};
    let core=new CompanionService({dataDir:dir,credentials,embeddings:{encode:async()=>await new Promise<number[]>((_,reject)=>rejectIndex=reject),close:async()=>{rejectIndex?.(new Error('fixture closed'));}},fetch:fetcher});
    try{
        await core.init();const archive=JSON.parse(core.exportArchive()),userId=randomUUID(),assistantId=randomUUID(),memoryId=randomUUID(),createdAt=new Date().toISOString();archive.messages=[{id:userId,role:'user',text:'我喜欢咖啡',createdAt,source:'chat'},{id:assistantId,role:'assistant',text:'旧的已完成会话',createdAt,source:'chat'}];archive.memories=[{id:memoryId,kind:'fact',text:'我喜欢咖啡',sourceId:userId,createdAt,valid:true}];await core.importArchive(JSON.stringify(archive));await until(()=>!!rejectIndex);await core.close();
        const store=new Store(dir);for(const job of store.all<Job>('work-job'))store.remove(job.id);assert.equal(store.hasVector(memoryId),false);store.close();time.advance(6000);
        core=new CompanionService({dataDir:dir,credentials,embeddings:localEmbedding(),fetch:fetcher});await core.init();await core.waitForBackground();assert.equal(apiCalls,0);assert.equal(core.getSnapshot().messages.length,2);assert.equal((await core.retrieve('饮料偏好'))[0].id,memoryId);const repaired=new Store(dir);assert.equal(repaired.hasVector(memoryId),true);assert.equal(repaired.all<Job>('work-job').some(j=>j.kind==='extract'),false);repaired.close();
    }finally{await core.close();time.restore();await rm(dir,{recursive:true,force:true});}
});
test('invalid extraction shapes remain recoverable and only a complete valid empty result finishes the checkpoint',async()=>{
    const time=clock();
    const invalid:unknown[]=[null,17,[],{facts:'invalid',diary:17},{text:'missing-fields'},{facts:[],diary:17},{facts:[''],diary:''},{facts:['a'],diary:''},{facts:['x'.repeat(301)],diary:''},{facts:['合法事实','合法事实','合法事实','合法事实'],diary:''},{facts:[],diary:'星'.repeat(701)},{facts:[]}];
    try{for(const shape of invalid){
        const dir=await mkdtemp(join(tmpdir(),'galagent-recovery-shape-'));let output=shape,calls=0;
        const core=new CompanionService({dataDir:dir,credentials:{get:async()=> 'fixture-only-key',set:async()=>{}},embeddings:localEmbedding(),fetch:async(_url,init)=>{if(!isExtraction(init))return chat();calls++;return response(output);}});
        try{
            await core.init();await core.handle({type:'chat.send',text:'我喜欢咖啡'});await core.waitForBackground();assert.equal(rows(dir)[0].state,'pending',JSON.stringify(shape));assert.equal(rows(dir)[0].attempts,1);assert.equal(core.getSnapshot().memories.length,0);assert.equal(core.getSnapshot().diary.length,0);
            time.advance(60000);output={facts:[],diary:''};await core.tick();await core.waitForBackground();assert.equal(rows(dir)[0].state,'done');assert.equal(calls,2);assert.equal(core.getSnapshot().memories.length,0);
        }finally{await core.close();await rm(dir,{recursive:true,force:true});}
    }}finally{time.restore();}
});

