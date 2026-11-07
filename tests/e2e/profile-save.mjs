// Crash/restart proof for the same explicit profile that desktop shortcuts can select.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const {_electron}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const root=path.join(process.cwd(),'.cache','profile-save-'+Date.now());
const profile=path.join(root,'profile');await mkdir(profile,{recursive:true});
const server=createServer(async(req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.method==='GET'){res.end(JSON.stringify({data:[{id:'fixture'}]}));return;}
 let raw='';for await(const c of req)raw+=c;
 const body=JSON.parse(raw),system=String(body.messages?.[0]?.content);
 const data=system.includes('facts每项')?{facts:[],diary:''}:{text:'AUTOSAVE_REPLY',expression:'neutral',action:'idle'};
 res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(data)}}]}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const db=new DatabaseSync(path.join(profile,'companion.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL)');
const put=db.prepare('INSERT INTO records VALUES(?,?,?)');
put.run('provider','state',JSON.stringify({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',mode:'native-api'}));
put.run('settings','state',JSON.stringify({observationEnabled:false,screenCaptureEnabled:false,clipboardEnabled:false,initiativeEnabled:false,researchEnabled:false,ttsEnabled:false}));
db.close();
const env={...process.env,GALAGENT_DATA_DIR:'',GALAGENT_API_KEY:'fixture',KIMI_API_KEY:'',MOONSHOT_API_KEY:''};delete env.ELECTRON_RUN_AS_NODE;
let app;
async function launch(){
 app=await _electron.launch({executablePath:path.resolve(process.env.GALAGENT_TEST_EXE||'release/win-unpacked/GalAgent.exe'),args:['--profile-directory='+profile],env,timeout:60000});
 const actual=await app.evaluate(({app})=>({data:app.getPath('userData'),cache:app.getPath('sessionData')}));
 assert.equal(path.resolve(actual.data),path.resolve(profile));assert.equal(path.resolve(actual.cache),path.resolve(profile));
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.galagent);
 return {page,send:async c=>{const r=await page.evaluate(c=>window.galagent.dispatch(c),c);assert.equal(r.ok,true,r.error);}};
}
try{
 let f=await launch();
 await f.send({type:'chat.send',text:'AUTOSAVE_INPUT'});
 await f.send({type:'memory.remember',text:'我喜欢测试保存功能'});
 await f.send({type:'settings.update',settings:{petScale:1.3}});
 const before=await f.page.evaluate(()=>window.galagent.getSnapshot());
 assert.ok(before.status.storage.savedAt);assert.equal(path.resolve(before.status.storage.directory),path.resolve(profile));
 const process=app.process();const exited=new Promise(resolve=>process.once('exit',resolve));
 process.kill();await exited;await app.close().catch(()=>{});app=undefined;
 f=await launch();
 const after=await f.page.evaluate(()=>window.galagent.getSnapshot());
 assert.ok(after.messages.some(m=>m.text==='AUTOSAVE_INPUT'));
 assert.ok(after.messages.some(m=>m.text==='AUTOSAVE_REPLY'));
 assert.ok(after.memories.some(m=>m.text==='我喜欢测试保存功能'));
 assert.equal(after.settings.petScale,1.3);
 assert.equal(after.identity.id,before.identity.id);
 assert.equal(after.status.storage.directory,before.status.storage.directory);
 console.log(JSON.stringify({passed:true,forcedExit:true,chatRestored:true,memoryRestored:true,settingsRestored:true,sameProfile:true,isolated:true}));
}finally{
 await app?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});
}
