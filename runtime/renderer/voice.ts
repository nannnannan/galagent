// Audio playback for TTS with a loudness envelope that drives the pet's mouth.
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));

export class VoicePlayer {
  private ctx?: AudioContext;
  private source?: AudioBufferSourceNode;
  private fallback?: HTMLAudioElement;
  private revision = 0;
  private frame = 0;
  constructor(private onLevel: (level: number) => void, private onText: (text: string) => void) {}
  stop() {
    this.revision++;
    try { this.source?.stop(); } catch { /* already ended */ }
    this.source = undefined;
    this.fallback?.pause(); this.fallback = undefined;
    window.speechSynthesis?.cancel();
    cancelAnimationFrame(this.frame); this.frame = 0;
    this.onLevel(0);
  }
  async playAudio(base64: string, mimeType = 'audio/wav', isCurrent: () => boolean = () => true) {
    if (!base64 || !isCurrent()) return;
    this.stop();
    const revision = this.revision, current = () => revision === this.revision && isCurrent();
    try {
      const bin = atob(base64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.ctx ||= new AudioContext();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const decoded = await this.ctx.decodeAudioData(bytes.buffer.slice(0));
      if (!current()) return;
      const channel = decoded.getChannelData(0), fps = 60, frames = Math.max(1, Math.ceil(decoded.duration * fps)), per = Math.max(1, Math.floor(channel.length / frames));
      const envelope = new Float32Array(frames);
      for (let f = 0; f < frames; f++) { let sum = 0, n = 0; for (let i = f * per, end = Math.min(channel.length, i + per); i < end; i++) { sum += channel[i] * channel[i]; n++; } envelope[f] = n ? clamp(Math.sqrt(sum / n) * 3.4) : 0; }
      const source = this.ctx.createBufferSource(); source.buffer = decoded; source.connect(this.ctx.destination);
      this.source = source;
      const started = this.ctx.currentTime;
      const tick = () => {
        if (!current() || this.source !== source) return;
        const index = Math.floor((this.ctx!.currentTime - started) * fps);
        if (index >= envelope.length) { this.onLevel(0); return; }
        this.onLevel(envelope[Math.max(0, index)]);
        this.frame = requestAnimationFrame(tick);
      };
      source.onended = () => { if (this.source === source) { this.source = undefined; this.onLevel(0); } };
      source.start(0); this.frame = requestAnimationFrame(tick);
    } catch {
      if (!current()) return;
      const audio = new Audio(`data:${mimeType};base64,${base64}`);
      this.fallback = audio;
      audio.play().catch(() => { if (this.fallback === audio) this.fallback = undefined; });
    }
  }
  speakFallback(text: string, speed = 1) {
    if (!text.trim() || typeof window.speechSynthesis === 'undefined') return;
    this.stop();
    const revision = this.revision;
    const utter = new SpeechSynthesisUtterance(text); utter.lang = 'zh-CN'; utter.rate = clamp(speed, 0.6, 1.6);
    this.onText(text);
    utter.onend = () => { if (revision === this.revision) this.onText(''); };
    window.speechSynthesis.speak(utter);
  }
}
