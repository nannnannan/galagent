import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService, CONTEXT_BUDGET } from '../../runtime/core/companion';
import { Store } from '../../runtime/core/store';
import { randomUUID } from 'node:crypto';
const local = () => ({ get: async () => 'test-secret-never-persist', set: async (_key: string) => { } });
const embeddings = () => ({ encode: async (text: string) => text.includes('咖啡') || text.includes('提神') ? [1, 0] : [0, 1], close: async () => { } });
const reply = (text = '今天也在。', extra = {}) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text, expression: 'neutral', action: 'idle', name: '星棱', ...extra }) } }] }), { status: 200 });
const isMemoryRequest=(init?:RequestInit)=>String(JSON.parse(String(init?.body)).messages[0].content).includes('facts每项');
const emptyMemory=()=>new Response(JSON.stringify({choices:[{message:{content:'{"facts":[],"diary":""}'}}]}));
const fixtureFetch:typeof fetch=async(_url,init)=>isMemoryRequest(init)?emptyMemory():reply();
async function setup(fetcher: typeof fetch = fixtureFetch) { const dir = await mkdtemp(join(tmpdir(), 'galagent-test-')); const core = new CompanionService({ dataDir: dir, credentials: local(), embeddings: embeddings(), fetch: fetcher }); await core.init(); return { core, dir, cleanup: async () => { await core.close(); await rm(dir, { recursive: true, force: true }); } }; }
test('explicit facts survive restart and semantic paraphrase; corrected/deleted backup cannot resurrect', async () => {
    const { core, dir } = await setup();
    await core.handle({ type: 'memory.remember', text: '我喜欢不加糖的咖啡' });
    await core.waitForBackground();
    assert.equal((await core.retrieve('什么饮料帮我提神'))[0].text, '我喜欢不加糖的咖啡');
    const archive = core.exportArchive();
    const id = core.getSnapshot().memories[0].id;
    await core.handle({ type: 'memory.correct', id, text: '我现在喜欢乌龙茶' });
    await core.waitForBackground();
    assert.deepEqual(core.getSnapshot().memories.map(m => m.text), ['我现在喜欢乌龙茶']);
    await core.importArchive(archive);
    await core.waitForBackground();
    assert.equal(core.getSnapshot().memories.some(m => m.text.includes('咖啡')), false);
    await core.close();
    const restarted = new CompanionService({ dataDir: dir, credentials: local(), embeddings: embeddings(), fetch:fixtureFetch });
    await restarted.init();
    assert.deepEqual(restarted.getSnapshot().memories.map(m => m.text), ['我现在喜欢乌龙茶']);
    assert.equal(restarted.exportArchive().includes('test-secret'), false);
    await restarted.close();
    await rm(dir, { recursive: true, force: true });
});
test('the active character card names the identity on first contact; unknown sources rejected', async () => {
    let bad = false;
    const { core, cleanup } = await setup(async (_url,init) => isMemoryRequest(init)?emptyMemory():reply('认识你了。', bad ? { sourceIds: ['invented-id'] } : {}));
    assert.equal((await core.handle({ type: 'chat.send', text: '我是黄' })).ok, true);
    await core.waitForBackground();
    assert.equal(core.getSnapshot().identity.name, core.getSnapshot().persona!.active.name);
    assert.equal(core.getSnapshot().identity.onboarding, 'ready');
    const count = core.getSnapshot().messages.length;
    bad = true;
    assert.equal((await core.handle({ type: 'chat.send', text: '你记得什么' })).ok, false);
    assert.equal(core.getSnapshot().messages.length, count);
    await cleanup();
});
test('unconfigured provider generates no counterfeit character response', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'galagent-test-'));
    const core = new CompanionService({ dataDir: dir, credentials: { get: async () => undefined, set: async () => { } }, embeddings: embeddings(), fetch:fixtureFetch });
    await core.init();
    assert.equal((await core.handle({ type: 'chat.send', text: '你好' })).ok, false);
    assert.equal(core.getSnapshot().messages.length, 0);
    await core.close();
    await rm(dir, { recursive: true, force: true });
});
test('quiet cancels in-flight initiative and suppresses late response; busy/fullscreen/stale do not generate', async () => {
    let calls = 0;
    let resolve: ((response: Response) => void) | undefined;
    const { core, cleanup } = await setup(async () => { calls++; if (calls === 1)
        return reply(); if (calls === 2)
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"facts":[],"diary":""}' } }] })); return await new Promise<Response>(r => { resolve = r; }); });
    await core.handle({ type: 'chat.send', text: '你好' });
    await core.waitForBackground();
    await core.handle({ type: 'settings.update', settings: { observationEnabled: true } });
    core.setObservation({ available: true, observedAt: new Date().toISOString(), idleSeconds: 2 });
    await core.tick();
    assert.equal(calls, 2);
    core.setObservation({ available: true, observedAt: new Date().toISOString(), idleSeconds: 600, fullscreen: true });
    await core.tick();
    assert.equal(calls, 2);
    core.setObservation({ available: true, observedAt: new Date(Date.now() - 60000).toISOString(), idleSeconds: 600 });
    await core.tick();
    assert.equal(calls, 2);
    core.setObservation({ available: true, observedAt: new Date().toISOString(), idleSeconds: 600 });
    const pending = core.tick();
    for (let i = 0; i < 30 && !resolve; i++)
        await new Promise(r => setTimeout(r, 5));
    await core.handle({ type: 'settings.update', settings: { quietUntil: Date.now() + 3600000 } });
    resolve!(reply('late response'));
    await pending;
    assert.equal(core.getSnapshot().messages.some(m => m.text === 'late response'), false);
    assert.equal(core.getSnapshot().status.busy, false);
    await cleanup();
});
test('context is bounded independently of archive size', async () => {
    const contexts: string[] = [];
    const { core, cleanup } = await setup(async (_url, init) => { if(isMemoryRequest(init))return emptyMemory();const body = JSON.parse(String(init?.body)); contexts.push(JSON.stringify(body.messages)); return reply(); });
    for (let i = 0; i < 50; i++)
        await core.handle({ type: 'memory.remember', text: `记录${i}：` + '星'.repeat(100) });
    await core.waitForBackground();
    await core.handle({ type: 'chat.send', text: '你好' });
    assert.ok(core.getSnapshot().status.contextTokens <= 6000);
    assert.ok(contexts[0].length < core.exportArchive().length);
    await core.waitForBackground();
    await cleanup();
});
test('background facts require direct user evidence, diary stays separate, deletion removes derived history', async () => {
    const { core, cleanup } = await setup(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (String(body.messages[0].content).includes('facts每项')) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ facts: ['我喜欢咖啡', '我住在月球'], diary: '今天的相处让我有些高兴。' }) } }] }));
        return reply('我会记下咖啡这件事。');
    });
    await core.handle({ type: 'chat.send', text: '我喜欢咖啡' });
    await core.waitForBackground();
    assert.deepEqual(core.getSnapshot().memories.map(m => m.text), ['我喜欢咖啡']);
    assert.equal(core.getSnapshot().diary.length, 1);
    await core.handle({ type: 'memory.delete', id: core.getSnapshot().memories[0].id });
    assert.equal(core.getSnapshot().diary.length, 0);
    assert.equal(core.getSnapshot().messages.length, 0);
    assert.equal(core.exportArchive().includes('咖啡'), false);
    await cleanup();
});
test('unknown source cannot reference internal identity record and malformed archive does not change state', async () => {
    const { core, cleanup } = await setup(async (_url,init) => isMemoryRequest(init)?emptyMemory():reply('answer', { sourceIds: ['identity'] }));
    assert.equal((await core.handle({ type: 'chat.send', text: '你好' })).ok, false);
    assert.equal(core.getSnapshot().identity.onboarding, 'intro');
    const archive = JSON.parse(core.exportArchive()); archive.messages.push({ id: 'settings', text: 'malicious', role: 'user', source: 'chat', createdAt: new Date().toISOString() });
    await assert.rejects(core.importArchive(JSON.stringify(archive)));
    assert.equal(core.getSnapshot().messages.length, 0); await cleanup();
});
test('quiet suppresses tap/drag scene generation; late scene cannot restore bubble or mischief', async () => {
    let calls = 0, deliver: ((response:Response)=>void)|undefined;
    const {core,cleanup} = await setup(async (_url,init) => {
        calls++; const body = JSON.parse(String(init?.body));
        if (String(body.messages[0].content).includes('facts每项')) return new Response(JSON.stringify({choices:[{message:{content:'{"facts":[],"diary":""}'}}]}));
        if (calls === 1) return reply();
        return await new Promise<Response>(r=>{deliver=r;});
    });
    await core.handle({type:'chat.send',text:'你好'}); await core.waitForBackground();
    const pending = core.handle({type:'pet.interact',interaction:'tap'});
    for(let i=0;i<30&&!deliver;i++) await new Promise(r=>setTimeout(r,5));
    await core.handle({type:'settings.update',settings:{quietUntil:Date.now()+3600000}});
    deliver!(reply('晚到的scene',{action:'doodle'})); await pending;
    assert.equal(core.getSnapshot().visual.bubble,''); assert.equal(core.getSnapshot().visual.action,'idle');
    const count=calls; await core.handle({type:'pet.interact',interaction:'tap'}); await core.handle({type:'pet.interact',interaction:'drag'}); assert.equal(calls,count);
    await core.handle({type:'settings.update',settings:{quietUntil:0}});
    deliver=undefined; const scene=core.handle({type:'pet.interact',interaction:'tap'}); for(let i=0;i<30&&!deliver;i++) await new Promise(r=>setTimeout(r,5));
    deliver!(reply('小动作',{action:'sulk'})); await scene; assert.equal(core.getSnapshot().visual.action,'sulk');
    await core.handle({type:'settings.update',settings:{mischiefEnabled:false}}); assert.equal(core.getSnapshot().visual.action,'idle'); assert.equal(core.getSnapshot().visual.bubble,''); await cleanup();
});
test('cancel resolves while semantic query is still pending and does not start provider', async () => {
    const dir=await mkdtemp(join(tmpdir(),'galagent-test-')); let complete:((v:number[])=>void)|undefined, calls=0;
    const core=new CompanionService({dataDir:dir,credentials:local(),embeddings:{encode:async (_text,query)=>query?await new Promise<number[]>(r=>complete=r):[1,0],close:async()=>{}},fetch:async(_url,init)=>{calls++;return isMemoryRequest(init)?emptyMemory():reply();}});
    await core.init(); await core.handle({type:'memory.remember',text:'我喜欢咖啡'}); await core.waitForBackground();
    const pending=core.handle({type:'chat.send',text:'我喜欢什么饮料'}); for(let i=0;i<30&&!complete;i++) await new Promise(r=>setTimeout(r,5));
    await core.handle({type:'chat.cancel'});
    const result=await Promise.race([pending,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('cancel stalled')),100))]); assert.equal(result.ok,false); assert.equal(calls,0);
    complete!([1,0]); await new Promise(r=>setTimeout(r,10)); assert.equal(calls,0); assert.equal(core.getSnapshot().status.busy,false); await core.close(); await rm(dir,{recursive:true,force:true});
});
test('archive rejects cross-kind and duplicate IDs before writes, permits same-kind restore, propagates deletion between devices', async () => {
    const a=await setup(),b=await setup(); await a.core.handle({type:'memory.remember',text:'唯一私密咖啡偏好'}); await a.core.waitForBackground(); const clean=a.core.exportArchive();
    const collision=JSON.parse(clean); collision.memories[0].id=collision.messages[0].id;
    await assert.rejects(a.core.importArchive(JSON.stringify(collision))); assert.equal(a.core.getSnapshot().memories.length,1);
    const duplicate=JSON.parse(clean); duplicate.messages.push(duplicate.messages[0]); await assert.rejects(a.core.importArchive(JSON.stringify(duplicate)));
    const existing=JSON.parse(clean); existing.messages=[]; existing.memories[0].id=existing.memories[0].sourceId; await assert.rejects(a.core.importArchive(JSON.stringify(existing)));
    await a.core.importArchive(clean); await a.core.waitForBackground(); assert.equal(a.core.getSnapshot().memories.length,1);
    await b.core.importArchive(clean); await b.core.waitForBackground(); await b.core.handle({type:'memory.delete',id:b.core.getSnapshot().memories[0].id});
    await a.core.importArchive(b.core.exportArchive()); assert.equal(a.core.getSnapshot().memories.length,0); assert.equal(a.core.exportArchive().includes('私密咖啡'),false); assert.equal((await a.core.retrieve('咖啡')).length,0);
    await a.cleanup();await b.cleanup();
});
test('user and background tokens do not consume initiative allowance; actual initiative usage persists and resets next local day', async () => {
    const dir=await mkdtemp(join(tmpdir(),'galagent-budget-')); const originalNow=Date.now;
    let now=new Date().setHours(12,0,0,0), initiativeCalls=0;
    Date.now=()=>now;
    const fetcher:typeof fetch=async(_url,init)=>{
        const body=JSON.parse(String(init?.body)), system=String(body.messages[0].content);
        const initiative=system.includes('"scene":"initiative"'); if(initiative) initiativeCalls++;
        const content=system.includes('facts每项')?JSON.stringify({facts:[],diary:''}):JSON.stringify({text:'真实模型回应',expression:'neutral',action:'idle',name:'星棱'});
        return new Response(JSON.stringify({choices:[{message:{content}}],usage:{total_tokens:initiative?20000:30000}}));
    };
    const create=async()=>{const c=new CompanionService({dataDir:dir,credentials:local(),embeddings:embeddings(),fetch:fetcher});await c.init();return c;};
    let core=await create();
    try {
        await core.handle({type:'chat.send',text:'你好'});await core.waitForBackground(); assert.ok(core.getSnapshot().stats.tokensToday>=60000);
        await core.handle({type:'settings.update',settings:{observationEnabled:true}});
        core.setObservation({available:true,observedAt:new Date(now).toISOString(),idleSeconds:600}); await core.tick(); assert.equal(initiativeCalls,1);
        now+=45*60000; core.setObservation({available:true,observedAt:new Date(now).toISOString(),idleSeconds:600}); await core.tick(); assert.equal(initiativeCalls,1);
        assert.equal((await core.handle({type:'chat.send',text:'继续聊天'})).ok,true);await core.waitForBackground();
        await core.close();core=await create();core.setObservation({available:true,observedAt:new Date(now).toISOString(),idleSeconds:600});await core.tick();assert.equal(initiativeCalls,1);
        now+=24*3600000;core.setObservation({available:true,observedAt:new Date(now).toISOString(),idleSeconds:600});await core.tick();assert.equal(initiativeCalls,2);assert.equal(core.getSnapshot().stats.tokensToday,20000);
    } finally { Date.now=originalNow;await core.close();await rm(dir,{recursive:true,force:true}); }
});
test('12000-character ASCII chat can fit the context budget and restore; over-budget Chinese fails without truncating or persisting', async () => {
    let calls=0;
    const {core,cleanup}=await setup(async(_url,init)=>{calls++;return isMemoryRequest(init)?emptyMemory():reply();});
    const ascii='a'.repeat(12000);
    assert.equal((await core.handle({type:'chat.send',text:ascii})).ok,true);await core.waitForBackground();
    assert.equal(core.getSnapshot().messages[0].text.length,12000);assert.ok(core.getSnapshot().status.contextTokens<=CONTEXT_BUDGET);
    const archive=core.exportArchive();await core.importArchive(archive);await core.waitForBackground();assert.equal(core.getSnapshot().messages[0].text,ascii);
    const count=calls, messages=core.getSnapshot().messages.length;
    const result=await core.handle({type:'chat.send',text:'星'.repeat(12000)});assert.equal(result.ok,true,'a maximal Chinese message fits the larger budget');await core.waitForBackground();assert.ok(core.getSnapshot().status.contextTokens<=CONTEXT_BUDGET);assert.ok(calls>count);assert.equal(core.getSnapshot().messages.length,messages+2);assert.equal(core.getSnapshot().status.busy,false);
    assert.equal((await core.handle({type:'chat.send',text:'a'.repeat(12001)})).ok,false);
    assert.equal((await core.handle({type:'chat.send',text:'短消息重试'})).ok,true);await core.waitForBackground();await cleanup();
});
test('K3 sends supported low-reasoning parameters and replays the complete private assistant protocol message', async () => {
    const requests:any[]=[];let turn=0;
    const raw={role:'assistant',content:JSON.stringify({text:'只展示这句话',expression:'neutral',action:'idle',name:'星棱'}),reasoning_content:'private-reasoning-sentinel',opaque_signature:{bytes:'opaque-value',nested:[1,2,3]}};
    const {core,dir,cleanup}=await setup(async(_url,init)=>{
        const body=JSON.parse(String(init?.body));
        if(String(body.messages[0].content).includes('facts每项'))return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'{"facts":["我喜欢咖啡"],"diary":""}'}}]}));
        requests.push(body);turn++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:turn===1?raw:{...raw,reasoning_content:'later-private-only'}}]}));
    });
    await core.handle({type:'chat.send',text:'我喜欢咖啡'});await core.waitForBackground();await core.handle({type:'chat.send',text:'你好'});await core.waitForBackground();
    assert.equal(requests[0].reasoning_effort,'low');assert.equal(requests[0].max_completion_tokens,4096);assert.equal(requests[0].response_format.type,'json_object');assert.equal('temperature'in requests[0],false);assert.equal('top_p'in requests[0],false);assert.equal('max_tokens'in requests[0],false);assert.equal('thinking'in requests[0],false);
    assert.deepEqual(requests[1].messages.find((m:any)=>m.role==='assistant'),raw);
    assert.equal(JSON.stringify(core.getSnapshot()).includes('private-reasoning-sentinel'),false);assert.equal(core.exportArchive().includes('private-reasoning-sentinel'),false);assert.equal(core.exportArchive().includes('opaque-value'),false);
    const store=new Store(dir);assert.equal(store.all('transport').length,2);store.close();
    await core.handle({type:'memory.delete',id:core.getSnapshot().memories[0].id});const deletedStore=new Store(dir);assert.equal(deletedStore.all('transport').length,0);deletedStore.close();
    await core.handle({type:'chat.send',text:'再见'});await core.waitForBackground();assert.equal(requests[2].messages.some((m:any)=>m.role==='assistant'),false);await cleanup();
});
test('raw thinking tokens consume context allowance and pairs are omitted whole rather than truncated', async () => {
    const contexts:any[]=[];let turn=0;
    const raw={role:'assistant',content:JSON.stringify({text:'可见短句',expression:'neutral',action:'idle',name:'星棱'}),reasoning_content:'星'.repeat(CONTEXT_BUDGET + 2000),opaque_field:'untouched'};
    const {core,cleanup}=await setup(async(_url,init)=>{const body=JSON.parse(String(init?.body));if(String(body.messages[0].content).includes('facts每项'))return new Response(JSON.stringify({choices:[{message:{content:'{"facts":[],"diary":""}'}}]}));contexts.push(body.messages);return new Response(JSON.stringify({choices:[{message:++turn===1?raw:{...raw,reasoning_content:'small'}}]}));});
    await core.handle({type:'chat.send',text:'必须整对裁剪的原问题'});await core.waitForBackground();await core.handle({type:'chat.send',text:'第二问'});await core.waitForBackground();
    assert.equal(contexts[1].filter((m:any)=>m.role==='assistant').length,0);assert.equal(contexts[1].filter((m:any)=>m.role==='user').length,1);assert.equal(JSON.stringify(contexts[1]).includes('星'.repeat(100)),false);assert.ok(core.getSnapshot().status.contextTokens<=CONTEXT_BUDGET);
    const archive=core.exportArchive();await core.importArchive(archive);await core.waitForBackground();await core.handle({type:'chat.send',text:'恢复后的第三问'});await core.waitForBackground();assert.equal(contexts[2].filter((m:any)=>m.role==='assistant').length,0);assert.match(contexts[2][0].content,/visibleHistoryData/);await cleanup();
});
test('non-K3 omits K3-only knobs, and truncated/empty thinking output has an actionable error', async () => {
    const requests:any[]=[];let truncated=true;
    const {core,cleanup}=await setup(async(_url,init)=>{if(isMemoryRequest(init))return emptyMemory();requests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{finish_reason:truncated?'length':'stop',message:{role:'assistant',content:'',reasoning_content:'budget spent'}}]}));});
    await core.handle({type:'config.save',baseUrl:'https://api.moonshot.cn/v1',model:'kimi-k2.6'});
    const result=await core.handle({type:'chat.send',text:'你好'});assert.equal(result.ok,false);assert.match(result.error||'',/截断.*输出预算/);assert.equal(requests[0].max_tokens,900);assert.equal('reasoning_effort'in requests[0],false);assert.equal('max_completion_tokens'in requests[0],false);assert.equal('temperature'in requests[0],false);
    truncated=false;const empty=await core.handle({type:'chat.send',text:'重试'});assert.match(empty.error||'',/输出预算.*思考/);assert.equal(core.getSnapshot().messages.length,0);await cleanup();
});
test('correcting one sourced fact preserves the first encounter, sibling facts and diary while retaining historical validity', async () => {
    const {core,dir,cleanup}=await setup(async(_url,init)=>{
        const body=JSON.parse(String(init?.body));
        if(String(body.messages[0].content).includes('facts每项'))return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:['我叫林','我喜欢咖啡'],diary:'初次相遇的感受留在札记里。'})}}]}));
        return reply('初次认识你。');
    });
    await core.handle({type:'chat.send',text:'我叫林，我喜欢咖啡'});await core.waitForBackground();
    const original=core.getSnapshot(),old=original.memories.find(m=>m.text==='我喜欢咖啡')!,name=original.memories.find(m=>m.text==='我叫林')!,backup=core.exportArchive();
    await new Promise(r=>setTimeout(r,5));
    assert.equal((await core.handle({type:'memory.correct',id:old.id,text:'我现在喜欢乌龙茶'})).ok,true);await core.waitForBackground();
    const updated=core.getSnapshot(),replacement=updated.memories.find(m=>m.text==='我现在喜欢乌龙茶')!;
    assert.ok(updated.messages.some(m=>m.id===original.messages[0].id));assert.ok(updated.messages.some(m=>m.id===original.messages[1].id));assert.ok(updated.memories.some(m=>m.id===name.id));assert.equal(updated.diary[0].id,original.diary[0].id);assert.equal(updated.identity.name,original.identity.name);assert.equal(replacement.supersedes,old.id);
    const store=new Store(dir),historical=store.get<any>(old.id);assert.equal(historical.valid,false);assert.ok(historical.validTo);assert.equal(store.all('transport').length,0);store.close();
    assert.equal((await core.retrieve('咖啡')).some(m=>m.id===old.id),false);
    const past=await core.retrieve('咖啡',{before:old.validFrom||old.createdAt});assert.ok(past.some(m=>m.id===old.id&&m.valid===false&&!!m.validTo));
    assert.ok((await core.retrieve('咖啡',{includeHistorical:true})).some(m=>m.id===old.id));
    await core.importArchive(backup);await core.waitForBackground();assert.equal(core.getSnapshot().memories.some(m=>m.id===old.id),false);assert.ok(core.getSnapshot().memories.some(m=>m.id===name.id));
    await core.handle({type:'memory.delete',id:replacement.id});await core.importArchive(backup);await core.waitForBackground();assert.equal(core.getSnapshot().memories.some(m=>m.id===old.id),false);assert.ok(core.getSnapshot().memories.some(m=>m.id===name.id));assert.ok(core.getSnapshot().messages.some(m=>m.id===original.messages[0].id));
    const ledger=JSON.parse(core.exportArchive()).correctionLedger;assert.equal(ledger[0].oldId,old.id);assert.equal(ledger[0].replacementId,replacement.id);await cleanup();
});

