// 微信通道：把 GalAgent 接到用户自己的个人微信（腾讯 iLink，见 ilink.ts）。
//
// 三条底线（用户 2026-11-04 同意）：
//   1. 只认一个人——扫码绑定的那个微信号；其他任何人发来的消息一律不处理、不回复。
//   2. 出微信的每一句都经 PrivacyGuard 脱敏（密钥、密码等仍会被打码），内容范围不另设限制。
//   3. 需要确认的操作（运行命令、放宽权限）以编号选项发到微信，回数字作答；没回答就按原规则拒绝。
// 额度按腾讯自己的限制为准：只能在用户最近一条消息带来的回复窗口里发，被限流就放弃这一条，不另做设置。
import type { AgentQuestion, AppCommand, AppSnapshot, CommandResult, Message, WeChatView } from '../../shared/contracts';
import { ILinkError, type InboundMessage, type LoginPollResult } from './ilink';

/** Tencent's reply window after the user's last message (community-observed ~24 h); we stop a little early. */
export const REPLY_WINDOW_MS = 24 * 3600_000 - 10 * 60_000;
/** Talking on the phone in the last half hour counts as "on the phone": replies and pushes go there. */
export const ON_PHONE_MS = 30 * 60_000;

export type WeChatSession = { token: string; baseUrl?: string; botId?: string; userId: string; boundAt: number; cursor: string; contextToken?: string; contextAt?: number; lastInboundAt?: number };
export type WeChatClient = {
  setSession(s: { token: string; baseUrl?: string }): void;
  getLoginQrcode(signal?: AbortSignal): Promise<{ qrcode: string; qrcodeContent: string }>;
  pollLogin(qrcode: string, signal?: AbortSignal, verifyCode?: string): Promise<LoginPollResult>;
  getUpdates(cursor: string, signal?: AbortSignal): Promise<{ messages: InboundMessage[]; cursor: string }>;
  sendText(to: string, text: string, contextToken?: string, signal?: AbortSignal): Promise<unknown>;
  sendTyping?(to: string, contextToken?: string, cancel?: boolean): Promise<boolean>;
};
export type BridgeDeps = {
  client: WeChatClient;
  secrets: { load(): Promise<WeChatSession | undefined>; save(s: WeChatSession | undefined): Promise<void> };
  core: { snapshot(): AppSnapshot; handle(c: AppCommand): Promise<CommandResult>; setReachable(r: boolean): void; redact(text: string): string; setView(v: WeChatView): void };
  /** The user is away from the desk (locked / idle), judged by the desktop shell. */
  away(): boolean;
  clock?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

/** Messages that belong on the phone when the user is not at the desk. */
export function forwardable(m: Message): boolean {
  if (m.role !== 'assistant' || m.channel === 'wechat' || !m.text.trim()) return false;
  if (m.source === 'initiative') return true;
  return m.source === 'scene' && /^(\[执行代理|\[已撤销|⏰)/.test(m.text);
}
export function formatQuestion(q: AgentQuestion): string {
  const lines: string[] = [];
  for (const item of q.questions) {
    lines.push(`【${item.header === 'TA 想修改设置' ? 'TA 想改设置，需要你同意' : item.header === '运行命令' ? '执行代理想运行一条命令' : item.header || '需要你确认'}】`, item.question.slice(0, 1200));
    item.options.forEach((o, i) => lines.push(`${i + 1}. ${o.label}${o.description ? `（${o.description.slice(0, 60)}）` : ''}`));
  }
  lines.push(q.questions.length > 1 ? '按顺序回复每个问题的数字，用空格隔开（例如 1 2）。' : '回复数字即可。不回复就当作不同意。');
  return lines.join('\n');
}
/** "1" / "2 1" → answers keyed by question text, the way the desktop card sends them. */
export function parseAnswer(q: AgentQuestion, text: string): Record<string, string> | undefined {
  const picks = text.trim().split(/[\s,，、]+/).map(x => Number(x));
  if (!picks.length || picks.some(n => !Number.isInteger(n) || n < 1)) return undefined;
  if (picks.length !== q.questions.length) return undefined;
  const out: Record<string, string> = {};
  for (const [i, item] of q.questions.entries()) { const o = item.options[picks[i] - 1]; if (!o) return undefined; out[item.question] = o.label; }
  return out;
}

export class WeChatBridge {
  private session?: WeChatSession;
  private view: WeChatView = { state: 'off' };
  private loop?: AbortController;
  private login?: AbortController;
  private seen = new Set<string>();
  private lastForwarded = '';
  private asked = new Map<string, AgentQuestion>();
  private queue: Promise<void> = Promise.resolve();
  private reachable = false;
  private sent = 0; private received = 0;
  private clock: () => number;
  constructor(private deps: BridgeDeps) { this.clock = deps.clock || Date.now; }

  async init() {
    this.session = await this.deps.secrets.load().catch(() => undefined);
    this.lastForwarded = this.deps.core.snapshot().messages.at(-1)?.id || '';
    this.sync();
  }
  get bound() { return !!this.session; }
  private enabled() { return this.deps.core.snapshot().settings.wechatEnabled === true; }
  private publish(patch: Partial<WeChatView> = {}) {
    const s = this.session;
    this.view = { ...this.view, ...patch, sent: this.sent, received: this.received, ...(s ? { boundAt: new Date(s.boundAt).toISOString(), ...(s.lastInboundAt ? { lastInboundAt: new Date(s.lastInboundAt).toISOString() } : {}), ...(s.contextAt ? { replyWindowUntil: new Date(s.contextAt + REPLY_WINDOW_MS).toISOString() } : {}) } : {}) };
    this.deps.core.setView(this.view);
    const reachable = !!s && this.enabled() && !!s.contextToken && !!s.contextAt && this.clock() - s.contextAt < REPLY_WINDOW_MS && this.view.state === 'connected';
    if (reachable !== this.reachable) { this.reachable = reachable; this.deps.core.setReachable(reachable); }
  }
  /** Start or stop polling to match the switch and the saved binding. */
  sync() {
    if (!this.enabled()) { this.stopLoop(); this.login?.abort(); this.publish({ state: 'off', qr: undefined, error: undefined }); return; }
    if (!this.session) { if (!this.login) this.publish({ state: 'unbound' }); return; }
    if (!this.loop) void this.run();
  }
  private stopLoop() { this.loop?.abort(); this.loop = undefined; }
  private async save() { if (this.session) await this.deps.secrets.save(this.session).catch(() => {}); }

  // ---------------------------------------------------------------- binding
  async startLogin(): Promise<void> {
    if (!this.enabled()) throw new Error('先打开微信通道');
    this.login?.abort(); const ctl = new AbortController(); this.login = ctl;
    const { qrcode, qrcodeContent } = await this.deps.client.getLoginQrcode(ctl.signal);
    this.publish({ state: 'qr', qr: qrcodeContent, error: undefined });
    void this.waitLogin(qrcode, ctl);
  }
  private verifyCode?: string;
  async verify(code: string) { this.verifyCode = code; }
  private async waitLogin(qrcode: string, ctl: AbortController) {
    try {
      for (let i = 0; i < 40 && !ctl.signal.aborted; i++) {
        const code = this.verifyCode; this.verifyCode = undefined;
        const r = await this.deps.client.pollLogin(qrcode, ctl.signal, code);
        if (r.status === 'scanned') this.publish({ state: 'scanned' });
        else if (r.status === 'need-verify-code') this.publish({ state: 'verify' });
        else if (r.status === 'confirmed' && r.token && r.userId) {
          // The scanner becomes the only person this bot will ever listen to.
          this.session = { token: r.token, baseUrl: r.baseUrl, botId: r.botId, userId: r.userId, boundAt: this.clock(), cursor: '' };
          await this.save(); this.deps.client.setSession({ token: r.token, baseUrl: r.baseUrl });
          this.publish({ state: 'connected', qr: undefined, error: undefined });
          this.sync(); return;
        } else if (r.status === 'expired' || r.status === 'verify-blocked') { this.publish({ state: 'error', qr: undefined, error: r.status === 'expired' ? '二维码过期了，重新绑定一次' : '验证码输错太多次，重新绑定一次' }); return; }
        else if (r.status === 'confirmed') { this.publish({ state: 'error', qr: undefined, error: '扫码成功但没拿到账号信息，请重试' }); return; }
      }
    } catch (e) { if (!ctl.signal.aborted) this.publish({ state: 'error', qr: undefined, error: e instanceof Error ? e.message : String(e) }); }
    finally { if (this.login === ctl) this.login = undefined; }
  }
  async logout() {
    this.stopLoop(); this.login?.abort(); this.session = undefined; this.asked.clear();
    await this.deps.secrets.save(undefined).catch(() => {});
    this.publish({ state: this.enabled() ? 'unbound' : 'off', qr: undefined, error: undefined, boundAt: undefined, lastInboundAt: undefined, replyWindowUntil: undefined });
  }
  close() { this.stopLoop(); this.login?.abort(); }

  // ---------------------------------------------------------------- receive
  private async run() {
    const ctl = new AbortController(); this.loop = ctl;
    const s = this.session!; this.deps.client.setSession({ token: s.token, baseUrl: s.baseUrl });
    this.publish({ state: 'connected', error: undefined });
    let backoff = 2000;
    const sleep = this.deps.sleep || ((ms: number, signal: AbortSignal) => new Promise<void>(r => { const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); }));
    while (!ctl.signal.aborted && this.session) {
      try {
        const r = await this.deps.client.getUpdates(this.session.cursor, ctl.signal);
        backoff = 2000;
        if (r.cursor && r.cursor !== this.session.cursor) { this.session.cursor = r.cursor; void this.save(); }
        for (const m of r.messages) this.queue = this.queue.then(() => this.inbound(m)).catch(() => {});
        await this.queue;
      } catch (e) {
        if (ctl.signal.aborted) break;
        if (e instanceof ILinkError && e.kind === 'expired') { this.stopLoop(); this.publish({ state: 'expired', error: '微信登录失效了，请重新绑定' }); return; }
        this.publish({ error: e instanceof Error ? e.message : String(e) });
        await sleep(backoff, ctl.signal); backoff = Math.min(60_000, backoff * 2);
      }
    }
  }
  /** Exposed for tests: handle one inbound message. */
  async inbound(m: InboundMessage) {
    const s = this.session; if (!s || this.seen.has(m.id)) return;
    this.seen.add(m.id); if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));
    if (m.from !== s.userId) return; // baseline 1: strangers are ignored, not even answered
    this.received++;
    if (m.contextToken) { s.contextToken = m.contextToken; s.contextAt = this.clock(); }
    s.lastInboundAt = this.clock(); void this.save(); this.publish();
    const text = m.text.trim();
    if (!text) { await this.send(m.kind === 'other' ? '这条消息我看不懂，发文字或语音给我吧。' : '我现在只看得懂文字和语音（会自动转成文字），图片和文件还接不住。'); return; }
    // baseline 3: a pending confirmation is answered by number
    const pending = [...this.asked.values()].at(-1), answers = pending && parseAnswer(pending, text);
    if (pending && answers) { const r = await this.deps.core.handle({ type: 'agent.answer', id: pending.id, answers }); this.asked.delete(pending.id); await this.send(r.ok ? '收到，已经照你说的办。' : '这个确认已经结束了。'); return; }
    const before = new Set(this.deps.core.snapshot().messages.map(x => x.id));
    void this.deps.client.sendTyping?.(s.userId, s.contextToken);
    let r = await this.deps.core.handle({ type: 'chat.send', text, channel: 'wechat' });
    for (let i = 0; !r.ok && /等当前回答完成/.test(r.error || '') && i < 20; i++) { await new Promise(res => setTimeout(res, 1500)); r = await this.deps.core.handle({ type: 'chat.send', text, channel: 'wechat' }); }
    void this.deps.client.sendTyping?.(s.userId, s.contextToken, true);
    if (!r.ok) { await this.send(`没能回你：${(r.error || '出错了').slice(0, 120)}`); return; }
    const replies = this.deps.core.snapshot().messages.filter(x => !before.has(x.id) && x.role === 'assistant' && x.channel === 'wechat');
    for (const reply of replies) await this.send(reply.parts?.length ? reply.parts.join('\n\n') : reply.text);
    const last = this.deps.core.snapshot().messages.at(-1); if (last) this.lastForwarded = last.id;
  }

  // ---------------------------------------------------------------- send
  private onPhone() { const s = this.session; return !!s?.lastInboundAt && this.clock() - s.lastInboundAt < ON_PHONE_MS; }
  /** Every line that leaves for WeChat passes the privacy guard (baseline 2). Tencent's limits decide the rest. */
  async send(text: string): Promise<boolean> {
    const s = this.session; if (!s || !this.enabled()) return false;
    const clean = this.deps.core.redact(text).trim(); if (!clean) return false;
    try { await this.deps.client.sendText(s.userId, clean, s.contextToken); this.sent++; this.publish(); return true; }
    catch (e) {
      if (e instanceof ILinkError && e.kind === 'expired') { this.stopLoop(); this.publish({ state: 'expired', error: '微信登录失效了，请重新绑定' }); }
      else if (e instanceof ILinkError && e.kind === 'no-context') { s.contextAt = 0; this.publish({ error: '回复窗口已过：在微信里给 TA 发一句，就能继续收到消息' }); }
      else this.publish({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }
  /** Called with every snapshot: pushes what belongs on the phone while the user is away or chatting there. */
  async onSnapshot(snap: AppSnapshot) {
    if (!this.enabled() && (this.loop || this.view.state !== 'off')) { this.sync(); return; }
    if (this.enabled() && this.session && !this.loop && this.view.state !== 'expired') this.sync();
    this.publish(); // the reply window runs out with time, not only on events
    if (!this.reachable) { this.lastForwarded = snap.messages.at(-1)?.id || this.lastForwarded; return; }
    const there = this.deps.away() || this.onPhone();
    const idx = snap.messages.findIndex(m => m.id === this.lastForwarded);
    const fresh = idx >= 0 ? snap.messages.slice(idx + 1) : snap.messages.slice(-1);
    this.lastForwarded = snap.messages.at(-1)?.id || this.lastForwarded;
    if (there) for (const m of fresh.filter(forwardable)) await this.send(m.parts?.length ? m.parts.join('\n\n') : m.text);
    for (const q of snap.agent?.questions || []) {
      if (this.asked.has(q.id) || !there) continue;
      this.asked.set(q.id, q);
      await this.send(formatQuestion(q));
    }
    for (const id of [...this.asked.keys()]) if (!(snap.agent?.questions || []).some(q => q.id === id)) this.asked.delete(id);
  }
}
