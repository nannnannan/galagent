import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import {parseModelReply} from '../../runtime/core/tool-protocol';
import {ToolHost,cronNext,isPrivateAddress,type HostSession,type HostTask} from '../../runtime/core/tool-host';
import {OpenAIToolAgent} from '../../runtime/core/openai-agent';
import {CompanionService} from '../../runtime/core/companion';

const signal=()=>new AbortController().signal;
const call=(name:string,args:unknown,id='call-1')=>({id,type:'function' as const,function:{name,arguments:JSON.stringify(args)}});
const reply=(message:unknown,reason='stop')=>new Response(JSON.stringify({choices:[{message,finish_reason:reason}],usage:{total_tokens:20}}),{headers:{'content-type':'application/json'}});
const final=(content='已核验完成。')=>reply({role:'assistant',content});
function stream(events:any[],complete=true){const bytes=new TextEncoder().encode(events.map(event=>'data: '+JSON.stringify(event)+'\r\n\r\n').join('')+(complete?'data: [DONE]\r\n\r\n':''));return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}}),{headers:{'content-type':'text/event-stream'}});}
async function hostFixture(){const dir=await mkdtemp(path.join(tmpdir(),'galagent-tools-'));const saved=new Map<string,HostSession>(),taskSaved=new Map<string,HostTask>();let now=Date.parse('2026-10-09T02:00:00Z'),answers:Record<string,string>={};const host=new ToolHost({save:s=>saved.set(s.id,s),saveTask:t=>taskSaved.set(t.id,t),ask:async()=>answers,child:async(_s,prompt)=>'Child result: '+prompt,allowPrivateFetch:true},()=>now);const session=host.session(dir);return{dir,host,session,saved,taskSaved,setAnswers:(value:Record<string,string>)=>{answers=value;},setNow:(value:number)=>{now=value;},cleanup:async()=>{host.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};}

test('SSE assembles multiple indexed tool calls, UTF8 and reasoning; usage-only chunk and opaque fields survive',async()=>{
 const result=await parseModelReply(stream([
  {choices:[{index:0,delta:{role:'assistant',reasoning_content:'私有',opaque_signature:{id:'opaque'},tool_calls:[{index:1,id:'two',type:'function',function:{name:'Re',arguments:'{"pa'}},{index:0,id:'one',type:'function',function:{name:'G',arguments:'{"pattern":'}}]},finish_reason:null}]},
  {choices:[{index:0,delta:{role:null,reasoning_content:'推理',tool_calls:[{index:1,id:null,type:null,function:{name:'ad',arguments:'th":"中文.txt"}'}},{index:0,function:{name:'lob',arguments:'"*.ts"}'}}]},finish_reason:'tool_calls'}]},
  {choices:[],usage:{total_tokens:123}},
 ]));assert.equal(result.usage,123);assert.equal(result.message.reasoning_content,'私有推理');assert.deepEqual(result.message.opaque_signature,{id:'opaque'});assert.deepEqual(result.message.tool_calls!.map(c=>[c.id,c.function.name,JSON.parse(c.function.arguments)]),[['one','Glob',{pattern:'*.ts'}],['two','Read',{path:'中文.txt'}]]);
});
test('incomplete SSE, truncated completion, repeated IDs and conflicting finish markers never produce executable calls',async()=>{
 await assert.rejects(parseModelReply(stream([{choices:[{index:0,delta:{tool_calls:[{index:0,id:'one',function:{name:'Write',arguments:'{"path":'}}]},finish_reason:null}]}],false)));
 await assert.rejects(parseModelReply(reply({role:'assistant',tool_calls:[call('Read',{path:'x'})]},'length')));
 await assert.rejects(parseModelReply(reply({role:'assistant',tool_calls:[call('Read',{path:'x'}),call('Read',{path:'y'})]},'tool_calls')));
 await assert.rejects(parseModelReply(stream([{choices:[{index:0,delta:{content:'ok'},finish_reason:'stop'}]},{choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}])));
});

test('K3.1 empty intermediate finish markers remain pending until a real terminal marker and DONE',async()=>{
 const pending={choices:[{index:0,delta:{role:'assistant',content:'',reasoning_content:'fixture',tool_calls:[{index:0,id:'k31-read',type:'function',function:{name:'Read',arguments:'{"path":"probe.txt"}'}}]},finish_reason:''}]};
 const terminal={choices:[{index:0,delta:{content:'',reasoning_content:''},finish_reason:'tool_calls'}],usage:{total_tokens:18}};
 const result=await parseModelReply(stream([pending,terminal]));
 assert.equal(result.finishReason,'tool_calls');assert.equal(result.usage,18);assert.equal(result.message.tool_calls![0].function.name,'Read');
 await assert.rejects(parseModelReply(stream([pending])),/未完整结束/);
 await assert.rejects(parseModelReply(stream([pending,terminal],false)),/模型流中断/);
 await assert.rejects(parseModelReply(stream([pending,{choices:[{index:0,delta:{},finish_reason:'length'}]}])),/未完整结束/);
 await assert.rejects(parseModelReply(stream([pending,terminal,{choices:[{index:0,delta:{},finish_reason:'stop'}]}])),/结束标记冲突/);
});
test('Read/Write/Edit preserve CRLF view, reject stale writes and ambiguous matches, and validate original path schema',async()=>{
 const f=await hostFixture();try{const file=path.join(f.dir,'source.txt');await writeFile(file,'甲\r\n重复\r\n重复\r\n');const view=await f.host.execute(f.session,'Read',{path:'source.txt',line_offset:1,n_lines:2},signal());assert.match(view.content,/1\t甲\n2\t重复/);
  assert.match((await f.host.execute(f.session,'Edit',{path:'source.txt',old_string:'重复',new_string:'乙'},signal())).content,/ToolError/);assert.equal((await f.host.execute(f.session,'Edit',{path:'source.txt',old_string:'重复',new_string:'乙',replace_all:true},signal())).content.startsWith('ToolError:'),false);assert.equal(await readFile(file,'utf8'),'甲\r\n乙\r\n乙\r\n');
  await writeFile(file,'changed externally');assert.match((await f.host.execute(f.session,'Write',{path:'source.txt',content:'overwrite'},signal())).content,/file changed/);assert.equal(await readFile(file,'utf8'),'changed externally');
  assert.match((await f.host.execute(f.session,'Read',{file_path:file},signal())).content,/ToolError/);await f.host.execute(f.session,'Write',{path:'new.txt',content:'new'},signal());assert.equal(await readFile(path.join(f.dir,'new.txt'),'utf8'),'new');await f.host.execute(f.session,'Write',{path:'new.txt',content:' appended',mode:'append'},signal());assert.equal(await readFile(path.join(f.dir,'new.txt'),'utf8'),'new appended');
  assert.match((await f.host.execute(f.session,'Read',{path:'.env'},signal())).content,/Sensitive/);
 }finally{await f.cleanup();}
});
test('Glob and Grep perform actual searches with ignored and sensitive files excluded, content pagination and regex errors',async()=>{
 const f=await hostFixture();try{await writeFile(path.join(f.dir,'first.ts'),'needle\nneedle two\n');await writeFile(path.join(f.dir,'second.py'),'other');await writeFile(path.join(f.dir,'.env'),'needle secret');await mkdir(path.join(f.dir,'.git'));await writeFile(path.join(f.dir,'.git','x.ts'),'needle');
  const glob=await f.host.execute(f.session,'Glob',{pattern:'*.ts',path:f.dir},signal());assert.match(glob.content,/first.ts/);assert.equal(glob.content.includes('.git'),false);
  const grep=await f.host.execute(f.session,'Grep',{pattern:'needle',path:f.dir,output_mode:'content',head_limit:1},signal());assert.match(grep.content,/first.ts:1:needle/);assert.match(grep.content,/More matches/);assert.equal(grep.content.includes('secret'),false);assert.match((await f.host.execute(f.session,'Grep',{pattern:'[',path:f.dir},signal())).content,/ToolError/);
 }finally{await f.cleanup();}
});
test('Bash and TaskList/TaskOutput/TaskStop use real owned processes and never kill a completed task',async()=>{
 const f=await hostFixture();try{const foreground=await f.host.execute(f.session,'Bash',{command:"printf 'shell-ok'"},signal());assert.match(foreground.content,/shell-ok/);assert.match(foreground.content,/exit code 0/);
  const started=JSON.parse((await f.host.execute(f.session,'Bash',{command:'sleep 20',description:'owned sleep',run_in_background:true},signal())).content);const list=JSON.parse((await f.host.execute(f.session,'TaskList',{},signal())).content);assert.ok(list.some((t:any)=>t.id===started.task_id));await f.host.execute(f.session,'TaskStop',{task_id:started.task_id,reason:'test stop'},signal());const stopped=JSON.parse((await f.host.execute(f.session,'TaskOutput',{task_id:started.task_id},signal())).content);assert.equal(stopped.status,'cancelled');
  const done=[...f.host.tasks.values()].find(t=>t.status==='done')!;await f.host.execute(f.session,'TaskStop',{task_id:done.id},signal());assert.equal(done.status,'done');const other=f.host.session(f.dir);assert.match((await f.host.execute(other,'TaskOutput',{task_id:done.id},signal())).content,/Unknown task/);
 }finally{await f.cleanup();}
});
test('media produces actual PNG crop and Kimi native video_url parts (inline data:video/* and ms:// upload) with keep_parts',async()=>{
 const f=await hostFixture();try{const image=path.join(f.dir,'image.png');await sharp({create:{width:32,height:24,channels:3,background:'#00ff00'}}).png().toFile(image);const result=await f.host.execute(f.session,'ReadMediaFile',{path:image,region:{x:2,y:3,width:10,height:8}},signal());assert.equal(result.attachments!.length,1);const url=(result.attachments![0] as any).image_url.url;const metadata=await sharp(Buffer.from(url.split(',')[1],'base64')).metadata();assert.equal(metadata.width,10);assert.equal(metadata.height,8);assert.equal(result.parts?.length,4);assert.equal((result.parts?.[1] as any).type,'image_url');
  const video=path.join(f.dir,'clip.mp4');assert.ok(ffmpeg);await new Promise<void>((resolve,reject)=>{const child=spawn(ffmpeg!,['-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:d=2','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Video fixture failed')));});
  const inlineVid=await f.host.execute(f.session,'ReadMediaFile',{path:video},signal());assert.equal(inlineVid.attachments!.length,1);assert.equal((inlineVid.attachments![0] as any).type,'video_url');assert.match((inlineVid.attachments![0] as any).video_url.url,/^data:video\/mp4;base64,/);assert.match(inlineVid.content,/<video path="/);assert.equal(inlineVid.parts?.length,4);assert.equal((inlineVid.parts?.[1] as any).type,'video_url');
  let uploadedFile='',uploadedPurpose='';const bodies:any[]=[];const agent=new OpenAIToolAgent({provider:()=>({baseUrl:'https://api.moonshot.cn/v1',model:'kimi-k3'}),credentials:{get:async()=> 'fixture-key'},ask:async()=>({}),fetch:async(reqUrl,init)=>{const u=String(reqUrl);if(u.endsWith('/files')){const form=init?.body as FormData;uploadedPurpose=String(form.get('purpose'));const fileObj=form.get('file') as File;uploadedFile=fileObj.name;return new Response(JSON.stringify({id:'file-video-123'}),{status:200,headers:{'content-type':'application/json'}});}const body=JSON.parse(String(init?.body));bodies.push(body);if(bodies.length===1)return reply({role:'assistant',tool_calls:[call('ReadMediaFile',{path:video},'read-vid')]},'tool_calls');return final('视频已读取。');}});
  try{const res=await agent.run('read video clip',f.dir,signal());assert.equal(res.summary,'视频已读取。');assert.equal(uploadedPurpose,'video');assert.equal(uploadedFile,'clip.mp4');const toolMsg=bodies[1].messages.find((m:any)=>m.role==='tool'&&m.tool_call_id==='read-vid');assert.ok(Array.isArray(toolMsg.content));assert.equal(toolMsg.content[1].type,'video_url');assert.deepEqual(toolMsg.content[1].video_url,{url:'ms://file-video-123',id:'file-video-123'});}finally{agent.close();}
 }finally{await f.cleanup();}
});
test('FetchURL reads a real local response, strips scripts and handles HTTP errors; Skill reads project-owned SKILL.md',async()=>{
 const f=await hostFixture(),server=createServer((req,res)=>{res.writeHead(req.url==='/error'?500:200,{'content-type':'text/html'});res.end('<h1>page-ok</h1><script>not-content</script>');});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));try{const port=(server.address() as any).port;const page=await f.host.execute(f.session,'FetchURL',{url:`http://127.0.0.1:${port}`},signal());assert.match(page.content,/page-ok/);assert.equal(page.content.includes('not-content'),false);assert.match((await f.host.execute(f.session,'FetchURL',{url:`http://127.0.0.1:${port}/error`},signal())).content,/HTTP 500/);
  await mkdir(path.join(f.dir,'.agents','skills','fixture'),{recursive:true});await writeFile(path.join(f.dir,'.agents','skills','fixture','SKILL.md'),'fixture skill body');const skill=await f.host.execute(f.session,'Skill',{skill:'fixture',args:'input'},signal());assert.match(skill.content,/fixture skill body/);assert.match((await f.host.execute(f.session,'Skill',{skill:'../outside'},signal())).content,/ToolError/);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup();}
});
test('TodoList and goal tools maintain real session state, budget ranges and independent sessions',async()=>{
 const f=await hostFixture();try{await f.host.execute(f.session,'TodoList',{todos:[{title:'one',status:'in_progress'},{title:'two',status:'pending'}]},signal());assert.equal(JSON.parse((await f.host.execute(f.session,'TodoList',{},signal())).content).todos.length,2);assert.match((await f.host.execute(f.session,'TodoList',{todos:[{title:'one',status:'in_progress'},{title:'two',status:'in_progress'}]},signal())).content,/ToolError/);
  await f.host.execute(f.session,'CreateGoal',{objective:'fixture objective',completionCriterion:'fixture proof'},signal());assert.match((await f.host.execute(f.session,'CreateGoal',{objective:'second'},signal())).content,/unfinished/);await f.host.execute(f.session,'SetGoalBudget',{value:3,unit:'turns'},signal());assert.equal(JSON.parse((await f.host.execute(f.session,'GetGoal',{},signal())).content).goal.budget.value,3);assert.match((await f.host.execute(f.session,'SetGoalBudget',{value:0.1,unit:'seconds'},signal())).content,/ToolError/);await f.host.execute(f.session,'UpdateGoal',{status:'complete'},signal());assert.equal(f.session.goal.status,'complete');assert.equal(f.host.session(f.dir).goal,undefined);
 }finally{await f.cleanup();}
});
test('plan mode allows only the plan file, blocks shell/agent effects and exits only after an actual selected approval',async()=>{
 const f=await hostFixture();try{await f.host.execute(f.session,'EnterPlanMode',{},signal());assert.match((await f.host.execute(f.session,'Write',{path:'bad.txt',content:'bad'},signal())).content,/ToolError/);assert.equal(await stat(path.join(f.dir,'bad.txt')).then(()=>true,()=>false),false);assert.match((await f.host.execute(f.session,'Bash',{command:'echo bad'},signal())).content,/ToolError/);await f.host.execute(f.session,'Write',{path:f.session.planFile,content:'Concrete fixture plan'},signal());await f.host.execute(f.session,'ExitPlanMode',{},signal());assert.equal(f.session.plan,true);f.setAnswers({'批准当前计划并开始执行？':'arbitrary custom text'});await f.host.execute(f.session,'ExitPlanMode',{},signal());assert.equal(f.session.plan,true);f.setAnswers({'批准当前计划并开始执行？':'Approve'});await f.host.execute(f.session,'ExitPlanMode',{},signal());assert.equal(f.session.plan,false);
 }finally{await f.cleanup();}
});
test('AskUserQuestion returns actual answers or dismissal and background answers are task-owned',async()=>{
 const f=await hostFixture();try{const questions=[{question:'选择方式?',options:[{label:'A'},{label:'B'}]}];assert.deepEqual(JSON.parse((await f.host.execute(f.session,'AskUserQuestion',{questions},signal())).content).answers,{});f.setAnswers({'选择方式?':'B'});const result=JSON.parse((await f.host.execute(f.session,'AskUserQuestion',{questions,background:true},signal())).content);await new Promise(r=>setTimeout(r,0));assert.equal(f.host.tasks.get(result.task_id)!.status,'done');assert.match(f.host.tasks.get(result.task_id)!.output,/'B'|"B"/);
 }finally{await f.cleanup();}
});
test('Agent and AgentSwarm delegate through our child hook, resume the correct session and reject invalid swarms before spawning',async()=>{
 const f=await hostFixture();try{const a=JSON.parse((await f.host.execute(f.session,'Agent',{prompt:'task one',description:'one'},signal())).content);assert.match(a.result,/task one/);const resume=JSON.parse((await f.host.execute(f.session,'Agent',{prompt:'continue',description:'resume',resume:a.agent_id},signal())).content);assert.equal(resume.agent_id,a.agent_id);assert.match((await f.host.execute(f.session,'Agent',{prompt:'x',description:'x',resume:a.agent_id,subagent_type:'coder'},signal())).content,/ToolError/);
  const before=f.host.sessions.size;assert.match((await f.host.execute(f.session,'AgentSwarm',{description:'bad',prompt_template:'same',items:['a','b']},signal())).content,/ToolError/);assert.equal(f.host.sessions.size,before);const swarm=JSON.parse((await f.host.execute(f.session,'AgentSwarm',{description:'group',prompt_template:'inspect {{item}}',items:['one','two']},signal())).content);assert.equal(swarm.length,2);assert.match(swarm[1].content,/inspect two/);
 }finally{await f.cleanup();}
});
test('CronCreate/List/Delete calculate local schedules, coalesce missed fires, expire and deliver one-shots once',async()=>{
 const f=await hostFixture();try{const now=Date.parse('2026-10-09T02:00:00Z');assert.equal(cronNext('5 10 * * *',now),now+300000);assert.throws(()=>cronNext('99 * * * *',now));const job=JSON.parse((await f.host.execute(f.session,'CronCreate',{cron:'* * * * *',prompt:'scheduled fixture',recurring:false},signal())).content);assert.equal(JSON.parse((await f.host.execute(f.session,'CronList',{},signal())).content).jobs.length,1);const fired=f.host.due(f.session,now+180000);assert.equal(fired.length,1);assert.match(fired[0],/scheduled fixture/);assert.equal(f.host.due(f.session,now+240000).length,0);const recurring=JSON.parse((await f.host.execute(f.session,'CronCreate',{cron:'* * * * *',prompt:'recurring'},signal())).content);assert.match(f.host.due(f.session,now+240000)[0],/coalescedCount="4"/);await f.host.execute(f.session,'CronDelete',{id:recurring.id},signal());assert.equal(f.session.crons.length,0);assert.ok(job.id);
 }finally{await f.cleanup();}
});

