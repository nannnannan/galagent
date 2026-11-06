/**
 * 微信 iLink Bot 协议客户端（纯网络逻辑，无依赖）。
 *
 * 该协议没有公开文档。本文件照着腾讯官方 OpenClaw 微信插件
 * `@tencent-weixin/openclaw-weixin`（MIT，版本 2.4.10，npm 包源码）对齐实现，读过的文件：
 *   - src/api/api.ts           请求头、base_info、getupdates / sendmessage / getconfig / sendtyping、
 *                              uint64 消息 id 无损解析、超时（长轮询 35s / 普通 15s / 轻量 10s）
 *   - src/api/types.ts         WeixinMessage、MessageItem、各 item 结构、TypingStatus
 *   - src/api/session-guard.ts ret/errcode -14 = bot token 失效
 *   - src/auth/login-qr.ts     get_bot_qrcode / get_qrcode_status、状态枚举、IDC 重定向
 *   - src/api/config-cache.ts  typing_ticket 按用户缓存（24h）
 *   - src/messaging/send.ts    发送体（client_id、message_type=BOT、message_state=FINISH）
 *   - src/messaging/inbound.ts context_token 每条消息下发、回复时原样带回；语音转文字 voice_item.text
 *   - src/monitor/monitor.ts   长轮询循环、longpolling_timeout_ms、错误处理
 *   - src/channel.ts           chatTypes 只有 "direct"（只支持 1:1），textChunkLimit 4000
 * 服务端行为可能随时变化；这里只做协议层，不做文件读写、不存密钥、不记录消息内容或令牌。
 */

import { createDecipheriv } from 'node:crypto';
import { isIP } from 'node:net';
import { isPrivateAddress } from '../net-guard';

export const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';
/** 插件 package.json 顶层的 ilink_appid。 */
export const ILINK_APP_ID = 'bot';
/** 插件对齐的版本（用于 base_info.channel_version 与 iLink-App-ClientVersion）。 */
export const ILINK_PLUGIN_VERSION = '2.4.10';
/** 扫码登录的 bot_type（插件 DEFAULT_ILINK_BOT_TYPE）。 */
export const ILINK_BOT_TYPE = '3';
/** 插件声明的单条文本上限；默认按更保守的 1800 字切分。 */
export const ILINK_TEXT_LIMIT = 4000;
export const DEFAULT_CHUNK_LIMIT = 1800;

const LONG_POLL_TIMEOUT_MS = 35_000;
const API_TIMEOUT_MS = 15_000;
const LIGHT_TIMEOUT_MS = 10_000;
const TYPING_TICKET_TTL_MS = 24 * 3600_000;

/** iLink-App-ClientVersion：uint32 0x00MMNNPP（major<<16 | minor<<8 | patch）。 */
export function encodeClientVersion(version: string): number {
  const [a = 0, b = 0, c = 0] = version.split('.').map((p) => parseInt(p, 10) || 0);
  return ((a & 0xff) << 16) | ((b & 0xff) << 8) | (c & 0xff);
}

/** X-WECHAT-UIN：随机 uint32 → 十进制字符串 → base64，每次请求重新生成。 */
export function randomWechatUin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return Buffer.from(String(n), 'utf-8').toString('base64');
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export type ILinkErrorKind = 'expired' | 'rate-limited' | 'no-context' | 'network' | 'protocol';

export class ILinkError extends Error {
  readonly code: number | string;
  readonly kind: ILinkErrorKind;
  /** sendText 中途失败时，已经成功发出的分段。 */
  readonly sent?: SendChunkResult[];
  constructor(kind: ILinkErrorKind, code: number | string, message: string, sent?: SendChunkResult[]) {
    super(message);
    this.name = 'ILinkError';
    this.kind = kind;
    this.code = code;
    if (sent) this.sent = sent;
  }
}

