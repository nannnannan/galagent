import { apiFailure, responseText } from './api-response';
import { parseModelReply } from './tool-protocol';
import type { AppSnapshot, UsageCategory } from '../shared/contracts';
import { isKimiK3Model } from '../shared/provider';
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
  getKey(): Promise<string | undefined>;
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
  ): Promise<unknown> {
    const provider = { ...this.deps.provider() };
    const key = await this.deps.getKey();
    if (!key) throw new Error('尚未配置模型 API Key，请先打开「连接」设置');
    const current = this.deps.provider();
    if (
      provider.baseUrl !== current.baseUrl ||
      provider.model !== current.model ||
      provider.mode !== current.mode
    )
      throw new Error('模型配置已更新，请重新请求');
    const k3 = provider.mode !== 'native-api' && isKimiK3Model(provider.model);
    const out = this.deps.outputLimit();
    const priority: PoolPriority =
      priorityOverride ||
      (account === 'chat' ? 'chat' : account === 'initiative' ? 'attention' : 'background');
    const endpoint = provider.baseUrl + '|' + provider.model;
    const convo: TransportMessage[] = [...messages];
    const toolset: Toolset | undefined =
      tools === true ? this.deps.mainToolset(signal, priority) : tools || undefined;
    type Reply = {
      choices?: {
        finish_reason?: string;
        message?: { role?: string; content?: string | null; tool_calls?: ToolCall[]; [key: string]: unknown };
      }[];
      usage?: { total_tokens?: number };
    };
    // Main-character tool rounds: the model may set or inspect wake-ups and recall a past day, then must answer with the JSON reply.
    for (let round = 0; ; round++) {
      const tokenField = this.tokenField.get(endpoint) || (k3 ? 'max_completion_tokens' : 'max_tokens');
      const offerTools = !!toolset && !this.toolless.has(endpoint) && round < toolset.rounds;
      const body = JSON.stringify({
        model: provider.model,
        messages: this.deps.guard.messages(convo, account === 'background' ? 'background' : account),
        ...(!this.withoutJsonFormat.has(endpoint) ? { response_format: { type: 'json_object' } } : {}),
        [tokenField]: out,
        ...(k3 ? { reasoning_effort: 'low' } : {}),
        ...(offerTools ? { tools: toolset!.defs, tool_choice: 'auto' } : {}),
      });
      const { response, release } = await callUpstream({
        fetch: this.deps.fetch || fetch,
        url: provider.baseUrl + '/chat/completions',
        init: {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body,
        },
        pool: this.deps.pool,
        priority,
        signal,
        attempts: account === 'background' ? 4 : 3,
        before: () => {
          const selected = this.deps.provider();
          if (
            selected.baseUrl !== provider.baseUrl ||
            selected.model !== provider.model ||
            selected.mode !== provider.mode
          )
            throw new Error('模型配置已更新，请重新请求');
        },
      });
      let data!: Reply;
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
              failure.unsupported.includes(tokenField) &&
              /not support|unsupported|unknown|unrecognized|use.{0,50}instead/i.test(failure.unsupported)
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
              (/tools|tool_choice|function.?call/i.test(failure.unsupported) || !failure.unsupported.trim())
            ) {
              this.toolless.add(endpoint);
              round--;
              continue;
            }
          }
          throw failure.error;
        }
        if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
          const streamed = await parseModelReply(response, signal);
          data = {
            choices: [
              {
                message: streamed.message as NonNullable<NonNullable<Reply['choices']>[number]['message']>,
                finish_reason: streamed.finishReason,
              },
            ],
            usage: { total_tokens: streamed.usage },
          };
        } else {
          const raw = await responseText(response, signal);
          try {
            data = JSON.parse(raw) as Reply;
          } catch {
            throw new Error('接口返回了无效 JSON，请检查 API 地址和兼容协议');
          }
        }
      } finally {
        release();
      }
      signal.throwIfAborted();
      const reported = Number(data.usage?.total_tokens);
      const usage = Number.isFinite(reported) ? Math.max(0, reported) : 0;
      this.deps.recordUsage(
        account,
        category || (account === 'chat' ? 'chat' : account === 'initiative' ? 'proactive' : 'upkeep'),
        usage,
      );
      const raw = data.choices?.[0]?.message;
      if (offerTools && raw?.tool_calls?.length) {
        // Keep the assistant turn verbatim (reasoning fields included) so thinking models can continue the chain.
        convo.push(structuredClone({ ...raw, role: 'assistant' }) as TransportMessage);
        // Calls of one round run side by side; each result is bounded so no single tool can flood the window.
        const calls = raw.tool_calls.slice(0, 8),
          results = await Promise.all(
            calls.map((call) =>
              toolset!
                .run(call)
                .catch((e) => JSON.stringify({ error: e instanceof Error ? e.message : String(e) })),
            ),
          );
        calls.forEach((call, i) =>
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content:
              results[i].length > HELPER_LIMITS.toolOutput && !DELEGATION_RESULT.has(call.function.name)
                ? results[i].slice(0, HELPER_LIMITS.toolOutput) + '…（截断）'
                : results[i],
          }),
        );
        continue;
      }
      if (data.choices?.[0]?.finish_reason === 'length')
        throw new Error('模型输出被截断：思考或回答达到输出预算，请缩短问题或调整模型输出预算');
      if (!raw || typeof raw.content !== 'string' || !raw.content)
        throw new Error('模型未返回可见回答：输出预算可能被思考耗尽，请调整输出预算后重试');
      if (raw.role !== undefined && raw.role !== 'assistant') throw new Error('模型消息角色无效');
      let output: unknown;
      try {
        output = JSON.parse(raw.content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1'));
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