test('OpenAI loop advertises all 25 original schemas plus WebSearch and ApplyPatch, preserves raw assistant fields, correlates parallel calls and performs actual writes',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-loop-')),bodies:any[]=[];const original={role:'assistant',content:null,reasoning_content:'private exact raw thinking',opaque_signature:{bytes:'signature'},tool_calls:[call('Write',{path:'made.txt',content:'created proof'},'write')]};
 const agent=new OpenAIToolAgent({provider:()=>({baseUrl:'http://127.0.0.1:18890/v1',model:'kimi-code/k3'}),credentials:{get:async()=> 'fixture-key'},ask:async()=>({}),fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));bodies.push(body);if(bodies.length===1)return reply(original,'tool_calls');if(bodies.length===2){assert.deepEqual(body.messages.at(-2),original);assert.equal(body.messages.at(-1).tool_call_id,'write');return reply({role:'assistant',tool_calls:[call('Read',{path:'made.txt'},'read'),call('Glob',{pattern:'*.txt'},'glob')]},'tool_calls');}assert.deepEqual(body.messages.slice(-2).map((m:any)=>m.tool_call_id),['read','glob']);return final();}});
 try{const result=await agent.run('create and verify',dir,signal());assert.equal(await readFile(path.join(dir,'made.txt'),'utf8'),'created proof');assert.equal(result.stopReason,'end_turn');assert.equal(result.tools.length,3);assert.equal(bodies[0].tools.length,27);assert.equal(bodies[0].stream,true);assert.deepEqual(bodies[0].thinking,{type:'enabled',keep:'all'});assert.equal(result.summary.includes('private'),false);}finally{agent.close();await rm(dir,{recursive:true,force:true});}
});
test('invalid batches and interrupted SSE cannot partially write files',async()=>{
 for(const brokenStream of [false,true]){const dir=await mkdtemp(path.join(tmpdir(),'galagent-batch-'));let turn=0;const agent=new OpenAIToolAgent({provider:()=>({baseUrl:'http://localhost/v1',model:'k3'}),credentials:{get:async()=> 'fixture'},ask:async()=>({}),fetch:async()=>{if(turn++)return final('Invalid batch was rejected.');if(brokenStream)return stream([{choices:[{index:0,delta:{tool_calls:[{index:0,id:'w',function:{name:'Write',arguments:'{"path":"bad.txt","content":"bad"}'}}]},finish_reason:null}]}],false);return reply({role:'assistant',tool_calls:[call('Write',{path:'bad.txt',content:'bad'},'good'),{...call('Read',{},'broken'),function:{name:'Read',arguments:'{"path":'}}]},'tool_calls');}});try{if(brokenStream)await assert.rejects(agent.run('test',dir,signal()));else await agent.run('test',dir,signal());assert.equal(await stat(path.join(dir,'bad.txt')).then(()=>true,()=>false),false);}finally{agent.close();await rm(dir,{recursive:true,force:true});}}
});
test('persisted execution sessions resume completed protocol history and repair interrupted tools without replaying side effects',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-resume-')),saved=new Map<string,HostSession>();const create=(fetcher:typeof fetch)=>new OpenAIToolAgent({provider:()=>({baseUrl:'http://localhost/v1',model:'k3'}),credentials:{get:async()=> 'fixture'},ask:async()=>({}),fetch:fetcher,storage:{sessions:()=>[...saved.values()],tasks:()=>[],save:s=>saved.set(s.id,s),saveTask:()=>{}}});let first=create(async()=>final('First complete result.'));await first.run('first task',dir,signal());first.close();const root=[...saved.values()][0];root.messages.push({role:'assistant',tool_calls:[call('Write',{path:'unknown.txt',content:'do not replay'},'interrupted')]});let checked=false;const second=create(async(_url,init)=>{const body=JSON.parse(String(init?.body));const interrupted=body.messages.find((m:any)=>m.tool_call_id==='interrupted');assert.match(interrupted.content,/Previous process stopped/);assert.ok(body.messages.some((m:any)=>m.content==='First complete result.'));checked=true;return final('Continued after inspection.');});try{await second.run('continue',dir,signal());assert.equal(checked,true);assert.equal(saved.size,1);assert.equal(await stat(path.join(dir,'unknown.txt')).then(()=>true,()=>false),false);}finally{second.close();await rm(dir,{recursive:true,force:true});}
});
test('default CompanionService uses the OpenAI loop; questions and plan approval travel through actual agent.answer commands',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-question-'));let turn=0;const core=new CompanionService({dataDir:dir,workingDir:dir,credentials:{get:async()=> 'fixture',set:async()=>{}},embeddings:{encode:async()=>[1,0],close:async()=>{}},fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.tools.length,27);if(turn++===0)return reply({role:'assistant',tool_calls:[call('AskUserQuestion',{questions:[{question:'选择方式?',options:[{label:'A'},{label:'B'}]}]},'ask')]},'tool_calls');assert.deepEqual(JSON.parse(body.messages.at(-1).content).answers,{'选择方式?':'B'});return final('收到B，任务结束。');}});await core.init();try{await core.handle({type:'agent.run',task:'ask a fixture question'});for(let i=0;i<100&&!core.getSnapshot().agent!.questions?.length;i++)await new Promise(r=>setTimeout(r,2));const question=core.getSnapshot().agent!.questions![0];assert.ok(question);assert.equal(core.getSnapshot().agent!.busy,true);assert.equal((await core.handle({type:'agent.answer',id:question.id,answers:{'选择方式?':'B'}})).ok,true);await core.waitForAgent();assert.equal(core.getSnapshot().agent!.lastResult!.status,'done');assert.equal(core.getSnapshot().agent!.questions!.length,0);assert.equal(core.getSnapshot().agent!.backend,'openai-kimi-tools');}finally{await core.close();await rm(dir,{recursive:true,force:true});}
});