test('incremental summaries cover old records once, update after four turns and retain their checkpoint across restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'galagent-rollup-'));
    const batches: {previous:string;messages:{id:string;text:string}[]}[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body)), system = String(body.messages[0].content);
        if (system.includes('facts每项')) return new Response(JSON.stringify({choices:[{message:{content:'{"facts":[],"diary":""}'}}]}));
        if (system.includes('压缩为短摘要')) {
            batches.push(JSON.parse(body.messages.at(-1).content));
            return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:`已处理第${batches.length}批旧记录`})}}]}));
        }
        return reply('短回答');
    };
    const create = async () => { const core = new CompanionService({dataDir:dir,credentials:local(),embeddings:embeddings(),fetch:fetcher}); await core.init(); return core; };
    let core = await create();
    try {
        for (let turn = 1; turn <= 40; turn++) {
            assert.equal((await core.handle({type:'chat.send',text:`第${turn}轮相处`})).ok,true);
            await core.waitForBackground();
            assert.equal(batches.length, turn < 12 ? 0 : 1 + Math.floor((turn - 12) / 4));
        }
        const history = JSON.parse(core.exportArchive()).messages;
        const covered = batches.flatMap(batch => batch.messages.map(message => message.id));
        assert.deepEqual(covered, history.slice(0,-12).map((message:any) => message.id));
        assert.equal(new Set(covered).size,covered.length);
        assert.equal(batches[0].previous,'');
        assert.equal(batches[1].previous,'已处理第1批旧记录');
        await core.close(); core = await create();
        for (let turn=41;turn<=44;turn++) {
            assert.equal((await core.handle({type:'chat.send',text:`第${turn}轮相处`})).ok,true);
            await core.waitForBackground();
            assert.equal(batches.length,turn<44?8:9);
        }
        assert.equal(batches.at(-1)!.previous,'已处理第8批旧记录');
    } finally { await core.close(); await rm(dir,{recursive:true,force:true}); }
});

