import { apiFailure, rejectedOption } from './api-response';
import { parseModelReply, toChatRequestMessages, type ModelReply } from './tool-protocol';
import type { AppSnapshot, UsageCategory } from '../shared/contracts';
import { endpointUrl, sameOrigin } from '../shared/endpoints';
import { OPENAI_BASE_URL } from '../shared/provider';
import type { ToolCall, ToolDefinition } from './main-tools';
import type { PrivacyGuard } from './privacy';
import type { RequestPool, PoolPriority } from './pool';
import { HELPER_LIMITS } from './helpers';
import { callUpstream } from './upstream';

/** Briefs come back whole: they are already the digest. */
const DELEGATION_RESULT = new Set(['ask_helpers', 'open_brief']);
export type Toolset = {
  defs: ToolDefinition[];
  rounds: number;
  run: (call: ToolCall) => Promise<string>;
  /** Receives the whole conversation once the model has answered. */ done?: (
    messages: TransportMessage[],
  ) => void;
};
export type TransportMessage = { role: string; content?: unknown; [key: string]: unknown };

type Account = 'chat' | 'initiative' | 'background';
type GatewayOptions = {
  provider(): AppSnapshot['provider'];
  getKey(baseUrl: string): Promise<string | undefined>;
  outputLimit(): number;
  pool: RequestPool;
  fetch?: typeof fetch;
  guard: Pick<PrivacyGuard, 'messages'> & Partial<Pick<PrivacyGuard, 'text'>>;
  mainToolset(signal: AbortSignal, priority: PoolPriority): Toolset;
  recordUsage(account: Account, category: UsageCategory, tokens: number): void;
};

export class ModelGateway {
  constructor(private deps: GatewayOptions) {}
  private toolless = new Set<string>();
  private withoutJsonFormat = new Set<string>();
  private tokenField = new Map<string, 'max_tokens' | 'max_completion_tokens'>();
  async request(
    messages: TransportMessage[],
    signal: AbortSignal,
    account: Account = 'background',
    capture?: (message: TransportMessage) => void,
    priorityOverride?: PoolPriority,
    tools: boolean | Toolset = false,
    category?: UsageCategory,
    beforeSend?: () => void,
  ): Promise<unknown> {
    const provider = { ...this.deps.provider() };
    if (!provider.configured) throw new Error('尚未配置模型 API Key，请先打开「连接」设置');
    const key = await this.deps.getKey(provider.baseUrl);
    if (!key) throw new Error('尚未配置模型 API Key，请先打开「连接」设置');
    const checkConnection = () => {
      signal.throwIfAborted();
      const current = this.deps.provider();
      if (provider.baseUrl !== current.baseUrl || provider.model !== current.model) {
        throw new Error('模型配置已更新，请重新请求');
      }
    };
    checkConnection();
    const out = this.deps.outputLimit();
    const priority: PoolPriority =
      priorityOverride ||
      (account === 'chat' ? 'chat' : account === 'initiative' ? 'attention' : 'background');
    const url = endpointUrl('chat', provider.baseUrl);
    const endpoint = url + '|' + provider.model;
    const convo: TransportMessage[] = [...messages];
    const toolset: Toolset | undefined =
      tools === true ? this.deps.mainToolset(signal, priority) : tools || undefined;
    // Main-character tool rounds can handle reminders and delegate lookups before the final JSON reply.
    for (let round = 0; ; round++) {
      const tokenField = this.tokenField.get(endpoint) || (sameOrigin(url, OPENAI_BASE_URL) ? 'max_completion_tokens' : 'max_tokens');
      const offerTools = !!toolset?.defs.length && !this.toolless.has(endpoint) && round < toolset.rounds;
      const { response, release } = await callUpstream({
        fetch: this.deps.fetch || fetch,
        url,
        init: () => ({
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: provider.model,
            messages: toChatRequestMessages(this.deps.guard.messages(convo, account), sameOrigin(url, OPENAI_BASE_URL)),
            ...(!this.withoutJsonFormat.has(endpoint) ? { response_format: { type: 'json_object' } } : {}),
            [tokenField]: out,
            ...(offerTools ? { tools: toolset!.defs, tool_choice: 'auto' } : {}),
          }),
        }),
        pool: this.deps.pool,
        priority,
        signal,
        attempts: account === 'background' ? 4 : 3,
        before: () => { checkConnection(); beforeSend?.(); },
      });
      let reply: ModelReply;
      try {
        if (!response.ok) {
          const failure = await apiFailure(
            response,
            signal,
            key,
            (text) => this.deps.guard.text?.(text, 'api-error') ?? text,
          );
          if (response.status === 400 || response.status === 422) {
            if (
              !this.tokenField.has(endpoint) &&
              rejectedOption(failure.unsupported, tokenField)
            ) {
              this.tokenField.set(
                endpoint,
                tokenField === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens',
              );
              round--;
              continue;
            }
            if (
              !this.withoutJsonFormat.has(endpoint) &&
              (/response_format|json_object/i.test(failure.unsupported) ||
                (/json.?mode/i.test(failure.unsupported) && !/tools|function/i.test(failure.unsupported)))
            ) {
              this.withoutJsonFormat.add(endpoint);
              round--;
              continue;
            }
            if (
              offerTools &&
              /tools|tool_choice|function.?call/i.test(failure.unsupported) &&
              /not support|unsupported|not allowed|not available|unavailable|unknown (field|parameter)|unrecognized|not implemented|不支持/i.test(failure.unsupported)
            ) {
              this.toolless.add(endpoint);
              round--;
              continue;
            }
          }
          throw failure.error;
        }
        reply = await parseModelReply(response, signal, true);
      } finally {
        release();
      }
      checkConnection();
      this.deps.recordUsage(
        account,
        category || (account === 'chat' ? 'chat' : account === 'initiative' ? 'proactive' : 'upkeep'),
        reply.usage,
      );
      const raw = reply.message;
      if (raw.tool_calls?.length) {
        if (!offerTools || !toolset) throw new Error('接口返回了本轮未开放的工具调用');
        for (const call of raw.tool_calls) {
          let args: unknown;
          try { args = JSON.parse(call.function.arguments); } catch { /* handled below */ }
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数不是完整的 JSON 对象');
        }
        convo.push(raw);
        const allowed = new Set(toolset.defs.map(def => def.function.name));
        for (const [index, call] of raw.tool_calls.entries()) {
          checkConnection();
          let content: string;
          if (index >= 8) content = JSON.stringify({ error: '本轮最多执行 8 个工具，未执行此项' });
          else if (!allowed.has(call.function.name)) content = JSON.stringify({ error: '本轮未开放此工具' });
          else {
            try { content = await toolset.run(call); }
            catch (error) { content = JSON.stringify({ error: error instanceof Error ? error.message : String(error) }); }
          }
          if (content.length > HELPER_LIMITS.toolOutput && !DELEGATION_RESULT.has(call.function.name)) {
            content = content.slice(0, HELPER_LIMITS.toolOutput) + '…（截断）';
          }
          convo.push({ role: 'tool', tool_call_id: call.id, content });
        }
        continue;
      }
      let output: unknown;
      try {
        output = JSON.parse((raw.content as string).trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1'));
      } catch {
        throw new Error('模型返回的结构无效');
      }
      // Preserve content, reasoning_content, signatures and opaque fields exactly as returned. Visible text is parsed separately.
      capture?.(structuredClone({ ...raw, role: raw.role || 'assistant' }));
      toolset?.done?.([...convo, structuredClone({ ...raw, role: raw.role || 'assistant' })]);
      return output;
    }
  }
}