test('real child loops use our two-request concurrency limit, execute their own tools and return aggregated conclusions',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-swarm-'));await writeFile(path.join(dir,'shared.txt'),'parallel-proof');let activeRequests=0,peak=0;
 const agent=new OpenAIToolAgent({provider:()=>({baseUrl:'http://localhost/v1',model:'k3'}),credentials:{get:async()=> 'fixture'},ask:async()=>({}),concurrency:2,fetch:async(_url,init)=>{activeRequests++;peak=Math.max(peak,activeRequests);try{await new Promise(r=>setTimeout(r,10));const body=JSON.parse(String(init?.body)),first=body.messages.find((m:any)=>m.role==='user'&&typeof m.content==='string');if(first.content==='root swarm'){if(body.messages.at(-1).role==='user')return reply({role:'assistant',tool_calls:[call('AgentSwarm',{description:'read independent proof',prompt_template:'child {{item}}',items:['one','two','three','four']})]},'tool_calls');assert.match(body.messages.at(-1).content,/parallel-proof/);return final('four conclusions verified');}if(body.messages.at(-1).role==='user')return reply({role:'assistant',tool_calls:[call('Read',{path:'shared.txt'})]},'tool_calls');assert.match(body.messages.at(-1).content,/parallel-proof/);return final('child conclusion: parallel-proof');}finally{activeRequests--;}}});
 try{const result=await agent.run('root swarm',dir,signal());assert.equal(result.summary,'four conclusions verified');assert.equal(peak,2);assert.equal(agent.host.sessions.size,5);assert.equal([...agent.host.tasks.values()].filter(t=>t.kind==='agent'&&t.status==='done').length,4);}finally{agent.close();await rm(dir,{recursive:true,force:true});}
});

