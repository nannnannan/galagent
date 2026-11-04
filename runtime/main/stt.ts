// 语音输入：把用户按住说话录下的一段 WAV 交给用户自己配置的语音识别接口，拿回文字。
// 音频只在内存里经过这一次请求，不落盘、不写日志、不进记忆或观察数据；识别出的文字只填进输入框，由用户决定发不发。
import { endpointUrl, modelsUrl, parseModelInfo, type ModelInfo, type SttFormat } from '../shared/endpoints';

export const STT_MAX_BYTES = 4 * 1024 * 1024; // ~2 min of 16 kHz mono 16-bit WAV; the recorder stops at 60 s
export const STT_PROMPT = '请把这段语音逐字转写成文字。只输出转写出的文字本身，不要解释、不要加引号；听不清就输出空。';

export type SttOptions = { audio: Uint8Array; baseUrl: string; apiKey?: string; model: string; format?: SttFormat; language?: string; fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number };
export type SttResult = { ok: true; text: string } | { ok: false; error: string };

/** Strips what models like to wrap a transcript in (quotes, "转写：" labels) and bounds the length. */
export function cleanTranscript(raw: unknown): string {
  let text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map(p => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string') ? (p as { text: string }).text : '').join('') : '';
  text = text.replace(/^\s*(转写(结果)?|识别结果|transcript(ion)?)\s*[:：]\s*/i, '').trim();
  text = text.replace(/^["“”'「『]+|["“”'」』]+$/g, '').trim();
  return text.slice(0, 4000);
}

export function isWav(audio: Uint8Array) {
  return audio.length > 44 && String.fromCharCode(...audio.slice(0, 4)) === 'RIFF' && String.fromCharCode(...audio.slice(8, 12)) === 'WAVE';
}

export async function transcribe(o: SttOptions): Promise<SttResult> {
  if (!o.audio?.length) return { ok: false, error: '没有录到声音' };
  if (o.audio.length > STT_MAX_BYTES) return { ok: false, error: '这段录音太长了（最多约 60 秒）' };
  if (!isWav(o.audio)) return { ok: false, error: '录音格式不对' };
  if (!o.model.trim()) return { ok: false, error: '还没填语音输入的模型' };
  let url: string;
  try { url = endpointUrl('stt', o.baseUrl, o.format); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const fetchImpl = o.fetchImpl || fetch;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 30000);
  const signal = o.signal ? AbortSignal.any([controller.signal, o.signal]) : controller.signal;
  const auth: Record<string, string> = o.apiKey ? { Authorization: `Bearer ${o.apiKey}` } : {};
  try {
    let res: Response;
    if (o.format === 'chat-input-audio') {
      res = await fetchImpl(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({
        model: o.model.trim(), temperature: 0,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: Buffer.from(o.audio).toString('base64'), format: 'wav' } }, { type: 'text', text: STT_PROMPT + (o.language ? `（语言：${o.language}）` : '') }] }],
      }) });
    } else {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(o.audio)], { type: 'audio/wav' }), 'speech.wav');
      form.append('model', o.model.trim());
      if (o.language) form.append('language', o.language);
      form.append('response_format', 'json');
      res = await fetchImpl(url, { method: 'POST', signal, headers: auth, body: form });
    }
    if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, error: `语音识别接口返回 ${res.status}${t ? '：' + t.slice(0, 160) : ''}` }; }
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) return { ok: true, text: cleanTranscript(await res.text()) };
    const data = await res.json() as { text?: unknown; choices?: { message?: { content?: unknown } }[] };
    const text = cleanTranscript(o.format === 'chat-input-audio' ? data.choices?.[0]?.message?.content : data.text);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: signal.aborted && !o.signal?.aborted ? '语音识别超时了' : e instanceof Error ? e.message : String(e) };
  } finally { clearTimeout(timer); }
}

/** GET {root}/models with the key for that endpoint; a short list of ids or a readable error. */
export async function listModels(baseUrl: string, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; models: string[]; info: ModelInfo[] } | { ok: false; error: string }> {
  let url: string;
  try { url = modelsUrl(baseUrl); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetchImpl(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: controller.signal });
    if (!res.ok) return { ok: false, error: res.status === 401 || res.status === 403 ? '密钥不对或没有权限' : res.status === 404 ? '这个接口不提供模型列表，请手动填写模型名' : `接口返回 ${res.status}` };
    const info = parseModelInfo(await res.json().catch(() => undefined)), models = info.map(m => m.id);
    return models.length ? { ok: true, models, info: info.filter(m => m.contextWindow || m.maxOutput) } : { ok: false, error: '没有拿到模型列表，请手动填写模型名' };
  } catch (e) {
    return { ok: false, error: controller.signal.aborted ? '连接超时' : e instanceof Error ? e.message : String(e) };
  } finally { clearTimeout(timer); }
}
