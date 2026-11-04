import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupMemories, profileGroup, recentFocus, rhythmOf } from '../../runtime/shared/profile';
import type { DailyArchiveView, MemoryItem } from '../../runtime/shared/contracts';

const mem = (text: string, kind: MemoryItem['kind'] = 'fact', extra: Partial<MemoryItem> = {}): MemoryItem => ({ id: text, kind, text, sourceId: 's', createdAt: '2026-11-01T00:00:00Z', valid: true, ...extra });

test('memories sort into readable groups; feelings stay out; invalid ones are dropped', () => {
  assert.equal(profileGroup(mem('用户喜欢不加糖的乌龙茶')), 'likes');
  assert.equal(profileGroup(mem('用户工作日经常熬夜到一点多')), 'rhythm');
  assert.equal(profileGroup(mem('用户下周有一场面试')), 'busy');
  assert.equal(profileGroup(mem('用户养了一只橘猫')), 'people');
  assert.equal(profileGroup(mem('一起看了流星雨', 'episode')), 'us');
  assert.equal(profileGroup(mem('我有点担心他', 'reflection')), undefined);
  assert.equal(profileGroup(mem('用户住在杭州')), 'other');
  const g = groupMemories([mem('用户喜欢听播客', 'fact', { importance: 2 }), mem('用户喜欢下雨天', 'fact', { importance: 5 }), mem('用户喜欢旧的', 'fact', { valid: false })]);
  assert.deepEqual(g.likes.map(m => m.text), ['用户喜欢下雨天', '用户喜欢听播客']);
});

test('recent focus counts topics over the last week and keeps the newest open threads', () => {
  const day = (offset: number) => new Date(Date.parse('2026-11-04T12:00:00') + offset * 86400_000).toLocaleDateString('en-CA');
  const a = (d: number, topics: string[], openThreads: string[] = []): DailyArchiveView => ({ day: day(d), title: '', summary: '', diary: '', mood: '', topics, highlights: [], openThreads, messageCount: 1, createdAt: '' });
  const f = recentFocus([a(-1, ['面试', '乌龙茶'], ['面试结果']), a(-2, ['面试']), a(-20, ['很久以前'], ['旧事'])], 7, Date.parse('2026-11-04T12:00:00'));
  assert.deepEqual(f.topics[0], { text: '面试', days: 2 });
  assert.ok(!f.topics.some(t => t.text === '很久以前'));
  assert.deepEqual(f.threads, [{ text: '面试结果', day: day(-1) }]);
});

test('rhythm counts hours of the user\'s own messages, finds the busiest stretch and late nights', () => {
  const now = Date.parse('2026-11-04T12:00:00');
  const at = (daysAgo: number, hour: number) => { const d = new Date(now - daysAgo * 86400_000); d.setHours(hour, 10, 0, 0); return d.getTime(); };
  const times = [...Array.from({ length: 12 }, (_, i) => at(i + 1, 21)), at(2, 22), at(3, 1), at(4, 2), at(40, 21)];
  const r = rhythmOf(times, now);
  assert.equal(r.messages, 15, 'older than 30 days is ignored');
  assert.equal(r.hours[21], 12);
  assert.ok(r.peak && r.peak[0] <= 21 && (r.peak[0] + 4) > 21);
  assert.equal(r.lateNights, 2);
  assert.equal(rhythmOf(times.slice(0, 3), now).peak, undefined, 'no peak claimed from a handful of messages');
});
