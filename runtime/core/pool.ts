// Global K3 request pool (DUAL-CORE DC1). Every model request — main dialogue,
// attention, execution, memory extraction and journal — must hold a slot.
// 20 is a ceiling, not a quota: idle slots simply stay unused. Requests beyond
// the ceiling wait in a priority queue instead of failing.
export type PoolPriority = 'chat' | 'attention' | 'execution' | 'background';
export const POOL_LIMIT = 20;
const rank: Record<PoolPriority, number> = { chat: 0, attention: 1, execution: 2, background: 3 };
type Waiter = { priority: PoolPriority; seq: number; wake: () => void; abort: () => void };
export type PoolStats = { limit: number; effectiveLimit: number; inflight: number; queued: number; peak: number; byPriority: Record<PoolPriority, number>; throttledUntil: number };

export class RequestPool {
    private inflight = 0;
    private peak = 0;
    private seq = 0;
    private waiters: Waiter[] = [];
    private active: Record<PoolPriority, number> = { chat: 0, attention: 0, execution: 0, background: 0 };
    private penalty = 0;
    private throttledUntil = 0;
    private closed = false;
    constructor(readonly limit = POOL_LIMIT, private clock: () => number = () => Date.now()) {
        if (!Number.isInteger(limit) || limit < 1 || limit > POOL_LIMIT) throw new Error(`并发上限必须在 1 至 ${POOL_LIMIT} 之间`);
    }
    /** Upstream throttling halves the usable ceiling for a minute; never below one slot. */
    effectiveLimit(now = this.clock()): number {
        if (now >= this.throttledUntil) this.penalty = 0;
        return Math.max(1, this.limit >> this.penalty);
    }
    penalize(durationMs = 60000) {
        this.penalty = Math.min(4, this.penalty + 1);
        this.throttledUntil = this.clock() + durationMs;
    }
    stats(): PoolStats { return { limit: this.limit, effectiveLimit: this.effectiveLimit(), inflight: this.inflight, queued: this.waiters.length, peak: this.peak, byPriority: { ...this.active }, throttledUntil: this.throttledUntil }; }
    async acquire(priority: PoolPriority, signal?: AbortSignal): Promise<() => void> {
        if (this.closed) throw new Error('并发池已关闭');
        if (signal?.aborted) throw new Error('已取消');
        // Even with free capacity, a higher-priority waiter goes first.
        if (this.inflight >= this.effectiveLimit() || this.waiters.some(w => rank[w.priority] <= rank[priority])) {
            await new Promise<void>((resolve, reject) => {
                const waiter: Waiter = {
                    priority, seq: ++this.seq,
                    wake: () => { signal?.removeEventListener('abort', onAbort); resolve(); },
                    abort: () => { signal?.removeEventListener('abort', onAbort); reject(new Error(this.closed ? '并发池已关闭' : '已取消')); },
                };
                const onAbort = () => { const i = this.waiters.indexOf(waiter); if (i >= 0) this.waiters.splice(i, 1); waiter.abort(); this.drain(); };
                signal?.addEventListener('abort', onAbort, { once: true });
                this.waiters.push(waiter);
                this.waiters.sort((a, b) => rank[a.priority] - rank[b.priority] || a.seq - b.seq);
                this.drain();
            });
        } else this.take(priority);
        let released = false;
        return () => { if (released) return; released = true; this.inflight--; this.active[priority]--; this.drain(); };
    }
    private take(priority: PoolPriority) { this.inflight++; this.active[priority]++; this.peak = Math.max(this.peak, this.inflight); }
    private drain() {
        while (this.waiters.length && this.inflight < this.effectiveLimit()) {
            const next = this.waiters.shift()!;
            this.take(next.priority);
            next.wake();
        }
        // A throttle window may expire with waiters still queued.
        if (this.waiters.length && this.penalty && !this.drainTimer) {
            this.drainTimer = setTimeout(() => { this.drainTimer = undefined; this.drain(); }, Math.max(50, this.throttledUntil - this.clock()));
            this.drainTimer.unref?.();
        }
    }
    private drainTimer?: ReturnType<typeof setTimeout>;
    async run<T>(priority: PoolPriority, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        const release = await this.acquire(priority, signal);
        try { return await fn(); } finally { release(); }
    }
    close() { this.closed = true; if (this.drainTimer) clearTimeout(this.drainTimer); for (const waiter of this.waiters.splice(0)) waiter.abort(); }
}
