import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResearchRunner } from '../../runtime/core/research-runner';
import { addManual, emptyResearch } from '../../runtime/core/research';
import type { ModelGateway } from '../../runtime/core/model-gateway';
import type { ResearchProgress } from '../../runtime/shared/contracts';

function fixture() {
  const now = Date.now();
  let ledger = addManual(emptyResearch(), '胶片摄影', now, () => 'film');
  ledger.lastPlanAt = now;
  const updates: ResearchProgress[] = [];
  const options = {
    gateway: { request: async () => ({findings:[{title:'新消息',summary:'已阅读原文',sources:[{url:'https://example.com/news',title:'原文'}],confidence:3}]}) } as unknown as ModelGateway,
    web: () => ({ search: async () => [], read: async () => ({}) }) as any,
    ledger: () => ledger,
    save: (next: typeof ledger) => { ledger = next; },
    prepare: async () => {},
    signals: () => ({ counts: { manual: 1 }, manual: ['胶片摄影'] }),
    blocked: () => false, busy: () => false,
    changed: () => { updates.push(runner.status); },
    helper: async () => ({id:'brief',by:'research' as const,goal:'查资料',gist:'已阅读原文',points:['已核对'],sources:[{url:'https://example.com/news',title:'原文'}],at:now}),
  };
  const runner = new ResearchRunner(options);
  return {runner, options, updates, now, ledger:()=>ledger};
}

test('manual research reruns recent interests and publishes progress and a final receipt', async () => {
  const f=fixture();f.ledger().interests[0].lastResearchedAt=f.now;
  await f.runner.step(f.now,true);
  assert.equal(f.ledger().findings.length,1);
  assert.ok(f.updates.some(s=>s.stage==='reading'&&s.running));
  assert.ok(f.updates.some(s=>s.stage==='summarizing'));
  assert.equal(f.runner.status.stage,'done');assert.equal(f.runner.status.running,false);
  assert.match(f.runner.status.message,/1 条笔记/);
});

test('manual research still respects a paused interest',async()=>{
  const f=fixture();f.ledger().interests[0].restUntil=f.now+60_000;
  let helpers=0;f.options.helper=async()=>{helpers++;throw Error('must not run');};
  await f.runner.step(f.now,true);
  assert.equal(helpers,0);assert.equal(f.runner.status.stage,'done');assert.match(f.runner.status.message,/休息/);
});

test('planning failure is visible, sanitized and manually retryable despite automatic backoff',async()=>{
  const f=fixture();f.ledger().lastPlanAt=0;
  let calls=0;
  f.options.gateway.request=async()=>{calls++;throw Error('HTTP 504 private-upstream-response');};
  await f.runner.step(f.now,true);
  assert.equal(f.runner.status.stage,'failed');assert.match(f.runner.status.message,/HTTP 504/);
  assert.ok(!f.runner.status.message.includes('private-upstream-response'));
  await f.runner.step(f.now+1000);assert.equal(calls,1);
  await f.runner.step(f.now+1000,true);assert.equal(calls,2);
});

test('cancel releases a stuck preparation; late work cannot overwrite the next run',async()=>{
  const f=fixture();let release!:()=>void;
  f.options.prepare=()=>new Promise<void>(r=>{release=r;});
  const first=f.runner.step(f.now,true);
  assert.equal(f.runner.status.stage,'preparing');
  f.runner.cancel();await first;
  assert.equal(f.runner.status.stage,'cancelled');assert.equal(f.runner.running,false);
  f.options.prepare=async()=>{};
  await f.runner.step(f.now,true);
  const receipt=f.runner.status;
  release();await new Promise(r=>setImmediate(r));
  assert.deepEqual(f.runner.status,receipt);assert.equal(f.ledger().findings.length,1);
});

test('cancel drops a late planner result and permits another run',async()=>{
  const f=fixture();f.ledger().lastPlanAt=0;
  let release!:(value:unknown)=>void, entered!:()=>void;
  const started=new Promise<void>(r=>{entered=r;});
  f.options.gateway.request=()=>new Promise(r=>{release=r;entered();});
  const run=f.runner.step(f.now,true);await started;
  f.runner.cancel();await run;
  release({interests:[],dailyLife:{summary:'late'}});
  await new Promise(r=>setImmediate(r));
  assert.equal(f.runner.running,false);assert.equal(f.ledger().lastPlanAt,0);assert.equal(f.ledger().daily,undefined);
});

test('an empty research result is reported and not mistaken for a running task',async()=>{
  const f=fixture();f.options.helper=async()=>({id:'empty',by:'research',goal:'查资料',gist:'没有可用原文',points:[],sources:[],at:f.now});
  await f.runner.step(f.now,true);
  assert.equal(f.runner.status.stage,'done');assert.match(f.runner.status.message,/没有找到/);
  assert.equal(f.ledger().runs.length,1);assert.equal(f.updates.at(-1)?.running,false);
});

test('invalid plan and helper failures are exposed as failed research',async()=>{
  const f=fixture();f.ledger().lastPlanAt=0;
  f.options.gateway.request=async()=>({text:'wrong schema'});
  await f.runner.step(f.now,true);assert.equal(f.runner.status.stage,'failed');assert.match(f.runner.status.message,/格式/);
  f.ledger().lastPlanAt=f.now;
  f.options.helper=async()=>({id:'failed',by:'research',goal:'查资料',gist:'没查成：network',points:[],sources:[],at:f.now});
  await f.runner.step(f.now,true);assert.equal(f.runner.status.stage,'failed');assert.equal(f.ledger().runs.length,0);
});