test('background answers are pushed after correlated tool results, never between assistant.tool_calls and role:tool',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-notify-'));let turn=0;
 const agent=new OpenAIToolAgent({provider:()=>({baseUrl:'http://localhost/v1',model:'k3'}),credentials:{get:async()=> 'fixture'},ask:async()=>({'继续方式?':'A'}),fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));if(turn++===0)return reply({role:'assistant',tool_calls:[call('AskUserQuestion',{questions:[{question:'继续方式?',options:[{label:'A'},{label:'B'}]}],background:true},'background-question')]},'tool_calls');const index=body.messages.findIndex((m:any)=>m.tool_calls?.[0]?.id==='background-question');assert.equal(body.messages[index+1].role,'tool');assert.equal(body.messages[index+1].tool_call_id,'background-question');assert.ok(body.messages.slice(index+2).some((m:any)=>m.role==='user'&&String(m.content).includes('Background task completed')));return final('actual answer delivered');}});
 try{const result=await agent.run('background question fixture',dir,signal());assert.equal(result.summary,'actual answer delivered');}finally{agent.close();await rm(dir,{recursive:true,force:true});}
});

test('an explicit goal budget stops further tool effects, and completed goals can finish without automatic extra requests',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-budget-'));let turns=0;
 const agent=new OpenAIToolAgent({provider:()=>({baseUrl:'http://localhost/v1',model:'k3'}),credentials:{get:async()=> 'fixture'},ask:async()=>({}),fetch:async()=>++turns===1?reply({role:'assistant',tool_calls:[call('CreateGoal',{objective:'budget fixture'},'goal'),call('SetGoalBudget',{unit:'turns',value:1},'budget')]},'tool_calls'):reply({role:'assistant',tool_calls:[call('Write',{path:'not-created.txt',content:'must not happen'},'write')]},'tool_calls')});
 try{const result=await agent.run('budgeted objective',dir,signal());assert.equal(result.stopReason,'budget_exceeded');assert.equal(turns,2);assert.equal(await stat(path.join(dir,'not-created.txt')).then(()=>true,()=>false),false);assert.equal([...agent.host.sessions.values()][0].goal.status,'active');}finally{agent.close();await rm(dir,{recursive:true,force:true});}
});

