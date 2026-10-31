import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import { ToolHost } from '../../runtime/core/tool-host';
import { builtinPersonas } from '../../runtime/shared/personas';
import { normalizeSandbox } from '../../runtime/core/privacy';

const credentials = { get: async () => 'fixture-key', set: async () => {} };
const embeddings = () => ({ encode: async () => [1, 0], close: async () => {} });
const memoryReply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"facts":[],"diary":""}' } }] }));
const reply = (body: Record<string, unknown>) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ expression: 'pleased', action: 'idle', ...body }) } }] }));
type Seen = { system: string; context: any; body: any };
function harness(answer: (seen: Seen) => Record<string, unknown>) {
  const seen: Seen[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)), system = String(body.messages[0].content);
    if (system.includes('facts每项')) return memoryReply();
    const marker = '\n状态数据：';
    const item = { system, body, context: system.includes(marker) ? JSON.parse(system.slice(system.indexOf(marker) + marker.length)) : undefined };
    seen.push(item);
    return reply(answer(item));
  };
  return { seen, fetcher };
}
async function make(fetcher: typeof fetch, features?: { attention?: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-universal-core-'));
  const core = new CompanionService({ dataDir: dir, credentials, embeddings: embeddings(), fetch: fetcher, features });
  await core.init();
  return { core, dir, cleanup: async () => { await core.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('switching character cards changes name, prompt and greeting; old lines are labelled with their speaker', async () => {
  const { seen, fetcher } = harness(() => ({ text: '收到' }));
  const { core, cleanup } = await make(fetcher);
  try {
    const first = core.getSnapshot();
    assert.equal(first.identity.name, builtinPersonas[0].name);
    assert.equal(first.visual.bubble, builtinPersonas[0].greeting, 'a fresh install greets with the card text, no model call');
    assert.equal((await core.handle({ type: 'chat.send', text: '你好' })).ok, true);
    await core.waitForBackground();
    assert.ok(seen[0].system.includes(`【名字】${builtinPersonas[0].name}`));
    assert.equal(core.getSnapshot().messages.at(-1)!.speaker, builtinPersonas[0].name);
    const saved = await core.handle({ type: 'persona.save', persona: { name: '豆豆', personality: '爱讲冷笑话', greeting: '豆豆来报到！' } });
    const id = (saved.data as { id: string }).id;
    await core.handle({ type: 'persona.select', id });
    assert.equal(core.getSnapshot().identity.name, '豆豆');
    assert.equal(core.getSnapshot().visual.bubble, '豆豆来报到！');
    await core.handle({ type: 'chat.send', text: '再说一次' });
    await core.waitForBackground();
    const last = seen.at(-1)!;
    assert.ok(last.system.includes('【性格】爱讲冷笑话'));
    assert.ok(!last.system.includes(builtinPersonas[0].personality));
    assert.ok(last.context.visibleHistoryData.some((m: any) => m.speaker === builtinPersonas[0].name), 'earlier replies keep their original speaker');
    assert.equal(last.body.messages.length, 2, 'raw protocol history of another card is not replayed');
    const exported = JSON.parse(core.exportArchive());
    assert.equal(exported.personas.active, id);
    assert.equal(exported.personas.custom[0].name, '豆豆');
  } finally { await cleanup(); }
});

test('the character schedules its own wake-up and is woken with the note when it comes due', async () => {
  let now = Date.now();
  const realNow = Date.now; Date.now = () => now;
  const { seen, fetcher } = harness(item => item.context?.wake ? { text: '面试怎么样啦？' } : { text: '加油！一小时后我来问你', schedule: { inMinutes: 60, note: '问问面试结果' } });
  const { core, cleanup } = await make(fetcher);
  try {
    await core.handle({ type: 'chat.send', text: '我一会儿去面试' });
    await core.waitForBackground();
    const [alarm] = core.getSnapshot().schedules!;
    assert.equal(alarm.note, '问问面试结果');
    assert.equal(alarm.createdBy, 'character');
    assert.ok(seen[0].system.includes('"schedule":{"inMinutes"'), 'the protocol teaches the field');
    await core.tick();
    assert.equal(seen.length, 1, 'not due yet');
    now += 61 * 60_000;
    await core.tick();
    const woken = seen.at(-1)!;
    assert.equal(woken.context.wake.events[0].kind, 'schedule');
    assert.ok(woken.context.wake.events[0].summary.includes('问问面试结果'));
    assert.equal(core.getSnapshot().messages.at(-1)!.text, '面试怎么样啦？');
    assert.deepEqual(core.getSnapshot().messages.at(-1)!.initiativeTopics, ['schedule']);
    assert.equal(core.getSnapshot().schedules!.length, 0, 'one-shot alarm consumed');
  } finally { Date.now = realNow; await cleanup(); }
});

test('user reminders ring in focus mode while the character’s own alarms wait; quiet hours hold both', async () => {
  let now = new Date(2026, 9, 29, 15, 0).getTime();
  const realNow = Date.now; Date.now = () => now;
  const { seen, fetcher } = harness(item => ({ text: item.context?.wake ? '到点啦' : '好' }));
  const { core, cleanup } = await make(fetcher);
  try {
    await core.handle({ type: 'chat.send', text: '你好' }); await core.waitForBackground();
    await core.handle({ type: 'schedule.add', note: '站起来活动一下', inMinutes: 5 });
    await core.handle({ type: 'settings.update', settings: { companionMode: 'focus' } });
    now += 6 * 60_000; await core.tick();
    assert.ok(seen.at(-1)!.context.wake, 'user reminder delivered in focus mode');
    const count = seen.length;
    await core.handle({ type: 'settings.update', settings: { companionMode: 'daily', quietHours: { enabled: true, start: '15:00', end: '18:00' } } });
    await core.handle({ type: 'schedule.add', note: '喝水', inMinutes: 1 });
    now += 2 * 60_000; await core.tick();
    assert.equal(seen.length, count, 'quiet hours hold the reminder');
    assert.equal(core.getSnapshot().activity!.kind, 'sleeping');
    await core.handle({ type: 'settings.update', settings: { quietHours: { enabled: false } } });
    await core.tick();
    assert.ok(seen.length > count, 'held reminder rings once quiet hours end');
  } finally { Date.now = realNow; await cleanup(); }
});

test('numeric companion settings accept any finite value and pace proactive wakes', async () => {
  const { fetcher } = harness(() => ({ text: '嗨' }));
  const { core, cleanup } = await make(fetcher);
  try {
    assert.equal((await core.handle({ type: 'settings.update', settings: { proactiveIntervalMinutes: 3, proactiveHourlyLimit: 9, proactiveDailyLimit: 99, heartbeatSeconds: 15, unansweredMinutes: 7.5 } })).ok, true);
    const s = core.getSnapshot().settings;
    assert.deepEqual([s.proactiveIntervalMinutes, s.proactiveHourlyLimit, s.proactiveDailyLimit, s.heartbeatSeconds, s.unansweredMinutes], [3, 9, 99, 15, 7.5]);
    await core.handle({ type: 'settings.update', settings: { screenIntervalSeconds: 5, proactiveHourlyLimit: 2.6 } });
    assert.equal(core.getSnapshot().settings.screenIntervalSeconds, 60, 'screenshots never faster than once a minute');
    assert.equal(core.getSnapshot().settings.proactiveHourlyLimit, 3);
    assert.equal((await core.handle({ type: 'settings.update', settings: { proactiveIntervalMinutes: Number.NaN } })).ok, false);
  } finally { await cleanup(); }
});

test('secrets typed into chat are redacted before the model request; the local record keeps the original', async () => {
  const { seen, fetcher } = harness(() => ({ text: '我不会记下密钥的' }));
  const { core, cleanup } = await make(fetcher);
  try {
    await core.handle({ type: 'settings.update', settings: { sandbox: { sensitiveWords: ['北极星项目'] } } });
    await core.handle({ type: 'chat.send', text: '帮我看看 sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX123 这个 key，顺便聊聊北极星项目' });
    await core.waitForBackground();
    const sent = JSON.stringify(seen.at(-1)!.body);
    assert.ok(!sent.includes('sk-proj-ABCDEFGHIJKLMNOP'));
    assert.ok(!sent.includes('北极星项目'));
    assert.ok(core.getSnapshot().messages.some(m => m.text.includes('北极星项目')), 'local history unchanged');
    assert.ok(core.getSnapshot().privacy!.redactedToday >= 2);
    assert.ok(!JSON.stringify(core.getSnapshot().privacy).includes('北极星'));
    await core.handle({ type: 'privacy.lockdown' });
    const after = core.getSnapshot().settings;
    assert.equal(after.observationEnabled, false);
    assert.equal(after.sandbox!.level, 'strict');
  } finally { await cleanup(); }
});

test('custom pixel pets: import validated file, select, refuse bad files, delete', async () => {
  const { fetcher } = harness(() => ({ text: '好' }));
  const { core, dir, cleanup } = await make(fetcher);
  try {
    const template = await readFile(join(process.cwd(), 'skills/galagent-pixel-pet/template.json'), 'utf8');
    const spec = JSON.parse(template); spec.id = 'my-test-pet'; spec.name = '测试小人';
    const imported = await core.handle({ type: 'pet.import', text: JSON.stringify(spec) });
    assert.equal(imported.ok, true, imported.error);
    assert.ok(core.getSnapshot().pets!.catalog.some(p => p.id === 'my-test-pet' && !p.builtin));
    assert.equal((await core.handle({ type: 'pet.select', id: 'my-test-pet' })).ok, true);
    assert.equal(core.getSnapshot().settings.petId, 'my-test-pet');
    assert.equal(((await core.handle({ type: 'pet.get', id: 'my-test-pet' })).data as { name: string }).name, '测试小人');
    assert.equal((await core.handle({ type: 'pet.import', text: '{"format":"nope"}' })).ok, false);
    // Files dropped straight into the folder are picked up on the next tick.
    await mkdir(join(dir, 'pets'), { recursive: true });
    await writeFile(join(dir, 'pets', 'dropped.json'), JSON.stringify({ ...spec, id: 'dropped-pet', name: '放进来的' }));
    await core.tick();
    assert.ok(core.getSnapshot().pets!.catalog.some(p => p.id === 'dropped-pet'));
    await core.handle({ type: 'pet.delete', id: 'my-test-pet' });
    assert.equal(core.getSnapshot().settings.petId, '');
    assert.equal((await core.handle({ type: 'pet.delete', id: core.getSnapshot().pets!.catalog[0].id })).ok, false, 'built-ins cannot be deleted');
  } finally { await cleanup(); }
});

test('executor sandbox confines file tools to the workspace and blocks shell and credential files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'galagent-sandbox-'));
  const work = join(root, 'work'), outside = join(root, 'outside');
  await mkdir(work); await mkdir(outside); await mkdir(join(work, '.ssh'));
  await writeFile(join(work, 'note.txt'), 'hello'); await writeFile(join(outside, 'secret.txt'), 'top secret'); await writeFile(join(work, '.ssh', 'id_rsa'), 'KEY'); await writeFile(join(work, '.ssh', 'config'), 'Host x');
  let sandbox = normalizeSandbox({});
  const host = new ToolHost({ save: () => {}, ask: async () => ({}), child: async () => '', sandbox: () => sandbox });
  const session = host.session(work);
  const call = (name: string, args: Record<string, unknown>) => host.execute(session, name, args, new AbortController().signal);
  try {
    assert.ok(JSON.stringify(await call('Read', { path: 'note.txt' })).includes('hello'));
    // standard: read anywhere, write only inside the workspace, Shell only after the user says yes
    assert.ok(JSON.stringify(await call('Read', { path: join(outside, 'secret.txt') })).includes('top secret'));
    assert.ok(JSON.stringify(await call('Write', { path: join(outside, 'new.txt'), content: 'x' })).includes('confines file tools'));
    assert.match(JSON.stringify(await call('Read', { path: '.ssh/id_rsa' })), /Sensitive file|never readable/);
    assert.ok(JSON.stringify(await call('Read', { path: '.ssh/config' })).includes('never readable'));
    assert.ok(JSON.stringify(await call('Bash', { command: 'echo hi' })).includes('declined'), 'no answer means no');
    sandbox = normalizeSandbox({ level: 'standard', fileScope: 'workspace' });
    assert.ok(JSON.stringify(await call('Read', { path: join(outside, 'secret.txt') })).includes('confines file tools'));
    sandbox = normalizeSandbox({ level: 'standard', shell: false });
    assert.ok(JSON.stringify(await call('Bash', { command: 'echo hi' })).includes('Shell is disabled'));
    sandbox = normalizeSandbox({ level: 'strict' });
    assert.ok(JSON.stringify(await call('Write', { path: 'new.txt', content: 'x' })).includes('read-only'));
    sandbox = normalizeSandbox({ level: 'open' });
    assert.ok(JSON.stringify(await call('Read', { path: join(outside, 'secret.txt') })).includes('top secret'));
  } finally { host.close(); await rm(root, { recursive: true, force: true }); }
});

test('Shell confirmation: the user sees the command and may allow once, for the whole task, or refuse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'galagent-confirm-'));
  const asked: string[] = []; let reply = '拒绝';
  const host = new ToolHost({ save: () => {}, ask: async questions => { asked.push(questions[0].question); return { [questions[0].question]: reply }; }, child: async () => '', sandbox: () => normalizeSandbox({}) });
  const session = host.session(root);
  const run = (command: string) => host.execute(session, 'Bash', { command }, new AbortController().signal).then(r => JSON.stringify(r));
  try {
    assert.match(await run('echo one'), /declined/);
    assert.match(asked[0], /echo one/);
    reply = '允许这一次'; assert.match(await run('echo two'), /two/);
    reply = '本任务都允许'; assert.match(await run('echo three'), /three/);
    reply = '拒绝'; assert.match(await run('echo four'), /four/, 'no more questions after "allow for this task"');
    assert.equal(asked.length, 3);
    const other = host.session(root);
    await host.execute(other, 'Bash', { command: 'echo five' }, new AbortController().signal);
    assert.equal(asked.length, 4, 'a new task asks again');
    const open = new ToolHost({ save: () => {}, ask: async () => { throw new Error('should not ask'); }, child: async () => '', sandbox: () => normalizeSandbox({ level: 'open' }) });
    try { assert.match(JSON.stringify(await open.execute(open.session(root), 'Bash', { command: 'echo six' }, new AbortController().signal)), /six/); } finally { open.close(); }
  } finally { host.close(); await rm(root, { recursive: true, force: true }); }
});

test('AI drafting a character card trims over-long fields and saves nothing until confirmed', async () => {
  const long = '很'.repeat(3000);
  const { fetcher } = harness(() => ({ name: '狼人管家', pronoun: '他', personality: long, idleLines: ['擦银器', '一个特别特别特别特别特别特别长的发呆词条超过限制'], greeting: '少爷，茶好了。' }));
  const { core, cleanup } = await make(fetcher);
  try {
    const before = core.getSnapshot().persona!.list.length;
    const result = await core.handle({ type: 'persona.generate', brief: '会做饭的狼人管家' });
    assert.equal(result.ok, true, result.error);
    const draft = result.data as { name: string; personality: string; idleLines: string[] };
    assert.equal(draft.name, '狼人管家');
    assert.equal([...draft.personality].length, 1500);
    assert.ok(draft.idleLines.every(line => [...line].length <= 24));
    assert.equal(core.getSnapshot().persona!.list.length, before);
  } finally { await cleanup(); }
});

test('lockdown from the open level really applies the strict preset; masks are never written back', async () => {
  const { fetcher } = harness(() => ({ text: '好' }));
  const { core, cleanup } = await make(fetcher);
  try {
    await core.handle({ type: 'settings.update', settings: { sandbox: { level: 'open' } } });
    assert.equal(core.getSnapshot().settings.sandbox!.shell, true);
    await core.handle({ type: 'privacy.lockdown' });
    const box = core.getSnapshot().settings.sandbox!;
    assert.deepEqual([box.level, box.fileScope, box.shell, box.network, box.redactPersonal], ['strict', 'workspace-read', false, false, true]);
  } finally { await cleanup(); }
  const root = await mkdtemp(join(tmpdir(), 'galagent-mask-'));
  await writeFile(join(root, 'app.env.txt'), 'password=hunter2hunter2\n');
  const host = new ToolHost({ save: () => {}, ask: async () => ({}), child: async () => '', sandbox: () => normalizeSandbox({}) });
  const session = host.session(root);
  try {
    await host.execute(session, 'Read', { path: 'app.env.txt' }, new AbortController().signal);
    const out = await host.execute(session, 'Write', { path: 'app.env.txt', content: 'password=〔已隐藏·口令〕\n' }, new AbortController().signal);
    assert.match(JSON.stringify(out), /privacy mask/);
    assert.equal(await readFile(join(root, 'app.env.txt'), 'utf8'), 'password=hunter2hunter2\n');
  } finally { host.close(); await rm(root, { recursive: true, force: true }); }
});
