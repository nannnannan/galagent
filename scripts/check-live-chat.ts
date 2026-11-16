// Isolated real companion chat; never reads production memory or logs credentials.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {CompanionService} from '../runtime/core/companion';
import {liveProvider} from './live-provider.mjs';
async function main(){
const {baseUrl,model,apiKey:key}=liveProvider();
const dir=path.resolve('.cache',`live-chat-check-${Date.now()}`);
await mkdir(dir,{recursive:true});
let requests=0;
const core=new CompanionService({dataDir:dir,credentials:{get:async()=>key,set:async()=>{}},embeddings:{encode:async()=>[1,0],close:async()=>{}},fetch:async(url,init)=>{requests++;return fetch(url,{...init,signal:init?.signal||AbortSignal.timeout(65000)});}});
try{
 await core.init();
 await core.handle({type:'config.save',baseUrl,model});
 const result=await core.handle({type:'chat.send',text:'这是隔离的连接验收。你好，请完成初次相遇、自己取名，用一句简短中文回应。不要委派任何任务。'});
 const state=core.getSnapshot();
 const report={at:new Date().toISOString(),passed:result.ok&&state.status.online&&state.identity.onboarding==='ready',liveApi:true,scope:'isolated CompanionService chat over an explicit OpenAI-compatible endpoint',requests,online:state.status.online,onboarding:state.identity.onboarding,responsePresent:state.messages.some(m=>m.role==='assistant'&&m.text.length>0),productionDataUsed:false,error:result.error};
 await writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 if(!report.passed)process.exitCode=1;
}finally{await core.close();}
}
main().catch(error=>{const key=process.env.GALAGENT_TEST_API_KEY;const message=String(error?.message||error);console.error('Isolated chat check: '+(key?message.split(key).join('[redacted]'):message));process.exitCode=1;});
