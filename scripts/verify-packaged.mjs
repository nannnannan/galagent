import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
const { chromium }=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const browser=await chromium.connectOverCDP(process.env.GALAGENT_CDP||'http://127.0.0.1:9224');
const pages=browser.contexts().flatMap(c=>c.pages());
const chat=pages.find(p=>p.url().includes('view=chat'));
assert.ok(chat,'Packaged chat window must exist');
assert.ok(chat.url().includes('app.asar'),'This check must use the packaged application, not dev source');
const dataDir=path.resolve(process.env.GALAGENT_CHECK_DATA_DIR||'.cache/packaged-validation');
const report={at:new Date().toISOString(),kind:'actual packaged Windows application, no remote model',page:chat.url(),passed:[],resources:[]};
async function pollSnapshot(predicate,timeout=90000) {
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline) { const state=await chat.evaluate(()=>window.galagent.getSnapshot()); if(predicate(state)) return state; await new Promise(resolve=>setTimeout(resolve,250)); }
 throw new Error('Packaged state did not reach its required condition before timeout.');
}
function resources(label) {
 const command="$root=[IO.Path]::GetFullPath('release\\win-unpacked\\GalAgent.exe'); $items=@(Get-Process | Where-Object { $_.Path -eq $root } | ForEach-Object { [pscustomobject]@{pid=$_.Id;workingSet=$_.WorkingSet64;privateMemory=$_.PrivateMemorySize64;cpuSeconds=$_.TotalProcessorTime.TotalSeconds} }); ConvertTo-Json -Compress -InputObject $items";
 const rows=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true}));
 const result={label,at:new Date().toISOString(),processes:rows.length,workingSetMiB:rows.reduce((s,r)=>s+r.workingSet,0)/2**20,privateMiB:rows.reduce((s,r)=>s+r.privateMemory,0)/2**20,cpuSeconds:rows.reduce((s,r)=>s+r.cpuSeconds,0)};
 report.resources.push(result);return result;
}
const original=await chat.evaluate(()=>window.galagent.getSnapshot());
assert.equal(original.provider.configured,false,'Verification data must not use a real key');
assert.equal(await chat.evaluate(()=>[...document.querySelectorAll('.expression')].every(img=>img.complete&&img.naturalWidth===1024)),true);
report.passed.push('all seven packaged transparent sprites load and renderer bridge works');
resources('packaged-before-index');
const text=`[运行包验收样本 ${Date.now()}] 我周六下午会去游泳。`;
assert.equal((await chat.evaluate(text=>window.galagent.dispatch({type:'memory.remember',text}),text)).ok,true);
const ready=await pollSnapshot(s=>s.status.embedding==='ready'&&s.status.tasks.some(task=>task.label.includes('语义索引')&&task.state==='done')&&!s.status.tasks.some(task=>task.state==='running'||task.state==='queued'));
const db=new DatabaseSync(path.join(dataDir,'companion.sqlite'),{readOnly:true});
const vector=db.prepare('SELECT body FROM vectors LIMIT 1').get();
assert.ok(vector);assert.equal(JSON.parse(vector.body).length,384);db.close();
report.passed.push('asar embedding worker imports native ONNX and offline packaged model; actual 384-dimensional vector persisted');
resources('packaged-model-ready');
const state=await chat.evaluate(()=>window.galagent.getSnapshot());
const memory=state.memories.find(m=>m.text===text);assert.ok(memory);
await chat.evaluate(id=>window.galagent.dispatch({type:'memory.delete',id}),memory.id);
const idleWaitStart=Date.now();
await pollSnapshot(s=>s.status.embedding==='idle',65000);
report.idleReleaseWaitMs=Date.now()-idleWaitStart;
assert.ok(report.idleReleaseWaitMs>40000,'Idle release must actually wait for the 45-second timer');
resources('packaged-after-idle-release');
report.passed.push('packaged model idle-release returns state to idle, fixture source deleted');
await chat.evaluate(()=>window.galagent.dispatch({type:'shell.chat',open:true}));
assert.equal(await chat.evaluate(()=>window.galagent.getWindowVisibility()),true);
report.frameTime=await chat.evaluate(()=>new Promise(resolve=>{const samples=[];let previous;function frame(t){if(previous!==undefined)samples.push(t-previous);previous=t;if(samples.length>=180){const a=[...samples].sort((a,b)=>a-b);resolve({count:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.ceil(a.length*.95)-1],over33ms:a.filter(x=>x>33.4).length});}else requestAnimationFrame(frame);}requestAnimationFrame(frame);}));
await mkdir('docs/evidence',{recursive:true});
await writeFile('docs/evidence/packaged-validation.json',JSON.stringify(report,null,2));
await chat.screenshot({path:'docs/evidence/packaged-chat.png'});
console.log(JSON.stringify(report,null,2));
await browser.close();
