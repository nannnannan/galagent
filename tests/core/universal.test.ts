import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../runtime/core/store';
import { PersonaBook } from '../../runtime/core/persona';
import { SelfWakeScheduler, readScheduleField, resolveAt } from '../../runtime/core/scheduler';
import { PrivacyGuard, redactText, normalizeSandbox, sensitivePath, DEFAULT_SANDBOX } from '../../runtime/core/privacy';
import { builtinPersonas, buildPersonaPrompt, parsePersonaFile, personaFile, normalizePersona } from '../../runtime/shared/personas';

async function store() { const dir = await mkdtemp(join(tmpdir(), 'galagent-universal-')); const db = new Store(dir); return { store: db, cleanup: () => { db.close(); return rm(dir, { recursive: true, force: true }); } }; }

test('built-in character cards are generic, valid and free of the old hard-coded persona', () => {
  assert.ok(builtinPersonas.length >= 6);
  assert.equal(new Set(builtinPersonas.map(p => p.id)).size, builtinPersonas.length);
  for (const p of builtinPersonas) {
    assert.doesNotThrow(() => normalizePersona(p));
    const prompt = buildPersonaPrompt(p);
    assert.ok(prompt.includes(p.name));
    assert.ok(!/Kimi|可黎|弹钢琴|吃醋/.test(prompt), `${p.id} still carries the old persona`);
    assert.ok(prompt.includes('通用守则'));
  }
});

test('custom cards: save, edit, built-in copy-on-write, delete falls back, file round-trip', async () => {
  const { store: s, cleanup } = await store();
  const book = new PersonaBook(s);
  assert.equal(book.active().id, builtinPersonas[0].id);
  const mine = book.save({ name: '阿福', personality: '憨厚', idleLines: ['发呆', '发呆', '打哈欠'] });
  assert.deepEqual(mine.idleLines, ['发呆', '打哈欠']);
  book.select(mine.id);
  assert.equal(book.active().name, '阿福');
  assert.ok(book.prompt().includes('【性格】憨厚'));
  const edited = book.save({ name: '阿福二号' }, mine.id);
  assert.equal(edited.id, mine.id);
  assert.equal(edited.personality, '憨厚', 'unspecified fields keep their value');
  const copy = book.save({ name: '我的星野' }, builtinPersonas[0].id);
  assert.notEqual(copy.id, builtinPersonas[0].id);
  assert.equal(copy.personality, builtinPersonas[0].personality);
  assert.throws(() => book.delete(builtinPersonas[0].id), /内置/);
  book.delete(mine.id);
  assert.equal(book.active().id, builtinPersonas[0].id);
  const parsed = parsePersonaFile(personaFile(copy));
  assert.equal(parsed.name, '我的星野');
  assert.throws(() => normalizePersona({ name: '' }), /名字/);
  assert.throws(() => normalizePersona({ name: 'x', personality: '长'.repeat(2000) }), /性格/);
  assert.throws(() => parsePersonaFile('not json'), /JSON/);
  await cleanup();
});

test('self-wake alarms: relative and clock times, dedupe, repeat, expiry, model field parsing', async () => {
  const { store: s, cleanup } = await store();
  let now = new Date(2026, 9, 29, 10, 0).getTime();
  const alarms = new SelfWakeScheduler(s, () => now);
  const a = alarms.add({ note: '问问面试结果', inMinutes: 30 }, 'character');
  assert.equal(a.dueAt, now + 30 * 60_000);
  assert.equal(alarms.add({ note: '问问面试结果', inMinutes: 31 }, 'character').id, a.id, 'near-identical alarm is not duplicated');
  assert.equal(resolveAt('09:30', now), new Date(2026, 9, 30, 9, 30).getTime(), 'past clock time rolls to tomorrow');
  const water = alarms.add({ note: '喝水', inMinutes: 5, repeatMinutes: 60 }, 'user');
  assert.throws(() => alarms.add({ note: 'x', inMinutes: 0 }, 'user'));
  assert.throws(() => alarms.add({ note: 'x', inMinutes: 60 * 24 * 40 }, 'user'));
  assert.throws(() => alarms.add({ note: 'x', at: '25:00' }, 'user'));
  now += 6 * 60_000;
  assert.deepEqual(alarms.due().map(x => x.id), [water.id]);
  alarms.complete(water);
  assert.equal(alarms.list().find(x => x.id === water.id)!.dueAt, water.dueAt + 60 * 60_000);
  now += 13 * 3600_000;
  assert.deepEqual(alarms.expire().map(x => x.id), [a.id], 'only the character’s own stale alarm is dropped');
  assert.ok(alarms.list().some(x => x.id === water.id), 'the user’s reminder still waits to ring');
  assert.equal(alarms.list().some(x => x.id === a.id), false, 'stale one-shot dropped');
  assert.deepEqual(readScheduleField({ inMinutes: '15', note: ' 提醒休息 ' }), { note: '提醒休息', inMinutes: 15 });
  assert.deepEqual(readScheduleField({ at: '18:30', note: '下班', repeatMinutes: 1440 }), { note: '下班', at: '18:30', repeatMinutes: 1440 });
  assert.equal(readScheduleField({ note: '缺时间' }), undefined);
  assert.equal(readScheduleField('soon'), undefined);
  await cleanup();
});

