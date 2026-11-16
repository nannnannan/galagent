import {liveProvider} from '../../scripts/live-provider.mjs';
// Isolated packaged app with a scripted OpenAI/SSE server. --live adds the user's configured API; no production conversations are imported.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
const {_electron}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const root=process.cwd(),folder=path.join(root,'.cache',`openai-native-${Date.now()}`),workspace=path.join(folder,'workspace'),dataDir=path.join(folder,'data');await mkdir(workspace,{recursive:true});await sharp({create:{width:20,height:20,channels:3,background:'#4477ff'}}).png().toFile(path.join(workspace,'image.png'));
await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'companion.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL)');
db.prepare('INSERT INTO records VALUES (?, ?, ?)').run('settings', 'state', JSON.stringify({observationEnabled:false,screenCaptureEnabled:false,clipboardEnabled:false,initiativeEnabled:false,researchEnabled:false}));
db.close();
const call=(name,args,id)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const checks=[],errors=[];let restoredHistory=false;
const server=createServer(async(req,res)=>{try{if(req.method==='GET'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'fixture-model'}]}));return;}let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);assert.equal(req.headers.authorization,'Bearer isolated-fixture-only');assert.equal(body.tools.length,27);assert.equal(body.stream,true);assert.equal(body.thinking,undefined);const lastUser=[...body.messages].reverse().find(m=>m.role==='user'&&typeof m.content==='string')?.content.split('\n\n[GalAgent任务简报')[0];let calls,content;
 if(lastUser==='probe'){const prior=body.messages.find(m=>m.tool_calls?.some(c=>c.id==='write-proof'));if(!prior)calls=[call('Write',{path:'proof.txt',content:'native-file-proof'},'write-proof'),call('ReadMediaFile',{path:'image.png'},'image-proof')];else{assert.ok(body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));assert.ok(body.messages.some(m=>m.tool_call_id==='write-proof'));content='[本地协议验收] native-file-proof';checks.push('packaged media dependency and image_url returned');}}
 else if(lastUser==='question'){const result=body.messages.find(m=>m.tool_call_id==='user-question');if(!result)calls=[call('AskUserQuestion',{questions:[{question:'选择测试方案?',options:[{label:'A'},{label:'B'}]}]},'user-question')];else{assert.deepEqual(JSON.parse(result.content).answers,{'选择测试方案?':'B'});content='[本地协议验收] user choice B received';checks.push('native question selection roundtrip');}}
 else if(lastUser==='after-restart'){restoredHistory=body.messages.some(m=>m.tool_call_id==='write-proof');content='[本地协议验收] restored private execution history';}
 else if(lastUser==='plan'){const entered=body.messages.find(m=>m.tool_call_id==='plan-start'),written=body.messages.find(m=>m.tool_call_id==='plan-write'),approved=body.messages.find(m=>m.tool_call_id==='plan-exit'),effect=body.messages.find(m=>m.tool_call_id==='approved-effect');if(!entered)calls=[call('EnterPlanMode',{},'plan-start')];else if(!written)calls=[call('Write',{path:JSON.parse(entered.content).plan_file,content:'Concrete fixture plan: create approved.txt only after review.'},'plan-write')];else if(!approved)calls=[call('ExitPlanMode',{},'plan-exit')];else if(!effect){assert.equal(JSON.parse(approved.content).approved,true);calls=[call('Write',{path:'approved.txt',content:'approved-effect'},'approved-effect')];}else{content='[本地协议验收] plan review and effect passed';checks.push('native plan review blocks until user approval');}}
 else if(lastUser==='cancel'){await new Promise(r=>setTimeout(r,2000));content='late reply must be discarded';}
 else if(lastUser==='video'){const result=body.messages.find(m=>m.tool_call_id==='video-proof');if(!result)calls=[call('ReadMediaFile',{path:'clip.mp4'},'video-proof')];else{assert.match(result.content,/没有提供视频附件能力/);assert.ok(!body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='video_url')));content='[本地协议验收] video capability checked';checks.push('standard endpoint receives no unsupported video payload');}}
 else throw new Error('Unexpected fixture task');
 res.writeHead(200,{'Content-Type':'text/event-stream'});const send=chunk=>res.write('data: '+JSON.stringify(chunk)+'\n\n');send({choices:[{index:0,delta:{role:'assistant',reasoning_content:'private-native-fixture'},finish_reason:null}]});if(calls)send({choices:[{index:0,delta:{role:null,tool_calls:calls.map((c,index)=>({...c,index}))},finish_reason:'tool_calls'}]});else send({choices:[{index:0,delta:{role:null,content},finish_reason:'stop'}]});send({choices:[],usage:{total_tokens:20}});res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));res.writeHead(500);res.end('{}');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const exe=process.env.GALAGENT_TEST_EXE||process.env.GALAGENT_E2E_EXE||path.join(root,'release/openai-tools/win-unpacked/GalAgent.exe');let app,pet,chat;