test('summary requests remain valid bounded JSON for oversized and escaped records, without claiming unsent sources', async () => {
    const batches:any[]=[];
    const {core,dir,cleanup}=await setup(async(_url,init)=>{
        const body=JSON.parse(String(init?.body)),system=String(body.messages[0].content);
        if(system.includes('facts每项'))return new Response(JSON.stringify({choices:[{message:{content:'{"facts":[],"diary":""}'}}]}));
        if(system.includes('压缩为短摘要')){
            const payload=String(body.messages.at(-1).content);
            const estimate=Math.ceil([...payload].reduce((n,c)=>n+(/[^\x00-\x7F]/.test(c)?1:.3),0));
            assert.ok(estimate<=4200);batches.push(JSON.parse(payload));
            return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"基于可见摘录的摘要"}'}}]}));
        }
        return reply();
    });
    try {
        const archive=JSON.parse(core.exportArchive());
        archive.messages=Array.from({length:24},(_,i)=>({id:randomUUID(),role:i%2?'assistant':'user',source:'chat',createdAt:new Date(1700000000000+i).toISOString(),text:i===0?'星'.repeat(12000):i===1?'quote"\\\n'.repeat(1000):`旧记录${i}`}));
        await core.importArchive(JSON.stringify(archive));
        assert.equal((await core.handle({type:'chat.send',text:'新消息触发后台压缩'})).ok,true);await core.waitForBackground();
        assert.equal(batches.length,1);assert.equal(batches[0].messages.length,1);
        assert.equal(batches[0].messages[0].id,archive.messages[0].id);assert.equal(batches[0].messages[0].omittedCharacters,10200);assert.match(batches[0].messages[0].text,/中间内容省略/);
        let store=new Store(dir);assert.deepEqual(store.get<any>('rollup').sourceIds,[archive.messages[0].id]);store.close();
        assert.equal((await core.handle({type:'chat.send',text:'继续处理尚未摘要的旧消息'})).ok,true);await core.waitForBackground();
        assert.equal(batches.length,2);assert.equal(batches[1].messages[0].id,archive.messages[1].id);
        const delivered=batches.flatMap(batch=>batch.messages.map((message:any)=>message.id));
        store=new Store(dir);assert.deepEqual(store.get<any>('rollup').sourceIds,delivered);store.close();
        assert.equal(new Set(delivered).size,delivered.length);
    } finally { await cleanup(); }
});

