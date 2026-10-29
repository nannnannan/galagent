// One place for every chat-completions call: pool slot, retry policy and backoff.
// A slot is held only while a request is actually in flight (including reading its
// body); backoff waits happen with the slot released so retries never pin capacity.
import { abortableDelay, type PoolPriority, type RequestPool } from './pool';

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
export type UpstreamCall = {
  fetch: typeof fetch;
  url: string;
  init: RequestInit;
  pool?: RequestPool;
  priority: PoolPriority;
  signal: AbortSignal;
  /** Total attempts including the first; default 4. */
  attempts?: number;
  /** Per-attempt timeout; streaming callers pass a larger one. */
  timeoutMs?: number;
  /** Last check right before each send (e.g. the provider was not switched while queued); throwing aborts. */
  before?: () => void;
};
/** Seconds or HTTP-date, capped so a hostile header cannot park a request for hours. */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(60_000, Math.max(0, seconds * 1000));
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(60_000, Math.max(0, at - now)) : undefined;
}
export const backoffMs = (attempt: number, random = Math.random) => Math.min(8000, 600 * 2 ** attempt) * (0.75 + random() * 0.5);

/**
 * Sends the request and hands back the response together with its slot release.
 * The caller MUST call `release()` once it has consumed the body (or given up).
 * Network errors and retryable statuses are retried; 429 also tightens the pool.
 */
export async function callUpstream(call: UpstreamCall): Promise<{ response: Response; release: () => void }> {
  const attempts = Math.max(1, call.attempts ?? 4);
  for (let attempt = 0; ; attempt++) {
    if (call.signal.aborted) throw new Error('已取消');
    const release = call.pool ? await call.pool.acquire(call.priority, call.signal) : () => {};
    let response: Response;
    try { call.before?.(); } catch (error) { release(); throw error; }
    try {
      response = await call.fetch(call.url, { ...call.init, signal: AbortSignal.any([call.signal, AbortSignal.timeout(call.timeoutMs ?? 120_000)]) });
    } catch (error) {
      release();
      if (call.signal.aborted || attempt + 1 >= attempts) throw error;
      await abortableDelay(backoffMs(attempt), call.signal);
      continue;
    }
    if (response.status === 429) call.pool?.penalize();
    if (RETRYABLE.has(response.status) && attempt + 1 < attempts) {
      const wait = retryAfterMs(response.headers.get('retry-after')) ?? backoffMs(attempt);
      await response.body?.cancel().catch(() => {});
      release();
      await abortableDelay(wait, call.signal);
      continue;
    }
    return { response, release };
  }
}
