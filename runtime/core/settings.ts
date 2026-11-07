import type { Settings, SettingsPatch } from '../shared/contracts';
import { validMode } from '../shared/companionship';
import { checkBaseUrl } from '../shared/endpoints';
import { DEFAULT_CAPTURE_BLOCKLIST } from '../desktop/perception';
import { DEFAULT_SANDBOX, normalizeSandbox } from './privacy';
import { validServers } from './mcp';

export const defaults: Settings = {
  observationEnabled: true,
  windowTitlesEnabled: false,
  initiativeEnabled: true,
  mischiefEnabled: true,
  quietUntil: 0,
  proactiveIntervalMinutes: 5,
  proactiveHourlyLimit: 2,
  proactiveDailyLimit: 8,
  petScale: 1,
  reducedMotion: false,
  screenCaptureEnabled: true,
  clipboardEnabled: true,
  captureBlocklist: [...DEFAULT_CAPTURE_BLOCKLIST],
  forbiddenPaths: [],
  roamingEnabled: true,
  ttsEnabled: false,
  ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
  ttsModel: 'mimo-v2.5-tts',
  ttsVoice: '冰糖',
  ttsSpeed: 1,
  petId: '',
  heartbeatSeconds: 60,
  unansweredMinutes: 20,
  reunionHours: 6,
  screenIntervalSeconds: 60,
  idleSleepMinutes: 10,
  bubbleSeconds: 12,
  roamSpeed: 1,
  quietHours: { enabled: false, start: '23:00', end: '08:00' },
  funCaptions: true,
  splitReplies: true,
  afterthoughts: true,
  moodEnabled: true,
  routineEnabled: true,
  murmursEnabled: true,
  shareDailyLimit: 1,
  recallEveryDays: 3,
  goodnightAt: '23:30',
  sandbox: { ...DEFAULT_SANDBOX },
};
/** Numeric settings: any finite value inside a sanity range, rounded where it must be whole. */
const numericSettings: Record<string, { min: number; max: number; integer?: boolean }> = {
  proactiveIntervalMinutes: { min: 1, max: 100000 },
  proactiveHourlyLimit: { min: 0, max: 1000, integer: true },
  proactiveDailyLimit: { min: 0, max: 10000, integer: true },
  heartbeatSeconds: { min: 10, max: 86400 },
  unansweredMinutes: { min: 1, max: 100000 },
  reunionHours: { min: 0.5, max: 10000 },
  screenIntervalSeconds: { min: 60, max: 86400 },
  idleSleepMinutes: { min: 0, max: 100000 },
  contextWindow: { min: 8000, max: 20_000_000, integer: true },
  maxOutputTokens: { min: 256, max: 1_000_000, integer: true },
  bubbleSeconds: { min: 2, max: 600 },
  shareDailyLimit: { min: 0, max: 20, integer: true },
  recallEveryDays: { min: 0, max: 365 },
  roamSpeed: { min: 0.2, max: 5 },
  petScale: { min: 0.3, max: 4 },
  ttsSpeed: { min: 0.5, max: 2 },
};
const OPTIONAL_NUMBERS = new Set(['contextWindow', 'maxOutputTokens']);
const clockTime = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(value.trim())
    ? value.trim().padStart(5, '0')
    : fallback;
/** Inside the daily do-not-disturb window (which may wrap past midnight)? */
export function inQuietHours(settings: Settings, now = Date.now()): boolean {
  const q = settings.quietHours;
  if (!q?.enabled) return false;
  const at = new Date(now),
    minutes = at.getHours() * 60 + at.getMinutes();
  const [sh, sm] = q.start.split(':').map(Number),
    [eh, em] = q.end.split(':').map(Number),
    start = sh * 60 + sm,
    end = eh * 60 + em;
  return start === end
    ? false
    : start < end
      ? minutes >= start && minutes < end
      : minutes >= start || minutes < end;
}
export function sanitizeBlocklist(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out: string[] = [];
  for (const item of value)
    if (typeof item === 'string') {
      const entry = item.trim().slice(0, 80);
      if (entry && !out.includes(entry)) out.push(entry);
    }
  return out.slice(0, 80);
}
export function sanitizeForbiddenPaths(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out: string[] = [];
  for (const item of value)
    if (typeof item === 'string' && !item.includes('\0')) {
      const entry = item.trim().slice(0, 500);
      if (entry && !out.includes(entry)) out.push(entry);
    }
  return out.slice(0, 200);
}

