// Isolated real companion chat; never reads production memory or logs credentials.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {CompanionService} from '../runtime/core/companion';
async function main(){
const dir=path.resolve('.cache',`live-chat-check-${Date.now()}`);
await mkdir(dir,{recursive:true});
const key=(await readFile(((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/Desktop/mira反代/kimi-api/.local-api-key"),'utf8')).trim();
let requests=0;
const core=new CompanionService({dataDir:dir,credentials:{get:async()=>key,set:async()=>{}},embeddings:{encode:async()=>[1,0],close:async()=>{}},fetch:async(url,init)=>{requests++;return fetch(url,{...init,signal:init?.signal||AbortSignal.timeout(65000)});}});
try{
 await core.init();
 await core.handle({type:'config.save',baseUrl:'http://127.0.0.1:18890/v1',model:'kimi-code/k3'});
 const result=await core.handle({type:'chat.send',text:'这是隔离的连接验收。你好，请完成初次相遇、自己取名，用一句简短中文回应。不要委派任何任务。'});
 const state=core.getSnapshot();
 const report={at:new Date().toISOString(),passed:result.ok&&state.status.online&&state.identity.onboarding==='ready',realK3:true,scope:'current CompanionService main character chat over existing OpenAI proxy',requests,online:state.status.online,onboarding:state.identity.onboarding,responsePresent:state.messages.some(m=>m.role==='assistant'&&m.text.length>0),productionDataUsed:false,error:result.error};
 await writeFile('docs/evidence/主角色真实连接检查-20261010.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 if(!report.passed)process.exitCode=1;
}finally{await core.close();}
}
main().catch(error=>{console.error('Isolated chat check: '+String(error?.message||error).replace(/mira-local-[a-z0-9]+/gi,'[redacted]'));process.exitCode=1;});
