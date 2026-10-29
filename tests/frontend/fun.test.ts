import test from 'node:test';
import assert from 'node:assert/strict';
import { AchievementWatcher, Fling, Mischief, Petting, addSeen, chimeCaption, dayKey, firstGreeting, isMidnight, releaseVelocity, seasonFor } from '../../runtime/renderer/fun';

test('petting needs several hand-sized strokes over the head', () => {
  const p = new Petting(4, 1800, 6000);
  let t = 0, result: string | undefined;
  const sweep = (from: number, to: number) => { for (let x = from; from < to ? x <= to : x >= to; x += from < to ? 4 : -4) result = p.move(x, true, t += 16) || result; };
  sweep(100, 130); sweep(130, 100); sweep(100, 130); assert.equal(result, undefined);
  sweep(130, 100); sweep(100, 130); assert.equal(result, 'pat');
  result = undefined; sweep(130, 100); assert.equal(result, 'stroke', 'continued petting during cooldown');
  const q = new Petting(); let r: string | undefined; t = 0;
  for (let i = 0; i < 20; i++) r = q.move(i % 2 ? 101 : 100, true, t += 16) || r; // twitches don't count
  assert.equal(r, undefined);
});
test('leaving the head for a while resets petting', () => {
  const p = new Petting(2); let t = 0;
  p.move(100, true, t += 16); p.move(120, true, t += 16); p.move(100, true, t += 16);
  p.move(100, false, t += 16); p.move(100, false, t += 500);
  assert.equal(p.move(120, true, t += 16), undefined);
});
test('release velocity and fling glide', () => {
  assert.deepEqual(releaseVelocity([{ x: 0, y: 0, t: 0 }, { x: 50, y: 10, t: 50 }], 60), { vx: 1, vy: 0.2 });
  assert.deepEqual(releaseVelocity([{ x: 0, y: 0, t: 0 }, { x: 50, y: 0, t: 50 }], 200), { vx: 0, vy: 0 }, 'paused before release');
  const fling = new Fling(2, 0, 4.2);
  let total = 0, steps = 0, done = false;
  while (!done && steps < 500) { const s = fling.step(16); total += s.dx; done = s.done; steps++; }
  assert.ok(done && steps * 16 <= 1120, 'stops within ~1.1 s');
  assert.ok(total > 350 && total < 480, `glides a plausible distance (${total})`);
  const capped = new Fling(40, 0); assert.equal(capped.startSpeed, 4);
  const b = new Fling(1, 0); b.bounce('x'); assert.ok(b.vx < 0 && b.vx > -1);
});
test('mischief taps escalate to dizzy', () => {
  const m = new Mischief(); let last;
  for (let i = 0; i < 5; i++) last = m.tap(i * 100);
  assert.equal(last?.dizzy, false);
  for (let i = 5; i < 9; i++) last = m.tap(i * 100);
  assert.equal(last?.dizzy, true);
});
test('clock captions', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 9)), '2026-01-05');
  assert.ok(isMidnight(new Date(2026, 0, 5, 0, 1)) && !isMidnight(new Date(2026, 0, 5, 0, 2)));
  assert.match(firstGreeting(new Date(2026, 9, 29, 8)), /^早上好！今天第一次见到你～$/);
  assert.match(firstGreeting(new Date(2026, 9, 29, 23, 30)), /这么晚/);
  assert.match(firstGreeting(new Date(2027, 9, 29, 20), { daysTogether: 400, firstMetAt: new Date(2026, 9, 29, 10).toISOString() }), /1 周年/);
  assert.match(firstGreeting(new Date(2026, 9, 29, 20), { daysTogether: 100 }), /第 100 天/);
  assert.equal(chimeCaption(new Date(2026, 9, 29, 15, 1)), undefined);
  assert.match(chimeCaption(new Date(2026, 9, 29, 3, 0))!, /三点|休息|照顾/);
  assert.equal(chimeCaption(new Date(2026, 9, 29, 12, 0)), '十二点，午饭时间！');
});
test('seasons', () => {
  assert.equal(seasonFor(new Date(2026, 0, 3)), 'snow');
  assert.equal(seasonFor(new Date(2026, 11, 3)), 'snow');
  assert.equal(seasonFor(new Date(2026, 2, 20)), 'petals');
  assert.equal(seasonFor(new Date(2026, 6, 1, 22)), 'fireflies');
  assert.equal(seasonFor(new Date(2026, 6, 1, 14)), 'none');
  assert.equal(seasonFor(new Date(2026, 9, 29)), 'leaves');
});
test('achievement watcher only celebrates unlocks after the baseline', () => {
  const w = new AchievementWatcher();
  const a = (id: string, unlockedAt?: string) => ({ id, icon: '', title: id, description: '', unlockedAt });
  assert.deepEqual(w.update(undefined), []);
  assert.deepEqual(w.update({ achievements: [a('first-chat', 'x'), a('pat')] }), []);
  assert.deepEqual(w.update({ achievements: [a('first-chat', 'x'), a('pat', 'y')] }).map(x => x.id), ['pat']);
  assert.deepEqual(w.update({ achievements: [a('first-chat', 'x'), a('pat', 'y')] }), []);
  assert.deepEqual(addSeen(['a'], 'a'), ['a']); assert.deepEqual(addSeen(['a'], 'b'), ['a', 'b']); assert.deepEqual(addSeen(['a'], ''), ['a']);
});
