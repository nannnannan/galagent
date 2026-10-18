import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
export type EmbeddingState = 'idle' | 'loading' | 'ready' | 'fallback';
export type EmbeddingOptions = { idleMs?: number; threads?: number; onState?: (state: EmbeddingState) => void };
export class Embeddings {
    worker?: Worker;
    pending = new Map<string, { resolve: (v: number[]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    private idleTimer?: ReturnType<typeof setTimeout>;
    private closed = false;
    private retiring = new Set<Promise<void>>();
    state: EmbeddingState = 'idle';
    constructor(private cacheDir: string, private modelPath?: string, private workerPath = join(process.cwd(), 'runtime/workers/embedding.mjs'), private options: EmbeddingOptions = {}) {}
    private transition(state: EmbeddingState) { this.state = state; this.options.onState?.(state); }
    private clearIdle() { if (this.idleTimer) clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    private retire(worker: Worker, error?: Error) {
        if (this.worker !== worker) return;
        this.clearIdle(); this.worker = undefined;
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error || new Error('Embedding worker disposed')); }
        this.pending.clear(); this.transition(error ? 'fallback' : 'idle');
        if (worker.threadId === -1) return;
        const disposal = new Promise<void>(resolve => {
            let done = false;
            const finish = () => { if (done) return; done = true; clearTimeout(timer); void worker.terminate().then(() => resolve(), () => resolve()); };
            const timer = setTimeout(finish, 1500);
            worker.on('message', data => { if (data.op === 'disposed') finish(); });
            worker.once('exit', finish);
            try { worker.postMessage({op:'dispose'}); } catch { finish(); }
        });
        this.retiring.add(disposal); void disposal.finally(() => this.retiring.delete(disposal));
    }
    private scheduleIdle() {
        if (this.pending.size || !this.worker || this.closed) return;
        this.clearIdle(); const worker = this.worker;
        this.idleTimer = setTimeout(() => { if (!this.pending.size) this.retire(worker); }, Math.max(1, this.options.idleMs ?? 45000));
        this.idleTimer.unref();
    }
    async encode(text: string, query = false): Promise<number[]> {
        if (this.closed) throw new Error('Embedding service closed');
        this.clearIdle();
        if (!this.worker) {
            this.transition('loading');
            const worker = new Worker(this.workerPath, { workerData: { cacheDir: this.cacheDir, modelPath: this.modelPath, threads: Math.min(4, Math.max(1, this.options.threads ?? 2)) } });
            this.worker = worker;
            worker.on('message', data => {
                if (this.worker !== worker) return;
                const pending = this.pending.get(data.id); if (!pending) return;
                clearTimeout(pending.timer); this.pending.delete(data.id);
                if (data.error) { pending.reject(new Error(data.error)); this.retire(worker, new Error(data.error)); }
                else if (!Array.isArray(data.values) || !data.values.length || data.values.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v))) { pending.reject(new Error('Invalid embedding')); this.retire(worker, new Error('Invalid embedding')); }
                else { this.transition('ready'); pending.resolve(data.values); this.scheduleIdle(); }
            });
            worker.on('error', error => this.retire(worker, error));
            worker.on('exit', code => { if (this.worker === worker) this.retire(worker, new Error(`Embedding worker exited (${code})`)); });
        }
        return new Promise((resolve, reject) => {
            const id = randomUUID(), worker = this.worker!;
            const timer = setTimeout(() => { this.retire(worker, new Error('Embedding timeout')); }, 180000);
            this.pending.set(id, { resolve, reject, timer });
            worker.postMessage({ id, text: text.slice(0, 3000), query });
        });
    }
    async close() { this.closed = true; this.clearIdle(); const worker = this.worker; if (worker) this.retire(worker); await Promise.all(this.retiring); }
}
