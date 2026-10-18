import readline from 'node:readline';
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const rpc=readline.createInterface({input:process.stdin});let promptId,question=false;
rpc.on('line',line=>{const m=JSON.parse(line),reply=result=>send({jsonrpc:'2.0',id:m.id,result});
 if(m.method==='initialize')reply({protocolVersion:1,agentInfo:{name:'fixture',version:'fixture-only'}});
 else if(m.method==='session/new')reply({sessionId:'fixture-session'});
 else if(m.method==='session/set_mode'){if(m.params.modeId!=='yolo')process.exit(3);reply({});}
 else if(m.method==='session/prompt'){
  if(m.params.prompt[0].text.startsWith('hold'))return;
  promptId=m.id;
  question=m.params.prompt[0].text.startsWith('question');
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'other-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'wrong-session'}}}});
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'private-sentinel'}}}});
  send({jsonrpc:'2.0',id:'permission',method:'session/request_permission',params:{options:[{optionId:question?'q0_choice':'approve_once',kind:'allow_once'}]}});
 }else if(m.id==='permission'&&m.result){
  if(question){if(m.result.outcome.outcome!=='cancelled')process.exit(5);send({jsonrpc:'2.0',id:promptId,result:{stopReason:'end_turn'}});return;}
  if(m.result.outcome.optionId!=='approve_once')process.exit(4);
  const notice=update=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update}});
  notice({sessionUpdate:'tool_call',toolCallId:'read-1',title:'Read fixture',status:'in_progress'});
  notice({sessionUpdate:'tool_call_update',toolCallId:'read-1',status:'completed',rawOutput:'private tool logs ignored'});
  const output=JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'已完成读取：fixture-result。'}}}})+'\n';
  process.stdout.write(output.slice(0,17));setTimeout(()=>{process.stdout.write(output.slice(17));send({jsonrpc:'2.0',id:promptId,result:{stopReason:'end_turn'}});},10);
 }
});
