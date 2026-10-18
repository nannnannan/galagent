// Isolated packaged personality check. Formal user data is never imported.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const root=process.cwd(),dataDir=path.join(root,'.cache','unified-native-'+Date.now());await mkdir(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'companion.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL)');
const id=randomUUID(),identity={id,name:'星棱',onboarding:'ready',stage:'S4'};
db.prepare('INSERT INTO records VALUES(?,?,?)').run('identity','state',JSON.stringify(identity));db.close();
const errors=[],observations=[];
const server=createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw),prompt=body.messages[0].content;
assert.match(prompt,/弹钢琴/);assert.match(prompt,/很好哄/);assert.doesNotMatch(prompt,/stageMeaning|不黏人|三无适应|安静傲娇/);
let content;
if(prompt.includes('facts每项'))content={facts:[],diary:''};else{const context=JSON.parse(prompt.split('\n状态数据：')[1]);assert.equal(context.variables.personality,'unified');assert.equal('stage' in context.identity,false);assert.equal('stage' in context.variables,false);observations.push({personality:context.variables.personality,hobbies:context.variables.core.hobbies});content={text:'[隔离协议测试] 统一人设已载入。',expression:'pleased',action:'celebrate'};}
res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(content)}}],usage:{total_tokens:30}}));
}catch(error){errors.push(String(error));res.writeHead(500);res.end('{}');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,GALAGENT_DATA_DIR:dataDir,GALAGENT_DEBUG_PORT:'9348',KIMI_API_KEY:'',MOONSHOT_API_KEY:''};delete env.ELECTRON_RUN_AS_NODE;
const exe=path.join(root,'release/unified-persona/win-unpacked/GalAgent.exe');
let child,connection,pet;
try{
child=spawn(exe,[],{env,windowsHide:true,stdio:'ignore'});
for(let i=0;i<150;i++){try{await fetch('http://127.0.0.1:9348/json/version');break;}catch{await new Promise(r=>setTimeout(r,100));}}
connection=await chromium.connectOverCDP('http://127.0.0.1:9348');
for(let i=0;i<100;i++){pet=connection.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('view=pet'));if(pet)break;await new Promise(r=>setTimeout(r,100));}
await pet.waitForFunction(()=>!!window.galagent);
const send=async command=>{const result=await pet.evaluate(c=>window.galagent.dispatch(c),command);assert.equal(result.ok,true,result.error);};
await send({type:'config.save',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'kimi-code/k3',apiKey:'isolated-fixture'});
await send({type:'chat.send',text:'统一人设隔离验证'});
let state=await pet.evaluate(()=>window.galagent.getSnapshot());
assert.equal(state.identity.id,id);assert.equal(state.identity.name,'星棱');assert.equal(state.identity.stage,'S4');assert.equal(state.variables.expression.stage,'unified');assert.equal(state.visual.action,'celebrate');assert.equal(state.visual.intensity,0.85);assert.deepEqual(errors,[]);
const replies=[];
if(process.argv.includes('--live')){
const key=(await readFile(((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/Desktop/mira反代/kimi-api/.local-api-key"),'utf8')).trim();
await send({type:'config.save',baseUrl:'http://127.0.0.1:18890/v1',model:'kimi-code/k3',apiKey:key});
for(const prompt of ['你平时喜欢做什么？','刚才用了会儿其他Agent，现在回来陪你啦，抱抱。']){
await send({type:'chat.send',text:prompt});state=await pet.evaluate(()=>window.galagent.getSnapshot());assert.equal(state.status.online,true);const reply=[...state.messages].reverse().find(m=>m.role==='assistant'&&m.source==='chat');assert.ok(reply?.text);replies.push({prompt,text:reply.text,expression:state.visual.expression,action:state.visual.action});}
assert.match(replies[0].text,/钢琴/);
}
const report={at:new Date().toISOString(),passed:true,scope:'actual unified-persona packaged app, isolated legacy S4 identity',legacyIdentityPreserved:true,stageRemovedFromModelContext:true,stageDoesNotLimitActions:true,realK3:process.argv.includes('--live'),productionDataUsed:false,observations,replies};
await writeFile('docs/evidence/统一人设原生验收.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await pet?.evaluate(()=>window.galagent.dispatch({type:'app.quit'})).catch(()=>{});if(child?.exitCode===null)await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,4000))]);if(child?.exitCode===null)child.kill();await connection?.close().catch(()=>{});await new Promise(r=>server.close(r));}
