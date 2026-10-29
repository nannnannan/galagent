import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand } from '../../runtime/main/validation';
test('desktop IPC rejects unknown capability, unsafe endpoint and nonfinite movement', () => {
  for (const command of [{type:'shell.exec',command:'arbitrary'}, {type:'config.save',baseUrl:'http://external.example/v1',model:'kimi-k3'}, {type:'config.save',baseUrl:'https://secret@example.com/v1',model:'kimi-k3'}, {type:'shell.drag',dx:Infinity,dy:0}, {type:'shell.pointer',interactive:'yes'}, {type:'shell.input',open:'true'}, {type:'shell.input'}, {type:'settings.update',settings:{unexpected:true}}]) assert.throws(()=>validateCommand(command));
  assert.equal(validateCommand({type:'config.save',baseUrl:'https://api.moonshot.cn/v1',model:'kimi-k3'}).type,'config.save');
  assert.equal(validateCommand({type:'config.save',baseUrl:'http://127.0.0.1:8080/v1',model:'test'}).type,'config.save');
});
test('desktop IPC enforces message, memory and interaction boundaries', () => {
  assert.throws(()=>validateCommand({type:'chat.send',text:' '}));
  assert.throws(()=>validateCommand({type:'chat.send',text:'x'.repeat(12001)}));
  assert.throws(()=>validateCommand({type:'memory.correct',id:'x',text:''}));
  assert.throws(()=>validateCommand({type:'pet.interact',interaction:'keyboard'}));
  assert.throws(()=>validateCommand({type:'settings.update',settings:{petScale:'big'}}));
  assert.throws(()=>validateCommand({type:'settings.update',settings:{proactiveIntervalMinutes:Number.NaN}}));
  assert.equal(validateCommand({type:'settings.update',settings:{proactiveIntervalMinutes:3,proactiveDailyLimit:500,heartbeatSeconds:15,quietHours:{enabled:true,start:'22:30',end:'07:00'},sandbox:{level:'strict',sensitiveWords:['机密']}}}).type,'settings.update');
  assert.throws(()=>validateCommand({type:'settings.update',settings:{sandbox:{level:'root'}}}));
  assert.throws(()=>validateCommand({type:'schedule.add',note:'喝水'}));
  assert.equal(validateCommand({type:'schedule.add',note:'喝水',inMinutes:30}).type,'schedule.add');
  assert.throws(()=>validateCommand({type:'pet.select',id:'../evil'}));
  assert.throws(()=>validateCommand({type:'persona.save',persona:'x'}));
  assert.equal(validateCommand({type:'chat.send',text:'你好'}).type,'chat.send');
});
