// 模型推理和工具调用不限时长（用户 2026-11-06）。代码里的超时都删了，但 Node 自带的 fetch 还藏着两个默认值：
// 响应头 300 秒、响应体 300 秒。不关掉的话，模型想超过 5 分钟照样会断。停下来只靠用户取消。
import { Agent, FormData as UndiciFormData, fetch as undiciFetch } from 'undici';

export const noDeadlineDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
/** Retain native FormData uploads when using the bundled undici client. */
export const noDeadlineFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const body = init?.body;
  if (!(body instanceof FormData)) {
    return undiciFetch(input as never, { dispatcher: noDeadlineDispatcher, ...init } as never);
  }
  const form = new UndiciFormData();
  for (const [name, value] of body) form.append(name, value);
  return undiciFetch(input as never, { dispatcher: noDeadlineDispatcher, ...init, body: form } as never);
}) as unknown as typeof fetch;
export function installNoDeadlineFetch() { globalThis.fetch = noDeadlineFetch; }