test('interrupted background tasks restore as lost, are not replayed, and a cancelled question releases the session',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-lost-'));const saved=new Map<string,HostSession>(),tasks=new Map<string,HostTask>();const first=new ToolHost({save:s=>saved.set(s.id,s),saveTask:t=>tasks.set(t.id,t),ask:async()=>({}),child:async()=>''});const root=first.session(dir);const task:HostTask={id:'persisted-task',owner:root.id,kind:'shell',description:'previous task',status:'running',output:'partial data',createdAt:Date.now(),pid:999999};tasks.set(task.id,task);first.close();let requested=false;
 const agent=new OpenAIToolAgent({provider:()=>({baseUrl:'http://localhost/v1',model:'k3'}),credentials:{get:async()=> 'fixture'},ask:async(_questions,live)=>await new Promise(resolve=>{requested=true;live.addEventListener('abort',()=>resolve({}),{once:true});}),storage:{sessions:()=>[...saved.values()],tasks:()=>[...tasks.values()],save:s=>saved.set(s.id,s),saveTask:t=>tasks.set(t.id,t)},fetch:async()=>reply({role:'assistant',tool_calls:[call('AskUserQuestion',{questions:[{question:'选择?',options:[{label:'A'},{label:'B'}]}]})]},'tool_calls')});
 try{assert.equal(agent.host.tasks.get(task.id)!.status,'lost');const controller=new AbortController();const pending=agent.run('question',dir,controller.signal);for(let i=0;i<100&&!requested;i++)await new Promise(r=>setTimeout(r,2));assert.equal(requested,true);controller.abort();await assert.rejects(pending);assert.equal(agent.host.tasks.get(task.id)!.status,'lost');}finally{agent.close();await rm(dir,{recursive:true,force:true});}
});

