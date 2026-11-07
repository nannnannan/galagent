import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import { followupTime } from '../../runtime/core/care-events';
import { Store } from '../../runtime/core/store';
import { optionalInterruption } from '../../runtime/core/pacing';

test('imprecise days are followed after the day; weekdays and rescheduling use local dates', () => {
  const now = new Date(2026, 10, 6, 14).getTime();
  assert.equal(followupTime('明天下午', now), new Date(2026, 10, 7, 19).getTime());
  assert.equal(followupTime('下周一上午', now), new Date(2026, 10, 9, 13).getTime());
  assert.equal(followupTime('下个星期一上午', new Date(2026, 10, 2, 14).getTime()), new Date(2026, 10, 9, 13).getTime());
  assert.equal(
    followupTime('周日', new Date(2026, 10, 2, 14).getTime()),
    new Date(2026, 10, 9, 10).getTime(),
  );
  assert.equal(followupTime('明天9:00', now), new Date(2026, 10, 7, 11).getTime());
});

test('one event follows a changed date, is asked once, then ends with the user’s result across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gal-care-')),
    original = Date.now;
  let now = new Date(2026, 10, 6, 14).getTime(),
    last: any,
    asks = 0;
  Date.now = () => now;
  const make = () =>
    new CompanionService({
      dataDir: dir,
      workingDir: dir,
      features: { life: true },
      credentials: { get: async () => 'fixture', set: async () => {} },
      embeddings: { encode: async () => [1, 0], close: async () => {} },
      fetch: async (_url, init) => {
        const b = JSON.parse(String(init?.body)),
          sys = String(b.messages[0].content),
          text = String(b.messages.at(-1).content);
        let result: any = { text: '记住了。', expression: 'neutral', action: 'idle' };
        if (sys.includes('facts每项')) result = { facts: [], diary: '' };
        else {
          last = JSON.parse(sys.split('\n状态数据：')[1]);
          const event = last.careEvents?.[0];
          if (text === '我明天下午有面试')
            result.careUpdates = [{ title: '面试', quote: text, when: '明天下午', status: 'open' }];
          if (text === '改到下周一上午了')
            result.careUpdates = [{ id: event.id, quote: text, when: '下周一上午', status: 'open' }];
          if (text === '通过了，收到录用了')
            result.careUpdates = [{ id: event.id, quote: text, status: 'resolved' }];
          if (last.scene === 'initiative' && last.wake?.reason === '跟进用户正在经历的事') {
            asks++;
            result = { ...result, text: '面试后来怎么样了？' };
          }
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(result) } }] }),
        );
      },
    });
  let core = make();
  const observe = () =>
    core.setObservation({
      available: true,
      appName: 'FixtureEditor',
      idleSeconds: 30,
      observedAt: new Date(now).toISOString(),
    });
  try {
    await core.init();
    await core.handle({ type: 'settings.update', settings: { shareDailyLimit: 0, recallEveryDays: 0 } });
    await core.handle({ type: 'chat.send', text: '我明天下午有面试' });
    await core.waitForBackground();
    now += 120000;
    await core.handle({ type: 'chat.send', text: '改到下周一上午了' });
    await core.waitForBackground();
    const archive = JSON.parse(core.exportArchive());
    assert.equal(archive.careEvents.length, 1);
    assert.equal(archive.careEvents[0].followAt, new Date(2026, 10, 9, 13).getTime());
    now = new Date(2026, 10, 7, 20).getTime();
    observe();
    await core.tick();
    assert.equal(asks, 0);
    await core.close();
    core = make();
    await core.init();
    now = new Date(2026, 10, 9, 14).getTime();
    observe();
    await core.tick();
    assert.equal(asks, 1);
    now += 10 * 60000;
    observe();
    await core.tick();
    assert.equal(asks, 1);
    await core.handle({ type: 'chat.send', text: '通过了，收到录用了' });
    await core.waitForBackground();
    const ended = JSON.parse(core.exportArchive());
    assert.equal(ended.careEvents[0].status, 'resolved');
    assert.equal(ended.careEvents[0].sourceIds.length, 3);
    await core.importArchive(JSON.stringify(archive));
    assert.equal(
      JSON.parse(core.exportArchive()).careEvents[0].status,
      'resolved',
      'an older backup cannot reopen a resolved event',
    );
    await core.close();
    core = make();
    await core.init();
    now += 86400000;
    observe();
    await core.tick();
    assert.equal(asks, 1);
    await core.handle({ type: 'chat.send', text: '你还记得面试吗' });
    assert.equal(last.careEvents[0].status, 'resolved');
    const beforeDelete = new Store(dir);
    const contexts = beforeDelete.all<{sourceIds:string[]}>('transport');
    assert.ok(contexts.some(record => ended.careEvents[0].sourceIds.every((id:string) => record.sourceIds.includes(id))));
    beforeDelete.close();
    // The derived state must not survive deletion of its evidence.
    const deleted = JSON.parse(core.exportArchive());
    deleted.tombstones.push(ended.careEvents[0].sourceIds[0]);
    await core.importArchive(JSON.stringify(deleted));
    const store = new Store(dir);
    assert.equal(store.all('care-event').length,0);
    store.close();
    assert.deepEqual(JSON.parse(core.exportArchive()).careEvents, []);
  } finally {
    await core.close();
    Date.now = original;
    await rm(dir, { recursive: true, force: true });
  }
});

test('optional concern waits while switching apps, gaming fullscreen, or waiting for a reply', () => {
  const now = Date.now(),
    observation = {
      available: true,
      observedAt: new Date(now).toISOString(),
      appName: 'Fixture',
      idleSeconds: 1,
    };
  assert.equal(optionalInterruption({ ...observation, fullscreen: true }, true, [], 0, now), 'fullscreen');
  assert.equal(optionalInterruption(observation, true, [], now - 2000, now), 'switching-apps');
  assert.equal(
    optionalInterruption(
      observation,
      true,
      [
        {
          id: 'x',
          role: 'assistant',
          text: '近况如何',
          source: 'initiative',
          createdAt: new Date(now - 5 * 60000).toISOString(),
        },
      ],
      0,
      now,
    ),
    'waiting-for-reply',
  );
  assert.equal(optionalInterruption(observation, true, [], now - 60000, now), undefined);
});
test('many updates retain the evidence for the original title and latest appointment when exporting',async()=>{
  const {CareEvents,validateCareArchive}=await import('../../runtime/core/care-events');
  const {randomUUID}=await import('node:crypto');
  const dir=await mkdtemp(join(tmpdir(),'gal-care-provenance-'));
  const store=new Store(dir), care=new CareEvents(store);
  let eventId='';
  const now=Date.now();
  try {
    for(let index=0;index<80;index++){
      const text=index===0?'明天面试':index===1?'改到下周一上午了':'面试有新进展 '+index;
      const message={id:randomUUID(),role:'user' as const,source:'chat' as const,text,createdAt:new Date(now+index).toISOString()};
      store.put('message',message.id,message);
      care.apply([{...(eventId?{id:eventId}:{title:'面试'}),quote:text,status:'open',...(index===0?{when:'明天'}:index===1?{when:'下周一上午'}:{})}],message);
      eventId=care.all()[0].id;
    }
    assert.ok(care.all()[0].sourceIds.length<=60);
    assert.equal(care.all()[0].when,'下周一上午');
    assert.equal(validateCareArchive(care.all(),id=>store.get(id)).length,1);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