/** 服务端错误码 → 错误类别。-14 来自插件源码；-2 为限流是未在源码中出现的推断。 */
export function kindForCode(code: number, errmsg = ''): ILinkErrorKind {
  if (code === -14) return 'expired';
  if (code === -2) return 'rate-limited';
  if (/context/i.test(errmsg)) return 'no-context';
  return 'protocol';
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** Where a picture or file sent by the user sits on Tencent's CDN. */
export type InboundMedia = { kind: 'image' | 'file'; param?: string; aesKey?: string; fullUrl?: string; fileName?: string };
export const ILINK_CDN_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024;
/** aes_key comes either as base64 of the 16 raw bytes, or as base64 of their hex spelling. */
export function parseAesKey(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-f]{32}$/i.test(decoded.toString('ascii'))) return Buffer.from(decoded.toString('ascii'), 'hex');
  throw new ILinkError('protocol', 'media', '媒体密钥格式不对');
}
export function mediaUrl(m: InboundMedia): string {
  if (m.fullUrl) {
    const u = new URL(m.fullUrl);
    // The URL comes off the wire: only Tencent's own HTTPS hosts may be fetched.
    if (u.protocol !== 'https:' || !/(^|\.)(weixin\.qq\.com|wechat\.com)$/i.test(u.hostname)) throw new ILinkError('protocol', 'media', '媒体地址不是腾讯的');
    return u.href;
  }
  if (!m.param) throw new ILinkError('protocol', 'media', '媒体没有下载地址');
  return `${ILINK_CDN_URL}/download?encrypted_query_param=${encodeURIComponent(m.param)}`;
}

export type InboundKind = 'text' | 'image' | 'voice' | 'file' | 'video' | 'other';

export interface InboundMessage {
  id: string;
  /** 发送者 iLink 用户 id（形如 xxx@im.wechat）。 */
  from: string;
  /** 文本内容；语音带转写时为转写文字；其它媒体为空串。 */
  text: string;
  /** 回复时必须原样带回。 */
  contextToken?: string;
  at: number;
  kind: InboundKind;
  /** 文件消息的文件名（若有）。 */
  fileName?: string;
  /** 图片或文件在腾讯 CDN 上的位置；只有绑定账号的消息才会真的去下载。 */
  media?: InboundMedia;
}

export interface ILinkClientOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  token?: string;
  /** 固定 X-WECHAT-UIN；不传则每次请求随机生成（与插件一致）。 */
  uin?: string;
  appId?: string;
  /** 用于 channel_version 与 iLink-App-ClientVersion 的语义化版本号。 */
  clientVersion?: string;
  /** base_info.bot_agent，UA 风格 `Name/Version`，仅用于服务端观测。 */
  botAgent?: string;
  /** 文本分段上限，最大 ILINK_TEXT_LIMIT。 */
  chunkLimit?: number;
  /** 扫码登录固定走的地址（插件硬编码为 ILINK_BASE_URL）。 */
  loginBaseUrl?: string;
}

export type LoginStatus =
  | 'wait'
  | 'scanned'
  | 'confirmed'
  | 'expired'
  /** 需要输入手机上显示的数字，下次 pollLogin 传 verifyCode。 */
  | 'need-verify-code'
  /** 数字多次输错，需重新取码。 */
  | 'verify-blocked'
  /** 该 bot 已绑定到本端（需在 getLoginQrcode 传入已有 token 才会出现），已有凭据仍有效。 */
  | 'already-bound';

export interface LoginPollResult {
  status: LoginStatus;
  token?: string;
  botId?: string;
  /** 扫码者的 iLink 用户 id。 */
  userId?: string;
  /** 登录后应使用的接口地址（服务端下发 baseurl）。 */
  baseUrl?: string;
}

export interface UpdatesResult {
  messages: InboundMessage[];
  cursor: string;
  /** 服务端建议的下一次长轮询超时。 */
  nextTimeoutMs?: number;
}

