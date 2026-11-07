import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { safeChildEnv } from './safe-env';
import { boundedMiddle as bounded } from './agent-kit';
import type { HostSession, HostTask } from './tool-host';

export const active = (task: HostTask) => ['queued', 'running'].includes(task.status);
export class TaskSupervisor {
  readonly tasks = new Map<string, HostTask>();
  stopped = false;
  private controllers = new Map<string, AbortController>();
  private processes = new Map<string, ChildProcess>();

  constructor(
    private sessions: Map<string, HostSession>,
    private clock: () => number,
    private saveTask: (task: HostTask) => void,
    private policyVersion: () => number,
    tasks: HostTask[],
  ) {
    for (const task of tasks) {
      if (active(task)) {
        task.status = 'lost';
        task.output = 'Previous process ended; side effects may exist. Do not replay automatically.';
      }
      this.tasks.set(task.id, task);
      this.saveTask(task);
    }
  }

  attach(task: HostTask, controller: AbortController) {
    this.controllers.set(task.id, controller);
  }
  release(task: HostTask) {
    this.controllers.delete(task.id);
  }
  newTask(session: HostSession, kind: HostTask['kind'], description: string) {
    const task: HostTask = {
      id: randomUUID(),
      owner: session.id,
      kind,
      description,
      status: 'queued',
      output: '',
      createdAt: this.clock(),
    };
    this.tasks.set(task.id, task);
    this.saveTask(task);
    return task;
  }
  update(task: HostTask) {
    if (!this.stopped) this.saveTask(structuredClone(task));
  }
  ownTask(session: HostSession, id: string) {
    const task = this.tasks.get(id);
    if (!task || task.owner !== session.id) throw new Error('Unknown task in this session');
    return task;
  }
  kill(id: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      controller.abort();
      return;
    }
    const child = this.processes.get(id);
    if (child && child.exitCode === null) child.kill();
  }
  close() {
    if (this.stopped) return;
    for (const task of this.tasks.values())
      if (active(task)) {
        task.status = 'cancelled';
        task.output = bounded(task.output + '\n[Application closed; not resumed automatically]');
        this.update(task);
      }
    for (const id of this.controllers.keys()) this.kill(id);
    this.stopped = true;
  }
  cancelSession(id: string) {
    const pending = [id],
      visited = new Set<string>();
    while (pending.length) {
      const owner = pending.pop()!;
      if (visited.has(owner)) continue;
      visited.add(owner);
      for (const task of this.tasks.values()) if (task.owner === owner && active(task)) this.kill(task.id);
      for (const child of this.sessions.values()) if (child.parentId === owner) pending.push(child.id);
    }
  }
  invalidatePolicy() {
    for (const task of this.tasks.values())
      if (active(task)) {
        task.status = 'cancelled';
        task.output = bounded(task.output + '\n[Cancelled: directory permission policy updated]');
        this.update(task);
      }
    for (const id of [...this.controllers.keys()]) this.kill(id);
  }
  spawnTask(
    session: HostSession,
    description: string,
    exe: string,
    args: string[],
    cwd: string,
    signal: AbortSignal,
    timeout: number,
  ): { task: HostTask; finished: Promise<HostTask> } {
    const startPolicy = this.policyVersion(),
      task = this.newTask(session, 'shell', description),
      controller = new AbortController();
    this.controllers.set(task.id, controller);
    const onAbort = () => {
      task.status = 'cancelled';
      this.kill(task.id);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const child = spawn(exe, args, {
      cwd,
      env: safeChildEnv(),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.processes.set(task.id, child);
    task.pid = child.pid;
    task.status = 'running';
    this.update(task);
    const ownAbort = () => {
      task.status = 'cancelled';
      if (child.exitCode === null) {
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.on('error', () => child.kill());
        } else child.kill('SIGTERM');
      }
    };
    controller.signal.addEventListener('abort', ownAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // setTimeout overflows past 2^31-1 ms (fires at once); anything that long simply means no timer.
    if (timeout > 0 && timeout <= 2147483647)
      timer = setTimeout(() => {
        task.output = bounded(task.output + '\n[Task timeout]');
        this.kill(task.id);
      }, timeout);
    const finished = new Promise<HostTask>((resolve) => {
      let ended = false,
        exitTimer: ReturnType<typeof setTimeout> | undefined;
      const end = (code: number | null, error?: Error) => {
        if (ended) return;
        ended = true;
        if (timer) clearTimeout(timer);
        if (exitTimer) clearTimeout(exitTimer);
        signal.removeEventListener('abort', onAbort);
        this.controllers.delete(task.id);
        this.processes.delete(task.id);
        task.exitCode = code ?? undefined;
        if (this.policyVersion() !== startPolicy) task.status = 'cancelled';
        else if (task.status !== 'cancelled') task.status = error || code !== 0 ? 'failed' : 'done';
        if (error) task.output = bounded(task.output + '\n' + error.message);
        this.update(task);
        resolve(task);
      };
      let lastData = Date.now();
      const add = (chunk: Buffer) => {
        lastData = Date.now();
        task.output = bounded(task.output + chunk.toString('utf8'));
      };
      child.stdout?.on('data', add);
      child.stderr?.on('data', add);
      child.once('error', (error) => end(null, error));
      child.once('close', (code) => end(code));
      // A backgrounded grandchild (`cmd &`) can keep our pipes open forever after the shell exits. Once the shell is gone,
      // wait for the pipes to go quiet, then settle; keep draining (never destroy) so the grandchild never hits EPIPE.
      child.once('exit', (code) => {
        const exitedAt = Date.now();
        const settle = () => {
          if (ended) return;
          // A grandchild that keeps logging would keep the pipes busy forever: give up waiting 10 s after the shell exited.
          if (Date.now() - lastData < 1500 && Date.now() - exitedAt < 10_000) {
            exitTimer = setTimeout(settle, 500);
            return;
          }
          for (const stream of [child.stdout, child.stderr]) {
            if (!stream) continue;
            stream.removeListener('data', add);
            stream.resume();
            (stream as unknown as { unref?: () => void }).unref?.();
          }
          end(code);
        };
        // Not unref'd: someone is awaiting this task, and the wait is bounded (10 s at most).
        exitTimer = setTimeout(settle, 500);
      });
    });
    if (signal.aborted || this.policyVersion() !== startPolicy) onAbort();
    return { task, finished };
  }
}
