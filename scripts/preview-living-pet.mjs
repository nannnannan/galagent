// Isolated visual acceptance: no provider key, no model replies, no production data.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

const root=process.cwd(),port=9241,identity=randomUUID();
const dataDir=path.join(root,'.cache',`living-pet-preview-${Date.now()}`);
const evidence=path.join(root,'docs/evidence/living-pet');
const executable=process.env.GALAGENT_PREVIEW_EXE||path.join(root,'release/living-pet/win-unpacked/GalAgent.exe');
const dev=process.argv.includes('--dev'),hold=process.argv.includes('--hold');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={startedAt:new Date().toISOString(),scope:'isolated actual Electron visual preview; no Kimi calls',executable,dataDir,checks:[],errors:[]};
await access(executable);await mkdir(dataDir,{recursive:true});await mkdir(evidence,{recursive:true});
await writeFile(path.join(dataDir,'window-state.json'),JSON.stringify({x:80,y:80,width:360,height:620}));
const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});
const seed=new DatabaseSync(path.join(dataDir,'companion.sqlite'));
seed.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL)');
seed.prepare('INSERT INTO records VALUES(?,?,?)').run('identity','state',JSON.stringify({id:identity,name:'',onboarding:'intro',stage:'S0'}));seed.close();
const env={...process.env,GALAGENT_DATA_DIR:dataDir,GALAGENT_DEBUG_PORT:String(port)};
for(const key of ['ELECTRON_RUN_AS_NODE','MOONSHOT_API_KEY','KIMI_API_KEY','GALAGENT_SOAK_PATH','GALAGENT_SOAK_SECONDS'])delete env[key];
const child=spawn(executable,dev?[root]:[],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
let spawnError,browser,pet,owned=false,stderr='';child.once('error',error=>spawnError=error);child.stderr.on('data',data=>stderr+=data);
try{
 const until=Date.now()+40000;let connected=false;
 while(Date.now()<until){if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error('Owned preview exited before connection');try{const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(750)});if(response.ok){connected=true;break;}}catch{}await delay(150);}
 assert.ok(connected,'Owned preview debug port ready');
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
 pet=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().includes('view=pet'));
 assert.ok(pet);await pet.waitForFunction(()=>!!window.galagent);
 const initial=await pet.evaluate(()=>window.galagent.getSnapshot());
 assert.equal(initial.identity.id,identity);owned=true;assert.equal(initial.provider.configured,false);assert.equal(initial.messages.length,0);
 pet.on('pageerror',error=>report.errors.push(String(error)));
 await pet.waitForSelector('canvas.living-canvas',{timeout:30000});
 await pet.waitForFunction(()=>Number(document.querySelector('canvas.living-canvas')?.dataset.frameCount)>2);
 const chat=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().includes('view=chat'));
 assert.ok(chat);assert.equal(await chat.evaluate(()=>window.galagent.getWindowVisibility()),false);
 report.checks.push('startup shows the transparent character; notebook remains hidden; isolated instance has no key or dialogue');
 report.renderer=await pet.locator('canvas.living-canvas').evaluate(canvas=>({...canvas.dataset,width:canvas.width,height:canvas.height}));
 report.drawTiming=await pet.evaluate(()=>new Promise((resolve,reject)=>{
  const canvas=document.querySelector('canvas.living-canvas'),samples=[];let previous;
  const timer=setTimeout(()=>{observer.disconnect();reject(Error('Live draw timing timed out'));},15000);
  const observer=new MutationObserver(records=>{if(!records.some(record=>record.attributeName==='data-frame-count'))return;const now=performance.now();if(previous!==undefined)samples.push(now-previous);previous=now;if(samples.length>=180){clearTimeout(timer);observer.disconnect();const sorted=[...samples].sort((a,b)=>a-b);resolve({samples:samples.length,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],medianMs:sorted[Math.floor(sorted.length*.5)],over33ms:samples.filter(ms=>ms>33.4).length,scope:'actual character drawElements notification intervals; visible isolated window'});}});
  observer.observe(canvas,{attributes:true,attributeFilter:['data-frame-count']});
 }));
 await pet.screenshot({path:path.join(evidence,'desktop-pet.png'),omitBackground:true});
 const video=await pet.evaluate(async()=>{
  const source=document.querySelector('canvas.living-canvas');
  const recording=document.createElement('canvas');recording.width=source.width;recording.height=source.height;
  const context=recording.getContext('2d');let active=true,paints=0,sampledFrames=0,visibleSamples=0;
  const paint=()=>{if(!active)return;context.fillStyle='#e7edf2';context.fillRect(0,0,recording.width,recording.height);context.drawImage(source,0,0);if(paints++%30===0){const data=context.getImageData(0,0,recording.width,recording.height).data;let distinct=0;for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-231)+Math.abs(data[i+1]-237)+Math.abs(data[i+2]-242)>40)distinct++;sampledFrames++;if(distinct>recording.width*recording.height*.05)visibleSamples++;}requestAnimationFrame(paint);};paint();
  const stream=recording.captureStream(30),chunks=[];
  const format=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
  const recorder=new MediaRecorder(stream,{mimeType:format,videoBitsPerSecond:2000000});
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();await new Promise(resolve=>setTimeout(resolve,12000));recorder.stop();await stopped;active=false;stream.getTracks().forEach(track=>track.stop());
  const bytes=new Uint8Array(await new Blob(chunks,{type:format}).arrayBuffer());let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));return{base64:btoa(encoded),format,seconds:12,sampledFrames,visibleSamples};
 });
 assert.ok(video.sampledFrames>2&&video.visibleSamples===video.sampledFrames,'Recorded samples must contain the actual character, not an empty matte');
 await writeFile(path.join(evidence,'living-character.webm'),Buffer.from(video.base64,'base64'));report.video={file:'living-character.webm',seconds:video.seconds,format:video.format,sampledFrames:video.sampledFrames,visibleSamples:video.visibleSamples,note:'Actual rendered canvas, recorded on a neutral matte; not generated animation or audio lip-sync'};
 const frames=()=>pet.locator('canvas.living-canvas').evaluate(canvas=>Number(canvas.dataset.frameCount));
 await pet.evaluate(()=>window.galagent.dispatch({type:'settings.update',settings:{reducedMotion:true}}));await delay(250);const frozen=await frames();await delay(900);assert.equal(await frames(),frozen);report.checks.push('reduced-motion stops the living-character draw loop');
 await pet.evaluate(()=>window.galagent.dispatch({type:'settings.update',settings:{reducedMotion:false,quietUntil:Date.now()+60000}}));await delay(250);const quiet=await frames();await delay(900);assert.ok(await frames()>quiet);report.checks.push('quiet retains gentle character motion instead of freezing her');
 await pet.evaluate(()=>window.galagent.dispatch({type:'settings.update',settings:{quietUntil:0}}));
 assert.ok(report.drawTiming.p95Ms<33.4,'Character draw timing meets the visible 30fps floor');
 console.log(JSON.stringify({status:'visual_ready',pid:child.pid,dataDir,evidence,controlFile:path.join(dataDir,'finish-preview.json')}));
 if(hold){const end=Date.now()+300000;while(Date.now()<end&&child.exitCode===null){if(await access(path.join(dataDir,'finish-preview.json')).then(()=>true,()=>false))break;await delay(500);}}
 report.finalState=await pet.evaluate(()=>({input:document.querySelector('.pet-input textarea')?.value,focused:document.activeElement?.tagName}));
 assert.equal(report.errors.length,0);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{
 if(owned&&pet)await Promise.race([pet.evaluate(()=>window.galagent.dispatch({type:'app.quit'})).catch(()=>{}),delay(2000)]);
 if(browser)await Promise.race([browser.close().catch(()=>{}),delay(2000)]);
 const end=Date.now()+5000;while(child.exitCode===null&&!spawnError&&Date.now()<end)await delay(100);if(child.exitCode===null&&!spawnError)child.kill();
 report.completedAt=new Date().toISOString();report.ownedChildPid=child.pid;report.stderr=stderr.slice(-2000);await writeFile(path.join(evidence,'preview-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,report:'docs/evidence/living-pet/preview-result.json'}));
}
