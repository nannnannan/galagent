import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Embeddings } from '../../runtime/core/embedding';
const sleep = (ms: number) => new Promise(r => setTimeout(r,ms));
test('idle worker unloads, cold restarts, never unloads in-flight request', async () => {
    const states: string[] = [];
    const embed = new Embeddings('.', undefined, resolve('tests/core/mock-embedding-worker.mjs'), {idleMs:30,onState:s => states.push(s)});
    assert.deepEqual(await embed.encode('first'),[1,0]); const first = embed.worker;
    const slow = embed.encode('slow'); await sleep(50); assert.equal(embed.worker,first); await slow;
    await sleep(65); assert.equal(embed.worker,undefined); assert.equal(embed.state,'idle');
    assert.deepEqual(await embed.encode('cold'),[1,0]); assert.notEqual(embed.worker,first); assert.equal(states.filter(s=>s==='loading').length,2);
    await embed.close(); await assert.rejects(embed.encode('closed'));
});
test('worker exits reject all pending and allow restart', async () => {
    const embed = new Embeddings('.', undefined, resolve('tests/core/mock-embedding-worker.mjs'), {idleMs:100});
    const slow = embed.encode('slow'); const crash = embed.encode('crash');
    const results = await Promise.allSettled([slow,crash]); assert.ok(results.every(r=>r.status==='rejected')); assert.equal(embed.worker,undefined);
    assert.deepEqual(await embed.encode('restart'),[1,0]); await embed.close();
});
