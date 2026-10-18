// Real existing API, only a self-created fixture directory. Never calls Kimi CLI.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {OpenAIToolAgent} from '../runtime/core/openai-agent';
import sharp from 'sharp';
async function main(){
const key=(await readFile(((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/Desktop/mira反代/kimi-api/.local-api-key"),'utf8')).trim();
const cwd=path.resolve('.cache',`live-openai-agent-${Date.now()}`);await mkdir(cwd,{recursive:true});
const nonce='LIVE_TOOLS_'+randomUUID();await writeFile(path.join(cwd,'fixture.txt'),nonce+'\nold\n');
let requests=0,usage=0,toolsAdvertised=0,thinkingReplayed=false;
const agent=new OpenAIToolAgent({provider:()=>({baseUrl:'http://127.0.0.1:18890/v1',model:'kimi-code/k3'}),credentials:{get:async()=>key},ask:async()=>({}),onUsage:value=>{usage+=value;},fetch:async(url,init)=>{requests++;const body=JSON.parse(String(init?.body));toolsAdvertised=body.tools.length;thinkingReplayed ||= body.messages.some((m:any)=>m.role==='assistant'&&typeof m.reasoning_content==='string');return fetch(url,init);}});
const controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),180000);
try{
 const result=await agent.run('本次是隔离工具适配验收，只在当前任务目录操作。先用Read读取fixture.txt；用Edit把第二行old改为new，其他内容不动；再用Read核验。最终原样给出文件的两行内容。不要调用CLI，不要写其他文件，不要创建Goal或Cron。',cwd,controller.signal);
 const content=await readFile(path.join(cwd,'fixture.txt'),'utf8');assert.equal(content,nonce+'\nnew\n');assert.equal(result.stopReason,'end_turn');assert.ok(result.summary.includes(nonce));assert.ok(result.summary.includes('new'));assert.ok(result.tools.some(t=>t.title==='Read'));assert.ok(result.tools.some(t=>t.title==='Edit'));assert.equal(toolsAdvertised,25);assert.ok(thinkingReplayed);
 const report={passed:true,scope:'formal GalAgent OpenAI executor -> existing 18890 proxy -> K3 -> Read/Edit/Read -> final verified result',toolsAdvertised,requests,totalTokens:usage,toolNames:result.tools.map(t=>t.title),fileVerified:true,finalAnswerVerified:true,thinkingHistoryReplayed:thinkingReplayed,cliUsed:false,proxyModified:false};await writeFile('docs/evidence/OpenAI执行器真实验收.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(process.argv.includes('--media')){
  await sharp({create:{width:48,height:48,channels:3,background:'#00ff00'}}).png().toFile(path.join(cwd,'media.png'));
  const media=await agent.run('继续隔离验收：用ReadMediaFile读取当前目录media.png。只根据图像，说出整张图的主色是红色、绿色还是蓝色；不要从文件名猜测。',cwd,controller.signal);assert.ok(media.tools.some(t=>t.title==='ReadMediaFile'));assert.ok(media.summary.includes('绿'));const mediaReport={passed:true,scope:'real K3 receives actual ReadMediaFile image_url output through existing OpenAI-compatible proxy',toolName:'ReadMediaFile',colorVerified:true,cliUsed:false};await writeFile('docs/evidence/OpenAI媒体真实验收.json',JSON.stringify(mediaReport,null,2));console.log(JSON.stringify(mediaReport));
 }
}finally{clearTimeout(deadline);agent.close();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Validation failed');process.exitCode=1;});
