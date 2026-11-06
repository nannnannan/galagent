// 模型推理和工具调用不限时长（用户 2026-11-06）。代码里的超时都删了，但 Node 自带的 fetch 还藏着两个默认值：
// 响应头 300 秒、响应体 300 秒。不关掉的话，模型想超过 5 分钟照样会断。停下来只靠用户取消。
import { Agent, fetch as undiciFetch } from 'undici';

export const noDeadlineDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
/** The same fetch everything already calls, without undici's default deadlines. */
export const noDeadlineFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => undiciFetch(input as never, { dispatcher: noDeadlineDispatcher, ...init } as never)) as unknown as typeof fetch;
export function installNoDeadlineFetch() { globalThis.fetch = noDeadlineFetch; }
