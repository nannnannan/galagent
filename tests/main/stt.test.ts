import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRoot, checkBaseUrl, endpointUrl, modelsUrl, parseModelList, rankModels, sameOrigin } from '../../runtime/shared/endpoints';
import { cleanTranscript, listModels, transcribe } from '../../runtime/main/stt';
import { validateCommand } from '../../runtime/main/validation';

const wav = (n = 1600) => { const b = new Uint8Array(44 + n * 2); b.set([...'RIFF'].map(c => c.charCodeAt(0)), 0); b.set([...'WAVE'].map(c => c.charCodeAt(0)), 8); return b; };

test('one rule for all three endpoints: base → …/v1 → kind-specific path', () => {
  assert.equal(apiRoot('https://api.openai.com'), 'https://api.openai.com/v1');
  assert.equal(apiRoot('https://api.siliconflow.cn/v1/'), 'https://api.siliconflow.cn/v1');
  assert.equal(apiRoot('https://api.groq.com/openai/v1'), 'https://api.groq.com/openai/v1');
  assert.equal(apiRoot('https://dashscope.aliyuncs.com/compatible-mode/v1'), 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(apiRoot('https://x.ai/v1/audio/transcriptions'), 'https://x.ai/v1');
  assert.equal(endpointUrl('chat', 'https://x.ai/v1'), 'https://x.ai/v1/chat/completions');
  assert.equal(endpointUrl('tts', 'https://x.ai/v1', 'openai-speech'), 'https://x.ai/v1/audio/speech');
  assert.equal(endpointUrl('tts', 'https://x.ai/v1', 'mimo-chat-audio'), 'https://x.ai/v1/chat/completions');
  assert.equal(endpointUrl('stt', 'https://x.ai/v1'), 'https://x.ai/v1/audio/transcriptions');
  assert.equal(endpointUrl('stt', 'https://x.ai/v1', 'chat-input-audio'), 'https://x.ai/v1/chat/completions');
  assert.equal(modelsUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1/models');
  assert.throws(() => checkBaseUrl('http://example.com/v1'), /HTTPS/);
  assert.throws(() => checkBaseUrl('https://user:pw@example.com/v1'), /账号密码/);
  assert.ok(sameOrigin('https://a.com/v1', 'https://a.com/x')); assert.ok(!sameOrigin('https://a.com', 'https://b.com'));
});

test('model lists from OpenAI-style and other shapes, ranked for the kind', () => {
  assert.deepEqual(parseModelList({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] }), ['a', 'b']);
  assert.deepEqual(parseModelList({ models: [{ name: 'qwen2.5' }] }), ['qwen2.5']);
  assert.deepEqual(parseModelList(['x']), ['x']);
  assert.deepEqual(parseModelList({ nope: 1 }), []);
  assert.deepEqual(rankModels('stt', ['gpt-4o', 'whisper-1', 'tts-1']).slice(0, 1), ['whisper-1']);
  assert.deepEqual(rankModels('tts', ['gpt-4o', 'whisper-1', 'tts-1']).slice(0, 1), ['tts-1']);
});

test('listModels sends the key only as a Bearer header and explains failures', async () => {
  let seen: { url: string; auth?: string } | undefined;
  const ok = await listModels('https://api.x.com/v1', 'sk-1', (async (url: string, init?: RequestInit) => { seen = { url, auth: (init?.headers as Record<string, string>)?.Authorization }; return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { headers: { 'content-type': 'application/json' } }); }) as typeof fetch);
  assert.deepEqual(ok, { ok: true, models: ['m1'] });
  assert.deepEqual(seen, { url: 'https://api.x.com/v1/models', auth: 'Bearer sk-1' });
  const denied = await listModels('https://api.x.com/v1', undefined, (async () => new Response('', { status: 401 })) as typeof fetch);
  assert.equal(denied.ok, false); assert.match((denied as { error: string }).error, /密钥/);
  const bad = await listModels('http://evil.com', undefined);
  assert.equal(bad.ok, false);
});

test('transcribe: multipart for /audio/transcriptions, input_audio for chat models, both cleaned', async () => {
  const calls: { url: string; body: unknown; auth?: string }[] = [];
  const fake = (reply: unknown) => (async (url: string, init?: RequestInit) => { calls.push({ url, body: init?.body, auth: (init?.headers as Record<string, string>)?.Authorization }); return new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  const a = await transcribe({ audio: wav(), baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'k', model: 'FunAudioLLM/SenseVoiceSmall', language: 'zh', fetchImpl: fake({ text: '  明天提醒我买牛奶 ' }) });
  assert.deepEqual(a, { ok: true, text: '明天提醒我买牛奶' });
  assert.equal(calls[0].url, 'https://api.siliconflow.cn/v1/audio/transcriptions');
  assert.ok(calls[0].body instanceof FormData);
  assert.equal((calls[0].body as FormData).get('model'), 'FunAudioLLM/SenseVoiceSmall');
  assert.equal((calls[0].body as FormData).get('language'), 'zh');
  assert.equal(calls[0].auth, 'Bearer k');
  const b = await transcribe({ audio: wav(), baseUrl: 'https://api.x.com/v1', model: 'gpt-4o-audio-preview', format: 'chat-input-audio', fetchImpl: fake({ choices: [{ message: { content: '转写：“今天好累”' } }] }) });
  assert.deepEqual(b, { ok: true, text: '今天好累' });
  const body = JSON.parse(String(calls[1].body));
  assert.equal(body.messages[0].content[0].type, 'input_audio');
  assert.equal(body.messages[0].content[0].input_audio.format, 'wav');
  assert.equal(calls[1].auth, undefined, 'no key, no header');
  assert.equal((await transcribe({ audio: new Uint8Array(10), baseUrl: 'https://x.com/v1', model: 'm' })).ok, false);
  assert.equal((await transcribe({ audio: wav(), baseUrl: 'http://x.com/v1', model: 'm' })).ok, false, 'plain http to a remote host is refused');
  const err = await transcribe({ audio: wav(), baseUrl: 'https://x.com/v1', model: 'm', fetchImpl: (async () => new Response('quota', { status: 429 })) as typeof fetch });
  assert.equal(err.ok, false); assert.match((err as { error: string }).error, /429/);
  assert.equal(cleanTranscript([{ type: 'text', text: '你好' }]), '你好');
});

test('validation: audio must be a bounded byte array; speech-input settings never ride on settings.update', () => {
  assert.doesNotThrow(() => validateCommand({ type: 'voice.transcribe', audio: wav() }));
  assert.throws(() => validateCommand({ type: 'voice.transcribe', audio: 'base64' }));
  assert.throws(() => validateCommand({ type: 'voice.transcribe', audio: new Uint8Array(5 * 1024 * 1024) }));
  assert.throws(() => validateCommand({ type: 'settings.update', settings: { voiceInputEnabled: true } }));
  assert.throws(() => validateCommand({ type: 'settings.update', settings: { sttBaseUrl: 'https://evil.example/v1' } }));
  assert.throws(() => validateCommand({ type: 'stt.configure', sttBaseUrl: 'http://evil.example/v1' }));
  assert.throws(() => validateCommand({ type: 'stt.configure', sttKeySet: true }), 'only the desktop shell may mark a key as saved');
  assert.doesNotThrow(() => validateCommand({ type: 'stt.configure', sttBaseUrl: 'https://api.openai.com/v1', sttModel: 'whisper-1', sttFormat: 'openai-transcriptions', sttLanguage: 'zh' }));
  assert.throws(() => validateCommand({ type: 'endpoint.models', kind: 'chat', baseUrl: 'http://evil.example' }));
});
