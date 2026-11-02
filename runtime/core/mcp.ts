// Model Context Protocol client (the tool-server protocol Codex CLI, Kimi Code and DSH all speak).
// Two transports: stdio (a local program, newline-delimited JSON-RPC) and Streamable HTTP (a URL, JSON or
// SSE responses, Mcp-Session-Id). Secrets (environment variables for stdio, headers such as Authorization
// for HTTP) never live in settings: the desktop shell keeps them DPAPI-encrypted and hands them over only
// when a connection starts. Local programs need Shell in the sandbox, remote servers need network; tool
// output is data, never instructions; server-side sampling (borrowing our model) is refused.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { safeChildEnv } from './safe-env';

export type McpServerConfig = {
  name: string; enabled: boolean;
  /** stdio */ command?: string; args?: string[];
  /** Streamable HTTP */ url?: string;
  /** Names (not values) of the encrypted env vars / headers the user has set. */ envKeys?: string[]; headerKeys?: string[];
};
export type McpSecrets = { env?: Record<string, string>; headers?: Record<string, string> };
export type McpTransportKind = 'stdio' | 'http';
export type McpTool = { server: string; transport: McpTransportKind; name: string; qualified: string; description: string; inputSchema: Record<string, unknown> };
export type McpStatus = { name: string; state: 'stopped' | 'starting' | 'ready' | 'failed'; tools: number; transport: McpTransportKind; error?: string };
export const MCP_LIMITS = { servers: 20, name: 32, command: 500, args: 60, arg: 2000, url: 1000, toolsPerServer: 120, secretKey: 100, secretValue: 8000, secrets: 30 } as const;
const PROTOCOL = '2025-06-18';

