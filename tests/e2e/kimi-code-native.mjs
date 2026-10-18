// Actual installed Kimi Code, one read-only fixture; isolated GalAgent storage.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const cwd=path.resolve('.cache',`kimi-agent-native-${Date.now()}`),dataDir=path.join(cwd,'galagent-data'),workspace=path.join(cwd,'workspace');await mkdir(workspace,{recursive:true});await writeFile(path.join(workspace,'probe.txt'),'galagent-kimi-native-probe-20261009');
const exe=path.resolve('release/kimi-agent/win-unpacked/GalAgent.exe');
const env={...process.env,GALAGENT_DATA_DIR:dataDir,GALAGENT_DEBUG_PORT:'9343',MOONSHOT_API_KEY:'',KIMI_API_KEY:''};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(exe,[],{env,windowsHide:true,stdio:'ignore'});let browser,pet;
try {
 for(let i=0;i<150;i++){if(child.exitCode!==null)throw new Error('Isolated app exited');try{await fetch('http://127.0.0.1:9343/json/version');break;}catch{await new Promise(r=>setTimeout(r,150));}}
 browser=await chromium.connectOverCDP('http://127.0.0.1:9343');
 for(let i=0;i<80;i++){pet=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('view=pet'));if(pet)break;await new Promise(r=>setTimeout(r,100));}assert.ok(pet);assert.ok(pet.url().includes('app.asar'));await pet.waitForFunction(()=>!!window.galagent);
 const send=async c=>{const r=await pet.evaluate(c=>window.galagent.dispatch(c),c);assert.equal(r.ok,true,r.error);};
 await send({type:'agent.configure',cwd:workspace});await send({type:'agent.run',task:'本次只读接入验收：用Read读取当前目录probe.txt，最终回答原样包含文件内容。不执行shell，不写文件，不联网搜索，不读其他文件。'});
 let state;for(let i=0;i<240;i++){state=await pet.evaluate(()=>window.galagent.getSnapshot());if(!state.agent.busy)break;await new Promise(r=>setTimeout(r,500));}
 assert.equal(state.agent.busy,false);assert.equal(state.agent.lastResult.status,'done',state.agent.lastResult.summary);assert.ok(state.agent.lastResult.summary.includes('galagent-kimi-native-probe-20261009'));assert.ok(state.agent.lastResult.toolCount>=1);assert.equal(state.provider.configured,false,'executor works independently of parent chat API config');assert.ok(state.messages.some(m=>m.text.includes('galagent-kimi-native-probe-20261009')));
 const report={passed:true,scope:'packaged GalAgent -> ACP -> installed Kimi Code 0.29.2 -> real Read tool',fullAccessMode:'yolo',fixtureMatched:true,toolCount:state.agent.lastResult.toolCount,parentChatConfigured:false,userProductionDataUsed:false};await writeFile('docs/evidence/KimiCode打包原生验收.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await pet?.evaluate(()=>window.galagent.dispatch({type:'app.quit'})).catch(()=>{});if(child.exitCode===null)await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill();await browser?.close();}
