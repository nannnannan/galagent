import { spawn } from 'node:child_process';
import type { Expression } from '../shared/contracts';

export interface TtsSynthesizeOptions {
  text: string;
  ttsBaseUrl?: string;
  ttsApiKey?: string;
  ttsModel?: string;
  ttsVoice?: string;
  ttsSpeed?: number;
  expression?: Expression;
  fetchImpl?: typeof fetch;
  windowsSapiFallback?: boolean;
  signal?: AbortSignal;
}

export interface TtsSynthesizeResult {
  ok: boolean;
  provider?: 'http' | 'windows-sapi' | 'web-speech';
  audioBase64?: string;
  mimeType?: string;
  fallbackText?: string;
  voice?: string;
  speed?: number;
  error?: string;
}

export const MIMO_PRESET_VOICES = [
  '冰糖',
  '茉莉',
  'mimo_default',
  '苏打',
  '白桦',
  'Mia',
  'Chloe',
  'Milo',
  'Dean',
] as const;

export function cleanTtsText(raw: string): string {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

export function isXiaomiMimoTts(baseUrl?: string, model?: string): boolean {
  const u = String(baseUrl || '').toLowerCase();
  const m = String(model || '').toLowerCase();
  return (
    m.startsWith('mimo-') ||
    u.includes('xiaomimimo.com') ||
    u.includes('mimo.mi.com') ||
    u.endsWith('/chat/completions')
  );
}

export function resolveMimoVoice(voice?: string): string {
  const trimmed = String(voice || '').trim();
  if ((MIMO_PRESET_VOICES as readonly string[]).includes(trimmed)) {
    return trimmed;
  }
  return '冰糖';
}

export function buildMimoStyleInstruction(expression?: Expression, speed = 1.0, customVoiceHint?: string): string {
  const emotionMap: Record<string, string> = {
    pleased: '当前情绪：开心欣喜，语气轻快上扬，带着藏不住的笑意与小小得意。',
    flustered: '当前情绪：害羞脸红、有点慌乱娇嗔，前半句略带嘴硬，尾音软下来带点小撒娇。',
    curious: '当前情绪：好奇灵动，语调微微扬起，充满探询的兴致与活力。',
    annoyed: '当前情绪：轻轻吃醋或佯装小不满，嘴上哼声带点小脾气，但底色依然亲昵好哄，不真生气。',
    softened: '当前情绪：温柔心软，语速柔和放缓，声音轻柔贴耳，带着体贴与关心。',
    neutral: '当前情绪：日常亲近陪伴，自然放松、温暖灵动，带一点随性的少女娇俏感。',
  };
  const speedHint =
    speed > 1.08 ? '整体语速略偏轻快。' : speed < 0.92 ? '整体语速略偏柔和缓慢。' : '语速自然适中。';
  const extra =
    customVoiceHint && !(MIMO_PRESET_VOICES as readonly string[]).includes(customVoiceHint.trim())
      ? `音色补充描述：${customVoiceHint.trim()}。`
      : '';
  return [
    '【角色】可黎，一位热爱弹钢琴、性格亲近有活力、对重要的人娇多傲极少的年轻少女。',
    '【演绎指导】清甜润泽的少女声线，吐字轻巧自然，带一点亲昵的呼吸感。',
    emotionMap[expression || 'neutral'] || emotionMap.neutral,
    speedHint,
    extra,
  ]
    .filter(Boolean)
    .join('');
}

export function resolveTtsEndpoint(baseUrl: string, model?: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const parsed = new URL(trimmed);
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
  ) {
    throw new Error('远程 TTS 接口需要 HTTPS，本地接口仅允许 127.0.0.1 / localhost');
  }
  if (parsed.username || parsed.password) {
    throw new Error('TTS 地址不能内嵌凭据');
  }
  if (isXiaomiMimoTts(trimmed, model)) {
    if (trimmed.endsWith('/chat/completions')) return trimmed;
    if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
    return `${trimmed}/v1/chat/completions`;
  }
  if (trimmed.endsWith('/audio/speech') || trimmed.endsWith('/tts')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/audio/speech`;
  }
  return `${trimmed}/v1/audio/speech`;
}

function synthesizeWithWindowsSapi(text: string, speed = 1.0, signal?: AbortSignal): Promise<string | null> {
  if (process.platform !== 'win32' || signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const rate = Math.max(-5, Math.min(5, Math.round((speed - 1.0) * 6)));
    const psScript = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$s.Rate = ${rate}`,
      '$voices = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like "zh*" }',
      'if ($voices) { $s.SelectVoice($voices[0].VoiceInfo.Name) }',
      '$ms = New-Object System.IO.MemoryStream',
      '$s.SetOutputToWaveStream($ms)',
      '$s.Speak($env:GALAGENT_TTS_TEXT)',
      '[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))',
    ].join('; ');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', psScript],
      {
        env: { ...process.env, GALAGENT_TTS_TEXT: text },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    let out = '';
    const abort = () => { child.kill(); resolve(null); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve(null);
    }, 8000);
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const trimmed = out.trim();
      resolve(code === 0 && trimmed.length > 100 ? trimmed : null);
    });
  });
}