export const qualify = (server: string, tool: string) => `mcp__${server}__${tool.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);
const keyList = (v: unknown) => Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(k)).slice(0, MCP_LIMITS.secrets) : undefined;
export function validServers(raw: unknown): McpServerConfig[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MCP_LIMITS.servers) throw new Error(`MCP 服务最多 ${MCP_LIMITS.servers} 个`);
  const names = new Set<string>();
  return raw.map(item => {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) throw new Error('MCP 服务名只能用字母、数字、_ 和 -（1–32 个）');
    if (names.has(name)) throw new Error(`MCP 服务名重复：${name}`); names.add(name);
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    const envKeys = keyList(r.envKeys), headerKeys = keyList(r.headerKeys);
    const common = { name, enabled: r.enabled !== false, ...(envKeys?.length ? { envKeys } : {}), ...(headerKeys?.length ? { headerKeys } : {}) };
    if (url) {
      let parsed: URL; try { parsed = new URL(url); } catch { throw new Error(`MCP 服务 ${name} 的网址无效`); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || url.length > MCP_LIMITS.url) throw new Error(`MCP 服务 ${name} 需要 http(s) 网址，且不能把密码写进网址（请用“密钥”）`);
      return { ...common, url };
    }
    const command = typeof r.command === 'string' ? r.command.trim() : '';
    if (!command || command.length > MCP_LIMITS.command || command.includes('\0')) throw new Error(`MCP 服务 ${name} 需要启动命令或网址`);
    const args = Array.isArray(r.args) ? r.args : [];
    if (args.length > MCP_LIMITS.args || args.some(a => typeof a !== 'string' || a.length > MCP_LIMITS.arg || a.includes('\0'))) throw new Error(`MCP 服务 ${name} 的参数无效`);
    return { ...common, command, args: args as string[] };
  });
}
export function validSecrets(raw: unknown): McpSecrets {
  const map = (v: unknown, label: string) => {
    if (v === undefined) return undefined;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${label}格式无效`);
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > MCP_LIMITS.secrets) throw new Error(`${label}最多 ${MCP_LIMITS.secrets} 项`);
    for (const [k, val] of entries) if (!/^[A-Za-z0-9_.-]{1,100}$/.test(k) || typeof val !== 'string' || val.length > MCP_LIMITS.secretValue || /[\r\n\0]/.test(val)) throw new Error(`${label}「${k.slice(0, 40)}」无效`);
    return Object.fromEntries(entries) as Record<string, string>;
  };
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const env = map(r.env, '环境变量'), headers = map(r.headers, '请求头');
  return { ...(env ? { env } : {}), ...(headers ? { headers } : {}) };
}
/** "KEY=value" lines → map (the settings form's text format). */
export const parseSecretLines = (text: string, sep = '='): Record<string, string> => Object.fromEntries(text.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf(sep); if (i <= 0) throw new Error(`每行写成 名称${sep}值：${l.slice(0, 30)}`); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
abstract class McpConnection {
  tools: McpTool[] = []; state: McpStatus['state'] = 'stopped'; error?: string;
  abstract readonly transport: McpTransportKind;
  constructor(readonly config: McpServerConfig, protected cwd: string, protected secrets: () => Promise<McpSecrets>) {}
  protected abstract open(): Promise<void>;
  protected abstract rpc(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<any>;
  protected abstract notify(method: string, params?: unknown): Promise<void>;
  protected abstract close(): void;
  async start(): Promise<void> {
    if (this.state === 'ready') return;
    this.state = 'starting'; this.error = undefined;
    try {
      await this.open();
      await this.rpc('initialize', { protocolVersion: PROTOCOL, capabilities: { roots: { listChanged: false } }, clientInfo: { name: 'GalAgent', version: '0.4' } }, 30_000);
      await this.notify('notifications/initialized');
      const tools: McpTool[] = []; let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const r = await this.rpc('tools/list', cursor ? { cursor } : {}, 30_000);
        for (const t of Array.isArray(r?.tools) ? r.tools : []) {
          if (!t || typeof t.name !== 'string' || tools.length >= MCP_LIMITS.toolsPerServer) continue;
          const schema = t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} };
          tools.push({ server: this.config.name, transport: this.transport, name: t.name, qualified: qualify(this.config.name, t.name), description: String(t.description || '').slice(0, 2000), inputSchema: schema });
        }
        cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
        if (!cursor) break;
      }
      this.tools = tools; this.state = 'ready';
    } catch (error) { this.stop(error instanceof Error ? error.message : String(error)); throw error; }
  }
  async call(tool: string, args: unknown, signal: AbortSignal): Promise<{ text: string; isError: boolean; images: { data: string; mimeType: string }[] }> {
    if (this.state !== 'ready') await this.start();
    const r = await this.rpc('tools/call', { name: tool, arguments: args ?? {} }, 600_000, signal);
    const parts = Array.isArray(r?.content) ? r.content : [];
    const text = parts.map((p: any) => p?.type === 'text' ? String(p.text ?? '') : p?.type === 'resource' ? String(p.resource?.text ?? `[resource ${p.resource?.uri ?? ''}]`) : p?.type === 'resource_link' ? `[resource ${p.uri ?? ''}]` : p?.type === 'image' ? '[image]' : '').filter(Boolean).join('\n')
      || (r?.structuredContent ? JSON.stringify(r.structuredContent) : '');
    const images = parts.filter((p: any) => p?.type === 'image' && typeof p.data === 'string' && /^image\/(png|jpeg|webp|gif)$/.test(p.mimeType)).slice(0, 4).map((p: any) => ({ data: p.data, mimeType: p.mimeType }));
    return { text, isError: r?.isError === true, images };
  }
  /** Answers server-initiated requests: ping and roots/list; sampling/elicitation are refused. */
  protected serverRequest(message: any): unknown {
    return message.method === 'ping' ? { result: {} } : message.method === 'roots/list' ? { result: { roots: [{ uri: 'file://' + this.cwd.replace(/\\/g, '/'), name: 'workspace' }] } } : { error: { code: -32601, message: 'Not supported by GalAgent' } };
  }
  stop(error?: string) { this.close(); this.tools = []; this.state = error ? 'failed' : 'stopped'; this.error = error; }
  view(): McpStatus { return { name: this.config.name, state: this.state, tools: this.tools.length, transport: this.transport, ...(this.error ? { error: this.error.slice(0, 300) } : {}) }; }
}