async function launch() {
  const env = {...process.env, OPENAI_API_KEY:'', GALAGENT_API_KEY:'', GALAGENT_DATA_DIR:dataDir, MOONSHOT_API_KEY:'', KIMI_API_KEY:''};
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({executablePath:exe,env,timeout:60000});
  await app.firstWindow();
  const windowFor = async view => {
    const matches = page => page.url().includes('view='+view);
    return app.windows().find(matches) || app.waitForEvent('window',{predicate:matches,timeout:15000});
  };
  pet = await windowFor('pet');
  chat = await windowFor('chat');
  assert.ok(pet.url().includes('app.asar'));
  await pet.waitForFunction(()=>!!window.galagent);
}
async function stop(){const owned=app;app=undefined;await owned?.close();}
async function send(command){const result=await pet.evaluate(c=>window.galagent.dispatch(c),command);assert.equal(result.ok,true,result.error);}
async function done(){for(let i=0;i<240;i++){const state=await pet.evaluate(()=>window.galagent.getSnapshot());if(!state.agent.busy)return state;await new Promise(r=>setTimeout(r,50));}throw new Error('Owned task did not finish');}
try{
 await launch();await send({type:'config.save',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture-model',apiKey:'isolated-fixture-only'});await send({type:'agent.configure',cwd:workspace});await send({type:'agent.run',task:'probe'});let state=await done();assert.equal(state.agent.lastResult.status,'done',state.agent.lastResult.summary+' '+errors.join(' | '));assert.equal(await readFile(path.join(workspace,'proof.txt'),'utf8'),'native-file-proof');assert.equal(JSON.stringify(state).includes('private-native-fixture'),false);checks.push('actual package file effect and no public reasoning');
 await send({type:'shell.chat',open:true});await send({type:'agent.run',task:'question'});await chat.getByText('执行任务需要你的选择',{exact:true}).waitFor();await chat.locator('#agent-questions input[value=B]').check();await chat.locator('#agent-questions button[type=submit]').click();state=await done();assert.equal(state.agent.lastResult.status,'done');assert.equal(state.agent.questions.length,0);assert.match(state.agent.lastResult.summary,/choice B/);
 await send({type:'agent.run',task:'plan'});await chat.locator('#agent-questions input[value=Approve]').waitFor();assert.equal(await readFile(path.join(workspace,'approved.txt')).then(()=>true,()=>false),false);await chat.locator('#agent-questions input[value=Approve]').check();await chat.locator('#agent-questions button[type=submit]').click();state=await done();assert.equal(state.agent.lastResult.status,'done');assert.equal(await readFile(path.join(workspace,'approved.txt'),'utf8'),'approved-effect');
 await stop();await launch();await send({type:'agent.run',task:'after-restart'});state=await done();assert.equal(restoredHistory,true);assert.equal(state.agent.lastResult.status,'done');checks.push('native restart resumes matching private execution session');
 await send({type:'agent.run',task:'cancel'});await new Promise(r=>setTimeout(r,100));await send({type:'agent.cancel'});state=await done();assert.equal(state.agent.lastResult.status,'cancelled');assert.equal(state.messages.some(m=>m.text.includes('late reply')),false);checks.push('native cancel discards late reply');
 const ffmpeg=path.join(path.dirname(exe),'resources','app.asar.unpacked','node_modules','ffmpeg-static','ffmpeg.exe');await new Promise((resolve,reject)=>{const process=spawn(ffmpeg,['-loglevel','error','-f','lavfi','-i','color=c=red:s=64x64:d=2','-c:v','libx264','-pix_fmt','yuv420p',path.join(workspace,'clip.mp4')],{windowsHide:true,stdio:'ignore'});process.once('error',reject);process.once('exit',code=>code===0?resolve():reject(new Error('Packaged codec fixture failed')));});await send({type:'agent.run',task:'video'});state=await done();assert.equal(state.agent.lastResult.status,'done',state.agent.lastResult.summary);
 assert.deepEqual(errors,[]);const report={passed:true,scope:'isolated packaged GalAgent and scripted OpenAI SSE fixture',checks,toolSchemaCount:27,cliUsed:false,productionDataUsed:false};await writeFile(path.join(folder,'tools-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(process.argv.includes('--live')){const {baseUrl,model,apiKey:key}=liveProvider(),nonce='PACKAGED_LIVE_'+randomUUID();await writeFile(path.join(workspace,'live.txt'),nonce);await send({type:'config.save',baseUrl,model,apiKey:key});await send({type:'agent.run',task:'这是隔离的打包接入验收。只用Read读取当前目录live.txt，最终原样返回文件内容。不要修改文件、不要调用CLI、不要创建Goal或Cron。'});for(let i=0;i<2400;i++){state=await pet.evaluate(()=>window.galagent.getSnapshot());if(!state.agent.busy)break;await new Promise(r=>setTimeout(r,50));}assert.equal(state.agent.busy,false);assert.equal(state.agent.lastResult.status,'done',state.agent.lastResult.summary);assert.ok(state.agent.lastResult.summary.includes(nonce));assert.ok(state.agent.lastResult.toolCount>=1);const liveReport={passed:true,scope:'packaged GalAgent -> selected OpenAI-compatible API -> our Read backend -> correlated result -> verified final answer',liveApi:true,fileMatched:true,toolCount:state.agent.lastResult.toolCount,cliUsed:false,productionDataUsed:false};await writeFile(path.join(folder,'tools-live.json'),JSON.stringify(liveReport,null,2));console.log(JSON.stringify(liveReport));}
}finally{await stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