test('empty or failed summaries never advance coverage; deleting a source invalidates a successful checkpoint', async () => {
    let attempts=0;const batches:any[]=[];
    const {core,dir,cleanup}=await setup(async(_url,init)=>{
        const body=JSON.parse(String(init?.body)),system=String(body.messages[0].content);
        if(system.includes('facts每项'))return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:['我喜欢茶'],diary:''})}}]}));
        if(system.includes('压缩为短摘要')){
            attempts++;batches.push(JSON.parse(body.messages.at(-1).content));
            if(attempts===1)return new Response('failure',{status:400});
            return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:attempts===2?'':'有来源的摘要'})}}]}));
        }
        return reply();
    });
    try {
        for(let turn=1;turn<=14;turn++){
            assert.equal((await core.handle({type:'chat.send',text:turn===1?'我喜欢茶':`普通相处${turn}`})).ok,true);await core.waitForBackground();
            if(turn===12||turn===13){const store=new Store(dir);assert.equal(store.get('rollup'),undefined);store.close();}
        }
        assert.equal(attempts,3);assert.equal(batches[0].messages[0].id,batches[2].messages[0].id);
        const fact=core.getSnapshot().memories[0];let store=new Store(dir);assert.ok(store.get<any>('rollup').sourceIds.includes(fact.sourceId));store.close();
        await core.handle({type:'memory.delete',id:fact.id});store=new Store(dir);assert.equal(store.get('rollup'),undefined);store.close();
    } finally { await cleanup(); }
});

