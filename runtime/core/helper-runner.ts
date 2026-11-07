import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { PrivacyGuard } from './privacy';
import { abortable, type PoolPriority } from './pool';
import type { ModelGateway, Toolset, TransportMessage } from './model-gateway';
import { mainToolDefinitions, runMainTool, type MainToolDeps } from './main-tools';
import {
  briefForMain,
  contextBriefs,
  HELPER_LIMITS,
  HELPER_PROMPT,
  helperTools,
  parseBrief,
  TAINT_ERROR,
  taintFor,
  trimSession,
  urlsIn,
  type Brief,
  type HelperSession,
  type Taint,
} from './helpers';

export type ResearchMcpTools = {
  defs: Toolset['defs'];
  run(call: Parameters<Toolset['run']>[0]): Promise<{ content: string; sources: string[] }>;
};
export type HelperOptions = {
  /** A research-only helper: MCP data never shares a tool context with web/private lookups. */
  mcp?: ResearchMcpTools;
  web?: MainToolDeps['web'];
  tools?: string[];
  rounds?: number;
  by?: Brief['by'];
  context?: Record<string, unknown>;
  continueFrom?: string;
};
export class HelperRunner {
  constructor(
    private store: Store,
    private guard: PrivacyGuard,
    private gateway: ModelGateway,
    private contextWindow: () => number,
    private networkAllowed: () => boolean,
    private tools: (signal: AbortSignal) => MainToolDeps,
  ) {}
  context(now: number) {
    return contextBriefs(
      this.briefs.filter((b) => b.by === 'helper'),
      now,
    );
  }
  taskGist(id: string) {
    return this.briefs.find((b) => b.refId === id)?.gist;
  }
  purgeDeleted(gone: string[]) {
    if (gone.length) {
      for (const s of this.store.all<HelperSession>('helper-session')) {
        const body = JSON.stringify(s);
        if (gone.some((t) => body.includes(JSON.stringify(t).slice(1, -1))))
          this.store.remove('helper-session:' + s.id);
      }
      for (const b of this.store.all<Brief>('brief'))
        if (gone.some((t) => `${b.goal}\n${b.gist}\n${b.points.join('\n')}`.includes(t))) {
          this.store.remove('brief:' + b.id);
          this.briefs = this.briefs.filter((x) => x.id !== b.id);
        }
    }
  }
  load() {
    // Briefs are kept for good, one record each (an older build kept a bounded list in one state row: move it over).
    const legacy = this.store.get<Brief[]>('briefs');
    if (Array.isArray(legacy)) {
      for (const b of legacy)
        if (b?.id && typeof b.gist === 'string') this.store.put('brief', 'brief:' + b.id, b);
      this.store.remove('briefs');
    }
    this.briefs = this.store
      .all<Brief>('brief')
      .filter((b) => b && typeof b.gist === 'string')
      .sort((a, b) => a.at - b.at)
      .slice(-200);
  }
  private briefs: Brief[] = [];
  /** Every brief is kept permanently on this machine; the in-memory list is just the recent ones for the working set. */
  saveBrief(b: Brief) {
    this.store.put('brief', 'brief:' + b.id, b);
    this.briefs = [...this.briefs.filter((x) => x.id !== b.id), b].slice(-200);
    return b;
  }
  openBrief(id: string) {
    id = id.replace(/^brief:/, '');
    const b = this.briefs.find((x) => x.id === id) || this.store.get<Brief>('brief:' + id);
    return b ? { ...briefForMain(b), by: b.by, at: new Date(b.at).toISOString() } : undefined;
  }
  private helperQueue = new Map<string, Promise<unknown>>();
  /** Whichever session a follow-up names (or a brief from before sessions existed, handed over as context). */
  private helperResume(continueFrom?: string): { session?: HelperSession; previous?: Brief } {
    if (!continueFrom) return {};
    const previous = this.store.get<Brief>('brief:' + continueFrom.replace(/^brief:/, ''));
    return {
      previous,
      session: previous?.session
        ? this.store.get<HelperSession>('helper-session:' + previous.session)
        : undefined,
    };
  }
  /** Sessions are stored redacted (content, tool-call arguments and reasoning), so a key that came through a tool never lands in SQLite. */
  private saveHelperSession(session: HelperSession) {
    const t = (v: string) => this.guard.text(v, 'helper-session');
    const messages = this.guard.messages(session.messages, 'helper-session').map((m) => {
      const out: HelperSession['messages'][number] = { ...m };
      if (typeof out.reasoning_content === 'string') out.reasoning_content = t(out.reasoning_content);
      if (Array.isArray(out.tool_calls))
        out.tool_calls = (out.tool_calls as { function?: { arguments?: unknown } }[]).map((c) =>
          c?.function && typeof c.function.arguments === 'string'
            ? { ...c, function: { ...c.function, arguments: t(c.function.arguments) } }
            : c,
        );
      return out;
    });
    const clean: HelperSession = { ...session, goal: t(session.goal), seen: session.seen.map(t), messages };
    this.store.put('helper-session', 'helper-session:' + session.id, clean);
  }
  /** One helper: its own context, its own tool rounds; returns a brief whose sources are only URLs it really saw. */
  async run(
    goal: string,
    signal: AbortSignal,
    priority: PoolPriority = 'background',
    options: HelperOptions = {},
  ): Promise<Brief> {
    const resume = this.helperResume(options.continueFrom),
      key = resume.session?.id;
    if (!key) return this.helperTurn(goal, signal, priority, options, resume);
    // Two follow-ups to one helper take turns, so neither is lost when the session is saved.
    const prev = this.helperQueue.get(key) || Promise.resolve();
    const run = abortable(
      prev.catch(() => {}),
      signal,
    ).then(() => this.helperTurn(goal, signal, priority, options, this.helperResume(options.continueFrom)));
    this.helperQueue.set(key, run);
    return run.finally(() => {
      if (this.helperQueue.get(key) === run) this.helperQueue.delete(key);
    });
  }
  private async helperTurn(
    goal: string,
    signal: AbortSignal,
    priority: PoolPriority,
    options: HelperOptions,
    resume: { session?: HelperSession; previous?: Brief },
  ): Promise<Brief> {
    if (signal.aborted) throw new Error('已取消');
    const seen = new Set<string>([
        ...(resume.session?.seen || []),
        ...(resume.previous?.sources.map((s) => s.url) || []),
      ]),
      sessionId = resume.session?.id || randomUUID();
    let taint: Taint | undefined =
        resume.session?.taint ??
        resume.previous?.taint ??
        (resume.previous?.by === 'executor'
          ? 'private'
          : resume.previous?.by === 'research' || resume.previous?.sources.length
            ? 'web'
            : undefined),
      transcript: HelperSession['messages'] | undefined;
    const openedPages = new Set<string>();
    let researchToolError: string | undefined;
    const deps = this.tools(signal);
    if (options.web) deps.web = options.web;
    const researchMcp = options.by === 'research' ? options.mcp : undefined;
    const toolset: Toolset = {
      defs: researchMcp?.defs || helperTools(mainToolDefinitions, this.networkAllowed(), options.tools, !!deps.local),
      rounds: options.rounds ?? HELPER_LIMITS.rounds,
      done: (messages) => {
        transcript = messages as HelperSession['messages'];
      },
      run: async (call) => {
        if (researchMcp) {
          if (!researchMcp.defs.some(t => t.function.name === call.function.name)) throw new Error('这个工具没有授权给主动研究');
          taint = 'private';
          const result = await researchMcp.run(call);
          const output = JSON.parse(result.content);
          if (output.isError) researchToolError = 'MCP 查询失败';
          for (const source of result.sources) { openedPages.add(source); seen.add(source); }
          return result.content;
        }
        const want = taintFor(call.function.name);
        if (want && taint && want !== taint) return JSON.stringify({ error: TAINT_ERROR[taint] });
        taint = want || taint;
        const out = await runMainTool(call, deps);
        if (options.by === 'research') {
          try { const result = JSON.parse(out); if (typeof result.error === 'string') researchToolError = result.error; } catch { /* a non-JSON tool result is handled by the model */ }
        }
        if (options.by === 'research' && call.function.name === 'read_webpage') {
          const page = JSON.parse(out);
          if (typeof page.url === 'string' && typeof page.text === 'string' && page.text.trim()) openedPages.add(page.url);
        }
        for (const u of urlsIn(out)) seen.add(u);
        return out;
      },
    };
    const now = Date.now(),
      time = {
        now: new Date(now).toISOString(),
        localTime: new Date(now).toLocaleString('zh-CN', { hour12: false, weekday: 'short' }),
      };
    const prior = resume.session
      ? trimSession(resume.session.messages, Math.floor(this.contextWindow() * 0.8))
      : undefined;
    const messages = (
      prior
        ? [...prior, { role: 'user', content: JSON.stringify({ followUp: goal, ...time }) }]
        : [
            { role: 'system', content: HELPER_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                goal,
                ...time,
                ...(resume.previous
                  ? {
                      earlier: {
                        goal: resume.previous.goal,
                        gist: resume.previous.gist,
                        points: resume.previous.points,
                      },
                    }
                  : {}),
                ...(options.context || {}),
              }),
            },
          ]
    ) as TransportMessage[];
    try {
      const raw = await this.gateway.request(
        messages,
        signal,
        'background',
        undefined,
        priority,
        toolset,
        options.by === 'research' ? 'research' : 'helper',
      );
      const brief = parseBrief(raw, goal, options.by === 'research' ? openedPages : seen, randomUUID(), Date.now(), options.by || 'helper');
      if (options.by === 'research' && !openedPages.size && researchToolError) brief.gist = '没查成：' + this.guard.text(researchToolError, 'research-error').slice(0, 120);
      if (taint) brief.taint = taint;
      if (transcript) {
        this.saveHelperSession({
          id: sessionId,
          goal: resume.session?.goal || goal,
          seen: [...seen],
          ...(taint ? { taint } : {}),
          messages: transcript,
          updatedAt: Date.now(),
        });
        brief.session = sessionId;
      }
      return this.saveBrief(brief);
    } catch (e) {
      if (signal.aborted) throw e;
      return this.saveBrief({
        id: randomUUID(),
        by: options.by || 'helper',
        goal: goal.slice(0, 200),
        gist: `没查成：${e instanceof Error ? e.message.slice(0, 120) : '出错了'}`,
        points: [],
        sources: [],
        at: Date.now(),
        ...(taint ? { taint } : {}),
      });
    }
  }
}
