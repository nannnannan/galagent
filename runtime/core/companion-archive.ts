import { validateCareArchive } from './care-events';
import type { Message, MemoryItem, DiaryEntry } from '../shared/contracts';
import { validMode, validTopic } from '../shared/companionship';
import { PERSONA_LIMITS } from '../shared/personas';
import type { Store } from './store';
import type { Story } from './story';
import type { CharacterVariables } from './variables';

export type CorrectionRecord = { oldId: string; replacementId: string; correctedAt: string };
function validId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function parseCompanionArchive(
  payload: string,
  store: Store,
  story: Story,
  variables: CharacterVariables,
) {
  if (payload.length > 20000000) throw new Error('存档过大');
  const a = JSON.parse(payload);
  if (
    a?.companionship &&
    (!validMode(a.companionship.mode) ||
      !a.companionship.preferences ||
      a.companionship.preferences.version !== 1)
  )
    throw new Error('陪伴偏好存档格式无效');
  if (
    !a ||
    a.version !== 1 ||
    !Array.isArray(a.messages) ||
    !Array.isArray(a.memories) ||
    !Array.isArray(a.diary) ||
    !Array.isArray(a.tombstones) ||
    !a.identity ||
    !validId(a.identity.id) ||
    typeof a.identity.name !== 'string' ||
    a.identity.name.length > PERSONA_LIMITS.name ||
    !['intro', 'naming', 'ready'].includes(a.identity.onboarding) ||
    !['S0', 'S2', 'S3', 'S4'].includes(a.identity.stage)
  )
    throw new Error('存档格式无效');
  const ids = new Set<string>();
  const validateId = (id: unknown, kind: string) => {
    if (!validId(id) || ids.has(id)) throw new Error('存档记录 ID 重复或无效');
    const existing = store.kind(id);
    if (existing && existing !== kind) throw new Error('存档记录类型冲突');
    ids.add(id);
  };
  const incomingMessages = new Map<string, Message>();
  for (const m of a.messages) {
    if (
      !m ||
      typeof m.text !== 'string' ||
      m.text.length > 12000 ||
      !['user', 'assistant'].includes(m.role) ||
      !Number.isFinite(Date.parse(m.createdAt)) ||
      !['chat', 'initiative', 'scene'].includes(m.source)
    )
      throw new Error('会话格式无效');
    if (
      m.initiativeTopics !== undefined &&
      (!Array.isArray(m.initiativeTopics) ||
        m.initiativeTopics.length > 10 ||
        m.initiativeTopics.some((topic: unknown) => !validTopic(topic)))
    )
      throw new Error('主动回应来源格式无效');
    if (
      m.parts !== undefined &&
      (!Array.isArray(m.parts) ||
        m.parts.length > 3 ||
        m.parts.some((part: unknown) => typeof part !== 'string' || part.length > 2000))
    )
      throw new Error('分条消息格式无效');
    if (m.afterthought !== undefined && typeof m.afterthought !== 'boolean')
      throw new Error('补充消息格式无效');
    validateId(m.id, 'message');
    incomingMessages.set(m.id, m);
  }
  const sourceExists = (id: unknown) =>
    typeof id === 'string' && (incomingMessages.has(id) || (store.kind(id) === 'message' && !store.dead(id)));
  for (const m of a.memories) {
    if (
      !m ||
      typeof m.text !== 'string' ||
      m.text.length > 1500 ||
      typeof m.valid !== 'boolean' ||
      !sourceExists(m.sourceId) ||
      !['fact', 'episode', 'reflection'].includes(m.kind) ||
      !Number.isFinite(Date.parse(m.createdAt))
    )
      throw new Error('记忆来源无效');
    if (
      m.importance !== undefined &&
      !(Number.isInteger(m.importance) && m.importance >= 1 && m.importance <= 5)
    )
      throw new Error('记忆重要度无效');
    if (
      (m.validFrom !== undefined &&
        (typeof m.validFrom !== 'string' || !Number.isFinite(Date.parse(m.validFrom)))) ||
      (m.validTo !== undefined &&
        (typeof m.validTo !== 'string' || !Number.isFinite(Date.parse(m.validTo)))) ||
      (m.supersedes !== undefined && !validId(m.supersedes))
    )
      throw new Error('记忆有效区间无效');
    validateId(m.id, 'memory');
  }
  for (const d of a.diary) {
    if (
      !d ||
      typeof d.text !== 'string' ||
      d.text.length > (d.kind === 'journal' ? 2000 : 700) ||
      (d.kind !== undefined && !['note', 'journal'].includes(d.kind)) ||
      (d.title !== undefined && (typeof d.title !== 'string' || d.title.length > 30)) ||
      !Number.isFinite(Date.parse(d.createdAt)) ||
      !Array.isArray(d.sourceIds) ||
      d.sourceIds.length > 100 ||
      d.sourceIds.some((id: unknown) => !sourceExists(id))
    )
      throw new Error('日记来源无效');
    validateId(d.id, 'diary');
  }
  if (a.tombstones.some((id: unknown) => !validId(id))) throw new Error('删除账本格式无效');
  const corrections: CorrectionRecord[] = a.correctionLedger || [];
  if (!Array.isArray(corrections)) throw new Error('更正账本格式无效');
  const correctedIds = new Set<string>();
  for (const correction of corrections) {
    if (
      !correction ||
      !validId(correction.oldId) ||
      !validId(correction.replacementId) ||
      correction.oldId === correction.replacementId ||
      typeof correction.correctedAt !== 'string' ||
      !Number.isFinite(Date.parse(correction.correctedAt)) ||
      correctedIds.has(correction.oldId)
    )
      throw new Error('更正账本格式无效');
    correctedIds.add(correction.oldId);
  }
  const storyKnownIds = new Set([
    ...ids,
    ...store.all<Message>('message').map((m) => m.id),
    ...store.all<MemoryItem>('memory').map((m) => m.id),
    ...store.all<DiaryEntry>('diary').map((d) => d.id),
  ]);
  const storyArchive = story.validateArchive(
    a.story,
    storyKnownIds,
    new Map([...store.all<MemoryItem>('memory'), ...a.memories].map((m) => [m.id, m])),
  );
  const importedSources = new Map<string, { kind: string; createdAt: string }>(
    storyArchive?.sources.map((s) => [s.id, s]) || [],
  );
  const variableArchive =
    a.variables === undefined
      ? undefined
      : variables.validate(
          a.variables,
          a.identity.id,
          (id) => incomingMessages.get(id) || store.get<Message>(id),
          (id) =>
            importedSources.has(id) ? 'story-source' : incomingMessages.has(id) ? 'message' : store.kind(id),
        );
  if (variableArchive)
    for (const event of variableArchive.events)
      if (event.kind === 'placement') {
        const source =
          importedSources.get(event.sourceIds[0]) ||
          store.get<{ kind: string; createdAt: string }>(event.sourceIds[0]);
        if (source?.kind !== 'drag' || source.createdAt !== event.createdAt)
          throw new Error('人物拖动事件没有匹配来源');
      }
  const careEvents = validateCareArchive(a.careEvents, id => incomingMessages.get(id) || store.get<Message>(id));
  for (const event of careEvents) validateId(event.id,'care-event');
  return { a, corrections, storyArchive, variableArchive, careEvents };
}
