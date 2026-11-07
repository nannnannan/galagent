import type { Expression, PetAction } from '../shared/contracts';
import { readScheduleField } from './scheduler';

type Visible = {
  careUpdates?: unknown[];
  sharedFindingId?: string;
  /** 活人感: a short line delivered a minute or two later. */
  afterthought?: string;
  delegate?: { task: string };
  schedule?: { note: string; inMinutes?: number; at?: string; repeatMinutes?: number };
  cancelSchedule?: string[];
  watch?: { title: string; condition?: string };
  text: string;
  expression: Expression;
  action: PetAction;
  sourceIds?: string[];
};
const expressions: Expression[] = [
  'neutral',
  'curious',
  'pleased',
  'flustered',
  'annoyed',
  'softened',
  'blink',
];
const actions: PetAction[] = [
  'idle',
  'nod',
  'sway',
  'peek',
  'sulk',
  'celebrate',
  'wave',
  'sparkle',
  'doodle',
  'run',
  'sleep',
  'think',
  'dizzy',
  'love',
];
export function parseVisibleReply(
  data: unknown,
  kind: string,
  knownSource: (id: string) => boolean,
  isAlarm: (id: string) => boolean,
): Visible {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('模型结构无效');
  const raw = data as Record<string, unknown>;
  const textVal =
    typeof raw.text === 'string'
      ? raw.text
      : typeof raw.reply === 'string'
        ? raw.reply
        : typeof raw.message === 'string'
          ? raw.message
          : typeof raw.response === 'string'
            ? raw.response
            : undefined;
  const pick = (v: unknown) =>
    typeof v === 'string'
      ? v.trim().toLowerCase()
      : Array.isArray(v) && typeof v[0] === 'string'
        ? v[0].trim().toLowerCase()
        : '';
  const expRaw = pick(raw.expression);
  const expMap: Record<string, Expression> = {
    smile: 'pleased',
    happy: 'pleased',
    joy: 'pleased',
    cheerful: 'pleased',
    gentle: 'softened',
    warm: 'softened',
    soft: 'softened',
    tender: 'softened',
    shy: 'flustered',
    embarrassed: 'flustered',
    blush: 'flustered',
    angry: 'annoyed',
    upset: 'annoyed',
    pout: 'annoyed',
    grumpy: 'annoyed',
    surprised: 'curious',
    wonder: 'curious',
    thinking: 'curious',
    interested: 'curious',
  };
  const expression: Expression = (expressions as readonly string[]).includes(expRaw)
    ? (expRaw as Expression)
    : expMap[expRaw] || 'neutral';
  const actRaw = pick(raw.action);
  const actMap: Record<string, PetAction> = {
    smile: 'celebrate',
    happy: 'celebrate',
    cheer: 'celebrate',
    jump: 'celebrate',
    greet: 'wave',
    wave_hand: 'wave',
    tilt: 'sway',
    rock: 'sway',
    look: 'peek',
    glance: 'peek',
    pout: 'sulk',
    shine: 'sparkle',
    twinkle: 'sparkle',
    draw: 'doodle',
    write: 'doodle',
  };
  const action: PetAction = (actions as readonly string[]).includes(actRaw)
    ? (actRaw as PetAction)
    : actMap[actRaw] || 'idle';
  if (typeof textVal !== 'string' || textVal.length > 3000 || (kind !== 'initiative' && !textVal.trim()))
    throw new Error('模型表现未通过校验');
  const del =
    raw.delegate && typeof raw.delegate === 'object' && !Array.isArray(raw.delegate)
      ? (raw.delegate as { task?: unknown })
      : undefined;
  const delegate =
    del && typeof del.task === 'string' && del.task.trim()
      ? { task: del.task }
      : raw.delegate === undefined || raw.delegate === null || raw.delegate === false || (del && !del.task)
        ? undefined
        : (raw.delegate as Visible['delegate']);
  if (
    delegate !== undefined &&
    (kind !== 'chat' ||
      !delegate ||
      typeof delegate.task !== 'string' ||
      !delegate.task.trim() ||
      delegate.task.length > 12000)
  )
    throw new Error('执行委派格式无效');
  const watchRaw =
    raw.watch && typeof raw.watch === 'object' && !Array.isArray(raw.watch)
      ? (raw.watch as { title?: unknown; condition?: unknown })
      : undefined;
  const watch =
    watchRaw && typeof watchRaw.title === 'string' && watchRaw.title.trim()
      ? {
          title: watchRaw.title.trim().slice(0, 200),
          condition:
            typeof watchRaw.condition === 'string' && watchRaw.condition.trim()
              ? watchRaw.condition.trim().slice(0, 400)
              : undefined,
        }
      : undefined;
  const sourceIds =
    raw.sourceIds === null || (Array.isArray(raw.sourceIds) && raw.sourceIds.length === 0)
      ? undefined
      : (raw.sourceIds as Visible['sourceIds']);
  if (
    sourceIds !== undefined &&
    (!Array.isArray(sourceIds) ||
      sourceIds.length > 12 ||
      sourceIds.some((id) => typeof id !== 'string' || !knownSource(id)))
  )
    throw new Error('模型引用了未知来源');
  const schedule = readScheduleField(raw.schedule);
  const cancelSchedule = Array.isArray(raw.cancelSchedule)
    ? raw.cancelSchedule.filter((id): id is string => typeof id === 'string' && isAlarm(id)).slice(0, 10)
    : undefined;
  const afterthought =
    kind === 'chat' && typeof raw.afterthought === 'string' && raw.afterthought.trim()
      ? [...raw.afterthought.trim()].slice(0, 120).join('')
      : undefined;
  return {
    text: textVal,
    ...(kind === 'chat' && Array.isArray(raw.careUpdates) ? { careUpdates: raw.careUpdates.slice(0,3) } : {}),
    expression,
    action,
    ...(afterthought ? { afterthought } : {}),
    ...(schedule ? { schedule } : {}),
    ...(cancelSchedule?.length ? { cancelSchedule } : {}),
    ...(delegate ? { delegate } : {}),
    ...(watch ? { watch } : {}),
    ...(sourceIds ? { sourceIds } : {}),
    ...(kind === 'initiative' && typeof raw.sharedFindingId === 'string' ? { sharedFindingId: raw.sharedFindingId } : {}),
  };
}
