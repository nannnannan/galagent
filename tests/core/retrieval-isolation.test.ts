import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';
import { grams } from '../../runtime/core/store';
import type { MemoryItem } from '../../runtime/shared/contracts';

test('semantic candidates respect the requested validity view before the shortlist limit', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'galagent-retrieval-isolation-'));
    let providerCalls = 0;
    const core = new CompanionService({
        dataDir: dir,
        credentials: { get: async () => undefined, set: async () => {} },
        embeddings: { encode: async () => [1, 0], close: async () => {} },
        fetch: async () => { providerCalls++; throw new Error('This fixture must never call a provider'); },
    });
    const query = '喝哪一种饮品';
    let previous: MemoryItem | undefined;
    try {
        await core.init();
        assert.equal((await core.handle({ type: 'memory.remember', text: '我喜欢编号00的薄荷苏打' })).ok, true);
        await core.waitForBackground();
        for (let i = 1; i <= 30; i++) {
            previous = core.getSnapshot().memories[0];
            // Distinct validity boundaries also make the historical assertion deterministic.
            await new Promise(resolve => setTimeout(resolve, 2));
            assert.equal((await core.handle({ type: 'memory.correct', id: previous.id, text: `我喜欢编号${String(i).padStart(2, '0')}的薄荷苏打` })).ok, true);
            await core.waitForBackground();
        }
        const current = core.getSnapshot().memories[0];
        const queryGrams = new Set(grams(query));
        assert.equal(grams(current.text).some(gram => queryGrams.has(gram)), false, 'Retrieval must depend on semantics, without a keyword rescue');

        await t.test('current facts are not crowded out by more than 24 corrected historical vectors', async () => {
            assert.deepEqual((await core.retrieve(query)).map(memory => memory.id), [current.id]);
        });
        await t.test('a recent historical validity interval has its own semantic shortlist', async () => {
            assert.ok(previous);
            const results = await core.retrieve(query, { asOf: previous.validFrom || previous.createdAt });
            assert.deepEqual(results.map(memory => memory.id), [previous.id]);
            assert.equal(results[0].valid, false);
            assert.ok(results[0].validTo);
        });
        await t.test('explicit historical retrieval can still return superseded facts', async () => {
            const results = await core.retrieve(query, { includeHistorical: true });
            assert.ok(results.some(memory => !memory.valid && !!memory.validTo));
        });
        assert.equal(providerCalls, 0);
    } finally {
        await core.close();
        await rm(dir, { recursive: true, force: true });
    }
});

test('keyword fallback shortlists only records allowed by the current or historical validity view', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'galagent-keyword-isolation-'));
    let queryFailures = 0;
    const core = new CompanionService({
        dataDir: dir,
        credentials: { get: async () => undefined, set: async () => {} },
        embeddings: {
            encode: async (_text, query) => {
                if (query) { queryFailures++; throw new Error('Fixture semantic query unavailable'); }
                return [1, 0];
            },
            close: async () => {},
        },
        fetch: async () => { throw new Error('This fixture must never call a provider'); },
    });
    let previous: MemoryItem | undefined;
    try {
        await core.init();
        assert.equal((await core.handle({ type: 'memory.remember', text: '我喜欢编号00的薄荷苏打' })).ok, true);
        await core.waitForBackground();
        for (let i = 1; i <= 30; i++) {
            previous = core.getSnapshot().memories[0];
            await new Promise(resolve => setTimeout(resolve, 2));
            assert.equal((await core.handle({ type: 'memory.correct', id: previous.id, text: `我喜欢编号${String(i).padStart(2, '0')}的薄荷苏打` })).ok, true);
            await core.waitForBackground();
        }
        const current = core.getSnapshot().memories[0];
        await t.test('current keyword matches are not displaced by invalid historical matches', async () => {
            assert.deepEqual((await core.retrieve('薄荷苏打')).map(memory => memory.id), [current.id]);
        });
        await t.test('as-of keyword matches use the historical interval before applying the limit', async () => {
            assert.ok(previous);
            assert.deepEqual((await core.retrieve('薄荷苏打', { asOf: previous.validFrom || previous.createdAt })).map(memory => memory.id), [previous.id]);
        });
        assert.equal(queryFailures, 2, 'Both assertions must exercise the keyword fallback rather than semantic success');
    } finally {
        await core.close();
        await rm(dir, { recursive: true, force: true });
    }
});
