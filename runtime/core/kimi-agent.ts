import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {realpath,stat} from 'node:fs/promises';

export type AgentResult={summary:string;stopReason:string;sessionId:string;tools:{id:string;title:string;status:string}[];/** Files the run changed through checked writes (undoable). */changedFiles?:string[];runId?:string};
export type AgentRunner={run(task:string,cwd:string,signal:AbortSignal,onProgress?:(count:number)=>void):Promise<AgentResult>;undoLast?():Promise<{runId:string;label:string;restored:string[];conflicts:string[];skipped:string[]}>;probe():Promise<{name:string;version:string}>;close():void;tick?(now?:number):void;cancelAll?():void};
export class KimiCodeAgent implements AgentRunner {
  readonly executable:string;
  private child?:ChildProcessWithoutNullStreams;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private sequence=0;
  private buffer='';
  private onUpdate?:(params:any)=>void;
  private info?:{name:string;version:string};
  private needsInput=false;
  constructor(executable=process.env.GALAGENT_KIMI_EXE||join(homedir(),'.kimi-code','bin',process.platform==='win32'?'kimi.exe':'kimi'),private launchArgs=['acp']){this.executable=executable;}
  private fail(message:string){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}this.pending.clear();}
  close(){const child=this.child;this.child=undefined;this.info=undefined;this.buffer='';this.onUpdate=undefined;this.fail('Kimi Code执行已停止');if(child&&child.exitCode===null){if(process.platform==='win32'&&child.pid)spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();}}
  private send(value:unknown){if(!this.child||this.child.stdin.destroyed)throw new Error('Kimi Code通道未连接');this.child.stdin.write(JSON.stringify(value)+'\n');}
  private receive(chunk:string){
    this.buffer+=chunk;if(this.buffer.length>4_000_000){this.close();return;}
    for(let lineEnd;(lineEnd=this.buffer.indexOf('\n'))>=0;){const line=this.buffer.slice(0,lineEnd);this.buffer=this.buffer.slice(lineEnd+1);if(!line.trim())continue;let message:any;try{message=JSON.parse(line);}catch{this.close();return;}
      if(message.id!==undefined&&message.method===undefined){const p=this.pending.get(message.id);if(!p)continue;clearTimeout(p.timer);this.pending.delete(message.id);message.error?p.reject(new Error('Kimi Code协议错误：'+String(message.error.message||message.error.code).slice(0,300))):p.resolve(message.result);}
      else if(message.method==='session/update'){this.onUpdate?.(message.params);}
      else if(message.id!==undefined){
        if(message.method==='session/request_permission'){
          // Ordinary tool approvals are delegated to the user's full-access policy.
          // Questions/plan choices have semantic answers; never pick one on behalf of the user.
          const option=message.params?.options?.find((o:any)=>o.optionId==='approve_once');
          if(!option)this.needsInput=true;
          this.send({jsonrpc:'2.0',id:message.id,result:{outcome:option?{outcome:'selected',optionId:option.optionId}:{outcome:'cancelled'}}});
        }else this.send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Client capability not implemented'}});
      }
    }
  }
  private rpc(method:string,params:unknown,timeout=30000):Promise<any>{return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Kimi Code请求超时'));},timeout);this.pending.set(id,{resolve,reject,timer});try{this.send({jsonrpc:'2.0',id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
  async probe(){
    if(this.info&&this.child)return this.info;
    if(!existsSync(this.executable))throw new Error('未找到Kimi Code，请配置本机kimi.exe路径');
    const child=spawn(this.executable,this.launchArgs,{windowsHide:true,stdio:'pipe',shell:false});this.child=child;this.buffer='';
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{if(this.child===child)this.receive(chunk);});child.stderr.resume();
    child.once('error',()=>{if(this.child===child){this.fail('无法启动本机Kimi Code');this.child=undefined;this.info=undefined;}});
    child.once('exit',()=>{if(this.child===child){this.fail('Kimi Code进程已退出');this.child=undefined;this.info=undefined;}});
    const response=await this.rpc('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'GalAgent',version:'0.1.0'}});
    this.info={name:response.agentInfo?.name||'Kimi Code',version:response.agentInfo?.version||'unknown'};return this.info;
  }
  async run(task:string,cwd:string,signal:AbortSignal,onProgress?:(count:number)=>void):Promise<AgentResult>{
    if(typeof task!=='string'||!task.trim()||task.length>12000)throw new Error('执行任务应为1至12000字');
    cwd=await realpath(resolve(cwd));if(!(await stat(cwd)).isDirectory())throw new Error('执行工作目录无效');
    if(signal.aborted)throw new Error('任务已取消');
    let sessionId='',summary='',truncated=false;this.needsInput=false;const tools=new Map<string,AgentResult['tools'][number]>();
    const cancel=()=>{if(sessionId&&this.child)try{this.send({jsonrpc:'2.0',method:'session/cancel',params:{sessionId}});}catch{}this.close();};signal.addEventListener('abort',cancel,{once:true});
    try{
      await this.probe();if(signal.aborted)throw new Error('任务已取消');
      const session=await this.rpc('session/new',{cwd,mcpServers:[]});sessionId=session.sessionId;if(typeof sessionId!=='string')throw new Error('Kimi Code未返回会话');
      await this.rpc('session/set_mode',{sessionId,modeId:'yolo'});
      this.onUpdate=params=>{if(params?.sessionId!==sessionId)return;const update=params.update;
        if(update?.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text'){const text=String(update.content.text);if(summary.length+text.length>12000)truncated=true;summary=(summary+text).slice(0,12000);}
        if(['tool_call','tool_call_update'].includes(update?.sessionUpdate)&&typeof update.toolCallId==='string'){const old=tools.get(update.toolCallId);if(old||tools.size<128)tools.set(update.toolCallId,{id:update.toolCallId,title:String(update.title||old?.title||'工具').slice(0,120),status:String(update.status||old?.status||'pending')});onProgress?.(tools.size);}
      };
      const result=await this.rpc('session/prompt',{sessionId,prompt:[{type:'text',text:task+'\n结束时简短说明实际完成内容、依据、改动、失败或待决事项；不要输出私有思维过程。'}]},600000);
      if(signal.aborted)throw new Error('任务已取消');
      return {summary:summary+(truncated?'\n[结果过长，仅保留前12000字]':'')+(this.needsInput?'\n[任务需要用户补充选择，尚未完成]':''),stopReason:this.needsInput?'needs_input':String(result.stopReason),sessionId,tools:[...tools.values()]};
    }finally{signal.removeEventListener('abort',cancel);this.onUpdate=undefined;this.close();}
  }
}
