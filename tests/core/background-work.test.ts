import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../runtime/core/store';
import { BackgroundWorkQueue, type WorkJob } from '../../runtime/core/background-work';

test('an interrupted job is recovered once even when resume is called repeatedly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'galagent-queue-restart-'));
  const store = new Store(dir);
  const job: WorkJob = {
    id: 'work:extract:fixture',
    kind: 'extract',
    sourceIds: ['fixture', 'reply'],
    state: 'running',
    attempts: 1,
    nextAttemptAt: 0,
  };
  store.put('work-job', job.id, job);
  let count = 0;
  const queue = new BackgroundWorkQueue(store, {
    valid: () => true,
    configured: () => true,
    status() {},
    forget() {},
    async execute(current) {
      count++;
      queue.complete(current);
    },
  });
  try {
    queue.recover();
    queue.resume();
    queue.resume();
    await queue.idle();
    queue.resume();
    await queue.idle();
    assert.equal(count, 1);
    assert.equal(store.get<WorkJob>(job.id)?.state, 'done');
    assert.equal(store.get<WorkJob>(job.id)?.attempts, 2);
  } finally {
    queue.stop();
    await queue.idle();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
