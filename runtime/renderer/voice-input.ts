// 按住说话：按下才打开麦克风，松开立刻关掉（最长 60 秒）。录音在内存里转成 16 kHz 单声道 WAV，交给桌面进程
// 发往用户配置的语音识别接口；识别出的文字填进输入框，由用户自己决定发不发。音频不保存、不进记忆。
import { command, toast } from './ui';
import { svgIcon } from './icons';

export const MAX_SECONDS = 60;
const MIN_MS = 400;

/** 16-bit PCM WAV from mono float samples. */
export function encodeWav(samples: Float32Array, rate = 16000): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2), v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return out;
}

async function toWav(blob: Blob): Promise<Uint8Array> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    const src = offline.createBufferSource(); src.buffer = decoded; src.connect(offline.destination); src.start();
    return encodeWav((await offline.startRendering()).getChannelData(0));
  } finally { void ctx.close(); }
}

/** Turns `button` into a hold-to-talk mic for `target`. Returns a cleanup function. */
export function attachVoice(button: HTMLButtonElement, target: HTMLTextAreaElement | HTMLInputElement, opts: { onState?: (state: 'idle' | 'recording' | 'working') => void } = {}) {
  button.type = 'button'; button.classList.add('mic'); button.setAttribute('aria-label', '按住说话'); button.title = '按住说话，松开识别（最长 60 秒）';
  if (!button.querySelector('svg')) button.append(svgIcon('mic', 18)!);
  let stream: MediaStream | undefined, recorder: MediaRecorder | undefined, chunks: Blob[] = [], startedAt = 0, limit: ReturnType<typeof setTimeout> | undefined, tick: ReturnType<typeof setInterval> | undefined, busy = false, holding = false, opening = false;
  const set = (state: 'idle' | 'recording' | 'working') => { button.dataset.state = state; button.classList.toggle('recording', state === 'recording'); button.classList.toggle('working', state === 'working'); opts.onState?.(state); };
  const release = () => { clearTimeout(limit); clearInterval(tick); for (const t of stream?.getTracks() || []) t.stop(); stream = undefined; button.style.removeProperty('--elapsed'); };
  const start = async () => {
    if (recorder || busy || opening) return;
    holding = true; opening = true;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false }); }
    catch { opening = false; holding = false; toast('打不开麦克风：请在「连接 → 语音输入」里打开按住说话，并允许系统麦克风权限。', 'error'); release(); return; }
    opening = false;
    if (!holding) { release(); return; }
    chunks = []; recorder = new MediaRecorder(stream); recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.start(); startedAt = performance.now(); set('recording');
    tick = setInterval(() => button.style.setProperty('--elapsed', `"${Math.floor((performance.now() - startedAt) / 1000)}s"`), 250);
    limit = setTimeout(() => void stop(), MAX_SECONDS * 1000);
  };
  const stop = async () => {
    holding = false;
    const r = recorder; if (!r) return; recorder = undefined;
    const held = performance.now() - startedAt;
    const done = new Promise<void>(resolve => { r.onstop = () => resolve(); });
    r.stop(); await done; release();
    if (held < MIN_MS) { set('idle'); toast('按住说话，说完再松开。'); return; }
    set('working'); busy = true;
    try {
      const audio = await toWav(new Blob(chunks, { type: r.mimeType || 'audio/webm' })); chunks = [];
      const res = await command({ type: 'voice.transcribe', audio }, true);
      const text = (res.data as { text?: string } | undefined)?.text?.trim();
      if (!res.ok) toast(res.error || '没识别出来。', 'error');
      else if (!text) toast('没听清，再说一次？');
      else { const at = target.selectionStart ?? target.value.length, end = target.selectionEnd ?? at; target.value = target.value.slice(0, at) + text + target.value.slice(end); target.focus(); target.selectionStart = target.selectionEnd = at + text.length; target.dispatchEvent(new Event('input', { bubbles: true })); }
    } catch { toast('这段录音没能处理，再试一次？', 'error'); }
    finally { busy = false; set('idle'); }
  };
  const down = (e: PointerEvent) => { if (e.button !== 0) return; e.preventDefault(); button.setPointerCapture(e.pointerId); void start(); };
  const up = () => void stop();
  const key = (e: KeyboardEvent) => { if (e.key !== ' ' && e.key !== 'Enter') return; e.preventDefault(); if (e.type === 'keydown' && !e.repeat) void start(); if (e.type === 'keyup') void stop(); };
  button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up); button.addEventListener('lostpointercapture', up);
  button.addEventListener('keydown', key); button.addEventListener('keyup', key);
  window.addEventListener('blur', up);
  set('idle');
  return () => { void stop(); release(); window.removeEventListener('blur', up); };
}
