// Owned isolated native process; localhost fixture proves plumbing, not Kimi quality.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const root=process.cwd(),dataDir=path.join(root,'.cache',`variable-e2e-${Date.now()}`),contexts=[],errors=[];
const server=createServer(async(req,res)=>{
  try {
    let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text),system=body.messages[0].content;
    let output;
    if(system.includes('facts每项'))output={facts:[],diary:''};
    else {contexts.push(JSON.parse(system.split('\n状态数据：')[1]));output={text:'[本地变量验收] 完成一次互动。',name:'验收星棱',expression:'pleased',action:'celebrate',stage:'S4',variables:{proficiency:999}};}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));
  }catch(e){errors.push(String(e));res.writeHead(500);res.end('{}');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let child,connection,pet,chat;
const packaged=process.env.GALAGENT_E2E_EXE;
async function launch(){
  const env={...process.env,GALAGENT_DATA_DIR:dataDir,GALAGENT_DEBUG_PORT:'9341',MOONSHOT_API_KEY:'',KIMI_API_KEY:''};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(packaged||path.join(root,'node_modules/electron/dist/electron.exe'),packaged?[]:[root],{env,stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',d=>log=(log+d).slice(-4000));child.stdout.on('data',d=>log=(log+d).slice(-4000));
  for(let i=0;i<160;i++){if(child.exitCode!==null)throw new Error('Owned Electron exited: '+log);try{await fetch('http://127.0.0.1:9341/json/version');break;}catch{await new Promise(r=>setTimeout(r,150));}}
  connection=await chromium.connectOverCDP('http://127.0.0.1:9341');
  for(let i=0;i<100;i++){const pages=connection.contexts().flatMap(c=>c.pages());pet=pages.find(p=>p.url().includes('view=pet'));chat=pages.find(p=>p.url().includes('view=chat'));if(pet&&chat)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(pet&&chat);await pet.waitForFunction(()=>!!window.galagent&&!!document.querySelector('canvas.living-canvas'));
  if(packaged)assert.ok(pet.url().includes('app.asar'));
}
async function stop(){
  await pet?.evaluate(()=>window.galagent.dispatch({type:'app.quit'})).catch(()=>{});
  if(child&&child.exitCode===null)await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);
  if(child&&child.exitCode===null)child.kill();await connection?.close().catch(()=>{});
}
async function send(command){const result=await pet.evaluate(c=>window.galagent.dispatch(c),command);assert.equal(result.ok,true,result.error);}
try {
  await launch();await send({type:'config.save',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'kimi-k3',apiKey:'isolated-fixture-only'});
  await send({type:'chat.send',text:'你有什么感受'});await pet.waitForFunction(()=>!!window.galagent&&document.querySelector('canvas.living-canvas')?.getLivingDiagnostics().intensity===.25);
  const first=await pet.evaluate(()=>window.galagent.getSnapshot());assert.equal(first.identity.stage,'S0');assert.equal(first.identity.onboarding,'ready');assert.equal(first.variables.expression.stage,'adapting');assert.equal(first.variables.expression.proficiency,5);assert.equal(first.visual.action,'nod');assert.equal(contexts[0].variables.stage,'adapting');
  await send({type:'chat.send',text:'解释这段代码'});await pet.waitForFunction(()=>document.querySelector('canvas.living-canvas').getLivingDiagnostics().intensity===.2);
  const work=await pet.evaluate(()=>window.galagent.getSnapshot());assert.equal(work.variables.scene.face,'work');assert.equal(work.visual.action,'idle');assert.equal(contexts.at(-1).variables.face,'work');
  await stop();await launch();const restored=await pet.evaluate(()=>window.galagent.getSnapshot());assert.equal(restored.identity.name,first.identity.name);assert.equal(restored.variables.expression.proficiency,work.variables.expression.proficiency);assert.equal(restored.messages.length,4);
  await send({type:'settings.update',settings:{quietUntil:Date.now()+60000}});await send({type:'pet.interact',interaction:'tap'});const quiet=await pet.evaluate(()=>window.galagent.getSnapshot());assert.equal(quiet.visual.action,'idle');assert.equal(quiet.visual.intensity,.2);assert.equal(quiet.variables.expression.proficiency,work.variables.expression.proficiency);assert.deepEqual(errors,[]);
  const result={passed:true,scope:packaged?'isolated packaged app.asar + localhost model fixture':'isolated compiled Electron + localhost model fixture',checks:['fresh naming retains adapting','model cannot write numeric state','IPC to WebGL intensity .25','work context and idle intensity .2','native restart preserves state and identity','quiet tap earns no growth'],realKimiTested:false};
  await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/人物变量原生验收.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await stop();await new Promise(r=>server.close(r));}
