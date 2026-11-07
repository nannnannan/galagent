'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const {native,loadAuth,build} = require('./native-runtime.cjs');
const origin='https://relay.mirasim.ai';
const port=Number(process.env.MIRA_PROXY_PORT||18890);
const DEFAULT_MODEL='kimi-k3';
const MODEL_ALIASES=new Map([
 ['kimi-k3.1-pro','kimi-k3.1-pro'],['kimi-code/k3.1-pro','kimi-k3.1-pro'],
 ['kimi-code/k3.1','kimi-k3.1-pro'],['k3.1','kimi-k3.1-pro'],['k3.1-pro','kimi-k3.1-pro'],
 ['kimi-code/k3','kimi-k3'],['kimi-k3','kimi-k3'],['k3','kimi-k3'],
]);
const keyPath=path.join(__dirname,'.local-api-key');
if(!fs.existsSync(keyPath))fs.writeFileSync(keyPath,'mira-local-'+crypto.randomBytes(24).toString('hex'),{mode:0o600,flag:'wx'});
const localKey=fs.readFileSync(keyPath,'utf8').trim();
let ticketCache=null, ticketPending=null;
function signed(a,p,body,credential,seal=true,method='POST'){
 const headers={'content-type':'application/json',authorization:'Bearer '+credential,...native.sign(a.device,{method,path:p,body,credential})};
 if(seal)native.seal(headers,method,p);
 return headers;
}
async function getTicket(a){
 if(ticketCache?.issuer===a.token&&ticketCache.until>Date.now()+60000)return ticketCache.token;
 if(ticketPending)return ticketPending;
 ticketPending=(async()=>{
  const p='/v1/device/session',body=JSON.stringify({publicKey:a.device.publicKeyB64,deviceId:a.device.deviceId});
  const r=await fetch(origin+p,{method:'POST',headers:signed(a,p,body,a.token,false),body,signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!r.ok){const e=new Error('Mira device session refused: HTTP '+r.status);e.status=r.status;await r.body?.cancel();throw e;}
  const d=await r.json();if(typeof d.ticket!=='string')throw new Error('Invalid Mira device session response');
  ticketCache={issuer:a.token,token:d.ticket,until:Date.now()+Math.max(0,Number(d.expiresIn)||60)*1000};
  return d.ticket;
 })().finally(()=>{ticketPending=null;});
 return ticketPending;
}
function json(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));}
function fail(res,status,message){if(!res.headersSent)json(res,status,{error:{message,type:'proxy_error'}});else res.destroy();}
function authorized(req){
 const given=Buffer.from((req.headers.authorization||'').replace(/^Bearer\s+/i,''));
 const expected=Buffer.from(localKey);return given.length===expected.length&&crypto.timingSafeEqual(given,expected);
}
async function readBody(req){
 const chunks=[];let size=0;
 for await(const b of req){size+=b.length;if(size>16*1024*1024){const e=new Error('Request exceeds 16 MiB');e.status=413;throw e;}chunks.push(b);}
 return Buffer.concat(chunks);
}
const server=http.createServer(async(req,res)=>{
 const p=(req.url||'').split('?')[0];
 if(!authorized(req)){fail(res,401,'Supply the local API key');return;}
 if(req.method==='GET'&&p==='/health'){json(res,200,{status:'running',upstream:origin,version:build.version,bundleSha256:build.sha256,defaultModel:DEFAULT_MODEL});return;}
 if(req.method==='GET'&&p==='/v1/models'){
  try{loadAuth();json(res,200,{object:'list',data:[...MODEL_ALIASES.keys()].map(id=>({id,object:'model',created:0,owned_by:'mirasim'}))});}
  catch{fail(res,503,'Cannot read Mira login or model catalog');}return;
 }
 if(req.method!=='POST'||p!=='/v1/chat/completions'){fail(res,404,'Unsupported API route');return;}
 const controller=new AbortController();
 const onClose=()=>{if(!res.writableFinished)controller.abort();};res.on('close',onClose);
 const timer=setTimeout(()=>controller.abort(),180000);
 try{
  const bytes=await readBody(req);let payload;
  try{payload=JSON.parse(bytes.toString('utf8'));}catch{fail(res,400,'Body must be JSON');return;}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)){fail(res,400,'Body must be a JSON object');return;}
  if(payload.model===undefined)payload.model=DEFAULT_MODEL;
  if(typeof payload.model!=='string'||!MODEL_ALIASES.has(payload.model)){fail(res,400,'Unsupported model; query /v1/models for available aliases');return;}
  payload.model=MODEL_ALIASES.get(payload.model);
  const upstreamBody=Buffer.from(JSON.stringify(payload));
  const a=loadAuth();
  if(a.exp*1000<=Date.now()){fail(res,401,'Mira login expired. Open Mira desktop to renew your login.');return;}
  const ticket=await getTicket(a);
  const headers=signed(a,p,upstreamBody,ticket);
  const upstream=await fetch(origin+p,{method:'POST',headers,body:upstreamBody,signal:controller.signal,redirect:'error'});
  if(upstream.status===401)ticketCache=null;
  const responseHeaders={'content-type':upstream.headers.get('content-type')||'application/json','cache-control':'no-store'};
  for(const name of ['retry-after','x-request-id']){const v=upstream.headers.get(name);if(v)responseHeaders[name]=v;}
  res.writeHead(upstream.status,responseHeaders);
  if(upstream.body)await pipeline(Readable.fromWeb(upstream.body),res);else res.end();
  console.log(new Date().toISOString(),p,upstream.status);
 }catch(e){fail(res,e.status||502,e.name==='AbortError'?'Request cancelled or timed out':'Request failed: '+e.message);}
 finally{clearTimeout(timer);res.off('close',onClose);}
});
server.requestTimeout=200000;
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log('Mira local API: http://127.0.0.1:'+port+'/v1\nAPI key file: '+keyPath));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>process.exit(0)));