export interface SendChunkResult {
  clientId: string;
  messageId?: string;
  length: number;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

const LOSSLESS_ID_FIELDS = new Set(['message_id', 'msg_id', 'svr_id']);

/** 把 uint64 消息 id 在 JSON.parse 之前加上引号（只改真正的属性，不碰字符串内容）。 */
export function parseILinkJson<T>(raw: string): T {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== '"') { out += raw[i++]; continue; }
    const start = i++;
    let esc = false;
    while (i < raw.length) {
      const ch = raw[i++];
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') break;
    }
    const tok = raw.slice(start, i);
    out += tok;
    let j = i;
    while (/\s/.test(raw[j] ?? '')) j++;
    if (raw[j] !== ':') continue;
    let key: unknown;
    try { key = JSON.parse(tok); } catch { continue; }
    if (typeof key !== 'string' || !LOSSLESS_ID_FIELDS.has(key)) continue;
    out += raw.slice(i, j + 1);
    j++;
    while (/\s/.test(raw[j] ?? '')) out += raw[j++];
    const ns = j;
    if (raw[j] === '-') j++;
    while (/\d/.test(raw[j] ?? '')) j++;
    if (j > ns && !(j === ns + 1 && raw[ns] === '-')) { out += `"${raw.slice(ns, j)}"`; i = j; }
    else i = ns;
  }
  return JSON.parse(out) as T;
}

