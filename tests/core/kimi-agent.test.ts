import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {KimiCodeAgent,type AgentRunner} from '../../runtime/core/kimi-agent';
import {CompanionService} from '../../runtime/core/companion';
import {validateCommand} from '../../runtime/main/validation';

test('ACP uses native full-access mode, handles partial lines, deduplicates tool updates and excludes private thought/logs',async()=>{
 const agent=new KimiCodeAgent(process.execPath,[resolve('tests/fixtures/kimi-acp-fixture.mjs')]);try{
  assert.equal((await agent.probe()).version,'fixture-only');const result=await agent.run('read fixture',process.cwd(),new AbortController().signal);
  assert.equal(result.stopReason,'end_turn');assert.equal(result.summary,'已完成读取：fixture-result。');assert.equal(result.tools.length,1);assert.equal(result.tools[0].status,'completed');assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(result.summary.includes('wrong-session'),false);
 }finally{agent.close();}
});
test('ACP cancellation terminates the owned process and permits a later fresh run',async()=>{
 const agent=new KimiCodeAgent(process.execPath,[resolve('tests/fixtures/kimi-acp-fixture.mjs')]);try{
  const controller=new AbortController();const pending=agent.run('hold',process.cwd(),controller.signal);setTimeout(()=>controller.abort(),150);await assert.rejects(pending);
  const later=await agent.run('read fixture',process.cwd(),new AbortController().signal);assert.equal(later.stopReason,'end_turn');
 }finally{agent.close();}
});
test('semantic questions are not guessed or reported as completed tasks',async()=>{const agent=new KimiCodeAgent(process.execPath,[resolve('tests/fixtures/kimi-acp-fixture.mjs')]);try{const result=await agent.run('question',process.cwd(),new AbortController().signal);assert.equal(result.stopReason,'needs_input');assert.match(result.summary,/尚未完成/);}finally{agent.close();}});
test('service defaults to Kimi executor, allows explicit tasks without chat API and returns only bounded result data to main context',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'galagent-kimi-agent-'));const seen:any[]=[];let contexts:any[]=[];
 const runner:AgentRunner={probe:async()=>({name:'fixture',version:'fixture'}),close(){},run:async(task,cwd)=>{seen.push({task,cwd});return{summary:task==='empty'?'':'读取完成，有实际来源。',stopReason:'end_turn',sessionId:'isolated',tools:[{id:'read',title:'Read',status:'completed'}]};}};
 const core=new CompanionService({dataDir:dir,agentRunner:runner,credentials:{get:async()=> 'fixture-key',set:async()=>{}},embeddings:{encode:async()=>[1,0],close:async()=>{}},fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body)),system=body.messages[0].content;if(system.includes('facts每项'))return new Response(JSON.stringify({choices:[{message:{content:'{"facts":[],"diary":""}'}}]}));contexts.push(JSON.parse(system.split('\n状态数据：')[1]));return new Response(JSON.stringify({choices:[{message:{content:'{"text":"我来处理。","name":"星棱","expression":"neutral","action":"idle","delegate":{"task":"读取任务文件"}}'}}]}));}});await core.init();
 try {
  assert.equal((await core.handle({type:'chat.send',text:'/任务 检查目录'})).ok,true);await core.waitForAgent();assert.equal(seen[0].task,'检查目录');assert.equal(core.getSnapshot().agent!.lastResult!.status,'done');assert.equal(core.getSnapshot().agent!.mode,'full-access');
  assert.equal((await core.handle({type:'chat.send',text:'帮我读取文件'})).ok,true);await core.waitForAgent();await core.waitForBackground();assert.equal(seen.length,2);assert.equal(contexts[0].agent.lastResult.summary,'读取完成，有实际来源。');assert.equal(core.getSnapshot().identity.name,core.getSnapshot().persona!.active.name);
  assert.equal(validateCommand({type:'agent.run',task:'任务'}).type,'agent.run');assert.throws(()=>validateCommand({type:'agent.run',task:''}));
  await core.handle({type:'agent.run',task:'empty'});await core.waitForAgent();assert.equal(core.getSnapshot().agent!.lastResult!.status,'failed');
 }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
test('independent task cancellation never stores an unfinished operation as success',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'galagent-kimi-cancel-'));
 const runner:AgentRunner={probe:async()=>({name:'fixture',version:'fixture'}),close(){},run:async(_task,_cwd,signal)=>await new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});})};
 const core=new CompanionService({dataDir:dir,agentRunner:runner,credentials:{get:async()=>undefined,set:async()=>{}},embeddings:{encode:async()=>[1,0],close:async()=>{}}});await core.init();
 try{await core.handle({type:'agent.run',task:'test'});assert.equal(core.getSnapshot().agent!.busy,true);assert.equal((await core.handle({type:'agent.run',task:'another'})).ok,false);await core.handle({type:'agent.cancel'});await core.waitForAgent();assert.equal(core.getSnapshot().agent!.lastResult!.status,'cancelled');assert.equal(core.getSnapshot().agent!.busy,false);}finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
