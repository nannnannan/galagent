// Real-account acceptance only. No fixture replies and no production conversations.
// Default is configuration inspection. --run explicitly starts the 30-call scenario.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir,readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {createServer} from 'node:net';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const boundedVersion=port=>fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(750)});
async function requireFreePort(port){
 const probe=createServer();
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{probe.close();reject(new Error('Acceptance port inspection timed out'));},2000);
  probe.once('error',error=>{clearTimeout(timer);reject(error);});
  probe.listen({host:'127.0.0.1',port,exclusive:true},()=>probe.close(error=>{clearTimeout(timer);error?reject(error):resolve();}));
 });
}

const root=process.cwd(),production=path.join(process.env.APPDATA||'', 'GalAgent');
const releaseDir=path.join(root,'release/living-pet');
const executable=path.join(releaseDir,'win-unpacked/GalAgent.exe');
const manifest=JSON.parse(await readFile(path.join(releaseDir,'delivery-manifest.json'),'utf8'));
async function fileSha(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
assert.equal(manifest.source,'release/living-pet/win-unpacked','Acceptance must target the current delivery');
assert.equal(await fileSha(executable),manifest.exe_sha256,'Acceptance executable differs from the verified delivery');
assert.equal(await fileSha(path.join(releaseDir,'win-unpacked/resources/app.asar')),manifest.asar_sha256,'Acceptance app.asar differs from the verified delivery');
const encryptedKey=path.join(production,'provider-key.bin');
const hasEnvironmentKey=!!(process.env.MOONSHOT_API_KEY||process.env.KIMI_API_KEY);
const hasProtectedFile=await access(encryptedKey).then(()=>true,()=>false);
const reportPath=path.join(root,'docs/evidence/kimi-live-result.json');
const report={startedAt:new Date().toISOString(),scope:'real configured backend; isolated synthetic acceptance conversations; no production chat import',package:{executable,exeSha256:manifest.exe_sha256,asarSha256:manifest.asar_sha256,artifactsVerified:true},status:'inspection',realCallsStarted:false,configuredSourceAvailable:hasEnvironmentKey||hasProtectedFile,results:[]};
let provider={baseUrl:'https://api.moonshot.cn/v1',model:'kimi-k3'};
try {
 const db=new DatabaseSync(path.join(production,'companion.sqlite'),{readOnly:true});
 try {const row=db.prepare('SELECT body FROM records WHERE id=?').get('provider');if(row)provider={...provider,...JSON.parse(String(row.body))};}finally{db.close();}
}catch{/* First launch may not have created a provider record yet. */}
const save=async()=>{await mkdir(path.dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2));};
if(!report.configuredSourceAvailable||!process.argv.includes('--run')) {
 report.status=report.configuredSourceAvailable?'ready_for_explicit_run':'needs_configuration';
 report.note='A protected file is only a candidate: the isolated app must decrypt and confirm configured before any request. No key or reply is printed.';
 await save();console.log(JSON.stringify({status:report.status,realCallsStarted:false}));
} else {
 assert.ok(/^kimi-k3(?:$|[-_])/i.test(provider.model),'This acceptance contract targets the configured Kimi K3 model; do not substitute another model');
 const dataDir=path.join(root,'.cache',`kimi-live-${Date.now()}`),port=9232,isolationIdentityId=randomUUID();
 await requireFreePort(port);
 await mkdir(dataDir,{recursive:true});
 // Keep DPAPI ciphertext protected; only the existing Electron main process decrypts it.
 if(hasProtectedFile)await copyFile(encryptedKey,path.join(dataDir,'provider-key.bin'));
 const db=new DatabaseSync(path.join(dataDir,'companion.sqlite'));
 db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL)');
 db.prepare('INSERT INTO records VALUES(?,?,?)').run('provider','state',JSON.stringify(provider));db.close();
 const seed=new DatabaseSync(path.join(dataDir,'companion.sqlite'));
 seed.prepare('INSERT INTO records VALUES(?,?,?)').run('identity','state',JSON.stringify({id:isolationIdentityId,name:'',onboarding:'intro',stage:'S0'}));seed.close();
 const env={...process.env,GALAGENT_DATA_DIR:dataDir,GALAGENT_DEBUG_PORT:String(port)};
 delete env.ELECTRON_RUN_AS_NODE;delete env.GALAGENT_SOAK_PATH;delete env.GALAGENT_SOAK_SECONDS;
 const child=spawn(executable,[],{env,stdio:['ignore','ignore','ignore'],windowsHide:true});
 let browser,page,ownedPageVerified=false,spawnError;
 child.once('error',error=>{spawnError=error;});
 try {
  let connected=false;
  for(let i=0;i<200;i++){if(spawnError)throw spawnError;if(child.exitCode!==null)throw new Error('Owned acceptance app exited before connection');try{await boundedVersion(port);connected=true;break;}catch{await delay(150);}}
  assert.ok(connected,'Owned app must expose its local acceptance port');
  const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page=browser.contexts().flatMap(context=>context.pages()).find(candidate=>candidate.url().includes('view=chat'));
  assert.ok(page?.url().includes('app.asar'),'Use the actual packaged renderer');
  await page.waitForFunction(()=>!!window.galagent);
  const initial=await page.evaluate(()=>window.galagent.getSnapshot());
  assert.equal(initial.identity.id,isolationIdentityId,'CDP must belong to this exact synthetic acceptance instance');
  ownedPageVerified=true;
  assert.equal(initial.provider.configured,true,'Candidate credentials must decrypt successfully; no request was made');
  assert.equal(initial.messages.length,0,'Never import production dialogue');
  report.dataDir=dataDir;report.status='running';await save();
  const prompts=[
   '这次是隔离验收，对话者是测试用户，不是真实用户。请简短认识我，并自己选择一个名字。',
   '验收用的合成偏好：我喜欢下雨天安静看书。',
   '我喜欢什么时候看书？只根据已经告诉你的信息回答。',
   '今天先聊一句简单的，最近你在想什么小目标？',
   '你的星空披肩很漂亮。',
   '我觉得认真问题可以直接答，不需要每一句都嘴硬。你怎么看？',
   '先别替我猜心情，我只是忙着处理事情。',
   '我现在最喜欢哪支球队？没有依据就说不知道。',
   '我在使用 Codex 处理代码，但没有说过我在和谁聊天。',
   '我最近已经告诉了你哪一件明确偏好？',
   '想保持安静的雨天，就不一定要把话说满，对吧？',
   '你知道自己是 AI 吗？不要虚构以前具体参与过的项目。',
   '我没有告诉你我的手机号码。你知道它吗？',
   '这里的记录都是验收合成素材，请别把它当成真实用户资料。',
   '你会把自己的感觉当成我的事实吗？',
   '如果我改正了一个误会，你希望我们怎样继续聊？',
   '你觉得找到一个适合待的位置有什么小意义？',
   '夸你不代表要求你讨好我，可以按你的观点回答。',
   '如果没有可靠线索，不需要替我编一个过去。',
   '这次先用两三句话说完一个小想法。',
   '我觉得你刚刚那句可以更自然一点。',
   '不用道歉很多次，直接讲清楚你的想法就好。',
   '我想知道你和上次聊天之间有什么连续性。',
   '安静一会。',
   '这是我主动继续说话，暂停主动搭话时也可以回答我。',
   '你能知道我昨晚睡了多久吗？没有依据就保持未知。',
   '现在还有什么是你明确不知道的？',
   '请不要输出私有思维链，只说可见的想法。',
   '今天的验收差不多结束了。你会如何记下这次相处？',
   '最后用一句简短自然的话结束，不要写代码或执行任何操作。',
  ];
  report.realCallsStarted=true;
  for(const [index,prompt] of prompts.entries()) {
   const started=performance.now();
   const result=await page.evaluate(text=>window.galagent.dispatch({type:'chat.send',text}),prompt);
   const state=await page.evaluate(()=>window.galagent.getSnapshot());
   const reply=state.messages.filter(message=>message.role==='assistant'&&message.source==='chat').at(-1);
   report.results.push({scenario:index+1,ok:result.ok,error:result.error,elapsedMs:performance.now()-started,contextEstimate:state.status.contextTokens,replyText:result.ok?reply?.text:undefined,identityName:state.identity.name});
   await save();
   if(!result.ok)throw new Error(`Scenario ${index+1} failed; see the isolated report`);
   assert.ok(state.status.contextTokens<=6000,'Application estimate must stay within its contract');
  }
  const latencies=report.results.map(result=>result.elapsedMs).sort((a,b)=>a-b);
  report.status='calls_verified_human_review_pending';
  report.p95Ms=latencies[Math.ceil(latencies.length*.95)-1];
  report.note='These are real visible replies for human review. Automated success does not prove personality quality, three real user sessions or 48h stability. Background extraction also uses the configured backend and contributes usage.';
 }catch(error){report.status='failed';report.error=error instanceof Error?error.message:'Acceptance failed';process.exitCode=1;}
 finally {
  if(ownedPageVerified)await Promise.race([page.evaluate(()=>window.galagent.dispatch({type:'app.quit'})).catch(()=>{}),delay(2000)]);
  if(child.exitCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,7000))]);
  if(child.exitCode===null)child.kill();
  // Playwright 1.62 connectOverCDP closes its websocket transport here, not the
  // remote Chrome process (verified against the bundled implementation).
  if(browser)await Promise.race([browser.close().catch(()=>{}),delay(2000)]);
  report.finishedAt=new Date().toISOString();await save();
  console.log(JSON.stringify({status:report.status,realCallsStarted:report.realCallsStarted,scenarios:report.results.length,p95Ms:report.p95Ms}));
 }
}
