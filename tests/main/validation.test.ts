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
  assert.throws(()=>validateCommand({type:'settings.update',settings:{petScale:10}}));
  assert.equal(validateCommand({type:'chat.send',text:'你好'}).type,'chat.send');
});
