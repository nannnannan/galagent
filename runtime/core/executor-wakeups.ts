import { cronNext, SCHEDULE_LIMITS, type SelfWakeScheduler } from './scheduler';
import type { HostHooks } from './tool-host';

// Executor reminders belong to the user, including when they match an existing character alarm.
export function executorWakeups(scheduler: SelfWakeScheduler, notify: () => void): NonNullable<HostHooks['mainCron']> {
    return {
        create({ cron, prompt, recurring }) {
            const timing = recurring ? { cron } : { at: new Date(cronNext(cron, Date.now())).toISOString() };
            const item = scheduler.add({ note: prompt.slice(0, SCHEDULE_LIMITS.note), ...timing }, 'user');
            notify();
            return { id: item.id, nextAt: item.dueAt };
        },
        list() {
            return scheduler.list().map(item => ({
                id: item.id, cron: item.cron, prompt: item.note, nextAt: item.dueAt,
                recurring: Boolean(item.cron || item.repeatMinutes),
            }));
        },
        delete(id) {
            const cancelled = scheduler.cancel(id);
            if (cancelled) notify();
            return cancelled;
        },
    };
}
