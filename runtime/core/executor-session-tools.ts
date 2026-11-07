import { abortable } from './pool';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { TaskSupervisor, active } from './task-supervisor';
import { boundedMiddle as bounded } from './agent-kit';
import { cronNext } from './scheduler';
import type { HostSession, HostHooks } from './tool-host';

type Handler = (
  session: HostSession,
  args: Record<string, any>,
  signal: AbortSignal,
) => Promise<{ content: string }>;
export class ExecutorSessionTools {
  constructor(
    private supervisor: TaskSupervisor,
    private hooks: Pick<HostHooks, 'ask' | 'mainCron' | 'onBackground'>,
    private clock: () => number,
    private save: (session: HostSession) => void,
  ) {}
  lookup(name: string): Handler | undefined {
    return Object.hasOwn(this.handlers, name) ? this.handlers[name] : undefined;
  }
  private handlers: Record<string, Handler> = {
    TodoList: async (session, a, signal) => {
      if (a.todos !== undefined) {
        if (a.todos.filter((t: any) => t.status === 'in_progress').length > 1)
          throw new Error('Only one todo may be in_progress');
        session.todos = a.todos;
      }
      return { content: JSON.stringify({ todos: session.todos }) };
    },
    CreateGoal: async (session, a, signal) => {
      if (session.goal && session.goal.status !== 'complete' && !a.replace)
        throw new Error('An unfinished goal already exists');
      session.goal = {
        objective: a.objective,
        completionCriterion: a.completionCriterion,
        status: 'active',
        startedAt: this.clock(),
        turns: session.turns,
        tokens: session.usage,
      };
      return { content: JSON.stringify(session.goal) };
    },
    GetGoal: async (session, a, signal) => {
      return { content: JSON.stringify({ goal: session.goal || null }) };
    },
    UpdateGoal: async (session, a, signal) => {
      if (!session.goal) throw new Error('No goal exists');
      session.goal.status = a.status;
      return { content: JSON.stringify(session.goal) };
    },
    SetGoalBudget: async (session, a, signal) => {
      if (!session.goal) throw new Error('No goal exists');
      const factors: any = { milliseconds: 1, seconds: 1000, minutes: 60000, hours: 3600000 };
      const value = factors[a.unit] ? a.value * factors[a.unit] : Math.max(1, Math.round(a.value));
      if (factors[a.unit] && (value < 1000 || value > 86400000))
        throw new Error('Time budget must be 1 second to 24 hours');
      session.goal.budget = { unit: factors[a.unit] ? 'milliseconds' : a.unit, value };
      return { content: JSON.stringify(session.goal) };
    },
    EnterPlanMode: async (session, a, signal) => {
      session.plan = true;
      return {
        content: JSON.stringify({
          plan_mode: true,
          plan_file: session.planFile,
          write_scope: 'plan_file_only',
        }),
      };
    },
    ExitPlanMode: async (session, a, signal) => {
      if (!session.plan) throw new Error('Not in plan mode');
      const plan = await readFile(session.planFile, 'utf8').catch(() => '');
      if (!plan.trim()) throw new Error('Write a concrete plan before requesting approval');
      const choices = [
        ...(a.options || []).map((o: any) => ({ label: o.label, description: o.description })),
        { label: 'Approve', description: '批准当前计划' },
        { label: 'Reject', description: '保持计划模式' },
      ];
      const answers = await this.hooks.ask(
        [{ question: '批准当前计划并开始执行？', options: choices }],
        signal,
      );
      signal.throwIfAborted();
      const choice = Object.values(answers)[0];
      if (choice === 'Approve' || (a.options || []).some((o: any) => o.label === choice))
        session.plan = false;
      return { content: JSON.stringify({ plan_mode: session.plan, approved: !session.plan, answers }) };
    },
    AskUserQuestion: async (session, a, signal) => {
      if (
        new Set(a.questions.map((q: any) => q.question)).size !== a.questions.length ||
        a.questions.some((q: any) => new Set(q.options.map((o: any) => o.label)).size !== q.options.length)
      )
        throw new Error('Question texts and labels must be unique');
      if (!a.background) {
        const answers = await abortable(this.hooks.ask(a.questions, signal), signal);
        return {
          content: JSON.stringify({
            answers,
            ...(!Object.keys(answers).length ? { note: 'User dismissed; no choice selected' } : {}),
          }),
        };
      }
      const task = this.supervisor.newTask(session, 'question', 'User question'),
        controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      this.supervisor.attach(task, controller);
      task.status = 'running';
      this.supervisor.update(task);
      let finished = false;
      const finish = (answers?: Record<string, string>) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', dismiss);
        const accepted = answers && !controller.signal.aborted;
        task.status = accepted ? 'done' : 'cancelled';
        task.output = accepted ? JSON.stringify({ answers }) : 'Question dismissed';
        this.supervisor.release(task);
        this.supervisor.update(task);
        this.hooks.onBackground?.(task);
      };
      const dismiss = () => finish();
      controller.signal.addEventListener('abort', dismiss, { once: true });
      if (controller.signal.aborted) dismiss();
      else {
        try {
          void this.hooks.ask(a.questions, controller.signal).then((answers) => finish(answers), dismiss);
        } catch {
          dismiss();
        }
      }
      return { content: JSON.stringify({ task_id: task.id, status: 'running' }) };
    },
    TaskList: async (session, a, signal) => {
      return {
        content: JSON.stringify(
          [...this.supervisor.tasks.values()]
            .filter((t) => t.owner === session.id && (!a.active_only || active(t)))
            .slice(-a.limit)
            .map(({ output, ...meta }) => meta),
        ),
      };
    },
    TaskOutput: async (session, a, signal) => {
      const task = this.supervisor.ownTask(session, a.task_id);
      if (a.block && active(task)) {
        const until = performance.now() + Math.min(a.timeout, 3600) * 1000;
        while (active(task) && performance.now() < until) {
          if (signal.aborted) throw new Error('Cancelled');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      return { content: JSON.stringify(task) };
    },
    TaskStop: async (session, a, signal) => {
      const task = this.supervisor.ownTask(session, a.task_id);
      if (active(task)) {
        this.supervisor.kill(task.id);
        task.status = 'cancelled';
        task.output = bounded(task.output + '\n' + a.reason);
        this.supervisor.update(task);
      }
      return { content: JSON.stringify(task) };
    },
    CronCreate: async (session, a, signal) => {
      if (this.hooks.mainCron) {
        const job = this.hooks.mainCron.create({
          cron: a.cron,
          prompt: a.prompt,
          recurring: a.recurring ?? true,
        });
        return {
          content: JSON.stringify({
            id: job.id,
            cron: a.cron,
            recurring: a.recurring ?? true,
            nextFireAt: new Date(job.nextAt).toISOString(),
            wakes: 'main-character',
            note: '到点时唤醒的是主角色（陪伴主代理），由它决定如何提醒用户或再委派任务；不会重新进入本执行会话。',
          }),
        };
      }
      if (session.crons.length >= 50) throw new Error('50 cron jobs per session maximum');
      const now = this.clock(),
        nextAt = cronNext(a.cron, now),
        job: HostSession['crons'][number] = {
          id: randomUUID(),
          cron: a.cron,
          prompt: a.prompt,
          recurring: a.recurring ?? true,
          nextAt,
          createdAt: now,
          expiresAt: now + 7 * 86400000,
        };
      session.crons.push(job);
      return { content: JSON.stringify(job) };
    },
    CronList: async (session, a, signal) => {
      return {
        content: JSON.stringify({ jobs: this.hooks.mainCron ? this.hooks.mainCron.list() : session.crons }),
      };
    },
    CronDelete: async (session, a, signal) => {
      if (this.hooks.mainCron) {
        if (!this.hooks.mainCron.delete(a.id)) throw new Error('Unknown cron job');
        return { content: 'Cron job deleted' };
      }
      const index = session.crons.findIndex((j) => j.id === a.id);
      if (index < 0) throw new Error('Unknown cron job');
      session.crons.splice(index, 1);
      return { content: 'Cron job deleted' };
    },
  };
  due(session: HostSession, now = this.clock()): string[] {
    if (!session.crons.length) return [];
    const prompts: string[] = [];
    for (const job of [...session.crons]) {
      if (now >= job.expiresAt) {
        session.crons = session.crons.filter((j) => j !== job);
        continue;
      }
      if (now < job.nextAt) continue;
      let count = 0;
      while (job.nextAt <= now && count < 10000) {
        count++;
        job.nextAt = cronNext(job.cron, job.nextAt);
        if (!job.recurring) break;
      }
      prompts.push(
        `<cron-fire jobId="${job.id}" cron="${job.cron}" recurring="${job.recurring}" coalescedCount="${count}"><prompt>${job.prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</prompt></cron-fire>`,
      );
      if (!job.recurring) session.crons = session.crons.filter((j) => j !== job);
    }
    this.save(session);
    return prompts;
  }
}
