import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CompanionService } from '../../runtime/core/companion';
import { Store } from '../../runtime/core/store';
import {
  addManual,
  addFindings,
  emptyResearch,
  noteShared,
  reactToResearch,
  readResearch,
  shareable,
  type ResearchLedger,
} from '../../runtime/core/research';
import type { ResearchFinding } from '../../runtime/shared/contracts';

function notebook(now: number) {
  const ledger = addManual(emptyResearch(), '胶片', now, () => 'film');
  const finding: ResearchFinding = {
    id: 'f1',
    interestId: 'film',
    topic: '胶片',
    angle: '新品',
    title: '新胶卷上市',
    summary: '这卷胶片可以拍 36 张',
    why: '你在准备试拍',
    sources: [{ title: '厂商公告', url: 'https://film.example/news' }],
    confidence: 3,
    freshness: 'new',
    at: now,
  };
  return addFindings(
    ledger,
    'film',
    [
      finding,
      { ...finding, id: 'f2', title: '换标题的同一件事' },
      { ...finding, id: 'f3', title: '冲洗活动', summary: '周六可以冲洗' },
    ],
    now,
  );
}

test('a change of subject is neutral; a removed interest cannot return through a late research result', () => {
  const ledger = notebook(100);
  assert.deepEqual(
    ledger.findings.map((f) => f.id),
    ['f1', 'f3'],
  );
  const neutral = reactToResearch(noteShared(ledger, ['f1'], 100), 101, '帮我改个文件');
  assert.equal(neutral.interests[0].weight, ledger.interests[0].weight);
  assert.equal(neutral.thread, undefined);
  const removed = { ...ledger, interests: [], findings: [] };
  assert.equal(addFindings(removed, 'film', ledger.findings, 102), removed);
});

