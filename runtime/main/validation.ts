import type { AppCommand } from '../shared/contracts';
import { validMode } from '../shared/companionship';
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, length: number): value is string => typeof value === 'string' && value.length <= length;
const settingsBounds: Record<string, [number, number]> = {
  quietUntil: [0, 4_000_000_000_000], proactiveIntervalMinutes: [5, 1440], proactiveHourlyLimit: [0, 12], proactiveDailyLimit: [0, 48], petScale: [0.6, 1.5], ttsSpeed: [0.5, 2.0],
};
const settingFlags = new Set(['observationEnabled', 'windowTitlesEnabled', 'initiativeEnabled', 'mischiefEnabled', 'reducedMotion', 'screenCaptureEnabled', 'clipboardEnabled', 'roamingEnabled', 'ttsEnabled']);
const settingStrings: Record<string, number> = { ttsBaseUrl: 400, ttsModel: 100, ttsVoice: 100 };
export function validateCommand(value: unknown): AppCommand {
  if (!plain(value) || !bounded(value.type, 64)) throw new Error('无效操作。');
  const command = value as Record<string, unknown>;
  switch (command.type) {
    case 'agent.run':
      if(!bounded(command.task,12000)||!command.task.trim())throw new Error('任务为空或过长。');break;
    case 'agent.configure':
      if(!bounded(command.cwd,1000)||!command.cwd.trim())throw new Error('工作目录无效。');break;
    case 'agent.cancel':break;
    case 'agent.answer':
      if(!bounded(command.id,100)||!plain(command.answers)||Object.entries(command.answers).some(([key,val])=>key.length>3000||!bounded(val,3000)))throw new Error('任务回答格式无效。');break;
    case 'chat.send':
      if (!bounded(command.text, 12000) || !command.text.trim()) throw new Error('请输入消息，最多 12000 字。'); break;
    case 'memory.remember':
      if (!bounded(command.text, 2000) || !command.text.trim()) throw new Error('记忆内容过长或为空。'); break;
    case 'memory.correct':
      if (!bounded(command.id, 100) || !bounded(command.text, 2000) || !command.text.trim()) throw new Error('记忆格式不正确。'); break;
    case 'memory.delete':
      if (!bounded(command.id, 100)) throw new Error('记忆格式不正确。'); break;
    case 'watch.add':
      if (!bounded(command.title, 120) || !command.title.trim()) throw new Error('关注事项标题不能为空或过长。');
      if (command.condition !== undefined && !bounded(command.condition, 300)) throw new Error('关注事项条件过长。');
      if (command.checkAfterMinutes !== undefined && (typeof command.checkAfterMinutes !== 'number' || !Number.isFinite(command.checkAfterMinutes) || command.checkAfterMinutes < 1 || command.checkAfterMinutes > 1440)) throw new Error('关注事项时间超出范围。');
      break;
    case 'watch.dismiss':
      if (!bounded(command.id, 100) || !command.id.trim()) throw new Error('关注事项标识无效。'); break;
    case 'browser.report':
      if (!plain(command.report)) throw new Error('浏览器观察报告格式无效。'); break;
    case 'browser.disconnect': case 'tts.stop': break;
    case 'initiative.feedback':
      if (!bounded(command.messageId, 100) || !command.messageId || !['welcome', 'mute'].includes(String(command.value))) throw new Error('互动反馈无效。');
      break;
    case 'initiative.resetFeedback': break;
    case 'pet.roam':
      if (command.active !== undefined && typeof command.active !== 'boolean') throw new Error('漫步状态无效。');
      if (command.direction !== undefined && command.direction !== -1 && command.direction !== 1) throw new Error('漫步方向无效。');
      break;
    case 'tts.speak':
      if (!bounded(command.text, 2000) || !command.text.trim()) throw new Error('语音文本为空或过长。'); break;
    case 'tts.configure': {
      if (command.ttsEnabled !== undefined && typeof command.ttsEnabled !== 'boolean') throw new Error('TTS 开关无效。');
      if (command.ttsBaseUrl !== undefined && !bounded(command.ttsBaseUrl, 400)) throw new Error('TTS 地址无效。');
      if (typeof command.ttsBaseUrl === 'string' && command.ttsBaseUrl.trim()) {
        const u = new URL(command.ttsBaseUrl.trim());
        if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))) throw new Error('远程 TTS 接口需要 HTTPS。');
        if (u.username || u.password) throw new Error('TTS 地址不能内嵌凭据。');
      }
      if (command.ttsModel !== undefined && !bounded(command.ttsModel, 100)) throw new Error('TTS 模型无效。');
      if (command.ttsVoice !== undefined && !bounded(command.ttsVoice, 100)) throw new Error('TTS 音色无效。');
      if (command.ttsSpeed !== undefined && (typeof command.ttsSpeed !== 'number' || !Number.isFinite(command.ttsSpeed) || command.ttsSpeed < 0.5 || command.ttsSpeed > 2.0)) throw new Error('TTS 语速超出范围。');
      if (command.ttsApiKey !== undefined && !bounded(command.ttsApiKey, 512)) throw new Error('TTS 密钥格式无效。');
      break;
    }
    case 'config.save': {
      if (!bounded(command.baseUrl, 400) || !bounded(command.model, 100) || (command.apiKey !== undefined && !bounded(command.apiKey, 512))) throw new Error('模型配置格式不正确。');
      if (command.mode !== undefined && command.mode !== 'mira-proxy' && command.mode !== 'native-api') throw new Error('API 接入模式无效。');
      const url = new URL(command.baseUrl);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('远程模型接入需要 HTTPS。');
      if (url.username || url.password || url.search || url.hash) throw new Error('模型地址不能包含凭据或查询参数。'); break;
    }
    case 'settings.update':
      if (!plain(command.settings)) throw new Error('相处设置格式不正确。');
      for (const [key, val] of Object.entries(command.settings)) {
        if (key === 'companionMode') { if (!validMode(val)) throw new Error('陪伴模式无效。'); }
        else if (settingFlags.has(key)) { if (typeof val !== 'boolean') throw new Error('相处设置格式不正确。'); }
        else if (settingStrings[key]) { if (!bounded(val, settingStrings[key])) throw new Error('相处设置格式不正确。'); }
        else if (key === 'captureBlocklist') { if (!Array.isArray(val) || val.length > 80 || val.some(item => !bounded(item, 80))) throw new Error('截屏黑名单格式不正确。'); }
        else if (key === 'forbiddenPaths') { if (!Array.isArray(val) || val.length > 200 || val.some(item => !bounded(item, 500) || item.includes('\0'))) throw new Error('禁止访问目录列表格式不正确。'); }
        else if (settingsBounds[key]) { const [min, max] = settingsBounds[key]; if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) throw new Error('相处设置超出范围。'); }
        else throw new Error('未知相处设置。');
      }
      break;
    case 'pet.interact':
      if (!['tap', 'drag'].includes(String(command.interaction))) throw new Error('未知互动。'); break;
    case 'shell.drag':
      if (![command.dx, command.dy].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1000)) throw new Error('无效移动。'); break;
    case 'shell.pointer':
      if (typeof command.interactive !== 'boolean') throw new Error('无效指针设置。'); break;
    case 'shell.chat':
      if (command.open !== undefined && typeof command.open !== 'boolean') throw new Error('无效窗口设置。'); break;
    case 'shell.input':
      if (typeof command.open !== 'boolean') throw new Error('无效输入设置。'); break;
    case 'chat.cancel': case 'initiative.check': case 'shell.menu': case 'shell.resetPosition': case 'app.export': case 'app.import': case 'app.quit': break;
    default: throw new Error('未知操作。');
  }
  return value as AppCommand;
}