test('a summary arriving after a source correction or deletion cannot restore an invalid checkpoint', async () => {
    for (const operation of ['correct','delete'] as const) {
        let finish: ((response:Response)=>void) | undefined;
        const {core,dir,cleanup}=await setup(async(_url,init)=>{
            const body=JSON.parse(String(init?.body)),system=String(body.messages[0].content);
            if(system.includes('facts每项'))return new Response(JSON.stringify({choices:[{message:{content:'{"facts":["我喜欢咖啡"],"diary":""}'}}]}));
            if(system.includes('压缩为短摘要'))return await new Promise<Response>(resolve=>{finish=resolve;});
            return reply();
        });
        try {
            for(let turn=1;turn<=12;turn++){
                assert.equal((await core.handle({type:'chat.send',text:turn===1?'我喜欢咖啡':`相处${turn}`})).ok,true);
                if(turn<12)await core.waitForBackground();
            }
            for(let retry=0;retry<30&&!finish;retry++)await new Promise(resolve=>setTimeout(resolve,5));
            assert.ok(finish,'summary has reached the remote provider before the mutation');
            const id=core.getSnapshot().memories[0].id;
            const result=await core.handle(operation==='correct'?{type:'memory.correct',id,text:'我现在喜欢茶'}:{type:'memory.delete',id});assert.equal(result.ok,true);
            finish(new Response(JSON.stringify({choices:[{message:{content:'{"summary":"晚到的咖啡旧偏好摘要"}'}}]})));await core.waitForBackground();
            const store=new Store(dir);assert.equal(store.get('rollup'),undefined);store.close();
        } finally { if(finish)finish(new Response(JSON.stringify({choices:[{message:{content:'{"summary":""}'}}]})));await cleanup(); }
    }
});