class StdioConnection extends McpConnection {
  readonly transport = 'stdio' as const;
  private child?: ChildProcessWithoutNullStreams; private buffer = ''; private seq = 0; private pending = new Map<number, Pending>();
  private fail(message: string) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } this.pending.clear(); }
  private send(message: unknown) { if (!this.child || this.child.stdin.destroyed) throw new Error(`MCP 服务 ${this.config.name} 未运行`); this.child.stdin.write(JSON.stringify(message) + '\n'); }
  protected async notify(method: string, params?: unknown) { this.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }); }
  protected rpc(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); this.pending.delete(id); try { this.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'cancelled' } }); } catch { /* gone */ } reject(new Error('Cancelled')); };
      const timer = setTimeout(() => { this.pending.delete(id); signal?.removeEventListener('abort', abort); reject(new Error(`MCP ${this.config.name}: ${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve: v => { signal?.removeEventListener('abort', abort); resolve(v); }, reject: e => { signal?.removeEventListener('abort', abort); reject(e); }, timer });
      if (signal) { if (signal.aborted) { abort(); return; } signal.addEventListener('abort', abort, { once: true }); }
      try { this.send({ jsonrpc: '2.0', id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error as Error); }
    });
  }
  private receive(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 8_000_000) { this.stop('MCP 输出过大'); return; }
    for (let end; (end = this.buffer.indexOf('\n')) >= 0;) {
      const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      let message: any; try { message = JSON.parse(line); } catch { continue; } // servers may log plain text to stdout
      if (message.id !== undefined && message.method === undefined) {
        const p = this.pending.get(message.id); if (!p) continue;
        clearTimeout(p.timer); this.pending.delete(message.id);
        message.error ? p.reject(new Error(`MCP ${this.config.name}: ${String(message.error.message || message.error.code).slice(0, 300)}`)) : p.resolve(message.result);
      } else if (message.id !== undefined && typeof message.method === 'string') {
        try { this.send({ jsonrpc: '2.0', id: message.id, ...(this.serverRequest(message) as object) }); } catch { /* gone */ }
      }
    }
  }
  protected async open() {
    const { env } = await this.secrets();
    const isWin = process.platform === 'win32', command = this.config.command!, args = this.config.args || [];
    // npx / uvx are .cmd shims on Windows; run them through cmd.exe without building a shell string.
    const [exe, argv] = isWin && !/\.(exe|com)$/i.test(command) ? ['cmd.exe', ['/d', '/s', '/c', command, ...args]] : [command, args];
    const child = spawn(exe, argv, { cwd: this.cwd, env: { ...safeChildEnv(), ...(env || {}) }, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.setEncoding('utf8'); child.stdout.on('data', d => this.receive(d));
    let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
    child.once('error', error => this.stop(error.message));
    child.once('exit', code => { if (this.child === child) this.stop(`MCP 服务退出（${code}）${stderr ? '：' + stderr.trim().slice(-300) : ''}`); });
  }
  protected close() {
    const child = this.child; this.child = undefined; this.buffer = ''; this.fail('MCP 服务已停止');
    if (child && child.exitCode === null) { try { child.stdin.end(); } catch { /* closed */ } if (process.platform === 'win32' && child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill()); else child.kill('SIGTERM'); }
  }
}

/** Streamable HTTP: every JSON-RPC message is a POST; the reply is JSON or an SSE stream carrying it. */
class HttpConnection extends McpConnection {
  readonly transport = 'http' as const;
  private seq = 0; private session?: string; private headers: Record<string, string> = {}; private controllers = new Set<AbortController>();
  constructor(config: McpServerConfig, cwd: string, secrets: () => Promise<McpSecrets>, private doFetch: typeof fetch) { super(config, cwd, secrets); }
  protected async open() { this.headers = (await this.secrets()).headers || {}; this.session = undefined; }
  private async post(body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController(); this.controllers.add(controller);
    const all = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    try {
      const response = await this.doFetch(this.config.url!, { method: 'POST', signal: all, headers: { ...this.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL, ...(this.session ? { 'mcp-session-id': this.session } : {}) }, body: JSON.stringify(body) });
      const sid = response.headers.get('mcp-session-id'); if (sid) this.session = sid;
      return response;
    } finally { this.controllers.delete(controller); }
  }
  protected async notify(method: string, params?: unknown) { const r = await this.post({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }, 30_000); await r.body?.cancel().catch(() => {}); }
  protected async rpc(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<any> {
    const id = ++this.seq;
    const response = await this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs, signal);
    if (response.status === 401 || response.status === 403) { await response.body?.cancel().catch(() => {}); throw new Error(`MCP ${this.config.name}: 需要授权（HTTP ${response.status}），请在“密钥”里填 Authorization 请求头`); }
    if (!response.ok) { const text = await response.text().catch(() => ''); throw new Error(`MCP ${this.config.name}: HTTP ${response.status} ${text.slice(0, 200)}`); }
    const pick = (message: any) => { if (message?.id !== id) return undefined; if (message.error) throw new Error(`MCP ${this.config.name}: ${String(message.error.message || message.error.code).slice(0, 300)}`); return { result: message.result }; };
    if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
      const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader(); let buffer = '', size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.length; if (size > 16_000_000) throw new Error('MCP 输出过大');
          buffer += value.replace(/\r\n/g, '\n');
          for (let end; (end = buffer.indexOf('\n\n')) >= 0;) {
            const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
            if (!data) continue;
            let message: any; try { message = JSON.parse(data); } catch { continue; }
            const hit = pick(message); if (hit) return hit.result;
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
      throw new Error(`MCP ${this.config.name}: 响应流结束但没有结果`);
    }
    const message = await response.json();
    const hit = (Array.isArray(message) ? message : [message]).map(pick).find(Boolean);
    if (!hit) throw new Error(`MCP ${this.config.name}: 响应里没有对应结果`);
    return hit.result;
  }
  protected close() {
    for (const c of this.controllers) c.abort(); this.controllers.clear();
    if (this.session) { void this.doFetch(this.config.url!, { method: 'DELETE', headers: { ...this.headers, 'mcp-session-id': this.session } }).then(r => r.body?.cancel(), () => {}); this.session = undefined; }
  }
}

export type McpHubOptions = { secrets?: (name: string) => Promise<McpSecrets>; fetch?: typeof fetch; onStatus?: () => void };
/** All configured servers; started lazily on the first executor task, restarted when the configuration changes. */
export class McpHub {
  private connections = new Map<string, McpConnection>(); private signature = '';
  constructor(private servers: () => McpServerConfig[], private cwd: () => string, private options: McpHubOptions = {}) {}
  private sync() {
    const wanted = this.servers().filter(s => s.enabled), signature = JSON.stringify([wanted, this.cwd()]);
    if (signature === this.signature) return;
    this.signature = signature;
    for (const c of this.connections.values()) c.stop();
    const secrets = (name: string) => () => this.options.secrets?.(name) ?? Promise.resolve({});
    this.connections = new Map(wanted.map(s => [s.name, s.url ? new HttpConnection(s, this.cwd(), secrets(s.name), this.options.fetch || fetch) : new StdioConnection(s, this.cwd(), secrets(s.name))]));
  }
  /** Starts the enabled servers of the allowed transports that are not running yet; failures go to status, never thrown. */
  async ensure(allow: Record<McpTransportKind, boolean> = { stdio: true, http: true }): Promise<void> {
    this.sync();
    await Promise.all([...this.connections.values()].filter(c => c.state === 'stopped' && allow[c.transport]).map(c => c.start().catch(() => {})));
    this.options.onStatus?.();
  }
  tools(): McpTool[] { this.sync(); return [...this.connections.values()].flatMap(c => c.state === 'ready' ? c.tools : []); }
  find(qualified: string) { return this.tools().find(t => t.qualified === qualified); }
  async call(qualified: string, args: unknown, signal: AbortSignal) {
    const tool = this.find(qualified); if (!tool) throw new Error('Unknown MCP tool: ' + qualified);
    return this.connections.get(tool.server)!.call(tool.name, args, signal);
  }
  status(): McpStatus[] { this.sync(); return [...this.connections.values()].map(c => c.view()); }
  restart() { this.signature = ''; this.sync(); }
  close() { for (const c of this.connections.values()) c.stop(); this.connections.clear(); this.signature = ''; }
}
