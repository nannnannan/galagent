// Fully isolated native app + local HTTP protocol fixture. No real Kimi calls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const root=process.cwd(),dataDir=path.join(root,'.cache',`e2e-${Date.now()}`),key='galagent-e2e-fixture-key',requests=[],checks=[],errors=[];
const packagedExecutable=process.env.GALAGENT_E2E_EXE;
const scope=packagedExecutable?'isolated packaged Windows app.asar + localhost HTTP protocol fixture; not actual Kimi':'isolated native Electron + localhost HTTP protocol fixture; not actual Kimi';
const fact='我喜欢在降水的午后安静看书。';
const recoveryFact='我周日清晨会跑步。';
let holdRecovery=true,releaseRecoveryResponse;
let longDialogueRequestCounts;
const runtimeVersions=Object.fromEntries(await Promise.all(['@huggingface/transformers','onnxruntime-node','sharp'].map(async name=>[name,JSON.parse(await readFile(path.join('node_modules',name,'package.json'),'utf8')).version])));
const shippedFrames=(await readdir('dist/renderer/assets/character')).filter(x=>x.endsWith('.png')).map(x=>x.slice(0,-4));
const tokenEstimate=text=>Math.ceil([...text].reduce((n,c)=>n+(/[^\x00-\x7F]/.test(c)?1:.3),0));
const server=createServer(async(req,res)=>{
 try{
  assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),system=body.messages[0].content,last=body.messages.at(-1).content;
  const category=system.includes('facts每项')?'memory':system.includes('压缩为短摘要')?'rollup':'chat';
  const capture={category,last,messages:body.messages.length,estimatedTokens:body.messages.reduce((n,m)=>n+tokenEstimate(m.content)+10,0),authorizationMatches:req.headers.authorization===`Bearer ${key}`,responseFormat:body.response_format,model:body.model};
  requests.push(capture);
  let output;
  if(category==='memory'){
   const source=JSON.parse(last);
   if(source.user===recoveryFact&&holdRecovery){capture.recoveryHeld=true;await new Promise(resolve=>releaseRecoveryResponse=resolve);if(res.destroyed){capture.closedBeforeReply=true;return;}}
   output={facts:source.user===recoveryFact?[recoveryFact]:source.user.includes(fact)?[fact,'[协议验收fixture] 不在用户原句中的伪造事实']:[],diary:'[协议验收fixture] 对测试相处的短札记。'};
  }
  else if(category==='rollup'){
   const payload=JSON.parse(last);
   assert.equal(typeof payload.previous,'string');assert.ok(Array.isArray(payload.messages)&&payload.messages.length>0);
   capture.summarySourceIds=payload.messages.map(message=>message.id);
   output={summary:'[协议验收fixture] 长对话压缩，仅保留实际验收话题。'};
  }
  else {
   const dynamic=JSON.parse(system.split('状态数据：').at(-1));capture.candidateTexts=dynamic.retrievalCandidates.map(x=>x.text);capture.summaryPresent=!!dynamic.summary;
   output={text:'[协议验收fixture] 这是本地协议响应，不是真实模型生成。',expression:'pleased',action:last==='触发胡闹验收'?'doodle':'nod',...(dynamic.identity.onboarding!=='ready'?{name:'验收星棱'}:{})};
   if(last.startsWith('表情切换验收:')){output.expression=last.split(':')[1];output.action='idle';}
   if(last==='未知来源验收')output.sourceIds=['00000000-0000-0000-0000-000000000999'];
   if(last==='延迟取消验收'){await new Promise(r=>setTimeout(r,1400));output.text='[协议验收fixture] 这条晚响应必须被丢弃。';}
  }
  capture.responseAttemptedAt=Date.now();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}],usage:{total_tokens:60}}));
 }catch(error){errors.push(String(error));res.writeHead(500);res.end('{}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
let electron,chat,petPage;
async function launch(){
 const env={...process.env,MOONSHOT_API_KEY:'',KIMI_API_KEY:'',GALAGENT_DATA_DIR:dataDir,GALAGENT_DEBUG_PORT:'9225'};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(packagedExecutable||path.join(root,'node_modules/electron/dist/electron.exe'),packagedExecutable?[]:[root],{env,stdio:['ignore','pipe','pipe']});
 let output='';child.stderr.on('data',data=>output=(output+data).slice(-8000));child.stdout.on('data',data=>output=(output+data).slice(-8000));
 let connected;
 for(let i=0;i<200;i++){if(child.exitCode!==null)throw new Error(`Owned Electron exited: ${output}`);try{await fetch('http://127.0.0.1:9225/json/version');connected=true;break;}catch{await new Promise(r=>setTimeout(r,150));}}
 if(!connected){child.kill();throw new Error(`Owned Electron CDP unavailable: ${output}`);}
 const connection=await chromium.connectOverCDP('http://127.0.0.1:9225');
 electron={close:async()=>{await chat?.evaluate(()=>window.galagent.dispatch({type:'app.quit'})).catch(()=>{});if(child.exitCode===null)await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,7000))]);if(child.exitCode===null)child.kill();await connection.close().catch(()=>{});}};
 for(let i=0;i<100;i++){chat=connection.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('view=chat'));if(chat)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(chat,'isolated native chat window exists');
 petPage=connection.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('view=pet'));
 assert.ok(petPage,'isolated native pet window exists');
 chat.on('pageerror',error=>errors.push(String(error)));
 await chat.waitForFunction(()=>!!window.galagent&&!!document.querySelector('#composer'));
 if(packagedExecutable)assert.ok(chat.url().includes('app.asar'),'packaged verification must load its shipped renderer');
}
const snap=()=>chat.evaluate(()=>window.galagent.getSnapshot());
async function waitState(predicate,timeout=180000){const deadline=Date.now()+timeout;let state;while(Date.now()<deadline){state=await snap();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Snapshot condition timed out: ${JSON.stringify(state.status)}`);}
const dispatch=command=>chat.evaluate(c=>window.galagent.dispatch(c),command);
const success=async command=>{const result=await dispatch(command);assert.equal(result.ok,true,result.error);return result;};
const background=()=>waitState(s=>!s.status.tasks.some(t=>t.state==='running'||t.state==='queued'));
try{
 await launch();
 await petPage.waitForFunction(()=>document.querySelector('.pet-stage')?.dataset.hitTest==='alpha');checks.push('原生file://真实neutral PNG可读alpha缓存，无矩形fallback');
 assert.equal((await snap()).provider.configured,false);
 assert.equal(await chat.evaluate(()=>typeof window.galagent.getWindowVisibility),'function');
 await success({type:'shell.chat',open:false});
 await chat.waitForFunction(()=>document.body.classList.contains('not-visible'));
 assert.equal(await chat.evaluate(()=>window.galagent.getWindowVisibility()),false);
 assert.equal(await chat.locator('.character').evaluate(element=>getComputedStyle(element).animationPlayState),'paused');
 assert.equal(await petPage.evaluate(()=>window.galagent.getWindowVisibility()),true);
 await petPage.waitForFunction(()=>!document.body.classList.contains('not-visible'));
 await success({type:'shell.chat',open:true});
 await chat.waitForFunction(()=>!document.body.classList.contains('not-visible'));
 assert.equal(await chat.evaluate(()=>window.galagent.getWindowVisibility()),true);
 checks.push('实际隐藏chat通知renderer暂停，重新显示恢复；可见pet持续保持可见动画资格');
 await chat.locator('#input').fill('未配置时恢复草稿验收');await chat.locator('#input').press('Enter');
 await chat.waitForFunction(()=>document.querySelector('#input').value==='未配置时恢复草稿验收'&&document.querySelector('#toast').textContent.includes('API Key'));
 assert.equal((await snap()).messages.length,0);await chat.locator('#input').fill('');checks.push('未配置请求失败后恢复UI草稿，无成功会话提交');
 assert.equal(await chat.locator('.notebook').evaluate(e=>getComputedStyle(e).display),'grid');
 await chat.waitForFunction(frames=>frames.every(frame=>{const image=document.querySelector(`[data-expression="${frame}"]`);return image.complete&&image.naturalWidth>0;}),shippedFrames);
 assert.equal(await chat.locator('.expression').evaluateAll(es=>es.filter(e=>e.complete&&e.naturalWidth>0).length),shippedFrames.length);checks.push(`生产CSP下JS/CSS加载，当前已打包 ${shippedFrames.length} / 7 张立绘差分成功加载`);
 await success({type:'config.save',baseUrl,model:'fixture-kimi-protocol',apiKey:key});
 assert.equal((await snap()).provider.configured,true);assert.equal(JSON.stringify(await snap()).includes(key),false);
 const cipher=await readFile(path.join(dataDir,'provider-key.bin'));assert.equal(cipher.includes(Buffer.from(key)),false);checks.push('test-only Key经过系统保护存储，snapshot和明文文件未泄漏');
 await success({type:'chat.send',text:'[协议验收fixture] 初次相遇，请自行取名。'});await background();
 const firstSnapshot=await snap(),identity=firstSnapshot.identity;assert.equal(identity.name,'验收星棱');assert.equal(identity.onboarding,'ready');assert.equal(firstSnapshot.story.recentEpisodes.filter(e=>e.type==='E01').length,1);checks.push('首启模型协议名字与S2身份提交，真实E01来源事件落盘');
 await success({type:'chat.send',text:fact});await background();
 await waitState(s=>s.status.embedding==='ready'||s.status.embedding==='fallback');
 let state=await snap();assert.ok(state.memories.some(m=>m.text===fact));assert.equal(state.memories.some(m=>m.text.includes('伪造事实')),false);
 assert.equal(state.status.embedding,'ready');checks.push('用户自述原句事实抽取；伪造非原句事实拒绝；真实本地embedding索引ready');
 assert.ok(state.story.recentEpisodes.some(e=>e.type==='E03'));assert.ok(state.story.goals.notebook.entries>=1);
 await chat.locator('[data-page="settings"]').click();
 await chat.waitForFunction(()=>document.querySelector('#shared-goals')?.textContent.includes('星图札记'));
 await chat.locator('[data-page="chat"]').click();checks.push('实际story事实事件与札记进度经preload显示在相处小目标，未用假snapshot');
 await success({type:'chat.send',text:'下雨的时候我爱做什么？'});await background();
 const retrieval=requests.filter(r=>r.category==='chat').at(-1);assert.ok(retrieval.candidateTexts.includes(fact),'synonym query must retrieve actual fact');checks.push('通过HTTP上下文捕获验证同义检索包含原始事实');
 const beforeCancel=(await snap()).messages.length;
 const pending=dispatch({type:'chat.send',text:'延迟取消验收'});
 await waitState(s=>s.status.busy,10000);
 for(let i=0;i<100&&!requests.some(r=>r.last==='延迟取消验收');i++)await new Promise(resolve=>setTimeout(resolve,50));
 assert.ok(requests.some(r=>r.last==='延迟取消验收'),'local HTTP server received delayed request before cancellation');
 await success({type:'chat.cancel'});
 const canceled=await pending;assert.equal(canceled.ok,false);await chat.waitForTimeout(1500);
 assert.ok(requests.find(r=>r.last==='延迟取消验收').responseAttemptedAt,'server attempted actual delayed response');
 assert.equal((await snap()).messages.length,beforeCancel);assert.equal((await snap()).messages.some(m=>m.text.includes('晚响应')),false);checks.push('取消请求后本地HTTP晚返回不提交会话');
 const bad=await dispatch({type:'chat.send',text:'未知来源验收'});assert.equal(bad.ok,false);assert.match(bad.error,/未知来源/);assert.equal((await snap()).messages.length,beforeCancel);checks.push('未知sourceId响应整体拒绝，无成功写入');
 await success({type:'chat.send',text:'触发胡闹验收'});await background();assert.equal((await snap()).visual.action,'doodle');
 await success({type:'settings.update',settings:{mischiefEnabled:false}});assert.equal((await snap()).visual.action,'idle');
 await success({type:'settings.update',settings:{quietUntil:Date.now()+60000}});assert.equal((await snap()).visual.bubble,'');assert.equal((await snap()).visual.action,'idle');
 await success({type:'settings.update',settings:{quietUntil:0,mischiefEnabled:true}});checks.push('关闭胡闹/安静立即收回视觉动作与气泡');
 await mkdir('docs/evidence',{recursive:true});
 for(const expression of shippedFrames){await success({type:'chat.send',text:`表情切换验收:${expression}`});await background();await chat.waitForTimeout(380);assert.equal((await snap()).visual.expression,expression);await chat.screenshot({path:`docs/evidence/E2E-expression-${expression}.png`});}
 checks.push(`原生真实协议切换 ${shippedFrames.length} 个表情并截图，未注入snapshot`);
 await success({type:'chat.send',text:'表情切换验收:neutral'});await background();
 await petPage.waitForFunction(()=>document.body.classList.contains('blinking'),null,{timeout:12000});
 assert.equal((await snap()).visual.expression,'neutral','natural blink is renderer motion, not fake model state');
 await petPage.waitForFunction(()=>!document.body.classList.contains('blinking'),null,{timeout:1000});checks.push('可见桌面人物自然眨眼短暂切换后恢复neutral，snapshot身份/表情未伪造');
 for(let i=0;i<65;i++){await success({type:'chat.send',text:`[协议验收fixture] 长对话第${i+1}段：${'这是无个人信息的虚构验收内容。'.repeat(24)}`});await background();}
 state=await snap();assert.ok(state.status.contextTokens<=state.status.contextBudget);assert.equal(state.messages.length,120,'after more than 60 dialogues, snapshot must be clipped to 120 actual messages');
 assert.ok(requests.some(r=>r.category==='rollup'));assert.ok(requests.some(r=>r.category==='chat'&&r.summaryPresent));
 assert.ok(requests.filter(r=>r.category==='chat').every(r=>r.estimatedTokens<=6000));checks.push('长对话产生后台压缩且后续请求使用摘要；捕获chat预算全部≤6000');
 const rollups=requests.filter(r=>r.category==='rollup'),foldedSources=rollups.flatMap(r=>r.summarySourceIds);
 assert.ok(rollups.length<=24,'same long dialogue must not rewrite the summary almost every turn');
 assert.equal(new Set(foldedSources).size,foldedSources.length,'incremental summary must not resend already folded records');
 checks.push('增量摘要输入为完整JSON；相同长对话摘要请求≤24次且来源不重复');
 longDialogueRequestCounts=Object.fromEntries(['chat','memory','rollup'].map(k=>[k,requests.filter(r=>r.category===k).length]));
 const remembered=state.memories.find(m=>m.text===fact);await success({type:'memory.correct',id:remembered.id,text:'[协议验收fixture] 已改为晴天阅读。'});
 await background();state=await snap();assert.equal(state.memories.some(m=>m.text===fact),false);const corrected=state.memories.find(m=>m.text.includes('已改为晴天阅读'));
 await success({type:'memory.delete',id:corrected.id});assert.equal((await snap()).memories.some(m=>m.id===corrected.id),false);checks.push('纠正/删除通过renderer IPC真实SQLite路径生效');
 await mkdir('docs/evidence',{recursive:true});await chat.screenshot({path:'docs/evidence/E2E-native-fixture.png'});
 const beforeRestart=await snap();await electron.close();electron=undefined;
 await launch();state=await snap();assert.deepEqual(state.identity,identity);assert.equal(state.provider.configured,true);assert.equal(state.messages.length,beforeRestart.messages.length);assert.equal(state.memories.some(m=>m.id===corrected.id),false);checks.push('关闭自建Electron后同目录重启：名字、密钥配置、会话及删除状态保留');
 await success({type:'chat.send',text:recoveryFact});
 const heldDeadline=Date.now()+10000;while(!requests.some(r=>r.recoveryHeld)){if(Date.now()>heldDeadline)throw new Error('recovery extraction did not reach fixture');await new Promise(resolve=>setTimeout(resolve,50));}
 assert.equal((await snap()).memories.some(m=>m.text===recoveryFact),false);
 await electron.close();electron=undefined;holdRecovery=false;releaseRecoveryResponse?.();releaseRecoveryResponse=undefined;
 await launch();await waitState(s=>s.memories.some(m=>m.text===recoveryFact));await background();
 state=await snap();assert.equal(state.memories.filter(m=>m.text===recoveryFact).length,1);
 assert.equal(requests.filter(r=>r.category==='memory'&&JSON.parse(r.last).user===recoveryFact).length,2,'one interrupted attempt plus one recovered attempt');
 assert.equal(state.status.embedding,'ready');
 checks.push('真实应用在后台抽取未返回时退出；同目录重启续接一次且事实不重复、语义索引ready');
 assert.equal(errors.length,0,errors.join('\n'));assert.ok(requests.every(r=>r.authorizationMatches));
 await mkdir('tests/e2e/evidence',{recursive:true});
 await writeFile('tests/e2e/evidence/protocol-result.json',JSON.stringify({at:new Date().toISOString(),runtimeVersions,dataDir,scope,checks,longDialogueRequestCounts,requestCounts:Object.fromEntries(['chat','memory','rollup'].map(k=>[k,requests.filter(r=>r.category===k).length])),maxChatContextTokens:Math.max(...requests.filter(r=>r.category==='chat').map(r=>r.estimatedTokens)),errors},null,2));
 console.log(checks.join('\n'));
}finally{releaseRecoveryResponse?.();if(electron)await electron.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));}