test('changing model/API creates a fresh private protocol chain and never replays old reasoning to another provider',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-provider-'));let provider={baseUrl:'http://localhost/v1',model:'k3'},count=0;const agent=new OpenAIToolAgent({provider:()=>provider,credentials:{get:async()=> 'fixture'},ask:async()=>({}),fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));if(count++===0)return reply({role:'assistant',content:'first answer',reasoning_content:'old-private-provider-reasoning'});assert.equal(JSON.stringify(body).includes('old-private-provider-reasoning'),false);assert.equal(body.messages.some((m:any)=>m.content==='first task'),false);return final('second answer');}});
 try{await agent.run('first task',dir,signal());provider={baseUrl:'https://other-provider.invalid/v1',model:'other-model'};await agent.run('second task',dir,signal());assert.equal(agent.host.sessions.size,2);}finally{agent.close();await rm(dir,{recursive:true,force:true});}
});

test('scheduler tick actually dispatches a due explicit cron and returns a verified result without replaying its one-shot',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-cron-loop-'));let now=Date.parse('2026-10-09T02:00:00Z'),seen=false,result='';const agent=new OpenAIToolAgent({clock:()=>now,provider:()=>({baseUrl:'http://localhost/v1',model:'k3'}),credentials:{get:async()=> 'fixture'},ask:async()=>({}),onResult:r=>{result=r.summary;},fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.ok(body.messages.some((m:any)=>typeof m.content==='string'&&m.content.includes('<cron-fire')));seen=true;return final('explicit cron delivered');}});const session=agent.host.session(dir);await agent.host.execute(session,'CronCreate',{cron:'* * * * *',prompt:'scheduled task',recurring:false},signal());
 try{now+=60000;agent.tick(now);for(let i=0;i<100&&!result;i++)await new Promise(r=>setTimeout(r,2));assert.equal(seen,true);assert.equal(result,'explicit cron delivered');assert.equal(session.crons.length,0);const turns=session.turns;now+=60000;agent.tick(now);await new Promise(r=>setTimeout(r,10));assert.equal(session.turns,turns);}finally{agent.close();await rm(dir,{recursive:true,force:true});}
});