function executorLimit(value: unknown, previous: number | undefined, min: number, max: number) {
  if (value === undefined) return previous;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('请输入有效的数字');
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function applySettingsPatch(previous: Settings, patch: SettingsPatch): Settings {
  const settings: Settings = {
    ...previous,
    ...patch,
    quietHours: previous.quietHours,
    sandbox: normalizeSandbox(patch.sandbox, previous.sandbox || DEFAULT_SANDBOX),
  };
  if (settings.companionMode !== undefined && !validMode(settings.companionMode))
    throw new Error('陪伴模式无效');
  settings.companionMode ||= 'daily';
  for (const key of [
    'observationEnabled',
    'windowTitlesEnabled',
    'initiativeEnabled',
    'mischiefEnabled',
    'reducedMotion',
    'screenCaptureEnabled',
    'clipboardEnabled',
    'funCaptions',
  ] as const)
    if (typeof settings[key] !== 'boolean') throw new Error('设置格式无效');
  settings.roamingEnabled = settings.roamingEnabled !== false;
  settings.ttsEnabled = Boolean(settings.ttsEnabled);
  settings.ttsBaseUrl =
    typeof settings.ttsBaseUrl === 'string' ? settings.ttsBaseUrl.trim().slice(0, 400) : '';
  // Only a newly typed address is checked: a stale saved one must not block every other setting (or lockdown).
  if (settings.ttsBaseUrl && settings.ttsBaseUrl !== (previous.ttsBaseUrl || '').trim())
    checkBaseUrl(settings.ttsBaseUrl, 'TTS');
  settings.ttsModel =
    typeof settings.ttsModel === 'string' && settings.ttsModel.trim()
      ? settings.ttsModel.trim().slice(0, 100)
      : 'tts-1';
  settings.ttsVoice =
    typeof settings.ttsVoice === 'string' && settings.ttsVoice.trim()
      ? settings.ttsVoice.trim().slice(0, 100)
      : 'zh-CN-XiaoxiaoNeural';
  settings.quietUntil = Math.max(0, Number(settings.quietUntil) || 0);
  for (const [key, range] of Object.entries(numericSettings)) {
    const raw = (patch as Record<string, unknown>)[key];
    // Optional limits: absent stays absent, 0 means "use what the API reports".
    if (OPTIONAL_NUMBERS.has(key)) {
      if (raw === undefined) continue;
      if (raw === 0 || raw === '0') {
        delete (settings as Record<string, unknown>)[key];
        continue;
      }
    }
    const value =
      raw === undefined
        ? Number((previous as Record<string, unknown>)[key] ?? (defaults as Record<string, unknown>)[key])
        : typeof raw === 'string' && raw.trim()
          ? Number(raw)
          : raw;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('请输入有效的数字');
    const clamped = Math.min(range.max, Math.max(range.min, value));
    (settings as Record<string, unknown>)[key] = range.integer ? Math.round(clamped) : clamped;
  }
  if (patch.aiControl !== undefined) {
    if (patch.aiControl !== 'confirm' && patch.aiControl !== 'full') throw new Error('AI 管理权限无效');
    settings.aiControl = patch.aiControl;
  }
  if (patch.mcpServers !== undefined) {
    settings.mcpServers = validServers(patch.mcpServers);
  }
  if (patch.executor !== undefined) {
    const input = patch.executor as Record<string, unknown>;
    const prior = previous.executor || {};
    if (!input || typeof input !== 'object') throw new Error('执行器设置格式无效');
    if (input.model !== undefined && (typeof input.model !== 'string' || input.model.length > 120))
      throw new Error('执行器模型名无效');
    const model = input.model === undefined ? prior.model : input.model.trim();
    const maxOutputTokens = executorLimit(input.maxOutputTokens, prior.maxOutputTokens, 1024, 131072);
    const maxTurns = executorLimit(input.maxTurns, prior.maxTurns, 4, 1000);
    const maxParallel = executorLimit(input.maxParallel, prior.maxParallel, 1, 6);
    settings.executor = {
      ...(model ? { model } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(maxTurns ? { maxTurns } : {}),
      ...(maxParallel ? { maxParallel } : {}),
    };
  }
  if (patch.goodnightAt !== undefined)
    settings.goodnightAt = clockTime(patch.goodnightAt, previous.goodnightAt || defaults.goodnightAt!);
  if (patch.quietHours !== undefined) {
    const q = patch.quietHours as Partial<NonNullable<Settings['quietHours']>>;
    if (!q || typeof q !== 'object') throw new Error('免打扰时段格式无效');
    const base = previous.quietHours || defaults.quietHours!;
    settings.quietHours = {
      enabled: q.enabled === undefined ? base.enabled : !!q.enabled,
      start: clockTime(q.start, base.start),
      end: clockTime(q.end, base.end),
    };
  }
  if (
    typeof settings.petId !== 'string' ||
    (settings.petId && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(settings.petId))
  )
    throw new Error('小人形象无效');
  settings.captureBlocklist = sanitizeBlocklist(settings.captureBlocklist, previous.captureBlocklist);
  settings.forbiddenPaths = sanitizeForbiddenPaths(settings.forbiddenPaths, previous.forbiddenPaths || []);
  return settings;
}
