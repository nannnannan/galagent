// Packaged UI proof: visible progress, cancellation, failure and retry, with isolated data only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {_electron}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const root=path.resolve('.cache','research-progress-'+Date.now());await mkdir(root,{recursive:true});
let mode='hang',mcpCalls=0,mcpSource='';
const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.method==='GET'){res.end(JSON.stringify({data:[{id:'fixture'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),system=String(body.messages?.[0]?.content);
  if(req.url==='/mcp'){
    if(!body.id){res.writeHead(202);res.end();return;}
    let result;
    if(body.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{}};
    else if(body.method==='tools/list')result={tools:[{name:'lookup',description:'查询展览资料',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']},annotations:{readOnlyHint:true}}]};
    else {mcpCalls++;result={content:[{type:'text',text:'展览周六开幕。'}]};}
    res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));return;
  }
  if(system.includes('派出去的并行助手')){
    if(mode==='hang')return;
    if(mode==='fail'){res.writeHead(400);res.end('{}');return;}
    if(mode==='mcp' && body.tools?.some(t=>t.function.name==='mcp__library__lookup')){
      if(!body.messages.some(m=>m.role==='tool')){
        res.end(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[{id:'lookup',type:'function',function:{name:'mcp__library__lookup',arguments:'{"query":"胶片摄影"}'}}]},finish_reason:'tool_calls'}]}));return;
      }
      const output=JSON.parse(body.messages.find(m=>m.role==='tool').content);mcpSource=output.sources[0].url;
      res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({gist:'展览周六开幕',points:['周六开幕'],sources:output.sources})}}]}));return;
    }
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({gist:'没有可用原文',points:[],sources:[]})}}]}));return;
  }
  const data=system.includes('facts每项')?{facts:[],diary:''}:system.includes('在替用户研究')?{findings:[{title:'周六展览',summary:'展览周六开幕',sources:[{title:'MCP library',url:mcpSource}],confidence:3}]}:{text:'你好',expression:'neutral',action:'idle'};
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(data)}}]}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const db=new DatabaseSync(path.join(root,'companion.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL)');
const put=db.prepare('INSERT INTO records VALUES(?,?,?)');
put.run('provider','state',JSON.stringify({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',mode:'native-api'}));
put.run('settings','state',JSON.stringify({observationEnabled:false,screenCaptureEnabled:false,clipboardEnabled:false,initiativeEnabled:false,researchEnabled:false,ttsEnabled:false}));
put.run('research','state',JSON.stringify({version:1,interests:[{id:'film',topic:'胶片摄影',kind:'hobby',why:'手动添加',sources:['manual'],weight:4,angles:[{angle:'新动态',query:'胶片摄影'}],createdAt:Date.now(),lastResearchedAt:Date.now()}],findings:[],blocked:[],runs:[Date.now()],lastPlanAt:Date.now()}));
db.close();
const env={...process.env,GALAGENT_DATA_DIR:root,GALAGENT_API_KEY:'fixture',KIMI_API_KEY:'',MOONSHOT_API_KEY:''};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
  app=await _electron.launch({executablePath:path.resolve(process.env.GALAGENT_TEST_EXE||'release/win-unpacked/GalAgent.exe'),env,timeout:60000});
  const pet=await app.firstWindow();await pet.waitForFunction(()=>!!window.galagent);
  const until=async check=>{let snapshot;for(const deadline=Date.now()+20000;Date.now()<deadline;){snapshot=await pet.evaluate(()=>window.galagent.getSnapshot());if(check(snapshot))return snapshot;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Snapshot condition timed out: '+JSON.stringify(snapshot?.research?.progress));};
  const send=async c=>{const result=await pet.evaluate(c=>window.galagent.dispatch(c),c);assert.equal(result.ok,true,result.error);};
  await send({type:'chat.send',text:'你好'});
  await send({type:'settings.update',settings:{researchEnabled:true}});
  await send({type:'shell.chat',open:true});
  const page=app.windows().find(p=>p.url().includes('view=chat'));
  assert.ok(page,'notebook window exists');
  await page.locator('nav').getByRole('button',{name:/记忆/}).click();
  await page.getByRole('button',{name:'现在研究一下',exact:true}).click();
  await until(s=>s.research.progress.stage==='reading');
  assert.equal(await page.getByRole('button',{name:'正在研究…',exact:true}).isDisabled(),true);
  assert.match(await page.locator('.research-progress').innerText(),/搜索并阅读原文/);
  await page.getByRole('button',{name:'停止本次研究',exact:true}).click();
  await until(s=>s.research.progress.stage==='cancelled');
  mode='fail';await page.getByRole('button',{name:'现在研究一下',exact:true}).click();
  await until(s=>s.research.progress.stage==='failed');
  assert.match(await page.locator('.research-progress').innerText(),/HTTP 400/);
  mode='empty';await page.getByRole('button',{name:'现在研究一下',exact:true}).click();
  await until(s=>s.research.progress.stage==='done');
  assert.match(await page.locator('.research-progress').innerText(),/没有找到/);
  await page.screenshot({path:path.resolve('.cache/research-progress-evidence.png')});
  mode='mcp';
  await send({type:'settings.update',settings:{sandbox:{level:'full'},mcpServers:[{name:'library',enabled:true,url:`http://127.0.0.1:${server.address().port}/mcp`}]}});
  await send({type:'mcp.restart'});
  await until(s=>s.agent.mcp?.[0]?.state==='ready');
  await page.locator('nav').getByRole('button',{name:/连接/}).click();
  const fold=page.locator('details').filter({has:page.locator('summary').filter({hasText:'主动研究工具'})});
  await fold.locator('summary').click();
  await fold.getByRole('switch',{name:/lookup/}).check();
  await until(s=>s.settings.mcpServers[0].researchTools?.includes('lookup'));
  assert.equal((await page.evaluate(()=>window.galagent.getSnapshot())).agent.mcp[0].state,'ready','selection does not restart MCP');
  await page.locator('nav').getByRole('button',{name:/记忆/}).click();
  await page.getByRole('button',{name:'现在研究一下',exact:true}).click();
  await until(s=>s.research.findings.some(f=>f.sources.some(source=>source.url.startsWith('mcp://'))));
  assert.equal(mcpCalls,1);assert.match(await page.locator('.finding-sources').innerText(),/mcp:\/\/library\/lookup\//);
  await page.screenshot({path:path.resolve('.cache/research-mcp-evidence.png')});
  console.log(JSON.stringify({passed:true,version:await app.evaluate(({app})=>app.getVersion()),progress:true,cancel:true,failure:true,retry:true,recentInterestRerun:true,mcpSelection:true,mcpResearch:true,mcpSource:true,isolated:true}));
}finally{
  await app?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});
}
