export type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
export type ModelMessage={role:string;content?:unknown;tool_calls?:ToolCall[];tool_call_id?:string;[key:string]:unknown};
export type ModelReply={message:ModelMessage;finishReason:string;usage:number};
const limit=16_000_000;
function validateReply(message:any,finishReason:unknown,usage:unknown):ModelReply {
 if(!message||message.role!=='assistant'||!['stop','tool_calls'].includes(String(finishReason)))throw new Error('模型回复未完整结束，未执行工具');
 if(message.tool_calls!==undefined){if(!Array.isArray(message.tool_calls)||message.tool_calls.length>128)throw new Error('工具调用列表无效');const ids=new Set<string>();for(const call of message.tool_calls){if(!call||call.type!=='function'||typeof call.id!=='string'||!call.id||call.id.length>200||ids.has(call.id)||typeof call.function?.name!=='string'||typeof call.function?.arguments!=='string'||call.function.arguments.length>1_000_000)throw new Error('工具调用格式无效');ids.add(call.id);}}
 if(finishReason==='tool_calls'&&!message.tool_calls?.length)throw new Error('缺少模型声明的工具调用');
 if(finishReason==='stop'&&message.tool_calls?.length)throw new Error('工具调用结束标记冲突');
 if(finishReason==='stop'&&(typeof message.content!=='string'||!message.content.trim()))throw new Error('模型没有最终可见回复');
 return{message:structuredClone(message),finishReason:String(finishReason),usage:typeof usage==='number'&&Number.isFinite(usage)?Math.max(0,usage):0};
}
export async function parseModelReply(response:Response,signal?:AbortSignal):Promise<ModelReply>{
 if(!response.ok)throw new Error(`模型API请求失败（HTTP ${response.status}）`);
 const reader=response.body?.getReader();if(!reader)throw new Error('模型响应为空');
 const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 const decoder=new TextDecoder();let buffer='',bytes=0,done=false,finishReason:unknown,usage=0;
 const streaming=(response.headers.get('content-type')||'').includes('text/event-stream');
 const message:ModelMessage={role:'assistant'};const calls=new Map<number,ToolCall>();
 const apply=(event:string)=>{
  const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)return;
  if(done)throw new Error('结束标记后仍有模型数据');if(data.trim()==='[DONE]'){done=true;return;}
  const chunk=JSON.parse(data);if(chunk.error)throw new Error('模型流返回错误');if(typeof chunk.usage?.total_tokens==='number')usage=chunk.usage.total_tokens;
  for(const choice of chunk.choices||[]){if(choice.index!==0)continue;if(choice.finish_reason!==null&&choice.finish_reason!==undefined){if(finishReason!==undefined&&finishReason!==choice.finish_reason)throw new Error('模型结束标记冲突');finishReason=choice.finish_reason;}
   const delta=choice.delta||{};if(delta.role!==undefined&&delta.role!==null&&delta.role!=='assistant')throw new Error('模型消息角色无效');
   for(const [key,value] of Object.entries(delta)){
    if(value===null||value===undefined||key==='role')continue;
    if(key==='content'||key==='reasoning_content'){if(typeof value!=='string')throw new Error('模型文本增量无效');message[key]=String(message[key]||'')+value;}
    else if(key==='tool_calls'){
     if(!Array.isArray(value))throw new Error('模型工具增量无效');for(const part of value){if(!Number.isInteger(part.index)||part.index<0||part.index>=128)throw new Error('工具增量索引无效');const call=calls.get(part.index)||{id:'',type:'function',function:{name:'',arguments:''}};
      if(part.id!==undefined&&part.id!==null){if(typeof part.id!=='string'||(call.id&&call.id!==part.id))throw new Error('工具调用ID冲突');call.id=part.id;}
      if(part.type!==undefined&&part.type!==null&&part.type!=='function')throw new Error('工具类型无效');
      for(const field of ['name','arguments'] as const)if(part.function?.[field]!==undefined&&part.function?.[field]!==null){if(typeof part.function[field]!=='string')throw new Error('工具参数增量无效');call.function[field]+=part.function[field];}
      calls.set(part.index,call);
     }
    }else message[key]=structuredClone(value);
   }
  }
 };
 try{while(true){if(signal?.aborted)throw new Error('任务已取消');const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>limit)throw new Error('模型响应超过大小上限');buffer+=decoder.decode(part.value,{stream:true});
   if(streaming){buffer=buffer.replace(/\r\n/g,'\n');let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){apply(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);}}
  }if(signal?.aborted)throw new Error('任务已取消');buffer+=decoder.decode();
  if(!streaming){const body=JSON.parse(buffer);const choice=body.choices?.[0];return validateReply(choice?.message,choice?.finish_reason,body.usage?.total_tokens);}
  if(buffer.trim())apply(buffer);if(!done)throw new Error('模型流中断，工具参数未执行');if(calls.size)message.tool_calls=[...calls].sort(([a],[b])=>a-b).map(([,call])=>call);
  return validateReply(message,finishReason,usage);
 }finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}