/** 按段落 / 句子 / 空白边界切分文本，每段不超过 limit 个 UTF-16 码元（不拆代理对）。 */
export function splitText(text: string, limit = DEFAULT_CHUNK_LIMIT): string[] {
  const max = Math.max(1, Math.min(ILINK_TEXT_LIMIT, Math.floor(limit)));
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const min = Math.floor(max * 0.5);
    let cut = -1;
    const para = window.lastIndexOf('\n\n');
    if (para >= min) cut = para + 2;
    if (cut < 0) { const nl = window.lastIndexOf('\n'); if (nl >= min) cut = nl + 1; }
    if (cut < 0) {
      const re = /[。！？!?；;…]+["'”’」』）)]*|[.](?=\s)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(window))) { const end = m.index + m[0].length; if (end >= min) cut = end; }
    }
    if (cut < 0) { const sp = Math.max(window.lastIndexOf(' '), window.lastIndexOf('，'), window.lastIndexOf(',')); if (sp >= min) cut = sp + 1; }
    if (cut < 0) {
      cut = max;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    const piece = rest.slice(0, cut).replace(/\s+$/, '');
    if (piece) chunks.push(piece);
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.trim() || chunks.length === 0) chunks.push(rest);
  return chunks;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

const ITEM_TEXT = 1, ITEM_IMAGE = 2, ITEM_VOICE = 3, ITEM_FILE = 4, ITEM_VIDEO = 5;
const MESSAGE_TYPE_BOT = 2;
const MESSAGE_STATE_FINISH = 2;

interface RawMedia { encrypt_query_param?: string; aes_key?: string; full_url?: string }
interface RawItem {
  type?: number;
  msg_id?: string;
  create_time_ms?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string };
  file_item?: { file_name?: string; media?: RawMedia };
  image_item?: { aeskey?: string; media?: RawMedia };
}
interface RawMessage {
  seq?: number;
  message_id?: string;
  from_user_id?: string;
  create_time_ms?: number;
  message_type?: number;
  item_list?: RawItem[];
  context_token?: string;
}

function toInbound(m: RawMessage): InboundMessage | null {
  const from = m.from_user_id?.trim();
  if (!from || m.message_type === MESSAGE_TYPE_BOT) return null;
  const items = m.item_list ?? [];
  const texts: string[] = [];
  let kind: InboundKind | undefined;
  let fileName: string | undefined, media: InboundMedia | undefined;
  const ref = (kind: InboundMedia['kind'], m?: RawMedia, key?: string): InboundMedia | undefined => m && (m.encrypt_query_param || m.full_url) ? { kind, ...(m.encrypt_query_param ? { param: m.encrypt_query_param } : {}), ...(key ? { aesKey: key } : {}), ...(m.full_url ? { fullUrl: m.full_url } : {}) } : undefined;
  for (const it of items) {
    switch (it.type) {
      case ITEM_TEXT:
        if (it.text_item?.text != null) texts.push(String(it.text_item.text));
        kind ??= 'text';
        break;
      case ITEM_VOICE:
        if (it.voice_item?.text) texts.push(it.voice_item.text);
        if (!kind || kind === 'text') kind = 'voice';
        break;
      case ITEM_IMAGE:
        if (!kind || kind === 'text') kind = 'image';
        media ??= ref('image', it.image_item?.media, it.image_item?.aeskey ? Buffer.from(it.image_item.aeskey, 'hex').toString('base64') : it.image_item?.media?.aes_key);
        break;
      case ITEM_FILE:
        if (!kind || kind === 'text') kind = 'file';
        fileName ??= it.file_item?.file_name;
        media ??= ref('file', it.file_item?.media, it.file_item?.media?.aes_key);
        break;
      case ITEM_VIDEO: if (!kind || kind === 'text') kind = 'video'; break;
      default: break;
    }
  }
  const id = m.message_id?.trim() || items.find((i) => i.msg_id?.trim())?.msg_id?.trim()
    || `${from}:${m.create_time_ms ?? ''}:${m.seq ?? ''}`;
  const out: InboundMessage = {
    id,
    from,
    text: texts.join('\n'),
    at: m.create_time_ms ?? items[0]?.create_time_ms ?? Date.now(),
    kind: kind ?? 'other',
  };
  if (m.context_token) out.contextToken = m.context_token;
  if (fileName) out.fileName = fileName;
  if (media) out.media = fileName ? { ...media, fileName } : media;
  return out;
}

// ---------------------------------------------------------------------------
// 客户端
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

export class ILinkClient {
  private readonly fetchImpl: typeof fetch;
  private baseUrl: string;
  private token?: string;
  private readonly uin?: string;
  private readonly appId: string;
  private readonly version: string;
  private readonly botAgent: string;
  private readonly chunkLimit: number;
  private readonly loginBaseUrl: string;
  /** 扫码时服务端 IDC 重定向后的轮询地址（按 qrcode 记）。 */
  private readonly loginRedirect = new Map<string, string>();
  private readonly typingTickets = new Map<string, { ticket: string; until: number }>();

  constructor(opts: ILinkClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = opts.baseUrl || ILINK_BASE_URL;
    this.token = opts.token?.trim() || undefined;
    this.uin = opts.uin;
    this.appId = opts.appId ?? ILINK_APP_ID;
    this.version = opts.clientVersion ?? ILINK_PLUGIN_VERSION;
    this.botAgent = opts.botAgent ?? 'GalAgent/1.0';
    this.chunkLimit = opts.chunkLimit ?? DEFAULT_CHUNK_LIMIT;
    this.loginBaseUrl = opts.loginBaseUrl ?? ILINK_BASE_URL;
  }

  /** 登录确认后换上新的令牌与地址。 */
  setSession(session: { token: string; baseUrl?: string }): void {
    this.token = session.token.trim() || undefined;
    if (session.baseUrl) this.baseUrl = this.safeBaseUrl(session.baseUrl);
    this.typingTickets.clear();
  }

  private safeBaseUrl(raw: string): string {
    let u: URL;
    try { u = new URL(raw); } catch { throw new ILinkError('protocol', 'bad-url', 'iLink 地址无效'); }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !host || /(^|\.)localhost$/i.test(host) || (isIP(host) && isPrivateAddress(host))) {
      throw new ILinkError('protocol', 'bad-url', `拒绝不安全的 iLink 地址 (${u.hostname})`);
    }
    return raw.trim().replace(/\/+$/, '');
  }

  get hasToken(): boolean { return Boolean(this.token); }

  // ---- 登录 ----

  /**
   * 取登录二维码。`qrcodeContent` 是要渲染成二维码的内容（服务端 qrcode_img_content，通常是一个链接，
   * 也可直接在浏览器打开）。`knownTokens` 对应插件的 local_token_list（最多 10 个），用于识别已绑定的 bot。
   */
  async getLoginQrcode(signal?: AbortSignal, knownTokens: string[] = []): Promise<{ qrcode: string; qrcodeContent: string }> {
    const raw = await this.request('POST', this.loginBaseUrl, `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(ILINK_BOT_TYPE)}`, {
      body: { local_token_list: knownTokens.slice(0, 10) }, auth: false, baseInfo: false, timeoutMs: API_TIMEOUT_MS, signal, label: 'get_bot_qrcode',
    });
    const r = this.checked<{ qrcode?: string; qrcode_img_content?: string }>(raw, 'get_bot_qrcode');
    if (!r.qrcode || !r.qrcode_img_content) throw new ILinkError('protocol', 'bad-response', 'get_bot_qrcode: missing qrcode');
    return { qrcode: r.qrcode, qrcodeContent: r.qrcode_img_content };
  }

  /** 长轮询扫码状态（约 35 秒）。客户端超时或网关错误视为 wait，外部 signal 中止则抛出。 */
  async pollLogin(qrcode: string, signal?: AbortSignal, verifyCode?: string): Promise<LoginPollResult> {
    const base = this.loginRedirect.get(qrcode) ?? this.loginBaseUrl;
    let path = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    if (verifyCode) path += `&verify_code=${encodeURIComponent(verifyCode)}`;
    let raw: Json;
    try {
      raw = await this.request('GET', base, path, { timeoutMs: LONG_POLL_TIMEOUT_MS, signal, label: 'get_qrcode_status' });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof ILinkError && (err.kind === 'network' || err.code === 524)) return { status: 'wait' };
      throw err;
    }
    const r = raw as {
      status?: string; bot_token?: string; ilink_bot_id?: string; baseurl?: string; ilink_user_id?: string; redirect_host?: string;
    };
    switch (r.status) {
      case 'scaned': return { status: 'scanned' };
      case 'scaned_but_redirect':
        if (r.redirect_host) this.loginRedirect.set(qrcode, this.safeBaseUrl(`https://${r.redirect_host}`));
        return { status: 'scanned' };
      case 'need_verifycode': return { status: 'need-verify-code' };
      case 'verify_code_blocked': this.loginRedirect.delete(qrcode); return { status: 'verify-blocked' };
      case 'binded_redirect': this.loginRedirect.delete(qrcode); return { status: 'already-bound' };
      case 'expired': this.loginRedirect.delete(qrcode); return { status: 'expired' };
      case 'confirmed': {
        this.loginRedirect.delete(qrcode);
        if (!r.ilink_bot_id || !r.bot_token) throw new ILinkError('protocol', 'bad-response', 'get_qrcode_status: confirmed without bot id/token');
        const res: LoginPollResult = { status: 'confirmed', token: r.bot_token, botId: r.ilink_bot_id };
        if (r.ilink_user_id) res.userId = r.ilink_user_id;
        if (r.baseurl) res.baseUrl = this.safeBaseUrl(r.baseurl);
        return res;
      }
      default: return { status: 'wait' };
    }
  }

  // ---- 收消息 ----

  /**
   * 长轮询拉取新消息。cursor 即 get_updates_buf，首次传 ""；返回的新 cursor 需由调用方保存。
   * 客户端超时视为没有新消息；外部 signal 中止则抛出 network/aborted。
   */
  async getUpdates(cursor: string, signal?: AbortSignal, timeoutMs = LONG_POLL_TIMEOUT_MS): Promise<UpdatesResult> {
    let raw: Json;
    try {
      raw = await this.request('POST', this.baseUrl, 'ilink/bot/getupdates', {
        body: { get_updates_buf: cursor ?? '' }, timeoutMs, signal, label: 'getupdates',
      });
    } catch (err) {
      if (err instanceof ILinkError && err.code === 'timeout') return { messages: [], cursor };
      throw err;
    }
    const r = this.checked<{ msgs?: RawMessage[]; get_updates_buf?: string; longpolling_timeout_ms?: number }>(raw, 'getupdates');
    const messages: InboundMessage[] = [];
    for (const m of r.msgs ?? []) { const x = toInbound(m); if (x) messages.push(x); }
    const out: UpdatesResult = { messages, cursor: r.get_updates_buf ? r.get_updates_buf : cursor };
    if (typeof r.longpolling_timeout_ms === 'number' && r.longpolling_timeout_ms > 0) out.nextTimeoutMs = r.longpolling_timeout_ms;
    return out;
  }

  // ---- 发消息 ----

  /** 发送文本，超长按段落/句子切分逐条发送。任一段失败抛 ILinkError，`sent` 带已发出的分段。 */
  async sendText(to: string, text: string, contextToken?: string, signal?: AbortSignal): Promise<SendChunkResult[]> {
    const chunks = splitText(text, this.chunkLimit).filter((c) => c.length > 0);
    const results: SendChunkResult[] = [];
    for (const chunk of chunks) {
      const clientId = `galagent:${Date.now()}-${randomHex(4)}`;
      const msg: Json = {
        from_user_id: '',
        to_user_id: to,
        client_id: clientId,
        message_type: MESSAGE_TYPE_BOT,
        message_state: MESSAGE_STATE_FINISH,
        item_list: [{ type: ITEM_TEXT, text_item: { text: chunk } }],
      };
      if (contextToken) msg.context_token = contextToken;
      try {
        const raw = await this.request('POST', this.baseUrl, 'ilink/bot/sendmessage', {
          body: { msg }, timeoutMs: API_TIMEOUT_MS, signal, label: 'sendmessage',
        });
        const r = this.checked<{ message_id?: string }>(raw, 'sendmessage');
        const res: SendChunkResult = { clientId, length: chunk.length };
        if (r.message_id) res.messageId = String(r.message_id);
        results.push(res);
      } catch (err) {
        if (err instanceof ILinkError) throw new ILinkError(err.kind, err.code, err.message, results.slice());
        throw err;
      }
    }
    return results;
  }

  /** “对方正在输入”。需先用 getconfig 换 typing_ticket（按用户缓存 24h）；尽力而为，永不抛错。 */
  /** Downloads and decrypts one picture or file. Called only for the bound account's messages. */
  async downloadMedia(media: InboundMedia, signal?: AbortSignal): Promise<Uint8Array> {
    const timer = AbortSignal.timeout(60_000);
    const combined = signal ? AbortSignal.any([signal, timer]) : timer;
    // Redirects are followed by hand so every hop is re-checked against Tencent's HTTPS hosts.
    let url = mediaUrl(media), res: Response;
    for (let hop = 0; ; hop++) {
      res = await this.fetchImpl(url, { signal: combined, redirect: 'manual' });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      await res.body?.cancel().catch(() => {});
      if (hop >= 3) throw new ILinkError('protocol', 'media', '媒体地址跳转太多次');
      url = mediaUrl({ ...media, fullUrl: new URL(location, url).href });
    }
    if (!res.ok) throw new ILinkError('network', 'media', `媒体下载失败 (${res.status})`);
    if (Number(res.headers.get('content-length')) > MEDIA_MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new ILinkError('protocol', 'media', '文件太大了');
    }
    let body: Buffer;
    if (res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MEDIA_MAX_BYTES) throw new ILinkError('protocol', 'media', '文件太大了');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      body = Buffer.concat(chunks, total);
    } else {
      body = Buffer.from(await res.arrayBuffer());
      if (body.length > MEDIA_MAX_BYTES) throw new ILinkError('protocol', 'media', '文件太大了');
    }
    if (!media.aesKey) return body;
    const decipher = createDecipheriv('aes-128-ecb', parseAesKey(media.aesKey), null);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }

  async sendTyping(to: string, contextToken?: string, cancel = false): Promise<boolean> {
    try {
      const ticket = await this.typingTicket(to, contextToken);
      if (!ticket) return false;
      const raw = await this.request('POST', this.baseUrl, 'ilink/bot/sendtyping', {
        body: { ilink_user_id: to, typing_ticket: ticket, status: cancel ? 2 : 1 }, timeoutMs: LIGHT_TIMEOUT_MS, label: 'sendtyping',
      });
      this.checked(raw, 'sendtyping');
      return true;
    } catch {
      return false;
    }
  }

  private async typingTicket(to: string, contextToken?: string): Promise<string | undefined> {
    const hit = this.typingTickets.get(to);
    if (hit && hit.until > Date.now()) return hit.ticket || undefined;
    const body: Json = { ilink_user_id: to };
    if (contextToken) body.context_token = contextToken;
    const raw = await this.request('POST', this.baseUrl, 'ilink/bot/getconfig', { body, timeoutMs: LIGHT_TIMEOUT_MS, label: 'getconfig' });
    const r = this.checked<{ typing_ticket?: string }>(raw, 'getconfig');
    const ticket = r.typing_ticket ?? '';
    this.typingTickets.set(to, { ticket, until: Date.now() + TYPING_TICKET_TTL_MS });
    return ticket || undefined;
  }

  // ---- HTTP ----

  private headers(method: 'GET' | 'POST', auth: boolean): Record<string, string> {
    const h: Record<string, string> = {
      'iLink-App-Id': this.appId,
      'iLink-App-ClientVersion': String(encodeClientVersion(this.version)),
    };
    if (method === 'POST') {
      h['Content-Type'] = 'application/json';
      h.AuthorizationType = 'ilink_bot_token';
      h['X-WECHAT-UIN'] = this.uin ?? randomWechatUin();
      if (auth && this.token) h.Authorization = `Bearer ${this.token}`;
    }
    return h;
  }

  /** 去掉错误文本里可能出现的令牌并截断。 */
  private scrub(s: string): string {
    let out = String(s).slice(0, 200);
    if (this.token) out = out.split(this.token).join('***');
    return out;
  }

  private checked<T>(raw: Json, label: string): T {
    const ret = typeof raw.ret === 'number' ? raw.ret : 0;
    const errcode = typeof raw.errcode === 'number' ? raw.errcode : 0;
    const code = ret !== 0 ? ret : errcode;
    if (code !== 0) {
      const errmsg = typeof raw.errmsg === 'string' ? raw.errmsg : '';
      const code2 = ret === -14 || errcode === -14 ? -14 : code;
      throw new ILinkError(kindForCode(code2, errmsg), code2, `${label}: ret=${code2}${errmsg ? ` ${this.scrub(errmsg)}` : ''}`);
    }
    return raw as T;
  }

  private async request(
    method: 'GET' | 'POST',
    base: string,
    path: string,
    o: { body?: Json; auth?: boolean; baseInfo?: boolean; timeoutMs: number; signal?: AbortSignal; label: string },
  ): Promise<Json> {
    const url = new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
    if (o.signal?.aborted) throw new ILinkError('network', 'aborted', `${o.label}: aborted`);
    const timer = AbortSignal.timeout(o.timeoutMs);
    const signal = o.signal ? AbortSignal.any([o.signal, timer]) : timer;
    let body: string | undefined;
    if (method === 'POST') {
      const payload: Json = { ...(o.body ?? {}) };
      if (o.baseInfo !== false) payload.base_info = { channel_version: this.version, bot_agent: this.botAgent };
      body = JSON.stringify(payload);
    }
    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(url, { method, headers: this.headers(method, o.auth !== false), body, signal });
      text = await res.text();
    } catch (err) {
      if (o.signal?.aborted) throw new ILinkError('network', 'aborted', `${o.label}: aborted`);
      if (timer.aborted || isAbort(err)) throw new ILinkError('network', 'timeout', `${o.label}: timeout`);
      const cause = (err as { cause?: { code?: unknown } })?.cause?.code;
      throw new ILinkError('network', typeof cause === 'string' ? cause : 'fetch-failed', `${o.label}: network error`);
    }
    if (!res.ok) {
      const kind: ILinkErrorKind = res.status === 429 ? 'rate-limited' : res.status === 401 ? 'expired' : res.status >= 500 ? 'network' : 'protocol';
      throw new ILinkError(kind, res.status, `${o.label}: HTTP ${res.status}`);
    }
    try {
      const parsed = parseILinkJson<unknown>(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      return parsed as Json;
    } catch {
      throw new ILinkError('protocol', 'bad-json', `${o.label}: invalid JSON response`);
    }
  }
}