test('an actual initiative shares one sourced detail, remembers the URL after restart and backs off when asked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gal-research-thread-'));
  const realNow = Date.now;
  let now = new Date(2026, 10, 6, 14, 0).getTime(),
    lastContext: any;
  Date.now = () => now;
  const seed = new Store(dir);
  seed.put('state', 'research', notebook(now));
  seed.close();
  const make = () =>
    new CompanionService({
      dataDir: dir,
      workingDir: dir,
      credentials: { get: async () => 'fixture', set: async () => {} },
      features: { life: true, research: true },
      embeddings: { encode: async () => [1, 0], close: async () => {} },
      fetch: async (_url, init) => {
        const b = JSON.parse(String(init?.body)),
          sys = String(b.messages[0].content);
        let result: any;
        if (sys.includes('facts每项')) result = { facts: [], diary: '' };
        else {
          const ctx = JSON.parse(sys.split('\n状态数据：')[1]);
          lastContext = ctx;
          if (ctx.scene === 'initiative') {
            assert.match(b.messages.at(-1).content, /你在准备试拍/);
            assert.match(b.messages.at(-1).content, /film\.example/);
            assert.match(b.messages.at(-1).content, /用户原话/);
            assert.match(b.messages.at(-1).content, /我想周末试试胶片/);
            result = {
              text: '你之前想试胶片，这卷能拍 36 张。',
              sharedFindingId: 'f1',
              expression: 'pleased',
              action: 'idle',
            };
          } else result = { text: '好，我记下了。', expression: 'neutral', action: 'idle' };
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(result) } }] }),
        );
      },
    });
  let core = make();
  const saved = () => {
    const store = new Store(dir);
    try {
      return readResearch(store.get<ResearchLedger>('research'));
    } finally {
      store.close();
    }
  };
  try {
    await core.init();
    assert.ok((await core.handle({ type: 'chat.send', text: '你好' })).ok);
    await core.waitForBackground();
    assert.ok((await core.handle({type:'memory.remember',text:'我想周末试试胶片'})).ok);
    await core.waitForBackground();
    now += 6 * 60000;
    await core.lifeStep(now);
    assert.equal(core.getSnapshot().messages.filter((m) => m.source === 'initiative').length, 1);
    assert.deepEqual(saved().pendingShare?.ids, ['f1']);
    assert.equal(saved().findings[1].sharedAt, undefined);
    await core.close();
    core = make();
    await core.init();
    assert.ok((await core.handle({ type: 'chat.send', text: '原文在哪？' })).ok);
    assert.equal(lastContext.researchNotes[0].sources[0].url, 'https://film.example/news');
    assert.equal(lastContext.researchNotes[0].alreadyShared, true);
    assert.ok((await core.handle({ type: 'chat.send', text: '先别聊这个了' })).ok);
    assert.ok(saved().interests[0].restUntil! > now, 'an explicit refusal overrides the pin');
    assert.deepEqual(shareable(saved(), now), []);
    assert.equal(lastContext.researchNotes, undefined);
    await core.close();
    core = make();
    await core.init();
    assert.deepEqual(shareable(saved(), now), []);
    assert.ok((await core.handle({ type: 'chat.send', text: '继续关注胶片' })).ok);
    assert.equal(saved().interests[0].restUntil, undefined);
    assert.deepEqual(
      shareable(saved(), now).map((f) => f.id),
      ['f3'],
    );
    assert.ok((await core.handle({ type: 'chat.send', text: '取消关注胶片' })).ok);
    assert.equal(saved().interests.length, 0);
    assert.equal(saved().findings.length, 0);
    assert.ok((await core.handle({ type: 'chat.send', text: '如果我说帮我留意星星呢？' })).ok);
    assert.equal(saved().interests.length, 0);
    assert.ok((await core.handle({ type: 'chat.send', text: '帮我留意一下摄影展' })).ok);
    assert.equal(saved().interests[0].topic, '摄影展');
    assert.equal(lastContext.researchPreference.topic, '摄影展');
  } finally {
    Date.now = realNow;
    await core.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('removing a topic during research cancels both angles; a late helper cannot restore the topic', async () => {
  const dir = await mkdtemp(join(tmpdir(),'gal-research-running-'));
  const now=Date.now(), seed=new Store(dir);
  const ledger=notebook(now); ledger.lastPlanAt=now; ledger.runs=[];
  delete ledger.interests[0].lastResearchedAt;
  seed.put('state','research',ledger);seed.close();
  let release!:()=>void, started!:()=>void, helperCalls=0;
  const barrier=new Promise<void>(r=>release=r), entered=new Promise<void>(r=>started=r);
  const core=new CompanionService({dataDir:dir,workingDir:dir,credentials:{get:async()=>'fixture',set:async()=>{}},
    features:{research:true},embeddings:{encode:async()=>[1,0],close:async()=>{}},
    fetch:async(_u,init)=>{
      const b=JSON.parse(String(init?.body)), sys=String(b.messages[0].content);
      let result;
      if(sys.includes('派出去的并行助手')){
        if(++helperCalls===2)started();
        await barrier; // Simulate a server that returns a response even after local cancellation.
        result={gist:'迟来的结果',sources:[],points:[]};
      }else if(sys.includes('facts每项')) result={facts:[],diary:''};
      else result={text:'嗯。',expression:'neutral',action:'idle'};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));
    }});
  try{
    await core.init();await core.handle({type:'chat.send',text:'你好'});await core.waitForBackground();
    const run=core.researchStep(now,true);
    await entered;
    await core.researchStep(now,true);
    assert.equal(helperCalls,2,'second trigger does not start duplicate helpers');
    assert.ok((await core.handle({type:'research.removeInterest',id:'film'})).ok);
    release();await run;
    assert.equal(core.getSnapshot().research?.findings.length,0);
    assert.equal(core.getSnapshot().research?.interests.length,0);
  }finally{release();await core.close();await rm(dir,{recursive:true,force:true});}
});
