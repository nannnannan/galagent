import { CompanionService } from '../runtime/core/companion.ts';
import { Embeddings } from '../runtime/core/embedding.ts';
import { Store } from '../runtime/core/store.ts';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root=resolve('.'),variant=process.argv.includes('--graphdisabled')?'graphdisabled':process.argv.includes('--noarena')?'noarena':process.argv.includes('--threads1')?'threads1':process.argv.includes('--idle')?'threads2-idle':'default';
const dataDir=join(root,'.cache/resource-probe-data',`${Date.now()}-${variant}`);
await mkdir(dataDir,{recursive:true});
const modelPath=join(root,'.cache/models/Xenova/multilingual-e5-small');
const report={variant,startedAt:new Date().toISOString(),dataDir,snapshots:[]};
report.sourceHashes=Object.fromEntries(await Promise.all(['runtime/core/companion.ts','runtime/core/embedding.ts','runtime/workers/embedding.mjs'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
function resources(label){
 const escaped=root.replaceAll("'","''");
 const ps=`$taskRoot='${escaped}'; $taskAll=Get-CimInstance Win32_Process; $taskSelected=@($taskAll | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskRoot,[StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.Contains($taskRoot)) -or $_.ProcessId -eq ${process.pid} }); $taskIds=@($taskSelected.ProcessId); for($taskI=0;$taskI -lt 4;$taskI++){ $taskChildren=@($taskAll | Where-Object { $_.ParentProcessId -in $taskIds -and $_.ProcessId -notin $taskIds }); $taskSelected+= $taskChildren; $taskIds=@($taskSelected.ProcessId) }; $taskRows=@(foreach($taskEntry in $taskSelected){ $taskProcess=Get-Process -Id $taskEntry.ProcessId -ErrorAction SilentlyContinue; if($taskProcess){ [pscustomobject]@{pid=$taskProcess.Id;kind=if($taskProcess.Id -eq ${process.pid}){'probe-node'}elseif($taskEntry.ExecutablePath -and $taskEntry.ExecutablePath.EndsWith('electron.exe')){'electron'}elseif($taskEntry.Name -match 'powershell|pwsh'){'powershell'}else{'project-process'};workingSetMiB=[Math]::Round($taskProcess.WorkingSet64/1MB,2);privateMiB=[Math]::Round($taskProcess.PrivateMemorySize64/1MB,2);cpuSeconds=[Math]::Round($taskProcess.TotalProcessorTime.TotalSeconds,3)} } }); ConvertTo-Json -InputObject $taskRows -Compress`;
 const rows=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,encoding:'utf8',maxBuffer:2**20}));
 // Do not omit an enabled observer helper when excluding this transient PowerShell collector.
 const helperScript = "$taskObserverHelpers=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('observer.ps1') -and -not $_.CommandLine.Contains('taskObserverHelpers') -and $_.CommandLine.Contains('"+escaped+"') }); $taskHelperRows=@(foreach($taskHelper in $taskObserverHelpers){$taskP=Get-Process -Id $taskHelper.ProcessId -ErrorAction SilentlyContinue;if($taskP){[pscustomobject]@{pid=$taskP.Id;kind='observer-helper';workingSetMiB=[Math]::Round($taskP.WorkingSet64/1MB,2);privateMiB=[Math]::Round($taskP.PrivateMemorySize64/1MB,2);cpuSeconds=[Math]::Round($taskP.TotalProcessorTime.TotalSeconds,3)}}});ConvertTo-Json -InputObject $taskHelperRows -Compress";
 const helpers=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',helperScript],{windowsHide:true,encoding:'utf8',maxBuffer:2**20}));
 const selected=[...rows.filter(x=>x.kind!=='powershell'),...helpers];
 const electron=selected.filter(x=>x.kind==='electron');
 const snapshot={label,rows:selected,electronWorkingSetMiB:electron.reduce((s,x)=>s+x.workingSetMiB,0),electronPrivateMiB:electron.reduce((s,x)=>s+x.privateMiB,0),projectPlusProbeWorkingSetMiB:selected.reduce((s,x)=>s+x.workingSetMiB,0),projectPlusProbePrivateMiB:selected.reduce((s,x)=>s+x.privateMiB,0),probeRssMiB:process.memoryUsage().rss/2**20};
 report.snapshots.push(snapshot);console.log(JSON.stringify({phase:label,...snapshot}));
}
function threadsOneEmbeddings(){
 const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');let extractor;parentPort.on('message',async({id,text,query})=>{try{if(!extractor)extractor=(async()=>{const {pipeline,env}=await import('@huggingface/transformers');env.allowRemoteModels=false;return pipeline('feature-extraction',workerData.modelPath,{dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:workerData.threads,interOpNumThreads:1,executionMode:'sequential',...(workerData.noarena?{enableCpuMemArena:false,enableMemPattern:false}:{}),...(workerData.graphdisabled?{graphOptimizationLevel:'disabled'}:{})}})})();const p=await extractor;const out=await p((query?'query: ':'passage: ')+text,{pooling:'mean',normalize:true});parentPort.postMessage({id,values:Array.from(out.data)})}catch(e){parentPort.postMessage({id,error:String(e.message)})}});`,{eval:true,workerData:{modelPath,threads:variant==='threads1'?1:2,noarena:variant==='noarena',graphdisabled:variant==='graphdisabled'}});
 const pending=new Map();worker.on('message',m=>{const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.values)}});
 return {encode(text,query=false){return new Promise((resolve,reject)=>{const id=randomUUID();pending.set(id,{resolve,reject});worker.postMessage({id,text,query})})},async close(){await worker.terminate()}};
}
function service(){return new CompanionService({dataDir,credentials:{get:async()=>undefined,set:async()=>{}},embeddingModelPath:modelPath,embeddingWorkerPath:join(root,'runtime/workers/embedding.mjs'),...(['threads1','noarena','graphdisabled'].includes(variant)?{embeddings:threadsOneEmbeddings()}:{})});}
let companion;
try{
 resources('base-before-model');
 companion=service();await companion.init();
 const states=[];companion.on('snapshot',s=>states.push({embedding:s.status.embedding,tasks:s.status.tasks.map(t=>t.state)}));
 const cpu=process.cpuUsage(),start=performance.now();
 for(const text of ['用户每周六下午去游泳。','用户使用 Windows 11 和 PowerShell。','用户喜欢温热乌龙茶。']){const r=await companion.handle({type:'memory.remember',text});if(!r.ok)throw Error(r.error);}
 await companion.waitForBackground();
 const ready=companion.getSnapshot();
 const t=performance.now(),retrieved=await companion.retrieve('周末会做什么运动？');
 report.actualPipeline={backgroundMs:performance.now()-start,queryMs:performance.now()-t,status:ready.status.embedding,tasks:ready.status.tasks.map(x=>x.state),memories:ready.memories.length,retrieved:retrieved.map(x=>x.text),cpuSeconds:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1e6,states};
 resources('actual-service-model-loaded');
 if(process.argv.includes('--short')) {
   const shortQueries=[];for(let i=0;i<40;i++){const t=performance.now();await companion.retrieve('周末会做什么运动？');shortQueries.push(performance.now()-t);}
   report.shortQueryMs={count:40,mean:shortQueries.reduce((a,b)=>a+b,0)/40,p95:[...shortQueries].sort((a,b)=>a-b)[37]};
   report.peakRssMiB=process.resourceUsage().maxRSS/1024;
 }
 if(process.argv.includes('--idle')){
   console.log(JSON.stringify({phase:'idle-wait',seconds:52}));
   await new Promise(resolve=>setTimeout(resolve,52000));
   if(global.gc)global.gc();
   report.afterIdleStatus=companion.getSnapshot().status.embedding;
   resources('after-52s-idle');
   const t=performance.now(),resumed=await companion.retrieve('周末会做什么运动？');
   report.reheat={queryMs:performance.now()-t,status:companion.getSnapshot().status.embedding,results:resumed.map(m=>m.text)};
   resources('after-idle-reheat');
 }
 await companion.close();companion=undefined;
 resources('after-service-close');
 if(!process.argv.includes('--short')) {
 const store=new Store(dataDir),sourceVector=store.vectors()[0].values;
 const seedStart=performance.now();store.transaction(()=>{for(let i=0;i<10000;i++){
  const sourceId=randomUUID(),id=randomUUID(),createdAt=new Date().toISOString(),text=`合成容量样本 ${i}：用户每周六下午去游泳。`;
  store.put('message',sourceId,{id:sourceId,role:'user',text,createdAt,source:'chat'});
  store.put('memory',id,{id,kind:'fact',text,sourceId,createdAt,valid:true});store.index(id,text);store.vector(id,sourceVector);
 }});report.syntheticSeed={count:10000,vectorDimensions:sourceVector.length,seedMs:performance.now()-seedStart,note:'合法唯一 source/message/memory，向量复用同一真实向量；非10000条独立语料embedding。'};store.close();
 companion=service();await companion.init();
 const warmStart=performance.now();await companion.retrieve('周六运动是什么？');report.syntheticFirstRetrieveMs=performance.now()-warmStart;
 const latencies=[];for(let i=0;i<20;i++){const t=performance.now();const result=await companion.retrieve('周六运动是什么？');latencies.push(performance.now()-t);if(!result.length)throw Error('Synthetic store retrieval unexpectedly empty');}
 report.syntheticStoreRetrieve={queries:20,memories:companion.getSnapshot().memories.length,meanMs:latencies.reduce((a,b)=>a+b,0)/latencies.length,p95Ms:[...latencies].sort((a,b)=>a-b)[18],maxMs:Math.max(...latencies),databaseBytes:(await stat(join(dataDir,'companion.sqlite'))).size};
 resources('actual-store-10000-model-loaded');
 await companion.close();companion=undefined;
 // Allow worker termination and JS collection opportunity before reporting retained RSS.
 if(global.gc)global.gc();
 await new Promise(resolve=>setTimeout(resolve,1500));resources('after-10000-close');
 report.peakRssMiB=process.resourceUsage().maxRSS/1024;
 }
}catch(e){report.error=String(e.stack||e);console.error(report.error);process.exitCode=1;}
finally{if(companion)await companion.close();await mkdir('docs/evidence',{recursive:true});await writeFile(`docs/evidence/runtime-resources-${variant}${process.argv.includes('--short')?'-short':''}.json`,JSON.stringify(report,null,2));}
