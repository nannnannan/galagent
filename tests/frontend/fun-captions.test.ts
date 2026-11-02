import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSY_ROTATE_MS, BusyTicker, Orbit, Stare, boredWords, busyLabeler, chatReaction, elapsedText, idleCaption, idleWords, initiativeWords, thinkingWords, workingWords } from '../../runtime/renderer/fun';
import { builtinPersonas, normalizePersona, PERSONA_LIMITS } from '../../runtime/shared/personas';
import { achievements } from '../../runtime/shared/achievements';

test('word pools are large, unique and short enough for the overhead chip', () => {
  for (const [pool, min] of [[thinkingWords, 60], [workingWords, 25], [initiativeWords, 8], [idleWords, 35]] as const) {
    assert.ok(pool.length >= min, `pool of ${pool.length}`);
    assert.equal(new Set(pool).size, pool.length, 'no duplicates');
    assert.ok(pool.every(w => [...w].length <= 12), 'fits on the chip');
  }
});
test('elapsed time reads like a spinner: seconds, then minutes', () => {
  assert.equal(elapsedText(0), '0s'); assert.equal(elapsedText(7900), '7s'); assert.equal(elapsedText(65_000), '1m 05s'); assert.equal(elapsedText(-5), '0s');
});
test('busy ticker rotates words, shows elapsed time after 4s and mixes in the character\'s own words', () => {
  const t = new BusyTicker('thinking', 1000, ['咬笔头']);
  assert.match(t.text(1000), /^.+…$/, 'no timer at first');
  assert.match(t.text(1000 + 12_000), /… 12s$/);
  const seen = new Set<string>(); for (let i = 0; i < 40; i++) seen.add(t.word(1000 + i * BUSY_ROTATE_MS));
  assert.ok(seen.size > 20, 'keeps changing');
  assert.equal(t.word(1000), '咬笔头', 'own word comes first');
  const w = new BusyTicker('working', 0); assert.ok(workingWords.includes(w.word(0)));
});
test('busy labeler keeps one shuffle per busy stretch and resets when idle', () => {
  const label = busyLabeler();
  assert.equal(label({ kind: 'idle', label: 'x' }), undefined);
  const a = label({ kind: 'thinking', label: '思考中…' }, [], 0)!, b = label({ kind: 'thinking', label: '思考中…' }, [], 500)!;
  assert.equal(a.replace(/….*/, ''), b.replace(/….*/, ''), 'same word within one rotation');
  assert.ok(initiativeWords.some(w => label({ kind: 'thinking', label: '', initiative: true }, [], 600)!.startsWith(w)), 'initiative uses its own pool');
  assert.equal(label(undefined), undefined);
});
test('stare fires once per continuous hover', () => {
  const s = new Stare(1000);
  assert.equal(s.move(true, 0), false); assert.equal(s.move(true, 1200), true); assert.equal(s.move(true, 5000), false);
  s.move(false, 5100); s.move(true, 5200); assert.equal(s.move(true, 6300), true);
});
test('orbit needs two full turns in one direction around the pet', () => {
  const o = new Orbit(2, 4000, 30, 220); let fired = false, t = 0;
  for (let i = 0; i <= 64 && !fired; i++) { const a = (i / 32) * 2 * Math.PI + 0.01; fired = o.move(100 + Math.cos(a) * 80, 100 + Math.sin(a) * 80, 100, 100, t += 40); }
  assert.ok(fired, 'two circles');
  const w = new Orbit(); let wiggle = false; t = 0;
  for (let i = 0; i < 200; i++) { const a = Math.sin(i / 5) * 2; wiggle = w.move(100 + Math.cos(a) * 80, 100 + Math.sin(a) * 80, 100, 100, t += 16) || wiggle; }
  assert.equal(wiggle, false, 'back-and-forth is not circling');
  const f = new Orbit(); let far = false; t = 0;
  for (let i = 0; i <= 64; i++) { const a = (i / 32) * 2 * Math.PI; far = f.move(100 + Math.cos(a) * 400, 100 + Math.sin(a) * 400, 100, 100, t += 40) || far; }
  assert.equal(far, false, 'too far away');
});
test('chat reactions match the user\'s words and ignore long pastes', () => {
  assert.equal(chatReaction('祝你生日快乐！')?.effect, 'confetti');
  assert.equal(chatReaction('谢谢你呀')?.effect, 'hearts');
  assert.equal(chatReaction('晚安')?.action, 'sleep');
  assert.equal(chatReaction('帮我查一下天气'), undefined);
  assert.equal(chatReaction('谢谢'.repeat(150)), undefined);
});
test('bored captions only after a long stretch without interaction', () => {
  const snap = { persona: { active: { idleLines: [] } } } as never;
  const realRandom = Math.random; Math.random = () => 0.1;
  try { assert.ok(boredWords.includes(idleCaption(snap, 30 * 60_000))); assert.ok(!boredWords.includes(idleCaption(snap, 0))); } finally { Math.random = realRandom; }
});
test('character cards keep their own thinking words, trimmed and deduplicated', () => {
  const p = normalizePersona({ name: '阿福', thinkingLines: ['挠头…', '挠头', '数手指...', '', '一个特别特别特别特别特别特别长的思考词条'] });
  assert.deepEqual(p.thinkingLines?.slice(0, 2), ['挠头', '数手指']);
  assert.ok(p.thinkingLines!.every(x => [...x].length <= PERSONA_LIMITS.thinkingLine));
  assert.equal(normalizePersona({ name: '无词' }).thinkingLines, undefined, 'optional');
  assert.throws(() => normalizePersona({ name: 'x', thinkingLines: 'no' }), /思考词条/);
  assert.ok(builtinPersonas.filter(p => p.id !== 'builtin:kimi').every(p => (p.thinkingLines?.length || 0) >= 4));
  assert.equal(builtinPersonas.find(p => p.id === 'builtin:kimi')?.thinkingLines, undefined, 'Kimi card stays as the user wrote it');
});
test('new gesture achievements are client-reported', () => {
  for (const id of ['tickle', 'stare', 'orbit', 'chat-react']) assert.ok(achievements.find(a => a.id === id)?.client, id);
});
