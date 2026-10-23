import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechPlayback } from '../../runtime/renderer/speech-playback';
import { synthesizeTtsSpeech } from '../../runtime/main/tts';

function fixture() {
  const pending = new Map<string, (value: any) => void>();
  const played: string[] = [];
  let stops = 0, cancellations = 0;
  const speech = new SpeechPlayback({
    synthesize: text => new Promise(resolve => pending.set(text, resolve)),
    play: async result => { played.push(result.audioBase64!); },
    stop: () => { stops++; }, cancel: () => { cancellations++; },
  });
  return { speech, pending, played, counts: () => ({ stops, cancellations }) };
}
test('stopping speech discards late synthesis without reviving playback', async () => {
  const f = fixture(); const work = f.speech.speak('old');
  f.speech.stop();
  f.pending.get('old')!({ ok: true, audioBase64: 'old' }); await work;
  assert.deepEqual(f.played, []); assert.equal(f.counts().cancellations, 2);
});
test('new speech supersedes old speech even if synthesis finishes out of order', async () => {
  const f = fixture(); const old = f.speech.speak('old'), newer = f.speech.speak('new');
  f.pending.get('new')!({ ok: true, audioBase64: 'new' }); await newer;
  f.pending.get('old')!({ ok: true, audioBase64: 'old' }); await old;
  assert.deepEqual(f.played, ['new']);
});
test('playback has a cancellation fence during asynchronous audio decoding', async () => {
  let decode!: () => void, playing = false;
  const speech = new SpeechPlayback({ synthesize: async () => ({ ok: true, audioBase64: 'wav' }),
    play: async (_r, _text, current) => { await new Promise<void>(r => { decode = r; }); if (current()) playing = true; },
    stop() { playing = false; }, cancel() {},
  });
  const work = speech.speak('hello'); await Promise.resolve();
  speech.stop(false); decode(); await work;
  assert.equal(playing, false);
});
test('HTTP speech synthesis accepts caller cancellation and never falls back after abort', async () => {
  const controller = new AbortController(); let remoteSignal: AbortSignal | undefined;
  const work = synthesizeTtsSpeech({ text: 'hello', ttsBaseUrl: 'https://example.com/v1', ttsModel: 'tts-1', signal: controller.signal,
    fetchImpl: async (_url, init) => {
      remoteSignal = init?.signal as AbortSignal;
      return new Promise((_resolve, reject) => remoteSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    },
  });
  controller.abort(); const result = await work;
  assert.equal(remoteSignal?.aborted, true); assert.equal(result.ok, false); assert.equal(result.provider, undefined);
  assert.equal((await synthesizeTtsSpeech({ text: 'hello', signal: controller.signal })).ok, false);
});