test('forbiddenPaths enforces canonical path, relative traversal, junction and NTFS hardlink isolation across tools and invalidates on policy change',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-forbidden-'));
 const secretDir=path.join(dir,'secret-vault');
 const publicDir=path.join(dir,'public-work');
 await mkdir(secretDir,{recursive:true});
 await mkdir(publicDir,{recursive:true});
 const secretFile=path.join(secretDir,'credentials.txt');
 await writeFile(secretFile,'top-secret-token','utf8');
 await writeFile(path.join(publicDir,'readme.txt'),'safe-public-content','utf8');
 const hardlinkPath=path.join(publicDir,'linked-secret.txt');
 const { linkSync, symlinkSync } = await import('node:fs');
 linkSync(secretFile,hardlinkPath);
 const junctionPath=path.join(publicDir,'vault-junction');
 try { symlinkSync(secretDir,junctionPath,'junction'); } catch { /* fallback if junction unsupported */ }

 let forbidden=[secretDir];
 let version=1;
 const host=new ToolHost({save:()=>{},saveTask:()=>{},ask:async()=>({}),child:async()=>'',forbiddenPaths:()=>forbidden,policyVersion:()=>version});
 const session=host.session(publicDir);
 try {
  // Allowed public file works
  const okRead=await host.execute(session,'Read',{path:'readme.txt'},signal());
  assert.equal(okRead.content.startsWith('ToolError:'),false);
  assert.match(okRead.content,/safe-public-content/);

  // Direct path, relative .. traversal, case-variant, Write, Edit, Glob, Grep, Bash are blocked
  for(const [toolName,args] of [
   ['Read',{path:secretFile}],
   ['Read',{path:'../secret-vault/credentials.txt'}],
   // Case-variant aliases only exist on case-insensitive file systems (Windows NTFS).
   ...(process.platform==='win32'?[['Read',{path:secretFile.toUpperCase()}] as const]:[]),
   ['Read',{path:hardlinkPath}],
   ['Write',{path:path.join(secretDir,'hack.txt'),content:'no'}],
   ['Edit',{path:secretFile,old_string:'top',new_string:'low'}],
   ['Glob',{path:secretDir,pattern:'*'}],
   ['Grep',{path:secretDir,pattern:'secret'}],
   ['Bash',{command:`cat "${secretFile.replace(/\\/g,'/')}"`}],
  ] as const){
   const res=await host.execute(session,toolName,args,signal());
   assert.match(res.content,/^ToolError:.*(forbidden directory|禁止访问)/,`expected ${toolName} on ${JSON.stringify(args)} to be blocked, got: ${res.content}`);
  }

  // Glob and Grep on parent dir skip forbidden subdirectories
  const globParent=await host.execute(session,'Glob',{path:dir,pattern:'*'},signal());
  assert.equal(globParent.content.startsWith('ToolError:'),false);
  assert.equal(globParent.content.includes('credentials.txt'),false);

  const grepParent=await host.execute(session,'Grep',{path:dir,pattern:'top-secret-token'},signal());
  assert.equal(grepParent.content.startsWith('ToolError:'),false);
  assert.equal(grepParent.content.includes('top-secret-token'),false);

  // A shell script or variable can hide its file accesses: reject the command before spawning.
  await writeFile(path.join(publicDir,'task.sh'),'cat ../secret-vault/credentials.txt');
  for(const command of ['bash task.sh','p=../secret-vault; cat "$p/credentials.txt"','echo harmless'])
   assert.match((await host.execute(session,'Bash',{command},signal())).content,/Bash is disabled/);
  // Search subprocesses receive individual checked files, never the unchecked parent tree.
  const originalSpawn=(host as any).spawnTask, searchArgs:string[][]=[];
  (host as any).spawnTask=(_s:unknown,_d:unknown,_e:unknown,args:string[])=>{searchArgs.push(args);return{finished:Promise.resolve({status:'done',exitCode:0,output:''})};};
  try{await host.execute(session,'Grep',{path:dir,pattern:'secret'},signal());}finally{(host as any).spawnTask=originalSpawn;}
  assert.ok(searchArgs.length>0);
  for(const args of searchArgs){assert.ok(args.includes(path.join(publicDir,'readme.txt')));assert.equal(args.includes(dir),false);assert.equal(args.includes(secretFile),false);assert.equal(args.includes(hardlinkPath),false);}

  // Policy invalidation stops background shell tasks
  // Arbitrary shell is unavailable while guarded; start in full access and then enable the guard.
  assert.match((await host.execute(session,'Bash',{command:'echo harmless'},signal())).content,/Bash is disabled/);
  forbidden=[];
  const bg=await host.execute(session,'Bash',{command:'sleep 10',description:'wait',run_in_background:true},signal());
  const bgId=JSON.parse(bg.content).task_id;
  assert.equal(host.tasks.get(bgId)?.status,'running');
  forbidden=[secretDir];version++;
  host.invalidatePolicy();
  assert.equal(host.tasks.get(bgId)?.status,'cancelled');
 } finally {
  host.close();
  await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});


