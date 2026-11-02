import type { CompanionMode, CompanionPreferences, InitiativeTopic } from './contracts';

export const companionModes: { value: CompanionMode; label: string; description: string }[] = [
  { value: 'daily', label: '日常陪伴', description: '根据眼前的事情和你的偏好，在合适的时刻主动开口。' },
  { value: 'focus', label: '专注时光', description: '暂停主动开口和桌面漫步；你设的定时提醒照常响，聊天照常回应。' },
  { value: 'rest', label: '安静休息', description: '暂停主动开口、桌面观察、漫步和自动朗读；仍可打字聊天。' },
];
export const topicLabels: Record<InitiativeTopic, string> = {
  window: '桌面动向', clipboard: '剪贴板', browser: '浏览的内容', task: '任务结果',
  watch: '关注事项', reunion: '重逢', unanswered: '久未回应', system: '连接状态', screen: '屏幕变化', schedule: '定时提醒与回访',
  greeting: '早安与晚安', share: '分享新鲜事', recall: '旧事重提',
};
export const validMode = (value: unknown): value is CompanionMode => companionModes.some(mode => mode.value === value);
export const validTopic = (value: unknown): value is InitiativeTopic => typeof value === 'string' && Object.hasOwn(topicLabels, value);
export function readPreferences(raw: unknown): CompanionPreferences {
  const empty: CompanionPreferences = { version: 1, topics: {}, ratings: {} };
  if (!raw || typeof raw !== 'object') return empty;
  const value = raw as CompanionPreferences;
  if (value.version !== 1 || !value.topics || !value.ratings || typeof value.topics !== 'object' || typeof value.ratings !== 'object') return empty;
  for (const [topic, choice] of Object.entries(value.topics)) if (validTopic(topic) && (choice === 'welcome' || choice === 'mute')) empty.topics[topic] = choice;
  for (const [id, choice] of Object.entries(value.ratings).slice(-120)) if (/^[0-9a-f-]{36}$/i.test(id) && (choice === 'welcome' || choice === 'mute')) empty.ratings[id] = choice;
  return empty;
}
