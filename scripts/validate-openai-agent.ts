// Real existing API, only a self-created fixture directory. Never calls Kimi CLI.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {OpenAIToolAgent} from '../runtime/core/openai-agent';
import sharp from 'sharp';
import {liveProvider} from './live-provider.mjs';
async function main(){
const {baseUrl,model,apiKey:key}=liveProvider();
const cwd=path.resolve('.cache',`live-openai-agent-${Date.now()}`);await mkdir(cwd,{recursive:true});
const nonce='LIVE_TOOLS_'+randomUUID();await writeFile(path.join(cwd,'fixture.txt'),nonce+'\nold\n');
let requests=0,usage=0,toolsAdvertised=0,thinkingReplayed=false;
const agent=new OpenAIToolAgent({provider:()=>({baseUrl,model}),credentials:{get:async()=>key},ask:async()=>({}),onUsage:value=>{usage+=value;},fetch:async(url,init)=>{requests++;const body=JSON.parse(String(init?.body));toolsAdvertised=body.tools?.length ?? toolsAdvertised;thinkingReplayed ||= body.messages.some((m:any)=>m.role==='assistant'&&typeof m.reasoning_content==='string');return fetch(url,init);}});
const controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),180000);
try{
 const result=await agent.run('本次是隔离工具适配验收，只在当前任务目录操作。先用Read读取fixture.txt；用Edit把第二行old改为new，其他内容不动；再用Read核验。最终原样给出文件的两行内容。不要调用CLI，不要写其他文件，不要创建Goal或Cron。',cwd,controller.signal);
 const content=await readFile(path.join(cwd,'fixture.txt'),'utf8');assert.equal(content,nonce+'\nnew\n');assert.equal(result.stopReason,'end_turn');assert.ok(result.summary.includes(nonce));assert.ok(result.summary.includes('new'));assert.ok(result.tools.some(t=>t.title==='Read'));assert.ok(result.tools.some(t=>t.title==='Edit'));assert.equal(toolsAdvertised,27);
 const report={passed:true,scope:'explicit OpenAI-compatible endpoint with isolated Read/Edit/Read',toolsAdvertised,requests,totalTokens:usage,toolNames:result.tools.map(t=>t.title),fileVerified:true,finalAnswerVerified:true,thinkingHistoryReplayed:thinkingReplayed,cliUsed:false,proxyModified:false};await writeFile(path.join(cwd,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(process.argv.includes('--media')){
  await sharp({create:{width:48,height:48,channels:3,background:'#00ff00'}}).png().toFile(path.join(cwd,'media.png'));
  const media=await agent.run('继续隔离验收：用ReadMediaFile读取当前目录media.png。只根据图像，说出整张图的主色是红色、绿色还是蓝色；不要从文件名猜测。',cwd,controller.signal);assert.ok(media.tools.some(t=>t.title==='ReadMediaFile'));assert.ok(media.summary.includes('绿'));const mediaReport={passed:true,scope:'explicit OpenAI-compatible model receives a tool image',toolName:'ReadMediaFile',colorVerified:true,cliUsed:false};await writeFile(path.join(cwd,'media-result.json'),JSON.stringify(mediaReport,null,2));console.log(JSON.stringify(mediaReport));
 }
}finally{clearTimeout(deadline);agent.close();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Validation failed');process.exitCode=1;});
