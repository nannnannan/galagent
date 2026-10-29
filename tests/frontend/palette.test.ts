import test from 'node:test';
import assert from 'node:assert/strict';
import { matchAction } from '../../runtime/renderer/palette';

test('palette matching is case-insensitive and needs every term', () => {
  const action = { title: '安静 30 分钟', hint: 'TA 暂时不会主动开口', keywords: 'quiet 免打扰', group: '常用' };
  assert.ok(matchAction(action, ''));
  assert.ok(matchAction(action, 'QUIET'));
  assert.ok(matchAction(action, '安静 开口'));
  assert.ok(!matchAction(action, '安静 提醒'));
});
