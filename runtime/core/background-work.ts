import type { BackgroundTask } from '../shared/contracts';
import type { Store } from './store';

export type WorkJob = {
  id: string;
  kind: 'index' | 'extract' | 'daily' | 'journal';
  sourceIds: string[];
  state: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  nextAttemptAt: number;
};

type Options = {
  configured(): boolean;
  valid(job: WorkJob): boolean;
  execute(job: WorkJob, signal: AbortSignal): Promise<void>;
  status(task: BackgroundTask): void;
  forget(id: string): void;
};

const MAX_ATTEMPTS = 3;
const FAILED = '重试达到上限；重新保存连接设置后可重试';

function label(job: WorkJob) {
  switch (job.kind) {
    case 'index':
      return '恢复语义索引';
    case 'daily':
      return `整理 ${job.sourceIds[0]} 每日档案`;
    case 'journal':
      return '第一人称日记';
    case 'extract':
      return '记忆与札记';
  }
}

export class BackgroundWorkQueue {
  private tail: Promise<void> = Promise.resolve();
  private scheduled = new Set<string>();
  private active?: { id: string; controller: AbortController };
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    private store: Store,
    private options: Options,
  ) {}

  recover() {
    for (const job of this.store.all<WorkJob>('work-job')) {
      if (job.state === 'running')
        this.save({ ...job, state: job.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' });
    }
  }

  ensure(kind: WorkJob['kind'], sourceIds: string[]) {
    const id = `work:${kind}:${sourceIds[0]}`;
    const existing = this.store.get<WorkJob>(id);
    if (!existing || (kind === 'index' && existing.state === 'done' && !this.store.hasVector(sourceIds[0]))) {
      this.save({ id, kind, sourceIds, state: 'pending', attempts: 0, nextAttemptAt: 0 });
    }
  }

  has(id: string) {
    return this.scheduled.has(id);
  }

  purgeInvalid() {
    for (const job of this.store.all<WorkJob>('work-job')) {
      if (!this.options.valid(job)) this.discard(job);
    }
  }

  private discard(job: WorkJob) {
    if (this.active?.id === job.id) this.active.controller.abort();
    this.store.remove(job.id);
    this.options.forget(job.id);
  }

  private save(job: WorkJob) {
    this.store.put('work-job', job.id, job);
  }

  private eligible(job: WorkJob) {
    return job.kind === 'index' || this.options.configured();
  }

  resume(retryFailed = false) {
    if (this.closed) return;
    for (let job of this.store.all<WorkJob>('work-job')) {
      if (job.state === 'done') continue;
      if (!this.options.valid(job)) {
        this.discard(job);
        continue;
      }
      if (job.state === 'failed') {
        if (!retryFailed) {
          this.report(job, 'failed', FAILED);
          continue;
        }
        job = { ...job, state: 'pending', attempts: 0, nextAttemptAt: 0 };
        this.save(job);
      }
      if (
        job.state !== 'pending' ||
        job.nextAttemptAt > Date.now() ||
        !this.eligible(job) ||
        this.has(job.id)
      )
        continue;
      this.scheduled.add(job.id);
      this.report(job, 'queued');
      this.tail = this.tail.then(() => this.run(job.id));
    }
    this.armTimer();
  }

  // Handlers call this after awaits, before writing results in a single synchronous transaction.
  current(job: WorkJob, signal: AbortSignal) {
    return (
      !this.closed &&
      !signal.aborted &&
      this.store.get<WorkJob>(job.id)?.state === 'running' &&
      this.options.valid(job)
    );
  }

  complete(job: WorkJob) {
    this.save({ ...job, state: 'done', nextAttemptAt: 0 });
  }

  defer(job: WorkJob) {
    this.save({ ...job, state: 'pending', attempts: job.attempts - 1, nextAttemptAt: Date.now() + 5000 });
  }

  private report(job: WorkJob, state: BackgroundTask['state'], detail?: string) {
    if (!this.closed) this.options.status({ id: job.id, label: label(job), state, detail });
  }

  private async run(id: string) {
    try {
      const pending = this.store.get<WorkJob>(id);
      if (
        this.closed ||
        pending?.state !== 'pending' ||
        pending.nextAttemptAt > Date.now() ||
        !this.eligible(pending)
      )
        return;
      if (!this.options.valid(pending)) {
        this.discard(pending);
        return;
      }
      const controller = new AbortController();
      this.active = { id, controller };
      const job: WorkJob = {
        ...pending,
        state: 'running',
        attempts: pending.attempts + 1,
        nextAttemptAt: Date.now() + Math.min(1800000, 60000 * 2 ** pending.attempts),
      };
      this.save(job);
      this.report(job, 'running');
      try {
        await this.options.execute(job, controller.signal);
      } catch {
        const current = this.store.get<WorkJob>(id);
        if (
          current?.state === 'running' &&
          this.options.valid(current) &&
          (!controller.signal.aborted || this.closed)
        ) {
          if (this.closed) this.defer(current);
          else this.save({ ...current, state: current.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' });
        }
      }
      const current = this.store.get<WorkJob>(id);
      if (!current || !this.options.valid(current)) {
        if (current) this.discard(current);
      } else if (current.state === 'done') this.report(current, 'done');
      else
        this.report(
          current,
          current.state === 'failed' ? 'failed' : 'queued',
          current.state === 'failed' ? FAILED : '等待后台任务重试',
        );
    } finally {
      this.active = undefined;
      this.scheduled.delete(id);
      this.armTimer();
    }
  }

  private armTimer() {
    clearTimeout(this.timer);
    if (this.closed) return;
    let next = Infinity;
    for (const job of this.store.all<WorkJob>('work-job')) {
      if (job.state === 'pending' && !this.has(job.id) && this.eligible(job))
        next = Math.min(next, job.nextAttemptAt);
    }
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(() => this.resume(), Math.max(1000, Math.min(1800000, next - Date.now())));
    this.timer.unref();
  }

  stop() {
    this.closed = true;
    clearTimeout(this.timer);
    this.active?.controller.abort();
  }

  async idle() {
    let tail;
    do {
      tail = this.tail;
      await tail;
    } while (tail !== this.tail);
  }
}
