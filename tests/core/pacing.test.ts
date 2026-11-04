import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyPacing, intervalFactor, noteInitiative, noteUserReply, noteWelcome, pacingView, readPacing, REPLY_WINDOW_MS, settlePacing, topicPaused } from '../../runtime/core/pacing';
import { validTopic } from '../../runtime/shared/companionship';

const H = 3600_000;
const ignoreOnce = (l: ReturnType<typeof emptyPacing>, topic: Parameters<typeof topicPaused>[1], at: number) => settlePacing(noteInitiative(l, [topic], at), at + REPLY_WINDOW_MS + 1);

test('one ignored line does nothing; two in a row rest the topic for 2 h, then 4 h', () => {
  let l = ignoreOnce(emptyPacing(), 'window', 0);
  assert.equal(topicPaused(l, 'window', REPLY_WINDOW_MS + 2), false);
  l = ignoreOnce(l, 'window', H);
  const end = H + REPLY_WINDOW_MS;
  assert.equal(topicPaused(l, 'window', end + 1), true);
  assert.equal(topicPaused(l, 'window', end + 2 * H + 1), false);
  l = ignoreOnce(l, 'window', 10 * H);
  assert.equal(topicPaused(l, 'window', 10 * H + REPLY_WINDOW_MS + 3.9 * H), true);
  assert.equal(l.topics.window?.ignored, 3);
});

test('backoff is capped at three days', () => {
  let l = emptyPacing();
  for (let i = 0; i < 12; i++) l = ignoreOnce(l, 'share', i * 100 * H);
  const last = 11 * 100 * H + REPLY_WINDOW_MS;
  assert.equal(topicPaused(l, 'share', last + 72 * H - 1), true);
  assert.equal(topicPaused(l, 'share', last + 72 * H + 1), false);
});

test('a reply inside the window clears the topic; a reply after it does not count', () => {
  let l = ignoreOnce(ignoreOnce(emptyPacing(), 'recall', 0), 'recall', H);
  assert.equal(topicPaused(l, 'recall', H + REPLY_WINDOW_MS + 1), true);
  l = noteInitiative(l, ['recall'], 5 * H);
  l = noteUserReply(l, 5 * H + 10 * 60_000);
  assert.equal(l.topics.recall, undefined);
  assert.equal(l.recent.at(-1)?.answered, true);
  let late = noteInitiative(emptyPacing(), ['reunion'], 0);
  late = noteUserReply(late, REPLY_WINDOW_MS + 5);
  assert.equal(late.recent[0].answered, null);
});

test('「这种挺好」 restores a resting topic at once', () => {
  let l = ignoreOnce(ignoreOnce(emptyPacing(), 'greeting', 0), 'greeting', H);
  l = noteWelcome(l, ['greeting']);
  assert.equal(topicPaused(l, 'greeting', H + REPLY_WINDOW_MS + 1), false);
});

test('things the user asked for never back off: task results, watches, reminders, connection', () => {
  let l = emptyPacing();
  for (const topic of ['task', 'watch', 'schedule', 'system'] as const) for (let i = 0; i < 5; i++) l = ignoreOnce(l, topic, i * H);
  for (const topic of ['task', 'watch', 'schedule', 'system'] as const) assert.equal(topicPaused(l, topic, 5 * H), false, topic);
  assert.equal(intervalFactor(l).factor, 1);
});

test('the interval only ever stretches: ×1 below half ignored, ×2 from half, ×3 from three quarters, needs 4 samples', () => {
  const run = (answers: boolean[]) => {
    let l = emptyPacing();
    answers.forEach((answered, i) => { const at = i * H; l = noteInitiative(l, ['window'], at); l = answered ? noteUserReply(l, at + 60_000) : settlePacing(l, at + REPLY_WINDOW_MS + 1); });
    return intervalFactor(l);
  };
  assert.equal(run([false, false, false]).factor, 1);
  assert.equal(run([true, true, false, false]).factor, 2);
  assert.equal(run([true, false, false, false]).factor, 3);
  assert.equal(run([true, true, true, false]).factor, 1);
  for (let n = 0; n < 16; n++) assert.ok(run(Array.from({ length: 8 }, (_, i) => ((n >> (i % 4)) & 1) === 1)).factor >= 1);
});

test('the ledger keeps only times and topic kinds, and a corrupt save falls back to empty', () => {
  const l = noteInitiative(emptyPacing(), ['screen', 'window'], 123);
  assert.deepEqual(Object.keys(l.recent[0]).sort(), ['answered', 'at', 'topics']);
  assert.deepEqual(readPacing({ version: 2 }, validTopic), emptyPacing());
  assert.deepEqual(readPacing({ version: 1, recent: [{ at: 1, topics: ['window', 'bogus'], answered: 'x' }], topics: { nope: { ignored: 1, backoffUntil: 2 } } }, validTopic), { version: 1, recent: [{ at: 1, topics: ['window'], answered: null }], topics: {} });
});

test('the view hides resting topics when the feature is off', () => {
  const l = ignoreOnce(ignoreOnce(emptyPacing(), 'window', 0), 'window', H);
  assert.equal(pacingView(l, true, H + REPLY_WINDOW_MS + 1).paused.length, 1);
  assert.deepEqual(pacingView(l, false, H + REPLY_WINDOW_MS + 1).paused, []);
});
