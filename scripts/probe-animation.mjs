// Owned packaged-app A/B/A probe. No model calls, OS input, product edits, or
// process selection by executable path. Only a temporary animation pause rule.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const root=process.cwd(),exe=path.join(root,'release/win-unpacked/GalAgent.exe'),asar=path.join(root,'release/win-unpacked/resources/app.asar');
const dataDir=path.join(root,'.cache',`animation-probe-${Date.now()}`),port=9231;
const durationMs=120000,sampleIntervalMs=5000;
const report={startedAt:new Date().toISOString(),scope:'isolated stable packaged GalAgent; no Kimi/model fixture or remote generation; read-only OS counters',dataDir,executable:exe,port,rootPid:null,protectedProductionPid:37792,displayRefreshHzUserReported:240,durationMs,sampleIntervalMs,phases:[],notes:[],validityIssues:[]};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
let child,collector,connection,chat,pet,temporaryStyle;
let pending=[];
async function save(){await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/animation-perf.json',JSON.stringify(report,null,2));}
async function pageState(page){return page.evaluate(()=>{const character=document.querySelector('.character'),style=character&&getComputedStyle(character);return{url:location.href,documentHidden:document.hidden,visibilityState:document.visibilityState,notVisibleClass:document.body.classList.contains('not-visible'),reducedMotion:document.body.classList.contains('reduced-motion'),quietMode:document.body.classList.contains('quiet-mode'),characterAnimationName:style?.animationName,characterAnimationPlayState:style?.animationPlayState,characterAction:character?.dataset.action,devicePixelRatio,windowBoundsCss:{x:screenX,y:screenY,width:outerWidth,height:outerHeight},activeCssAnimations:document.getAnimations().map(a=>({playState:a.playState,type:a.constructor.name}))};});}
async function appState(){const state=await chat.evaluate(()=>window.galagent.getSnapshot());return{configured:state.provider.configured,busy:state.status.busy,embedding:state.status.embedding,pendingTasks:state.status.tasks.filter(t=>t.state==='running'||t.state==='queued').length,action:state.visual.action,expression:state.visual.expression,observationEnabled:state.settings.observationEnabled,conversations:state.stats.conversations};}
function startCollector(rootPid){
 const nativeSource='using System; using System.Runtime.InteropServices; public static class GalAnimationMetricsCursor { [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; } [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p); public class WindowInfo { public long Handle; public string Title; public bool Visible; } private delegate bool EnumProc(IntPtr h, IntPtr l); [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc p, IntPtr l); [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr h,System.Text.StringBuilder b,int c); public static WindowInfo[] OwnedWindows(uint pid) {var list=new System.Collections.Generic.List<WindowInfo>();EnumWindows((h,l)=>{uint owner;GetWindowThreadProcessId(h,out owner);if(owner==pid){var text=new System.Text.StringBuilder(512);GetWindowText(h,text,text.Capacity);list.Add(new WindowInfo{Handle=h.ToInt64(),Title=text.ToString(),Visible=IsWindowVisible(h)});}return true;},IntPtr.Zero);return list.ToArray();} }';
 const command=`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -TypeDefinition '${nativeSource}'; while($null -ne ($taskRequest=[Console]::ReadLine())) { if($taskRequest -eq 'quit'){break}; $taskAll=@(Get-CimInstance Win32_Process); $taskSelected=@($taskAll | Where-Object { $_.ProcessId -eq ${rootPid} }); $taskIds=@($taskSelected.ProcessId); for($taskLevel=0;$taskLevel -lt 8;$taskLevel++){ $taskChildren=@($taskAll | Where-Object { $_.ParentProcessId -in $taskIds -and $_.ProcessId -notin $taskIds }); if($taskChildren.Count -eq 0){break}; $taskSelected+=$taskChildren; $taskIds=@($taskSelected.ProcessId) }; $taskRows=@(foreach($taskEntry in $taskSelected){ $taskP=Get-Process -Id $taskEntry.ProcessId -ErrorAction SilentlyContinue; if($taskP){ $taskKind=if($taskP.Id -eq ${rootPid}){'browser'}elseif($taskEntry.CommandLine -match '--type=([^ ]+)'){$Matches[1]}elseif($taskEntry.Name -match 'powershell|pwsh'){'observer-helper'}else{'child'}; [pscustomobject]@{pid=$taskP.Id;parentPid=$taskEntry.ParentProcessId;createdAt=$taskEntry.CreationDate.ToUniversalTime().ToString('o');kind=$taskKind;cpuSeconds=$taskP.TotalProcessorTime.TotalSeconds;workingSetBytes=$taskP.WorkingSet64;privateBytes=$taskP.PrivateMemorySize64} } }); $taskPoint=[GalAnimationMetricsCursor+Point]::new(); $taskCursorOk=[GalAnimationMetricsCursor]::GetCursorPos([ref]$taskPoint); $taskCpuCount=(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors; $taskPayload=[pscustomobject]@{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();logicalCpuCount=$taskCpuCount;rootAlive=(${rootPid} -in $taskRows.pid);rows=@($taskRows);nativeWindows=@([GalAnimationMetricsCursor]::OwnedWindows(${rootPid}));cursor=[pscustomobject]@{available=$taskCursorOk;x=$taskPoint.X;y=$taskPoint.Y;coordinateSpace='Win32 GetCursorPos; OS input was not moved'}}; Write-Output (ConvertTo-Json -Depth 6 -Compress -InputObject $taskPayload) }`;
 collector=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let buffer='';collector.stdout.on('data',chunk=>{buffer+=chunk.toString('utf8');while(buffer.includes('\n')){const cut=buffer.indexOf('\n'),line=buffer.slice(0,cut).trim();buffer=buffer.slice(cut+1);if(!line)continue;const task=pending.shift();try{task?.resolve(JSON.parse(line));}catch(error){task?.reject(error);}}});
 collector.stderr.on('data',chunk=>{report.collectorStderr=(report.collectorStderr||'').concat(chunk.toString('utf8')).slice(-5000);});
 collector.on('exit',code=>{for(const task of pending.splice(0))task.reject(new Error(`Owned collector exited ${code}: ${report.collectorStderr||''}`));});
}
async function sample(){const value=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Owned resource collector timed out')),15000);pending.push({resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});collector.stdin.write('sample\n');});assert.equal(value.rootAlive,true,'owned app root must remain alive');assert.ok(value.logicalCpuCount>0);assert.equal(value.rows.some(row=>row.pid===report.protectedProductionPid),false,'production PID must never enter metrics');return value;}
function summarize(phase){
 const start=phase.samples[0],end=phase.samples.at(-1),wallSeconds=(end.at-start.at)/1000;
 const key=row=>`${row.pid}:${row.createdAt}`,first=new Map(start.rows.map(row=>[key(row),row]));
 const initialKeys=[...first.keys()].sort().join('|');phase.stablePidFamily=phase.samples.every(sample=>sample.rows.map(key).sort().join('|')===initialKeys);
 phase.wallSeconds=wallSeconds;phase.logicalCpuCount=start.logicalCpuCount;
 phase.perProcess=end.rows.map(row=>{const earlier=first.get(key(row));const cpuDeltaSeconds=earlier?row.cpuSeconds-earlier.cpuSeconds:null;return{pid:row.pid,kind:row.kind,createdAt:row.createdAt,cpuDeltaSeconds,wholeMachineCpuPercent:cpuDeltaSeconds===null?null:100*cpuDeltaSeconds/wallSeconds/start.logicalCpuCount,workingSetStartMiB:(earlier?.workingSetBytes||0)/2**20,workingSetEndMiB:row.workingSetBytes/2**20,workingSetMaxMiB:Math.max(...phase.samples.flatMap(s=>s.rows.filter(r=>key(r)===key(row)).map(r=>r.workingSetBytes)))/2**20};});
 phase.cpuDeltaSeconds=phase.perProcess.reduce((sum,row)=>sum+(row.cpuDeltaSeconds||0),0);phase.wholeMachineCpuPercent=100*phase.cpuDeltaSeconds/wallSeconds/start.logicalCpuCount;
 phase.workingSetStartMiB=start.rows.reduce((sum,row)=>sum+row.workingSetBytes,0)/2**20;phase.workingSetEndMiB=end.rows.reduce((sum,row)=>sum+row.workingSetBytes,0)/2**20;phase.workingSetMaxMiB=Math.max(...phase.samples.map(s=>s.rows.reduce((sum,row)=>sum+row.workingSetBytes,0)/2**20));
 phase.cursorMoved=phase.samples.some(s=>s.cursor.x!==start.cursor.x||s.cursor.y!==start.cursor.y);phase.states=phase.samples.map(s=>s.validation).filter(Boolean);
 if(!phase.stablePidFamily)report.validityIssues.push(`${phase.label}: app PID family changed; end-minus-start CPU can miss exited children`);
 const nativeChat=phase.samples.map(s=>s.nativeWindows.filter(w=>w.Title==='GalAgent · 星图札记'));phase.nativeChatHidden=nativeChat.every(windows=>windows.length===1&&!windows[0].Visible);
 if(!phase.nativeChatHidden)report.validityIssues.push(`${phase.label}: native chat was not consistently verifiably hidden`);
 phase.hiddenChatCssStillRunning=phase.states.every(s=>!s.chat.documentHidden&&!s.chat.notVisibleClass&&s.chat.characterAnimationPlayState==='running');
 if(phase.states.some(s=>s.app.busy||s.app.pendingTasks||s.app.action!=='idle'||s.app.configured||s.app.observationEnabled))report.validityIssues.push(`${phase.label}: configured/busy/tasks/action/observation condition changed`);
}
async function phase(label,paused){
 if(paused)temporaryStyle=await pet.addStyleTag({content:'.pet-view .character { animation-play-state: paused !important; }'});
 else if(temporaryStyle){await temporaryStyle.evaluate(node=>node.remove());temporaryStyle=undefined;}
 await sleep(2000);
 const item={label,paused,samples:[]};report.phases.push(item);
 const start=await sample();start.validation={chat:await pageState(chat),pet:await pageState(pet),app:await appState()};item.samples.push(start);
 assert.equal(start.validation.pet.characterAnimationPlayState,paused?'paused':'running');
 assert.equal(start.validation.app.action,'idle');
 const deadline=Date.now()+durationMs;let index=0;
 while(Date.now()<deadline){await sleep(Math.min(sampleIntervalMs,Math.max(1,deadline-Date.now())));const current=await sample();if(++index%6===0||Date.now()>=deadline){current.validation={chat:await pageState(chat),pet:await pageState(pet),app:await appState()};console.log(JSON.stringify({phase:label,elapsedSeconds:(current.at-start.at)/1000,ownedPid:report.rootPid,cursor:current.cursor,rows:current.rows.length}));}item.samples.push(current);}
 summarize(item);await save();console.log(JSON.stringify({completed:label,wholeMachineCpuPercent:item.wholeMachineCpuPercent,perProcess:item.perProcess,stablePidFamily:item.stablePidFamily,workingSetMaxMiB:item.workingSetMaxMiB}));
}
try{
 try{await fetch(`http://127.0.0.1:${port}/json/version`);throw new Error('Requested isolated CDP port already occupied; will not connect to an existing process');}catch(error){if(!String(error).includes('fetch failed'))throw error;}
 report.executableSha256=await hash(exe);report.asarSha256=await hash(asar);
 const env={...process.env,GALAGENT_DATA_DIR:dataDir,GALAGENT_DEBUG_PORT:String(port)};for(const name of ['ELECTRON_RUN_AS_NODE','MOONSHOT_API_KEY','KIMI_API_KEY','GALAGENT_SOAK_SECONDS','GALAGENT_SOAK_PATH'])delete env[name];
 child=spawn(exe,[],{cwd:root,env,stdio:['ignore','pipe','pipe']});report.rootPid=child.pid;assert.ok(child.pid&&child.pid!==report.protectedProductionPid);
 child.stdout.on('data',()=>{});child.stderr.on('data',chunk=>{report.appStderr=(report.appStderr||'').concat(chunk.toString('utf8')).slice(-5000);});
 for(let i=0;i<200;i++){if(child.exitCode!==null)throw new Error(`Owned package exited: ${report.appStderr||''}`);try{await fetch(`http://127.0.0.1:${port}/json/version`);break;}catch{await sleep(150);}}
 connection=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
 for(let i=0;i<100;i++){const pages=connection.contexts().flatMap(c=>c.pages());chat=pages.find(p=>p.url().includes('view=chat'));pet=pages.find(p=>p.url().includes('view=pet'));if(chat&&pet)break;await sleep(100);}
 assert.ok(chat&&pet);await chat.waitForFunction(()=>!!window.galagent);await pet.waitForFunction(()=>!!document.querySelector('.character'));
 report.initialPages={chat:await pageState(chat),pet:await pageState(pet)};
 assert.equal((await appState()).configured,false);
 assert.equal((await chat.evaluate(()=>window.galagent.dispatch({type:'shell.chat',open:false}))).ok,true);
 await sleep(1000);report.afterChatHide={chat:await pageState(chat),pet:await pageState(pet)};
 startCollector(child.pid);report.initialResourceSample=await sample();report.logicalCpuCount=report.initialResourceSample.logicalCpuCount;
 report.cursorPosition=report.initialResourceSample.cursor;report.petBoundsCss=report.afterChatHide.pet.windowBoundsCss;
 // Compare only when physical coordinates and CSS/DIP screen geometry agree.
 const bounds=report.petBoundsCss,cursor=report.cursorPosition,dpr=report.afterChatHide.pet.devicePixelRatio;
 report.cursorOutsidePet={value:dpr===1?!(cursor.x>=bounds.x&&cursor.x<bounds.x+bounds.width&&cursor.y>=bounds.y&&cursor.y<bounds.y+bounds.height):null,devicePixelRatio:dpr,note:dpr===1?'direct comparable coordinates':'DPI coordinate conversion was not independently verified; no outside assertion'};
 console.log(JSON.stringify({started:true,ownedPid:child.pid,logicalCpuCount:report.logicalCpuCount,initialPages:report.initialPages,afterChatHide:report.afterChatHide,cursorOutsidePet:report.cursorOutsidePet}));
 await sleep(30000);
 await phase('A1-normal',false);await phase('B-pet-animation-paused',true);await phase('A2-restored',false);
 const [a,b,a2]=report.phases;
 report.finalExecutableSha256=await hash(exe);report.finalAsarSha256=await hash(asar);if(report.finalExecutableSha256!==report.executableSha256||report.finalAsarSha256!==report.asarSha256)report.validityIssues.push('package files changed during the experiment');
 const allCursors=report.phases.flatMap(p=>p.samples.map(s=>s.cursor));if(allCursors.some(c=>c.x!==allCursors[0].x||c.y!==allCursors[0].y))report.validityIssues.push('OS cursor moved naturally during measurement; cursor-poll path may not remain comparable');
 report.comparison={normalA1:a.wholeMachineCpuPercent,pausedB:b.wholeMachineCpuPercent,restoredA2:a2.wholeMachineCpuPercent,meanNormal:(a.wholeMachineCpuPercent+a2.wholeMachineCpuPercent)/2,reductionPercentOfNormal:100*(1-b.wholeMachineCpuPercent/((a.wholeMachineCpuPercent+a2.wholeMachineCpuPercent)/2)),a2ToA1Ratio:a2.wholeMachineCpuPercent/a.wholeMachineCpuPercent};
 report.causalEvidenceUsable=report.validityIssues.length===0;
 report.notes.push('Only CSS animation-play-state was changed on the owned pet. Blink timers, expression layers, alpha cache, native hit-test polling, keys/settings, and frame rate were not changed.');
 report.notes.push('Production process 37792 and same-exe peer instances were excluded by owned-root ancestry. Global hardware scheduling/contention still cannot be controlled.');
}catch(error){report.error=String(error.stack||error);report.causalEvidenceUsable=false;process.exitCode=1;console.error(report.error);}
finally{
 if(temporaryStyle)await temporaryStyle.evaluate(node=>node.remove()).catch(()=>{});
 if(chat)await chat.evaluate(()=>window.galagent.dispatch({type:'app.quit'})).catch(()=>{});
 if(child&&child.exitCode===null){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(8000)]);if(child.exitCode===null)child.kill();}
 if(connection)await connection.close().catch(()=>{});
 if(collector&&collector.exitCode===null){collector.stdin.write('quit\n');collector.stdin.end();await Promise.race([new Promise(resolve=>collector.once('exit',resolve)),sleep(3000)]);if(collector.exitCode===null)collector.kill();}
 report.finishedAt=new Date().toISOString();report.ownedProcessExitCode=child?.exitCode;await save();console.log(JSON.stringify({finished:true,comparison:report.comparison,causalEvidenceUsable:report.causalEvidenceUsable,validityIssues:report.validityIssues}));
}
