import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CompanionService} from '../../runtime/core/companion';
import type {AgentRunner} from '../../runtime/core/kimi-agent';

const longReport = '过程记录。'.repeat(1000) + '最终结果位于 D:/out.txt';
const response = (data: unknown) => new Response(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(data)}}]}));
async function bounded<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  try {return await Promise.race([work, new Promise<never>((_, reject) => {
    timer=setTimeout(()=>reject(new Error('operation waited for the stalled digest')),1500);
  })]);} finally {clearTimeout(timer!);}
}
async function until(check:()=>boolean) {
  await bounded((async()=>{while(!check()) await new Promise(resolve=>setTimeout(resolve,10));})());
}
async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'galagent-completion-'));
  const digests: {signal:AbortSignal;resolve:(value:Response)=>void}[]=[];
  let calls=0;
  const wakeEvents: unknown[]=[];
  const runner:AgentRunner={probe:async()=>({name:'fixture',version:'1'}), close(){},
    run:async()=>({summary:++calls===1 ? longReport : '第二项已经完成',stopReason:'end_turn',sessionId:'fixture',tools:[]})};
  const core=new CompanionService({dataDir:dir,workingDir:dir,agentRunner:runner,features:{attention:true},
    credentials:{get:async()=>'fixture',set:async()=>{}},embeddings:{encode:async()=>[1,0],close:async()=>{}},
    fetch:async(_url,init)=>{
      const body=JSON.parse(String(init?.body)), system=String(body.messages[0].content);
      if(system.startsWith('把执行代理交回的任务汇报压缩'))
        return new Promise<Response>(resolve=>digests.push({signal:init!.signal!,resolve})); // Deliberately ignores abort.
      if(system.includes('facts每项'))return response({ops:[],diary:''});
      if(system.startsWith('你是GalAgent的后台注意力代理')){
        const input=JSON.parse(body.messages[1].content), task=input.events.find((e:any)=>e.kind==='task');
        if(task){wakeEvents.push(task);assert.match(task.summary,/D:\/out.txt/);}
        return response(task?{decision:'wake',reason:'任务完成',evidence:[task.id],nextCheck:null,wakeHint:'告诉用户结果'}:{decision:'silent',reason:'无',evidence:[],nextCheck:null});
      }
      return response({text:'任务完成，结果在 D:/out.txt。',expression:'pleased',action:'idle'});
    }});
  await core.init();
  return {core,dir,digests,wakeEvents,cleanup:async()=>{await bounded(core.close());for(const d of digests)d.resolve(response({gist:'迟到的摘要'}));await new Promise(r=>setTimeout(r,20));await rm(dir,{recursive:true,force:true});}};
}

test('stalled digest does not delay completed status, the one proactive report, or shutdown', {timeout:10000}, async()=>{
  const f=await fixture();
  try {
    await f.core.handle({type:'chat.send',text:'你好'});await f.core.waitForBackground();
    await f.core.handle({type:'agent.run',task:'生成长报告'});
    await bounded(f.core.waitForAgent());
    let snap=f.core.getSnapshot();
    assert.equal(snap.agent!.busy,false);assert.equal(snap.taskHistory![0].status,'done');
    assert.equal(snap.agent!.lastResult!.gist!.includes('D:/out.txt'),true);
    assert.equal(snap.messages.filter(m=>m.source==='scene').length,1);
    await until(()=>f.digests.length===1);
    await until(()=>f.core.getSnapshot().messages.some(m=>m.source==='initiative'));
    assert.equal(f.wakeEvents.length,1);
    assert.equal(f.core.getSnapshot().messages.filter(m=>m.source==='initiative').length,1);
  } finally {await f.cleanup();}
  assert.equal(f.digests[0].signal.aborted,true);
});

test('a late successful digest cannot overwrite a newer task or issue a second notification', {timeout:10000}, async()=>{
  const f=await fixture();
  try{
    await f.core.handle({type:'agent.run',task:'第一项长报告'});await bounded(f.core.waitForAgent());await until(()=>f.digests.length===1);
    await f.core.handle({type:'agent.run',task:'第二项短报告'});await bounded(f.core.waitForAgent());
    f.digests[0].resolve(response({gist:'第一项摘要，结果在 D:/out.txt'}));
    await until(()=>f.core.getSnapshot().messages.some(m=>m.text.includes('第一项摘要')));
    const snap=f.core.getSnapshot();
    assert.equal(snap.agent!.lastResult!.summary,'第二项已经完成');
    assert.equal(snap.messages.filter(m=>m.source==='scene').length,2);
    assert.equal(snap.taskHistory!.length,2);
  }finally{await f.cleanup();}
});

test('clearing task history cancels refinement and late output does not restore the history or brief', {timeout:10000}, async()=>{
  const f=await fixture();
  try{
    await f.core.handle({type:'agent.run',task:'长报告'});await bounded(f.core.waitForAgent());await until(()=>f.digests.length===1);
    await f.core.handle({type:'agent.clearHistory'});
    assert.equal(f.digests[0].signal.aborted,true);
    f.digests[0].resolve(response({gist:'已经清除的任务'}));
    await new Promise(r=>setTimeout(r,30));
    assert.equal(f.core.getSnapshot().taskHistory!.length,0);
    assert.equal(f.core.getSnapshot().messages.some(m=>m.text.includes('已经清除的任务')),false);
  }finally{await f.cleanup();}
});
