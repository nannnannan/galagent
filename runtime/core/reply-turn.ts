import { randomUUID } from 'node:crypto';
import type { AppSnapshot, Message, InitiativeTopic } from '../shared/contracts';
import { validTopic } from '../shared/companionship';
import { splitReply } from '../shared/reply';
import type { WakeRequest } from './attention';
import type { Store } from './store';
import type { TransportRecord } from './conversation-context';
import type { TransportMessage } from './model-gateway';
import type { parseVisibleReply } from './visible-reply';

export type ReplyTurn = {
  kind: 'chat' | 'initiative' | 'scene';
  startedAt: number;
  channel?: 'wechat';
  findingId?: string;
  care?: {id:string;revision:number};
  researchPreference?: { topic: string; result: string };
  controller: AbortController;
  afterReply: (() => void)[];
};

export function replyMessages(
  text: string,
  kind: ReplyTurn['kind'],
  channel: ReplyTurn['channel'],
  data: ReturnType<typeof parseVisibleReply>,
  speaking: { id: string; name: string },
  splitReplies: boolean | undefined,
  wake?: WakeRequest,
) {
  const now = new Date(Date.now()).toISOString();
  const user: Message = {
    id: randomUUID(),
    role: 'user',
    text,
    createdAt: now,
    source: kind,
    ...(channel && kind === 'chat' ? { channel } : {}),
  };
  const assistant: Message = {
    id: randomUUID(),
    role: 'assistant',
    text: data.text,
    createdAt: now,
    source: kind,
    personaId: speaking.id,
    speaker: speaking.name,
    ...(channel && kind === 'chat' ? { channel } : {}),
  };
  const parts = splitReplies !== false && kind !== 'scene' ? splitReply(data.text) : undefined;
  if (parts) assistant.parts = parts;
  if (kind === 'initiative' && wake)
    assistant.initiativeTopics = [
      ...new Set<InitiativeTopic>([
        ...wake.events.map((e) => e.kind).filter(validTopic),
        ...(wake.screenSummary ? ['screen' as const] : []),
      ]),
    ];
  return { user, assistant };
}

// Called within the same SQLite transaction as story, variables, and the extraction job.
export function writeReplyRecords(
  store: Store,
  user: Message,
  assistant: Message,
  rawAssistant: TransportMessage | undefined,
  sourceIds: string[],
  provider: AppSnapshot['provider'],
) {
  const chat = user.source === 'chat';
  if (chat) store.put('message', user.id, user);
  store.put('message', assistant.id, assistant);
  if (chat) store.put('lineage', 'pair:' + user.id, { sourceId: user.id, assistantId: assistant.id });
  if (rawAssistant) {
    store.put('transport', 'transport:' + assistant.id, {
      assistantId: assistant.id,
      userId: chat ? user.id : undefined,
      sourceIds,
      personaId: assistant.personaId,
      provider: { baseUrl: provider.baseUrl, model: provider.model },
      userMessage: { role: 'user', content: user.text },
      assistantMessage: rawAssistant,
    } satisfies TransportRecord);
  }
  const rows = store.all<TransportRecord>('transport');
  for (const row of rows.slice(0, Math.max(0, rows.length - 60)))
    store.remove('transport:' + row.assistantId);
}
