// 三个模型接口（对话 / 语音输出 / 语音输入）统一成同一种写法：
//   地址 = OpenAI 兼容的基础地址（通常以 /v1 结尾），密钥 = Bearer 令牌，模型 = 名称，格式 = 该接口的请求形状。
// 具体路径由“种类 + 格式”推出来，所以三处界面、校验、拉取模型列表都共用这一份规则。
export type EndpointKind = 'chat' | 'tts' | 'stt';
export type TtsFormat = 'openai-speech' | 'mimo-chat-audio';
export type SttFormat = 'openai-transcriptions' | 'chat-input-audio';

export const ENDPOINT_LABEL: Record<EndpointKind, string> = { chat: '对话模型', tts: '语音输出', stt: '语音输入' };
export const TTS_FORMATS: [TtsFormat, string][] = [['openai-speech', 'OpenAI /audio/speech（通用）'], ['mimo-chat-audio', '小米 MiMo（/chat/completions 输出音频）']];
export const STT_FORMATS: [SttFormat, string][] = [['openai-transcriptions', 'OpenAI /audio/transcriptions（Whisper 类，通用）'], ['chat-input-audio', '多模态对话 /chat/completions（input_audio，如 gpt-4o-audio、MiMo-Audio）']];

/** Only HTTPS, or plain HTTP to this machine; never credentials inside the URL. Returns the cleaned base. */
export function checkBaseUrl(raw: string, what = '接口'): string {
  let url: URL;
  try { url = new URL(String(raw || '').trim()); } catch { throw new Error(`${what}地址无效`); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error(`远程${what}需要 HTTPS，本机接口只允许 127.0.0.1 / localhost`);
  if (url.username || url.password) throw new Error(`${what}地址不能内嵌账号密码，请把密钥填在密钥栏`);
  return url.toString().replace(/\/+$/, '');
}

const strip = (base: string, tails: string[]) => { let b = base.replace(/\/+$/, ''); for (const t of tails) if (b.endsWith(t)) { b = b.slice(0, -t.length); break; } return b; };
/** The …/v1 root of whatever the user pasted (a full endpoint URL works too). */
export function apiRoot(base: string): string {
  const b = strip(checkBaseUrl(base), ['/chat/completions', '/audio/speech', '/audio/transcriptions', '/models', '/tts']);
  return /\/v\d+[a-z]*$/i.test(b) || /\/compatible-mode\/v1$/.test(b) || /\/openai(\/v1)?$/.test(b) ? b : `${b}/v1`;
}
export function endpointUrl(kind: EndpointKind, base: string, format?: TtsFormat | SttFormat): string {
  const root = apiRoot(base);
  if (kind === 'chat') return `${root}/chat/completions`;
  if (kind === 'tts') return format === 'mimo-chat-audio' ? `${root}/chat/completions` : `${root}/audio/speech`;
  return format === 'chat-input-audio' ? `${root}/chat/completions` : `${root}/audio/transcriptions`;
}
export const modelsUrl = (base: string) => `${apiRoot(base)}/models`;

/** Model ids from a /models reply (OpenAI `{data:[{id}]}`, some gateways `{models:[…]}` or a bare array), sorted, unique. */
export function parseModelList(body: unknown): string[] {
  const raw = Array.isArray(body) ? body : body && typeof body === 'object' ? ((body as Record<string, unknown>).data ?? (body as Record<string, unknown>).models) : undefined;
  if (!Array.isArray(raw)) return [];
  const ids = raw.map(m => typeof m === 'string' ? m : m && typeof m === 'object' ? (m as Record<string, unknown>).id ?? (m as Record<string, unknown>).name : undefined)
    .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 500);
}

export type ModelInfo = { id: string; contextWindow?: number; maxOutput?: number };
const num = (...vals: unknown[]) => { for (const v of vals) { const n = typeof v === 'string' ? Number(v) : v; if (typeof n === 'number' && Number.isFinite(n) && n >= 1024 && n <= 100_000_000) return Math.round(n); } return undefined; };
/** Context and output limits, from whichever field this gateway uses (OpenRouter, vLLM, Groq, Gemini, Moonshot, LiteLLM…). */
export function parseModelInfo(body: unknown): ModelInfo[] {
  const raw = Array.isArray(body) ? body : body && typeof body === 'object' ? ((body as Record<string, unknown>).data ?? (body as Record<string, unknown>).models) : undefined;
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, ModelInfo>();
  for (const m of raw) {
    if (typeof m === 'string') { out.set(m, { id: m }); continue; }
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>, top = (r.top_provider || {}) as Record<string, unknown>, meta = (r.metadata || r.model_info || r.info || {}) as Record<string, unknown>;
    const id = String(r.id ?? r.name ?? '').replace(/^models\//, ''); if (!id || id.length > 200) continue;
    const contextWindow = num(r.context_length, r.context_window, r.max_context_length, r.max_model_len, r.max_input_tokens, r.inputTokenLimit, r.input_token_limit, top.context_length, meta.context_length, meta.max_input_tokens, meta.context_window);
    const maxOutput = num(top.max_completion_tokens, r.max_completion_tokens, r.max_output_tokens, r.outputTokenLimit, r.output_token_limit, meta.max_output_tokens, meta.max_tokens, r.max_tokens);
    out.set(id, { id, ...(contextWindow ? { contextWindow } : {}), ...(maxOutput && (!contextWindow || maxOutput <= contextWindow) ? { maxOutput } : {}) });
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500);
}
/** Default when the API does not say: mainstream models are around a million tokens now. */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/** Puts the models most likely meant for this kind first (speech models for TTS, whisper/asr for STT). */
export function rankModels(kind: EndpointKind, ids: string[]): string[] {
  const hint = kind === 'tts' ? /tts|speech|voice|cosyvoice|sambert|audio/i : kind === 'stt' ? /whisper|transcri|asr|sensevoice|paraformer|audio|omni|speech/i : /chat|instruct|gpt|qwen|deepseek|kimi|glm|claude|llama|mistral|moonshot|k2|k3/i;
  return [...ids.filter(i => hint.test(i)), ...ids.filter(i => !hint.test(i))];
}

/** Same-origin check: a stored key is only ever sent to the host it was saved for. */
export const sameOrigin = (a?: string, b?: string) => { try { return !!a && !!b && new URL(a).origin === new URL(b).origin; } catch { return false; } };

export const STT_PRESETS: { label: string; url: string; model: string; format: SttFormat }[] = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', format: 'openai-transcriptions' },
  { label: '硅基流动 SenseVoice', url: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall', format: 'openai-transcriptions' },
  { label: 'Groq Whisper', url: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', format: 'openai-transcriptions' },
  { label: '本机 Whisper 服务', url: 'http://127.0.0.1:8000/v1', model: 'Systran/faster-whisper-small', format: 'openai-transcriptions' },
];
