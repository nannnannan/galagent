import type { AppSnapshot, TaskRunDetail, TaskRunView } from '../shared/contracts';
import type { Store } from './store';

const TASK_HISTORY_MAX = 100;
/** Light list row for the snapshot; the full record is fetched with agent.task. */
const taskView = (r: TaskRunDetail): TaskRunView => ({
  id: r.id,
  task: r.task.slice(0, 160),
  status: r.status,
  startedAt: r.startedAt,
  completedAt: r.completedAt,
  durationMs: r.durationMs,
  toolCount: r.toolCount,
  changedFiles: r.files.length,
  undoable: !!r.runId && r.files.length > 0 && !r.undone,
  ...(r.undone ? { undone: true } : {}),
});
/** Tool calls by name ("Read: a.ts" → Read), so the record keeps what was done without any tool output. */
export const toolCounts = (tools: { title: string }[]) => {
  const out: Record<string, number> = {};
  for (const t of tools) {
    const name = (t.title || '').split(/[\s:：(（]/)[0].slice(0, 40) || '其他';
    out[name] = (out[name] || 0) + 1;
  }
  return out;
};

export class TaskHistory {
  private records: TaskRunDetail[] = [];
  constructor(private store: Store) {}

  load() {
    this.records = this.store
      .all<TaskRunDetail>('task-run')
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      .slice(0, TASK_HISTORY_MAX);
  }
  view() {
    return this.records.slice(0, 40).map(taskView);
  }
  recent(limit: number) {
    return this.records.slice(0, limit);
  }
  get(id: string) {
    return this.records.find((r) => r.id === id);
  }
  clear() {
    this.store.transaction(() => {
      for (const record of this.store.all<TaskRunDetail>('task-run'))
        this.store.remove('task-run:' + record.id);
    });
    this.records = [];
  }
  record(r: {
    id: string;
    task: string;
    cwd: string;
    startedAt: string;
    result: NonNullable<NonNullable<AppSnapshot['agent']>['lastResult']>;
    tools: Record<string, number>;
    files: string[];
  }) {
    const done = Date.parse(r.result.completedAt),
      start = Date.parse(r.startedAt);
    const rec: TaskRunDetail = {
      id: r.id,
      task: r.task.slice(0, 4000),
      cwd: r.cwd,
      status: r.result.status,
      summary: r.result.summary.slice(0, 8000),
      startedAt: r.startedAt,
      completedAt: r.result.completedAt,
      durationMs: Number.isFinite(done - start) ? Math.max(0, done - start) : 0,
      toolCount: r.result.toolCount,
      changedFiles: r.files.length,
      undoable: !!r.result.runId && r.files.length > 0,
      tools: r.tools,
      files: r.files,
      ...(r.result.runId ? { runId: r.result.runId } : {}),
    };
    this.store.put('task-run', 'task-run:' + rec.id, rec);
    this.records = [rec, ...this.records];
    this.records = this.records.slice(0, TASK_HISTORY_MAX);
  }
  markUndone(u: { runId: string; restored: string[]; conflicts: string[]; skipped: string[] }) {
    const rec = this.records.find((h) => h.runId === u.runId);
    if (!rec) return;
    rec.undone = true;
    rec.undoable = false;
    rec.undo = {
      at: new Date(Date.now()).toISOString(),
      restored: u.restored.length,
      conflicts: u.conflicts.slice(0, 50),
      skipped: u.skipped.length,
    };
    this.store.put('task-run', 'task-run:' + rec.id, rec);
  }
}
