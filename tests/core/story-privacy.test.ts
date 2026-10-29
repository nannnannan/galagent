import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionService } from '../../runtime/core/companion';

test('deleting a reunion clue removes its evidence from episodes, future context and restored archives', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'galagent-story-privacy-'));
    const originalNow = Date.now;
    let now = Date.parse('2026-10-09T01:00:00Z');
    Date.now = () => now;
    const secret = '我最喜欢秘密薄荷汽水';
    const contexts: any[] = [];
    let legacyCore: CompanionService | undefined;
    let legacyDir: string | undefined;
    const core = new CompanionService({
        dataDir: dir,
        credentials: { get: async () => 'fixture-only-key', set: async () => {} },
        embeddings: { encode: async () => [1, 0], close: async () => {} },
        fetch: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            const system = String(body.messages[0].content);
            const extraction = system.includes('facts每项');
            if (!extraction) {
                const marker = '\n状态数据：';
                contexts.push(JSON.parse(system.slice(system.indexOf(marker) + marker.length)));
            }
            const output = extraction
                ? { facts: JSON.parse(body.messages[1].content).user === secret ? [secret] : [], diary: '' }
                : { text: 'fixture response without any private clue', expression: 'neutral', action: 'idle', name: '星棱' };
            return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
        },
    });
    try {
        await core.init();
        assert.equal((await core.handle({ type: 'chat.send', text: secret })).ok, true);
        await core.waitForBackground();
        const fact = core.getSnapshot().memories[0];
        now += 1000;
        assert.equal((await core.handle({ type: 'chat.send', text: '另一个已完成的话题' })).ok, true);
        await core.waitForBackground();
        now += 8 * 3600000;
        assert.equal((await core.handle({ type: 'chat.send', text: '我回来了' })).ok, true);
        await core.waitForBackground();
        const reunion = core.getSnapshot().story!.recentEpisodes.find(episode => episode.type === 'E04');
        assert.ok(reunion, 'The reunion must really be completed before testing deletion');
        assert.ok(JSON.stringify(reunion.evidence).includes(secret));
        const backup = core.exportArchive();

        assert.equal((await core.handle({ type: 'memory.delete', id: fact.id })).ok, true);
        assert.equal(JSON.stringify(core.getSnapshot().story).includes(secret), false, 'A clue cannot remain inside surviving episode evidence');
        assert.equal(core.exportArchive().includes(secret), false, 'An episode must not re-export a deleted clue');
        assert.equal((await core.handle({ type: 'chat.send', text: '接着说一件新的事情' })).ok, true);
        await core.waitForBackground();
        assert.equal(JSON.stringify(contexts.at(-1)).includes(secret), false, 'Recent episode context cannot reintroduce deleted evidence');

        await core.importArchive(backup);
        await core.waitForBackground();
        assert.equal(core.exportArchive().includes(secret), false, 'Restoring an old sourced episode must honor the deletion ledger');

        // Older releases omitted nested clue dependencies from E04.sourceIds.
        // Either rejection or safe normalization is acceptable; resurrection is not.
        const legacy = JSON.parse(backup);
        for (const episode of legacy.story.episodes) if (episode.type === 'E04') {
            episode.sourceIds = episode.sourceIds.filter((id: string) => id !== fact.id && id !== fact.sourceId);
        }
        try { await core.importArchive(JSON.stringify(legacy)); } catch (error) {
            assert.ok(error instanceof Error);
        }
        await core.waitForBackground();
        assert.equal(core.exportArchive().includes(secret), false, 'An incomplete legacy dependency list cannot revive deleted evidence');

        // Also test legacy import before deletion on a separate fresh device: an
        // existing episode tombstone must not accidentally make this assertion pass.
        legacyDir = await mkdtemp(join(tmpdir(), 'galagent-legacy-story-privacy-'));
        legacyCore = new CompanionService({
            dataDir: legacyDir,
            credentials: { get: async () => undefined, set: async () => {} },
            embeddings: { encode: async () => [1, 0], close: async () => {} },
            fetch: async () => { throw new Error('Legacy restoration must never call a provider'); },
        });
        await legacyCore.init();
        let restored = false;
        try { await legacyCore.importArchive(JSON.stringify(legacy)); restored = true; } catch (error) {
            assert.ok(error instanceof Error);
        }
        await legacyCore.waitForBackground();
        if (restored) assert.equal((await legacyCore.handle({ type: 'memory.delete', id: fact.id })).ok, true);
        assert.equal(legacyCore.exportArchive().includes(secret), false, 'A restored legacy E04 must reject or track its nested clue dependency');
    } finally {
        if (legacyCore) await legacyCore.close();
        await core.close();
        Date.now = originalNow;
        if (legacyDir) await rm(legacyDir, { recursive: true, force: true });
        await rm(dir, { recursive: true, force: true });
    }
});

test('other AI apps and mentions of other assistants never produce jealousy scenes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'galagent-no-jealousy-'));
    const contexts: any[] = [];
    const core = new CompanionService({
        dataDir: dir,
        credentials: { get: async () => 'fixture-only-key', set: async () => {} },
        embeddings: { encode: async () => [1, 0], close: async () => {} },
        fetch: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            const system = String(body.messages[0].content);
            if (system.includes('facts每项')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"facts":[],"diary":""}' } }] }));
            const marker = '\n状态数据：';
            contexts.push(JSON.parse(system.slice(system.indexOf(marker) + marker.length)));
            return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: 'ordinary reply', expression: 'neutral', action: 'idle' }) } }] }));
        },
    });
    try {
        await core.init();
        assert.equal((await core.handle({ type: 'chat.send', text: '我今天用 ChatGPT 和 Claude 写代码' })).ok, true);
        await core.waitForBackground();
        await core.handle({ type: 'settings.update', settings: { observationEnabled: true } });
        core.setObservation({ available: true, observedAt: new Date().toISOString(), idleSeconds: 600, appName: 'Codex' });
        await core.tick();
        assert.ok(contexts.length >= 1);
        for (const context of contexts) assert.equal(context.sceneCandidates.some((scene: any) => scene.type === 'E05'), false);
        assert.equal(core.getSnapshot().story!.recentEpisodes.some(episode => episode.type === 'E05'), false);
    } finally {
        await core.close();
        await rm(dir, { recursive: true, force: true });
    }
});
