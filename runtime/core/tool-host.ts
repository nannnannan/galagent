import {spawn,type ChildProcess} from 'node:child_process';
import {readFile,writeFile,mkdir,stat,readdir,realpath,rename,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {existsSync,realpathSync,statSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {homedir,tmpdir} from 'node:os';
import Ajv from 'ajv';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import definitions from '../assets/protocol/kimi-code-tools-0.29.2.json';
import type {ModelMessage} from './tool-protocol';

export type Question={question:string;options:{label:string;description?:string}[];header?:string;multi_select?:boolean};
export type HostSession={id:string;cwd:string;parentId?:string;provider?:{baseUrl:string;model:string};profile:string;messages:ModelMessage[];notifications?:string[];reads:Record<string,string>;todos:any[];plan:boolean;planFile:string;goal?:any;crons:CronJob[];usage:number;turns:number;createdAt:number;};
type CronJob={id:string;cron:string;prompt:string;recurring:boolean;nextAt:number;createdAt:number;expiresAt:number};
export type HostTask={id:string;owner:string;kind:'shell'|'agent'|'question';description:string;status:'queued'|'running'|'done'|'failed'|'cancelled'|'lost';output:string;createdAt:number;exitCode?:number;pid?:number;agentId?:string};
export type VideoUpload={data:Buffer;mimeType:string;filename:string;session:HostSession};
type ToolOutput={content:string;attachments?:unknown[];parts?:unknown[]};
export type HostHooks={save:(session:HostSession)=>void;saveTask?:(task:HostTask)=>void;ask:(questions:Question[],signal:AbortSignal)=>Promise<Record<string,string>>;child:(session:HostSession,prompt:string,signal:AbortSignal)=>Promise<string>;onBackground?:(task:HostTask)=>void;uploadVideo?:(upload:VideoUpload,signal:AbortSignal)=>Promise<{id:string}|undefined>;forbiddenPaths?:()=>string[];policyVersion?:()=>number};
const VIDEO_EXT_MIMES:Record<string,string>={'.mp4':'video/mp4','.mpeg':'video/mpeg','.mpg':'video/mpeg','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.avi':'video/x-msvideo','.flv':'video/x-flv','.3gp':'video/3gpp'};
export function detectVideoMime(file:string,header?:Buffer):string|undefined {
 if(header&&header.length>=12&&header.subarray(4,8).toString('ascii')==='ftyp'){const brand=header.subarray(8,12).toString('ascii');return brand==='qt  '?'video/quicktime':brand.startsWith('3gp')?'video/3gpp':'video/mp4';}
 if(header&&header.length>=4&&header[0]===0x1a&&header[1]===0x45&&header[2]===0xdf&&header[3]===0xa3)return header.subarray(0,64).toString('latin1').toLowerCase().includes('webm')?'video/webm':'video/x-matroska';
 if(header&&header.length>=12&&header.subarray(0,4).toString('ascii')==='RIFF'&&header.subarray(8,12).toString('ascii')==='AVI ')return'video/x-msvideo';
 if(header&&header.length>=3&&header.subarray(0,3).toString('ascii')==='FLV')return'video/x-flv';
 if(header&&header.length>=4&&header[0]===0x00&&header[1]===0x00&&header[2]===0x01&&(header[3]===0xba||header[3]===0xb3))return'video/mpeg';
 return VIDEO_EXT_MIMES[path.extname(file).toLowerCase()];
}
const hasVideoMagic=(header:Buffer)=>Boolean(detectVideoMime('',header));
const digest=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
const bounded=(text:string,max=50000)=>text.length<=max?text:text.slice(0,max)+'\n[Output truncated]';
const secret=(file:string)=>/^(\.env(?:\..*)?|id_rsa|id_ed25519|id_ecdsa|credentials\.json)$/i.test(path.basename(file));
const active=(task:HostTask)=>['queued','running'].includes(task.status);
const failure=(message:string)=>({content:'ToolError: '+message});
export function canonicalizePath(target:string,cwd=process.cwd()):string {
 let raw=target.trim();
 if(process.platform==='win32'&&/^\/[a-z](?:\/|$)/i.test(raw))raw=raw[1]+':'+raw.slice(2);
 if(raw==='~'||raw.startsWith('~/')||raw.startsWith('~\\'))raw=path.join(homedir(),raw.slice(1));
 const abs=path.resolve(cwd,raw);
 let cur=abs;
 const suffix:string[]=[];
 while(true){
  try{
   const real=(realpathSync.native||realpathSync)(cur);
   return path.normalize(suffix.length?path.join(real,...suffix.reverse()):real);
  }catch{
   const parent=path.dirname(cur);
   if(parent===cur)return path.normalize(abs);
   suffix.push(path.basename(cur));
   cur=parent;
  }
 }
}
const normCompare=(p:string)=>process.platform==='win32'?p.replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase():p.replace(/\/+$/,'');
const isSubOrEqual=(cand:string,rule:string)=>{const c=normCompare(cand),r=normCompare(rule);return Boolean(r)&&(c===r||c.startsWith(r+(process.platform==='win32'?'\\':'/')));};
function sharesForbiddenHardlink(resolvedFile:string,canonicalRules:string[]):boolean {
 try{
  const st=statSync(resolvedFile,{bigint:true,throwIfNoEntry:false});
  if(!st||!st.isFile()||st.nlink<=1n||st.ino<=0n)return false;
  let scanned=0;
  const checkDir=(dir:string):boolean=>{
   if(scanned>1500)return false;
   let entries;
   try{entries=readdirSync(dir,{withFileTypes:true});}catch{return false;}
   for(const entry of entries){
    if(++scanned>1500)return false;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(checkDir(full))return true;}
    else if(entry.isFile()){
     try{const es=statSync(full,{bigint:true,throwIfNoEntry:false});if(es&&es.ino===st.ino&&es.dev===st.dev)return true;}catch{}
    }
   }
   return false;
  };
  return canonicalRules.some(rule=>checkDir(rule));
 }catch{return false;}
}
export function isForbiddenPath(candidate:string,forbiddenPaths:readonly string[],cwd=process.cwd()):boolean {
 if(!forbiddenPaths.length||!candidate.trim())return false;
 const candReal=canonicalizePath(candidate,cwd);
 const candLex=path.resolve(cwd,process.platform==='win32'&&/^\/[a-z](?:\/|$)/i.test(candidate)?candidate[1]+':'+candidate.slice(2):candidate);
 const canonicalRules:string[]=[];
 for(const raw of forbiddenPaths){
  if(!raw||!raw.trim())continue;
  const ruleReal=canonicalizePath(raw,cwd);
  const ruleLex=path.resolve(cwd,raw.trim());
  canonicalRules.push(ruleReal);
  if(isSubOrEqual(candReal,ruleReal)||isSubOrEqual(candLex,ruleLex)||isSubOrEqual(candReal,ruleLex))return true;
 }
 return sharesForbiddenHardlink(candReal,canonicalRules);
}
export function cronNext(expression:string,after:number):number {
 const parts=expression.trim().split(/\s+/);if(parts.length!==5)throw new Error('cron须为5个字段');
 const ranges=[[0,59],[0,23],[1,31],[1,12],[0,7]];
 const sets=parts.map((part,index)=>{const [min,max]=ranges[index],values=new Set<number>();for(const item of part.split(',')){const [base,stepRaw,...extra]=item.split('/'),step=stepRaw===undefined?1:Number(stepRaw);if(extra.length||!Number.isInteger(step)||step<1)throw new Error('cron步长无效');let first=min,last=max;if(base!=='*'){const terms=base.split('-');if(terms.length>2||terms.some(t=>!/^\d+$/.test(t)))throw new Error('cron字段无效');first=Number(terms[0]);last=terms.length===2?Number(terms[1]):stepRaw===undefined?first:max;}if(first<min||last>max||last<first)throw new Error('cron范围无效');for(let n=first;n<=last;n+=step)values.add(index===4&&n===7?0:n);}return values;});
 // User's local zone is Asia/Shanghai; a cron job stores local minute fields.
 for(let time=Math.floor(after/60000)*60000+60000,end=time+5*366*86400000;time<end;time+=60000){const d=new Date(time+8*3600000),dom=sets[2].has(d.getUTCDate()),dow=sets[4].has(d.getUTCDay());const dateMatch=parts[2]==='*'?dow:parts[4]==='*'?dom:dom||dow;if(sets[0].has(d.getUTCMinutes())&&sets[1].has(d.getUTCHours())&&sets[3].has(d.getUTCMonth()+1)&&dateMatch)return time;}
 throw new Error('未来5年没有匹配时间');
}

export class ToolHost {
 readonly definitions=definitions;
 readonly sessions=new Map<string,HostSession>();
 readonly tasks=new Map<string,HostTask>();
 private schemas=new Map<string,Ajv.ValidateFunction>();
 private controllers=new Map<string,AbortController>();
 private processes=new Map<string,ChildProcess>();
 private locks=new Map<string,Promise<unknown>>();
 private stopped=false;
 constructor(private hooks:HostHooks,private clock=()=>Date.now(),sessions:HostSession[]=[],tasks:HostTask[]=[]){
  const ajv=new Ajv({allErrors:true,useDefaults:true,jsonPointers:true});for(const tool of definitions)this.schemas.set(tool.function.name,ajv.compile(tool.function.parameters));
  for(const session of sessions)this.sessions.set(session.id,session);
  for(const task of tasks){if(active(task)){task.status='lost';task.output='Previous process ended; side effects may exist. Do not replay automatically.';}this.tasks.set(task.id,task);this.hooks.saveTask?.(task);}
 }
 session(cwd:string,parentId?:string,profile='coder'):HostSession {
  const id=randomUUID(),session:HostSession={id,cwd,parentId,profile,messages:[],reads:{},todos:[],plan:false,planFile:path.join(cwd,'.galagent',`plan-${id}.md`),crons:[],usage:0,turns:0,createdAt:this.clock()};this.sessions.set(id,session);this.save(session);return session;
 }
 save(session:HostSession){if(!this.stopped)this.hooks.save(structuredClone(session));}
 validate(name:string,args:unknown):Record<string,any>{const validate=this.schemas.get(name);if(!validate)throw new Error('Unknown tool: '+name);const copy=structuredClone(args);if(!validate(copy))throw new Error('Invalid parameters for '+name+': '+JSON.stringify(validate.errors).slice(0,900));if(name==='Bash'&&(copy as any).run_in_background&&!(args as any)?.timeout)(copy as any).timeout=600;return copy as Record<string,any>;}
 private forbiddenList(){return this.hooks.forbiddenPaths?.()||[];}
 private policyVersion(){return this.hooks.policyVersion?.()??0;}
 assertAllowed(target:string,cwd=process.cwd()){if(isForbiddenPath(target,this.forbiddenList(),cwd))throw new Error('Access to forbidden directory is blocked by user policy');}
 private assertCommandAllowed(command:string,cwd:string){
  const rules=this.forbiddenList();if(!rules.length)return;
  this.assertAllowed(cwd,cwd);
  const tokens=new Set<string>();
  for(const m of command.matchAll(/"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s;|&><()`"$']+)/g)){
   const tok=(m[1]||m[2]||m[3]||'').trim();
   if(!tok||tok.startsWith('-'))continue;
   tokens.add(tok.replace(/^file:\/\//i,''));
  }
  for(const tok of tokens){
   if(isForbiddenPath(tok,rules,cwd))throw new Error('Command references a forbidden directory blocked by user policy');
  }
  try{
   for(const entry of readdirSync(cwd).slice(0,200)){
    if(command.includes(entry)&&isForbiddenPath(path.join(cwd,entry),rules,cwd))throw new Error('Command references a link to a forbidden directory blocked by user policy');
   }
  }catch(e){if(e instanceof Error&&e.message.includes('forbidden directory'))throw e;}
 }
 invalidatePolicy(){
  for(const task of this.tasks.values())if(active(task)){task.status='cancelled';task.output=bounded(task.output+'\n[Cancelled: directory permission policy updated]');this.update(task);}
  for(const id of [...this.controllers.keys()])this.kill(id);
 }
 private file(session:HostSession,input:string){if(!input||input.includes('\0'))throw new Error('路径无效');if(process.platform==='win32'&&/^\/[a-z]\//i.test(input))input=input[1]+':'+input.slice(2);return path.resolve(session.cwd,input);}
 private safeFile(session:HostSession,input:string){this.assertAllowed(session.cwd,session.cwd);const file=this.file(session,input);if(secret(file))throw new Error('Sensitive file is blocked by the Kimi tool policy');this.assertAllowed(file,session.cwd);return file;}
 private async locked<T>(file:string,fn:()=>Promise<T>){const prior=this.locks.get(file)||Promise.resolve();let unlock!:()=>void;const next=new Promise<void>(resolve=>{unlock=resolve;});this.locks.set(file,next);await prior.catch(()=>{});try{return await fn();}finally{unlock();if(this.locks.get(file)===next)this.locks.delete(file);}}
 private newTask(session:HostSession,kind:HostTask['kind'],description:string){const task:HostTask={id:randomUUID(),owner:session.id,kind,description,status:'queued',output:'',createdAt:this.clock()};this.tasks.set(task.id,task);this.hooks.saveTask?.(task);return task;}
 private update(task:HostTask){if(!this.stopped)this.hooks.saveTask?.(structuredClone(task));}
 private ownTask(session:HostSession,id:string){const task=this.tasks.get(id);if(!task||task.owner!==session.id)throw new Error('Unknown task in this session');return task;}
 private kill(id:string){const controller=this.controllers.get(id);if(controller){controller.abort();return;}const child=this.processes.get(id);if(child&&child.exitCode===null)child.kill();}
 close(){if(this.stopped)return;for(const task of this.tasks.values())if(active(task)){task.status='cancelled';task.output=bounded(task.output+'\n[Application closed; not resumed automatically]');this.update(task);}for(const id of this.controllers.keys())this.kill(id);this.stopped=true;}
 cancelSession(id:string){for(const task of this.tasks.values())if(task.owner===id&&active(task))this.kill(task.id);for(const session of this.sessions.values())if(session.parentId===id)this.cancelSession(session.id);}
 private shellPath(){if(process.platform!=='win32')return '/bin/bash';const candidates=[process.env.GALAGENT_BASH,'C:\\Program Files\\Git\\bin\\bash.exe','C:\\Program Files\\Git\\usr\\bin\\bash.exe'];const found=candidates.find(p=>p&&existsSync(p));if(!found)throw new Error('Git Bash未安装，无法执行Bash工具');return found;}
 private rgPath(){const own=path.join(homedir(),'.kimi-code','bin',process.platform==='win32'?'rg.exe':'rg');return existsSync(own)?own:'rg';}
 private spawnTask(session:HostSession,description:string,exe:string,args:string[],cwd:string,signal:AbortSignal,timeout:number):{task:HostTask;finished:Promise<HostTask>} {
  const startPolicy=this.policyVersion(),task=this.newTask(session,'shell',description),controller=new AbortController();this.controllers.set(task.id,controller);
  const onAbort=()=>{task.status='cancelled';this.kill(task.id);};signal.addEventListener('abort',onAbort,{once:true});
  const child=spawn(exe,args,{cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});this.processes.set(task.id,child);task.pid=child.pid;task.status='running';this.update(task);
  const ownAbort=()=>{task.status='cancelled';if(child.exitCode===null){if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}else child.kill('SIGTERM');}};controller.signal.addEventListener('abort',ownAbort,{once:true});
  let timer:ReturnType<typeof setTimeout>|undefined;if(timeout>0)timer=setTimeout(()=>{task.output=bounded(task.output+'\n[Task timeout]');this.kill(task.id);},timeout);
  const finished=new Promise<HostTask>(resolve=>{let ended=false;const end=(code:number|null,error?:Error)=>{if(ended)return;ended=true;if(timer)clearTimeout(timer);signal.removeEventListener('abort',onAbort);this.controllers.delete(task.id);this.processes.delete(task.id);task.exitCode=code??undefined;if(this.policyVersion()!==startPolicy)task.status='cancelled';else if(task.status!=='cancelled')task.status=error||code!==0?'failed':'done';if(error)task.output=bounded(task.output+'\n'+error.message);this.update(task);resolve(task);};
   const add=(chunk:Buffer)=>{task.output=bounded(task.output+chunk.toString('utf8'));};child.stdout?.on('data',add);child.stderr?.on('data',add);child.once('error',error=>end(null,error));child.once('close',code=>end(code));
  });if(signal.aborted||this.policyVersion()!==startPolicy)onAbort();return{task,finished};
 }
 private text(buffer:Buffer){if(buffer[0]===0xff&&buffer[1]===0xfe)return buffer.subarray(2).toString('utf16le');if(buffer[0]===0xfe&&buffer[1]===0xff){const swapped=Buffer.from(buffer.subarray(2));swapped.swap16();return swapped.toString('utf16le');}if(buffer.subarray(0,4096).includes(0))throw new Error('Binary file; use ReadMediaFile');return buffer.toString('utf8').replace(/^\uFEFF/,'');}
 private async read(session:HostSession,a:any){const file=this.safeFile(session,a.path),info=await stat(file);if(!info.isFile()||info.size>10*1024*1024)throw new Error('Read requires a text file at most 10 MiB');const buffer=await readFile(file),text=this.text(buffer);session.reads[file]=digest(buffer);const lines=text.replace(/\r\n/g,'\n').split('\n');if(lines.at(-1)==='')lines.pop();const start=a.line_offset<0?Math.max(0,lines.length+a.line_offset):Math.max(0,(a.line_offset||1)-1),count=Math.min(a.n_lines||1000,1000);let rendered='',readCount=0;
  for(let i=start;i<Math.min(lines.length,start+count);i++){const line=`${i+1}\t${bounded(lines[i],2000)}\n`;if(rendered.length+line.length>100*1024)break;rendered+=line;readCount++;}
  return{content:rendered+`<system>${readCount} lines read from file starting from line ${start+1}. Total lines in file: ${lines.length}. ${start+readCount>=lines.length?'End of file reached.':'More content remains.'}</system>`};
 }
 private async mutate(session:HostSession,name:string,a:any){const file=this.safeFile(session,a.path);if(session.plan&&file!==session.planFile)throw new Error('Plan mode allows writes only to the plan file');return this.locked(file,async()=>{
  this.assertAllowed(file,session.cwd);
  const old=await readFile(file).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});if(old&&session.reads[file]!==digest(old))throw new Error('Read the current file before writing; file changed or has not been read');
  let output:string;if(name==='Write')output=a.mode==='append'?this.text(old||Buffer.alloc(0))+a.content:a.content;
  else{if(!old)throw new Error('File does not exist');const original=this.text(old),crlf=original.includes('\r\n')&&!original.replace(/\r\n/g,'').includes('\n'),view=crlf?original.replace(/\r\n/g,'\n'):original;if(a.old_string===a.new_string)throw new Error('Replacement has no change');const count=view.split(a.old_string).length-1;if(!count||(!a.replace_all&&count!==1))throw new Error('old_string not found or not unique');output=a.replace_all?view.split(a.old_string).join(a.new_string):view.replace(a.old_string,a.new_string);if(crlf)output=output.replace(/\r?\n/g,'\r\n');}
  await mkdir(path.dirname(file),{recursive:true});const temporary=file+'.galagent-'+randomUUID();await writeFile(temporary,output);await rename(temporary,file);session.reads[file]=digest(Buffer.from(output));return{content:`${name} succeeded: ${file}`};
 });}
 private async search(session:HostSession,name:string,a:any,signal:AbortSignal){const root=this.safeFile(session,a.path||'.');if(path.basename(root)==='.git')throw new Error('VCS metadata is excluded');const args=['--hidden','--glob','!.git/**','--glob','!**/.git/**','--glob','!.env','--glob','!**/.env','--glob','!.env.*','--glob','!**/.env.*','--glob','!**/id_rsa','--glob','!**/id_ed25519'];if(a.include_ignored)args.push('--no-ignore');
  if(name==='Glob')args.push('--files','--glob',a.pattern);
  else{const mode=a.output_mode||'files_with_matches';args.push(mode==='content'?'--line-number':mode==='count_matches'?'--count':'--files-with-matches');if(a['-n']===false&&mode==='content')args.push('--no-line-number');if(a['-i'])args.push('--ignore-case');if(a.multiline)args.push('--multiline');for(const flag of ['-A','-B','-C'])if(a[flag]!==undefined)args.push(flag,String(a[flag]));if(a.glob)args.push('--glob',a.glob);if(a.type)args.push('--type',a.type);args.push('--regexp',a.pattern);}
  args.push('--glob','!**/.git/**','--glob','!**/.env','--glob','!**/.env.*','--glob','!**/id_rsa','--glob','!**/id_ed25519','--',root);const {finished}=this.spawnTask(session,`${name}: ${a.pattern}`,this.rgPath(),args,session.cwd,signal,30000),task=await finished;
  if(task.status==='cancelled')throw new Error('Search cancelled');if(task.exitCode!==0&&task.exitCode!==1)throw new Error(task.output||'ripgrep failed');
  const extractFile=(line:string)=>{if(name==='Glob')return line;const m=line.match(/^([A-Za-z]:[\\/][^:]+|[^:]+):/);return m?m[1]:line;};
  let lines=task.output.split(/\r?\n/).filter(Boolean).filter(line=>{const f=extractFile(line);return !secret(f)&&!isForbiddenPath(f,this.forbiddenList(),root);});
  if(name==='Glob'){const dated=await Promise.all(lines.map(async file=>({file,time:await stat(file).then(s=>s.mtimeMs,()=>0)})));lines=dated.sort((a,b)=>b.time-a.time).map(x=>x.file);}
  const offset=a.offset||0,cap=name==='Glob'?100:a.head_limit===0?lines.length:a.head_limit||250;return{content:bounded(lines.slice(offset,offset+cap).join('\n')+(lines.length>offset+cap?'\n[More matches remain]':''))};
 }
 private async media(session:HostSession,a:any,signal:AbortSignal){const file=this.safeFile(session,a.path),info=await stat(file);if(!info.isFile()||info.size>100*1024*1024)throw new Error('Media must be a file at most 100 MB');if(/\.(mp4|mpeg|mpg|mov|mkv|avi|webm|flv|3gp)$/i.test(file))return this.video(session,file,a,signal);const head=await readFile(file).then(b=>b.subarray(0,64),()=>Buffer.alloc(0));if(hasVideoMagic(head))return this.video(session,file,a,signal);let image=sharp(file,{animated:false}),metadata=await image.metadata();if(!['png','jpeg','webp','gif'].includes(metadata.format||''))throw new Error('Unsupported media format; convert to PNG/JPEG/WebP/GIF first');if(a.region){if(a.region.x+a.region.width>(metadata.width||0)||a.region.y+a.region.height>(metadata.height||0))throw new Error('Crop exceeds image boundaries');image=image.extract({left:a.region.x,top:a.region.y,width:a.region.width,height:a.region.height});}else if(!a.full_resolution)image=image.resize({width:1536,height:1536,fit:'inside',withoutEnlargement:true});const bytes=await image.png().toBuffer();if(bytes.length>8*1024*1024)throw new Error('Image exceeds delivery limit; use region');const part={type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}},note=`<system>Read image file. Mime type: image/png. Size: ${bytes.length} bytes. Original dimensions: ${metadata.width}x${metadata.height}. If you generate or edit images or videos via commands or scripts, read the result back immediately before continuing.</system>`;return{content:`Image from ${file}; original ${metadata.width}x${metadata.height}.\n${note}`,attachments:[part],parts:[{type:'text',text:`<image path="${file}">`},part,{type:'text',text:'</image>'},{type:'text',text:note}]};}
 private async skill(session:HostSession,a:any){if(!/^[\p{L}\p{N}_.:-]+(?:\/[\p{L}\p{N}_.-]+)*$/u.test(a.skill)||a.skill.includes('..'))throw new Error('Skill name invalid');const roots=[path.join(session.cwd,'.agents','skills'),path.join(session.cwd,'.kimi','skills'),path.join(homedir(),'.agents','skills'),path.join(homedir(),'.kimi','skills'),path.join(homedir(),'.codex','skills'),path.join(homedir(),'.mirasim','skills')];for(const root of roots){const file=path.join(root,a.skill,'SKILL.md');if(isForbiddenPath(file,this.forbiddenList(),session.cwd))continue;try{const text=await readFile(file,'utf8');return{content:bounded(`Skill source: ${file}\nArguments: ${a.args||''}\n${text}`)};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}throw new Error('Skill not found: '+a.skill);}
 private async agent(session:HostSession,a:any,signal:AbortSignal){this.assertAllowed(session.cwd,session.cwd);let child:HostSession;if(a.resume){const prior=this.sessions.get(a.resume);if(!prior||prior.parentId!==session.id)throw new Error('Unknown subagent');child=prior;}else child=this.session(session.cwd,session.id,a.subagent_type||'coder');let depth=0,parent=child;while(parent.parentId){depth++;const next=this.sessions.get(parent.parentId);if(!next)break;parent=next;}if(depth>3)throw new Error('Subagent depth limit reached');
  const task=this.newTask(session,'agent',a.description||'Resume subagent');task.agentId=child.id;task.status='running';const controller=new AbortController();this.controllers.set(task.id,controller);const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();this.update(task);
  const finished=this.hooks.child(child,a.prompt,controller.signal).then(output=>{task.output=bounded(output);task.status=controller.signal.aborted?'cancelled':'done';},error=>{task.output=String(error instanceof Error?error.message:error);task.status=controller.signal.aborted?'cancelled':'failed';}).finally(()=>{signal.removeEventListener('abort',abort);this.controllers.delete(task.id);this.update(task);if(a.run_in_background)this.hooks.onBackground?.(task);});
  if(a.run_in_background)return{content:JSON.stringify({task_id:task.id,agent_id:child.id,status:task.status})};await finished;return{content:JSON.stringify({task_id:task.id,agent_id:child.id,status:task.status,result:task.output})};
 }
 private async video(session:HostSession,file:string,a:any,signal:AbortSignal):Promise<ToolOutput>{
  if(a.region)throw new Error('region is for images only');
  const raw=await readFile(file);if(!raw.length)throw new Error('Video file is empty');
  let mimeType=detectVideoMime(file,raw.subarray(0,64))||'video/mp4',delivery=raw;
  const uploaded=await this.hooks.uploadVideo?.({data:raw,mimeType,filename:path.basename(file),session},signal).catch(()=>undefined);
  if(!uploaded?.id&&(!hasVideoMagic(raw.subarray(0,64))||raw.length>16*1024*1024)){
   if(!ffmpeg)throw new Error('Video decoder unavailable');
   const directory=await mkdtemp(path.join(tmpdir(),'galagent-video-')),target=path.join(directory,'normalized.mp4'),executable=ffmpeg.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
   try{const {finished}=this.spawnTask(session,'ReadMediaFile video encoder',executable,['-hide_banner','-loglevel','error','-i',file,'-vf','scale=1280:720:force_original_aspect_ratio=decrease','-c:v','libx264','-preset','veryfast','-crf','28','-pix_fmt','yuv420p','-movflags','+faststart',target],session.cwd,signal,60000);const task=await finished;if(task.status!=='done')throw new Error(task.output||'Video decoding failed');delivery=await readFile(target);mimeType='video/mp4';}
   finally{await unlink(target).catch(()=>{});await rmdir(directory).catch(()=>{});}
  }
  const part=uploaded?.id?{type:'video_url',video_url:{url:'ms://'+uploaded.id,id:uploaded.id}}:{type:'video_url',video_url:{url:`data:${mimeType};base64,${delivery.toString('base64')}`}};
  const note=`<system>Read video file. Mime type: ${mimeType}. Size: ${delivery.length} bytes. If you generate or edit images or videos via commands or scripts, read the result back immediately before continuing.</system>`;
  return{content:`<video path="${file}"></video>\n${note}`,attachments:[part],parts:[{type:'text',text:`<video path="${file}">`},part,{type:'text',text:'</video>'},{type:'text',text:note}]};
 }
 async execute(session:HostSession,name:string,args:unknown,signal:AbortSignal):Promise<ToolOutput>{
  try{const startPolicy=this.policyVersion();if(this.stopped||signal.aborted)throw new Error('Task cancelled');const a=this.validate(name,args);
   if(session.plan&&['Bash','Agent','AgentSwarm','CronCreate','CronDelete','TaskStop'].includes(name))throw new Error('Side effects are unavailable in plan mode');
   let output:ToolOutput;
   switch(name){
    case 'Read':output=await this.read(session,a);break;
    case 'Write':case 'Edit':output=await this.mutate(session,name,a);break;
    case 'Glob':case 'Grep':output=await this.search(session,name,a,signal);break;
    case 'ReadMediaFile':output=await this.media(session,a,signal);break;
    case 'Bash':{const rawCwd=this.file(session,a.cwd||'.');this.assertAllowed(rawCwd,session.cwd);const cwd=await realpath(rawCwd);this.assertCommandAllowed(a.command,cwd);if(a.run_in_background&&!a.description)throw new Error('Background Bash requires description');const seconds=a.timeout??(a.run_in_background?600:60);if(seconds>(a.run_in_background?86400:300))throw new Error('Bash timeout exceeds limit');const {task,finished}=this.spawnTask(session,a.description||a.command,this.shellPath(),['-lc',a.command],cwd,signal,a.run_in_background&&a.disable_timeout?0:seconds*1000);if(a.run_in_background){void finished.then(t=>this.hooks.onBackground?.(t));output={content:JSON.stringify({task_id:task.id,status:task.status,pid:task.pid})};}else{await finished;if(this.policyVersion()!==startPolicy)throw new Error('Directory permission policy changed during execution; task cancelled');output={content:bounded(task.output)+`\n<system>Task ${task.status}; exit code ${task.exitCode??'unknown'}.</system>`};}break;}
    case 'FetchURL':{const url=new URL(a.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('URL must be HTTP(S) without credentials');const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});if(!response.ok)throw new Error('HTTP '+response.status);const reader=response.body?.getReader();let text='',bytes=0;const decoder=new TextDecoder();if(reader)try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2_000_000)throw new Error('Page exceeds size limit');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}if((response.headers.get('content-type')||'').includes('html'))text=text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');output={content:bounded(text)};break;}
    case 'Skill':output=await this.skill(session,a);break;
    case 'TodoList':if(a.todos!==undefined){if(a.todos.filter((t:any)=>t.status==='in_progress').length>1)throw new Error('Only one todo may be in_progress');session.todos=a.todos;}output={content:JSON.stringify({todos:session.todos})};break;
    case 'CreateGoal':if(session.goal&&session.goal.status!=='complete'&&!a.replace)throw new Error('An unfinished goal already exists');session.goal={objective:a.objective,completionCriterion:a.completionCriterion,status:'active',startedAt:this.clock(),turns:session.turns,tokens:session.usage};output={content:JSON.stringify(session.goal)};break;
    case 'GetGoal':output={content:JSON.stringify({goal:session.goal||null})};break;
    case 'UpdateGoal':if(!session.goal)throw new Error('No goal exists');session.goal.status=a.status;output={content:JSON.stringify(session.goal)};break;
    case 'SetGoalBudget':{if(!session.goal)throw new Error('No goal exists');const factors:any={milliseconds:1,seconds:1000,minutes:60000,hours:3600000};const value=factors[a.unit]?a.value*factors[a.unit]:Math.max(1,Math.round(a.value));if(factors[a.unit]&&(value<1000||value>86400000))throw new Error('Time budget must be 1 second to 24 hours');session.goal.budget={unit:factors[a.unit]?'milliseconds':a.unit,value};output={content:JSON.stringify(session.goal)};break;}
    case 'EnterPlanMode':session.plan=true;output={content:JSON.stringify({plan_mode:true,plan_file:session.planFile,write_scope:'plan_file_only'})};break;
    case 'ExitPlanMode':{if(!session.plan)throw new Error('Not in plan mode');const plan=await readFile(session.planFile,'utf8').catch(()=> '');if(!plan.trim())throw new Error('Write a concrete plan before requesting approval');const choices=[...(a.options||[]).map((o:any)=>({label:o.label,description:o.description})),{label:'Approve',description:'批准当前计划'},{label:'Reject',description:'保持计划模式'}];const answers=await this.hooks.ask([{question:'批准当前计划并开始执行？',options:choices}],signal);const choice=Object.values(answers)[0];if(choice==='Approve'||(a.options||[]).some((o:any)=>o.label===choice))session.plan=false;output={content:JSON.stringify({plan_mode:session.plan,approved:!session.plan,answers})};break;}
    case 'AskUserQuestion':{if(new Set(a.questions.map((q:any)=>q.question)).size!==a.questions.length||a.questions.some((q:any)=>new Set(q.options.map((o:any)=>o.label)).size!==q.options.length))throw new Error('Question texts and labels must be unique');if(a.background){const task=this.newTask(session,'question','User question'),controller=new AbortController();this.controllers.set(task.id,controller);task.status='running';this.update(task);void this.hooks.ask(a.questions,controller.signal).then(answers=>{task.status='done';task.output=JSON.stringify({answers});},()=>{task.status='cancelled';task.output='Question dismissed';}).finally(()=>{this.controllers.delete(task.id);this.update(task);this.hooks.onBackground?.(task);});output={content:JSON.stringify({task_id:task.id,status:'running'})};}else{const answers=await this.hooks.ask(a.questions,signal);output={content:JSON.stringify({answers,...(!Object.keys(answers).length?{note:'User dismissed; no choice selected'}:{})})};}break;}
    case 'Agent':if(a.resume&&a.subagent_type)throw new Error('resume and subagent_type are exclusive');output=await this.agent(session,a,signal);break;
    case 'AgentSwarm':{const resumes=Object.entries(a.resume_agent_ids||{});if((a.items||[]).length<2&&!resumes.length)throw new Error('Swarm requires 2 items or existing agents');if(a.items?.length&&(!a.prompt_template||!a.prompt_template.includes('{{item}}')))throw new Error('prompt_template must include {{item}}');const prompts=(a.items||[]).map((item:string)=>a.prompt_template.split('{{item}}').join(item));if(new Set(prompts).size!==prompts.length)throw new Error('Filled prompts must be distinct');for(const [id] of resumes)if(this.sessions.get(id)?.parentId!==session.id)throw new Error('Unknown resumed agent');const jobs=[...resumes.map(([resume,prompt])=>({resume,prompt,description:a.description})),...prompts.map((prompt:string)=>({prompt,description:a.description,subagent_type:a.subagent_type}))];output={content:bounded(JSON.stringify(await Promise.all(jobs.map(job=>this.agent(session,job,signal)))))};break;}
    case 'TaskList':output={content:JSON.stringify([...this.tasks.values()].filter(t=>t.owner===session.id&&(!a.active_only||active(t))).slice(-a.limit).map(({output,...meta})=>meta))};break;
    case 'TaskOutput':{const task=this.ownTask(session,a.task_id);if(a.block&&active(task)){const until=performance.now()+Math.min(a.timeout,3600)*1000;while(active(task)&&performance.now()<until){if(signal.aborted)throw new Error('Cancelled');await new Promise(resolve=>setTimeout(resolve,50));}}output={content:JSON.stringify(task)};break;}
    case 'TaskStop':{const task=this.ownTask(session,a.task_id);if(active(task)){this.kill(task.id);task.status='cancelled';task.output=bounded(task.output+'\n'+a.reason);this.update(task);}output={content:JSON.stringify(task)};break;}
    case 'CronCreate':{if(session.crons.length>=50)throw new Error('50 cron jobs per session maximum');const now=this.clock(),nextAt=cronNext(a.cron,now),job:CronJob={id:randomUUID(),cron:a.cron,prompt:a.prompt,recurring:a.recurring??true,nextAt,createdAt:now,expiresAt:now+7*86400000};session.crons.push(job);output={content:JSON.stringify(job)};break;}
    case 'CronList':output={content:JSON.stringify({jobs:session.crons})};break;
    case 'CronDelete':{const index=session.crons.findIndex(j=>j.id===a.id);if(index<0)throw new Error('Unknown cron job');session.crons.splice(index,1);output={content:'Cron job deleted'};break;}
    default:throw new Error('No execution backend for '+name);
   }
   this.save(session);return output;
  }catch(error){return failure(error instanceof Error?error.message:String(error));}
 }
 due(session:HostSession,now=this.clock()):string[]{if(!session.crons.length)return[];const prompts:string[]=[];for(const job of [...session.crons]){if(now>=job.expiresAt){session.crons=session.crons.filter(j=>j!==job);continue;}if(now<job.nextAt)continue;let count=0;while(job.nextAt<=now&&count<10000){count++;job.nextAt=cronNext(job.cron,job.nextAt);if(!job.recurring)break;}prompts.push(`<cron-fire jobId="${job.id}" cron="${job.cron}" recurring="${job.recurring}" coalescedCount="${count}"><prompt>${job.prompt.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</prompt></cron-fire>`);if(!job.recurring)session.crons=session.crons.filter(j=>j!==job);}this.save(session);return prompts;}
}