test('privacy guard redacts secrets and chosen words, blocks exfiltration URLs, audits without content', async () => {
  const { store: s, cleanup } = await store();
  let sandbox = normalizeSandbox({ sensitiveWords: ['蓝鲸计划'] });
  const guard = new PrivacyGuard(() => sandbox, s);
  const raw = '密钥 sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX123 和 password=hunter2hunter，项目代号蓝鲸计划，电话13812345678';
  const out = guard.text(raw, 'chat');
  assert.ok(!out.includes('sk-proj-ABCDEFG'));
  assert.ok(!out.includes('hunter2hunter'));
  assert.ok(!out.includes('蓝鲸计划'));
  assert.ok(out.includes('13812345678'), 'personal data kept unless enabled');
  sandbox = normalizeSandbox({ redactPersonal: true }, sandbox);
  assert.ok(!guard.text(raw, 'chat').includes('13812345678'));
  assert.ok(redactText('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----', sandbox).text.includes('〔已隐藏·私钥〕'));
  assert.equal(redactText('卡号 6222020200112345678', sandbox).count, 0, 'non-Luhn digits are not a bank card');
  assert.equal(redactText('id 3f2a9c1e-77aa-4b1c-9d2e-a13812345678', sandbox).count, 0, 'UUID segments are not phone numbers');
  assert.equal(redactText('data:image/png;base64,sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX', sandbox).count, 0, 'media payloads untouched');
  const messages = guard.messages([{ role: 'user', content: [{ type: 'text', text: 'token: abcdefghijkl' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }], 'model');
  assert.ok(JSON.stringify(messages).includes('〔已隐藏·口令〕'));
  assert.ok(JSON.stringify(messages).includes('data:image/png;base64,AAAA'));
  assert.throws(() => guard.assertUrl(new URL('https://evil.example/collect?k=sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX123')), /sensitive/);
  sandbox = normalizeSandbox({ allowedDomains: ['https://docs.example.com/path'] }, sandbox);
  assert.doesNotThrow(() => guard.assertUrl(new URL('https://api.docs.example.com/x')));
  assert.throws(() => guard.assertUrl(new URL('https://other.example/x')), /allow-list/);
  sandbox = normalizeSandbox({ level: 'strict' }, sandbox);
  assert.equal(sandbox.network, false);
  assert.throws(() => guard.assertUrl(new URL('https://api.docs.example.com/x')), /disabled/);
  const view = guard.view();
  assert.ok(view.redactedToday >= 4 && view.blockedToday >= 3);
  assert.ok(!JSON.stringify(view).includes('hunter2'), 'audit never stores content');
  guard.clear();
  assert.equal(guard.view().recent.length, 0);
  await cleanup();
});

test('sandbox presets and always-blocked credential paths', () => {
  assert.equal(DEFAULT_SANDBOX.level, 'standard');
  assert.equal(DEFAULT_SANDBOX.shell, false);
  const open = normalizeSandbox({ level: 'open' });
  assert.equal(open.shell, true);
  assert.equal(normalizeSandbox({ shell: false }, open).shell, false, 'switches override the preset');
  assert.throws(() => normalizeSandbox({ level: 'root' }));
  for (const file of ['C:/Users/a/.ssh/id_rsa', '/home/a/.aws/credentials', 'D:/vault/me.kdbx', 'C:/Users/a/AppData/Roaming/GalAgent/provider-key.bin', '/p/.env.local', '/srv/site.pem']) assert.ok(sensitivePath(file), file);
  for (const file of ['C:/work/readme.md', '/home/a/project/src/key-utils.ts']) assert.equal(sensitivePath(file), false, file);
});

test('review regressions: env-style keys, JSON-safe masks, mapped IPv6 loopback, snooze survives completion', async () => {
  const s = normalizeSandbox({});
  for (const line of ['DB_PASSWORD=hunter2hunter2', 'OPENAI_API_KEY=abcdefghijklmnop', 'aws_secret_access_key = wJalrXUtnFEMIabc', '_authToken=npm_abcdef123456']) assert.equal(redactText(line, s).count, 1, line);
  const json = JSON.stringify({ text: '我的密码是abc12345', next: 1, token: 'zzzzzzzzzz' });
  assert.doesNotThrow(() => JSON.parse(redactText(json, s).text), 'masking keeps surrounding JSON valid');
  assert.equal(redactText('{"contextTokens":3120,"tokensToday":12000}', s).count, 0);
  const { isPrivateAddress } = await import('../../runtime/core/tool-host');
  assert.equal(isPrivateAddress(new URL('http://[::ffff:127.0.0.1]:18890/').hostname), true);
  assert.equal(isPrivateAddress('::ffff:c0a8:0101'), true);
  assert.equal(isPrivateAddress('::ffff:0808:0808'), false);
  const { store: st, cleanup } = await store();
  let now = Date.now();
  const alarms = new SelfWakeScheduler(st, () => now);
  const first = alarms.add({ note: '喝水', inMinutes: 5 }, 'character');
  now += 6 * 60_000;
  const snooze = alarms.add({ note: '喝水', inMinutes: 3 }, 'character');
  assert.notEqual(snooze.id, first.id, 'snooze is a new alarm, not the ringing one');
  alarms.complete(first);
  assert.deepEqual(alarms.list().map(a => a.id), [snooze.id]);
  const user = alarms.add({ note: '交房租', inMinutes: 1 }, 'user');
  now += 24 * 3600_000;
  alarms.expire();
  assert.ok(alarms.list().some(a => a.id === user.id), 'user reminders are never silently dropped');
  await cleanup();
});

test('forgetting curve: a recalled memory outranks an equally old one that was never used', async () => {
  const { memoryBoost } = await import('../../runtime/core/memory-plus');
  const now = Date.parse('2026-10-29T00:00:00Z'), old = '2026-08-01T00:00:00Z';
  const base = { id: 'a', kind: 'fact' as const, text: 'x', sourceId: 's', createdAt: old, valid: true };
  assert.ok(memoryBoost({ ...base, recalls: 2, lastRecalledAt: '2026-10-28T00:00:00Z' }, now) > memoryBoost(base, now));
});