test('FetchURL blocks loopback/private targets by default and private address classification is strict',async()=>{
 for(const address of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','fd00::1','fe80::1','::ffff:127.0.0.1'])assert.equal(isPrivateAddress(address),true,address);
 for(const address of ['8.8.8.8','1.1.1.1','172.32.0.1','2606:4700::1111'])assert.equal(isPrivateAddress(address),false,address);
 const dir=await mkdtemp(path.join(tmpdir(),'galagent-ssrf-'));const host=new ToolHost({save:()=>{},ask:async()=>({}),child:async()=>''});
 try{const session=host.session(dir);
  for(const url of ['http://127.0.0.1:18890/v1/models','http://localhost:8787/','http://[::1]/','http://169.254.169.254/latest/meta-data'])assert.match((await host.execute(session,'FetchURL',{url},signal())).content,/private network/,url);
 }finally{host.close();await rm(dir,{recursive:true,force:true});}
});

test('SSE parser accepts bare CR line endings, CR split across chunks, and choices without index',async()=>{
 const text='data: '+JSON.stringify({choices:[{delta:{role:'assistant',content:'你好'},finish_reason:null}]})+'\r\r'+'data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\r\n\r\ndata: [DONE]\r\n\r\n';
 const bytes=new TextEncoder().encode(text),cut=new TextEncoder().encode(text.slice(0,text.indexOf('\r\n\r\n')+1)).length;
 const response=new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,cut));controller.enqueue(bytes.subarray(cut));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
 const result=await parseModelReply(response);
 assert.equal(result.message.content,'你好');
});
