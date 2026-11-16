import { validMode } from './companionship';
import { checkBaseUrl } from './endpoints';

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, length: number): value is string => typeof value === 'string' && value.length <= length;
const strings = (value: unknown, count: number, width: number) => Array.isArray(value) && value.length <= count && value.every(item => bounded(item, width));
const slug = (value: unknown) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(value);
const settingNumbers = new Set(['quietUntil', 'proactiveIntervalMinutes', 'proactiveHourlyLimit', 'proactiveDailyLimit', 'petScale', 'ttsSpeed', 'heartbeatSeconds', 'unansweredMinutes', 'reunionHours', 'screenIntervalSeconds', 'idleSleepMinutes', 'bubbleSeconds', 'roamSpeed', 'shareDailyLimit', 'recallEveryDays', 'contextWindow', 'maxOutputTokens']);
const settingFlags = new Set(['observationEnabled', 'windowTitlesEnabled', 'initiativeEnabled', 'mischiefEnabled', 'reducedMotion', 'screenCaptureEnabled', 'clipboardEnabled', 'roamingEnabled', 'ttsEnabled', 'funCaptions', 'splitReplies', 'afterthoughts', 'moodEnabled', 'routineEnabled', 'murmursEnabled', 'adaptivePacing', 'researchEnabled']);
const settingStrings: Record<string, number> = { ttsBaseUrl: 400, ttsModel: 100, ttsVoice: 100, goodnightAt: 5 };

export function validateSettingsPatch(value: unknown) {
  if (!plain(value)) throw new Error('相处设置格式不正确。');
  for (const [key, val] of Object.entries(value)) {
    if (key === 'companionMode') { if (!validMode(val)) throw new Error('陪伴模式无效。'); }
    else if (settingFlags.has(key)) { if (typeof val !== 'boolean') throw new Error('相处设置格式不正确。'); }
    else if (Object.hasOwn(settingStrings, key)) { if (!bounded(val, settingStrings[key])) throw new Error('相处设置格式不正确。'); if (key === 'ttsBaseUrl') val && checkBaseUrl(val, 'TTS'); }
    else if (key === 'captureBlocklist') { if (!Array.isArray(val) || val.length > 80 || val.some(item => !bounded(item, 80))) throw new Error('截屏黑名单格式不正确。'); }
    else if (key === 'forbiddenPaths') { if (!Array.isArray(val) || val.length > 200 || val.some(item => !bounded(item, 500) || item.includes('\0'))) throw new Error('禁止访问目录列表格式不正确。'); }
    else if (settingNumbers.has(key)) { if (typeof val !== 'number' || !Number.isFinite(val)) throw new Error('请输入有效的数字。'); }
    else if (key === 'aiControl') { if (val !== 'confirm' && val !== 'full') throw new Error('AI 管理权限无效。'); }
    else if (key === 'mcpServers') { if (!Array.isArray(val) || val.length > 20 || val.some(v => !plain(v) || !bounded(v.name, 32) || typeof v.enabled !== 'boolean' || (v.researchTools !== undefined && (!Array.isArray(v.researchTools) || v.researchTools.length > 120 || v.researchTools.some((t: unknown) => !bounded(t, 200)))) || (v.url !== undefined ? !bounded(v.url, 1000) : !bounded(v.command, 500)) || (v.args !== undefined && (!Array.isArray(v.args) || v.args.length > 60 || v.args.some((x: unknown) => typeof x !== 'string' || x.length > 2000))) || [v.envKeys, v.headerKeys].some(k => k !== undefined && (!Array.isArray(k) || k.length > 30 || k.some((x: unknown) => !bounded(x, 100)))))) throw new Error('MCP 服务配置格式不正确。'); }
    else if (key === 'executor') { if (!plain(val) || (val.model !== undefined && typeof val.model !== 'string') || (typeof val.model === 'string' && val.model.length > 120) || [val.maxOutputTokens, val.maxTurns, val.maxParallel].some(n => n !== undefined && (typeof n !== 'number' || !Number.isFinite(n)))) throw new Error('执行器设置格式不正确。'); }
    else if (key === 'petId') { if (val !== '' && !slug(val)) throw new Error('小人形象无效。'); }
    else if (key === 'quietHours') { if (!plain(val) || (val.enabled !== undefined && typeof val.enabled !== 'boolean') || (val.start !== undefined && !bounded(val.start, 5)) || (val.end !== undefined && !bounded(val.end, 5))) throw new Error('免打扰时段格式无效。'); }
    else if (key === 'sandbox') {
      if (!plain(val)) throw new Error('沙箱设置格式无效。');
      for (const [k, v] of Object.entries(val)) {
        if (k === 'level') { if (!['strict', 'standard', 'open', 'full'].includes(String(v))) throw new Error('沙箱级别无效。'); }
        else if (k === 'fileScope') { if (!['workspace-read', 'workspace', 'read-anywhere', 'anywhere'].includes(String(v))) throw new Error('文件范围无效。'); }
        else if (['shell', 'shellConfirm', 'network', 'lanAccess', 'credentialFiles', 'redactSecrets', 'redactPersonal'].includes(k)) { if (typeof v !== 'boolean') throw new Error('沙箱开关无效。'); }
        else if (k === 'allowedDomains') { if (!strings(v, 100, 200)) throw new Error('允许域名列表格式无效。'); }
        else if (k === 'sensitiveWords') { if (!strings(v, 200, 100)) throw new Error('敏感词列表格式无效。'); }
        else throw new Error('未知沙箱设置。');
      }
    }
    else throw new Error('未知相处设置。');
  }
}