export async function synthesizeTtsSpeech(options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
  if (options.signal?.aborted) return { ok: false, error: '语音已停止' };
  const text = cleanTtsText(options.text);
  if (!text) {
    return { ok: false, error: '没有可朗读的文字' };
  }
  const speed = Math.max(0.5, Math.min(2.0, Number(options.ttsSpeed) || 1.0));
  const model = (options.ttsModel || 'mimo-v2.5-tts').trim();
  const mimoMode = isXiaomiMimoTts(options.ttsBaseUrl, model);
  const voice = mimoMode
    ? resolveMimoVoice(options.ttsVoice)
    : (options.ttsVoice || '冰糖').trim();
  const fetchImpl = options.fetchImpl || fetch;

  if (options.ttsBaseUrl && options.ttsBaseUrl.trim()) {
    let endpoint: string;
    try {
      endpoint = resolveTtsEndpoint(options.ttsBaseUrl, model);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (options.ttsApiKey) {
        headers.Authorization = `Bearer ${options.ttsApiKey}`;
        headers['api-key'] = options.ttsApiKey;
      }

      if (mimoMode) {
        const isVoiceDesign = model.toLowerCase().includes('voicedesign');
        const stylePrompt = buildMimoStyleInstruction(options.expression, speed, options.ttsVoice);
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'user', content: stylePrompt },
              { role: 'assistant', content: text },
            ],
            audio: isVoiceDesign
              ? { format: 'wav', optimize_text_preview: false }
              : { format: 'wav', voice },
          }),
          signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          return { ok: false, error: `小米 MiMo TTS 返回状态 ${res.status}${errText ? ': ' + errText.slice(0, 120) : ''}` };
        }
        const data = (await res.json()) as {
          choices?: { message?: { audio?: { data?: string } } }[];
        };
        const audioBase64 = data?.choices?.[0]?.message?.audio?.data;
        if (signal.aborted) return { ok: false, error: '语音已停止' };
        if (typeof audioBase64 !== 'string' || audioBase64.length < 64) {
          return { ok: false, error: '小米 MiMo TTS 返回的音频数据为空' };
        }
        return {
          ok: true,
          provider: 'http',
          audioBase64,
          mimeType: 'audio/wav',
          voice,
          speed,
        };
      }

      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          input: text,
          text,
          text_lang: 'zh',
          voice,
          response_format: 'mp3',
          speed,
        }),
        signal,
      });
      if (!res.ok) {
        return { ok: false, error: `TTS 接口返回状态 ${res.status}` };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (signal.aborted) return { ok: false, error: '语音已停止' };
      if (buf.byteLength < 32) {
        return { ok: false, error: 'TTS 接口返回的音频为空' };
      }
      const contentType = res.headers.get('content-type') || 'audio/mpeg';
      const mimeType = contentType.includes('wav')
        ? 'audio/wav'
        : contentType.includes('ogg')
          ? 'audio/ogg'
          : 'audio/mpeg';
      return {
        ok: true,
        provider: 'http',
        audioBase64: buf.toString('base64'),
        mimeType,
        voice,
        speed,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  if (options.windowsSapiFallback !== false) {
    const wavBase64 = await synthesizeWithWindowsSapi(text, speed, options.signal);
    if (options.signal?.aborted) return { ok: false, error: '语音已停止' };
    if (wavBase64) {
      return {
        ok: true,
        provider: 'windows-sapi',
        audioBase64: wavBase64,
        mimeType: 'audio/wav',
        voice,
        speed,
      };
    }
  }

  if (options.signal?.aborted) return { ok: false, error: '语音已停止' };
  return {
    ok: true,
    provider: 'web-speech',
    fallbackText: text,
    voice,
    speed,
  };
}
