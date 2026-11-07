// Packaged care continuity and native-API fallback, using only an isolated profile and a loopback fixture.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {_electron}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const profile=await mkdtemp(path.join(tmpdir(),'gal-care-native-'));
const db=new DatabaseSync(path.join(profile,'companion.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL)');
db.prepare('INSERT INTO records VALUES(?,?,?)').run('settings','state',JSON.stringify({
 observationEnabled:false,screenCaptureEnabled:false,clipboardEnabled:false,ttsEnabled:false,shareDailyLimit:0,recallEveryDays:0,researchEnabled:false}));
db.close();
let asks=0,formatRejected=0,lastStatus,unexpected='';
const server=createServer(async(req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.method==='GET'&&req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'native-fixture'}]}));return;}
 if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
 try{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);
  if(body.response_format){formatRejected++;res.writeHead(400).end(JSON.stringify({error:{param:'response_format',message:'response_format unsupported'}}));return;}
  const sys=String(body.messages[0].content),text=String(body.messages.at(-1).content);
  let answer={text:'记住了。',expression:'neutral',action:'idle'};
  if(sys.includes('facts每项'))answer={facts:[],diary:''};
  else if(sys.includes('状态数据：')){
   const ctx=JSON.parse(sys.split('\n状态数据：')[1]),event=ctx.careEvents?.[0];
   lastStatus=event?.status;
   if(text==='我明天下午面试')answer.careUpdates=[{title:'面试',quote:text,when:'明天下午',status:'open'}];
   if(text==='改到下周一上午了')answer.careUpdates=[{id:event.id,quote:text,when:'下周一上午',status:'open'}];
   if(text==='通过了')answer.careUpdates=[{id:event.id,quote:text,status:'resolved'}];
   if(ctx.scene==='initiative'&&ctx.wake?.reason==='跟进用户正在经历的事'){asks++;answer.text='面试后来怎么样了？';}
  } else answer={decision:'silent',reason:'无',evidence:[],nextCheck:null};
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(answer)}}]}));
 }catch(error){unexpected=String(error);res.writeHead(500).end('{}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const env={...process.env,GALAGENT_DATA_DIR:profile,GALAGENT_API_KEY:'',KIMI_API_KEY:'',MOONSHOT_API_KEY:''};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 const clock=async now=>app.evaluate((_electron,n)=>{Date.now=()=>n;},now);
 async function launch(now){
  app=await _electron.launch({executablePath:path.resolve(process.env.GALAGENT_TEST_EXE||'release/win-unpacked/GalAgent.exe'),env,timeout:60000});
  await clock(now);
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.galagent);
  return {page,send:async command=>{const r=await page.evaluate(c=>window.galagent.dispatch(c),command);assert.equal(r.ok,true,r.error);}};
 }
 let f=await launch(new Date(2026,10,6,14).getTime());
 await f.send({type:'config.save',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'native-fixture',mode:'native-api',apiKey:'fixture'});
 await f.send({type:'chat.send',text:'我明天下午面试'});
 await f.send({type:'chat.send',text:'改到下周一上午了'});
 await clock(new Date(2026,10,7,20).getTime());
 await f.send({type:'chat.send',text:'我回来了'});
 await clock(new Date(2026,10,7,20,2).getTime());
 await new Promise(r=>setTimeout(r,11000));assert.equal(asks,0,'old appointment must not trigger a question');
 await clock(new Date(2026,10,9,14).getTime());
 await f.send({type:'chat.send',text:'我到家了'});
 await clock(new Date(2026,10,9,14,2).getTime());
 const deadline=Date.now()+35000;
 while(Date.now()<deadline){
  const snapshot=await f.page.evaluate(()=>window.galagent.getSnapshot());
  if(snapshot.messages.some(m=>m.source==='initiative'&&m.text==='面试后来怎么样了？'))break;
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(asks,1,'follow-up after revised date: '+unexpected);
 await f.send({type:'chat.send',text:'通过了'});
 await app.close();app=undefined;
 f=await launch(new Date(2026,10,10,14).getTime());
 await f.send({type:'chat.send',text:'还记得面试吗'});
 assert.equal(lastStatus,'resolved');
 await clock(new Date(2026,10,10,14,3).getTime());
 await new Promise(r=>setTimeout(r,11000));assert.equal(asks,1);assert.equal(unexpected,'');
 console.log(JSON.stringify({passed:true,changedDateHonored:true,askedOnce:true,resolutionSurvivedRestart:true,jsonModeFallback:formatRejected>0}));
}finally{await app?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
