import type { Settings } from '../shared/contracts';
import { DEFAULT_SANDBOX, normalizeSandbox } from './privacy';

/** Settings the AI's update_settings may never touch (in addition to aiControl and every secret). */
export const USER_ONLY_SETTINGS = [
  'voiceInputEnabled',
  'sttBaseUrl',
  'sttModel',
  'sttFormat',
  'sttLanguage',
  'sttKeySet',
  'wechatEnabled',
  'researchDeepAccess',
] as const;
export const SENSITIVE_SETTINGS = [
  'observationEnabled',
  'windowTitlesEnabled',
  'screenCaptureEnabled',
  'clipboardEnabled',
  'captureBlocklist',
  'forbiddenPaths',
  'sandbox',
  'mcpServers',
  'ttsEnabled',
  'ttsBaseUrl',
] as const;
/** Which changes in a patch widen what GalAgent can see or do (these need the user's click unless they granted full control). */
export function permissionExpansions(s: Settings, patch: Record<string, unknown>): string[] {
  const out: string[] = [],
    on = (k: keyof Settings, label: string) => {
      if (patch[k] === true && !s[k]) out.push(label);
    };
  on('observationEnabled', '打开桌面观察');
  on('windowTitlesEnabled', '读取窗口标题');
  on('screenCaptureEnabled', '打开截屏');
  on('clipboardEnabled', '读取剪贴板');
  if (
    typeof patch.ttsBaseUrl === 'string' &&
    patch.ttsBaseUrl.trim() &&
    patch.ttsBaseUrl.trim() !== s.ttsBaseUrl
  )
    out.push('修改语音合成接口地址');
  const removed = (k: 'captureBlocklist' | 'forbiddenPaths', label: string) => {
    const next = patch[k];
    if (Array.isArray(next)) {
      const gone = (s[k] || []).filter((x) => !next.includes(x));
      if (gone.length) out.push(`${label}：${gone.slice(0, 4).join('、')}`);
    }
  };
  removed('captureBlocklist', '移出截屏黑名单');
  removed('forbiddenPaths', '解除禁止访问的文件夹');
  const box = patch.sandbox as Record<string, unknown> | undefined,
    cur = s.sandbox || DEFAULT_SANDBOX;
  if (box && typeof box === 'object') {
    const next = normalizeSandbox(box, cur);
    const levels = ['strict', 'standard', 'open', 'full'],
      scopes = ['workspace-read', 'workspace', 'read-anywhere', 'anywhere'];
    if (levels.indexOf(next.level) > levels.indexOf(cur.level))
      out.push(
        `沙箱调到「${({ standard: '标准', open: '宽松', full: '完全放开' } as Record<string, string>)[next.level] || next.level}」`,
      );
    if (scopes.indexOf(next.fileScope) > scopes.indexOf(cur.fileScope)) out.push('扩大文件范围');
    if (next.shell && !cur.shell) out.push('允许命令行');
    if (!next.shellConfirm && cur.shellConfirm) out.push('运行命令不再询问');
    if (next.network && !cur.network) out.push('允许联网');
    if (next.lanAccess && !cur.lanAccess) out.push('允许访问内网');
    if (next.credentialFiles && !cur.credentialFiles) out.push('允许读写凭据文件');
    if (!next.redactSecrets && cur.redactSecrets) out.push('关闭密钥脱敏');
    if (!next.redactPersonal && cur.redactPersonal) out.push('关闭个人信息脱敏');
    // An empty list means every public domain; going from empty to a list is a tightening.
    if (
      cur.allowedDomains.length > 0 &&
      (next.allowedDomains.length === 0 || next.allowedDomains.some((d) => !cur.allowedDomains.includes(d)))
    )
      out.push('放宽域名白名单');
    if (cur.sensitiveWords.some((w) => !next.sensitiveWords.includes(w))) out.push('移除敏感词');
  }
  if (Array.isArray(patch.mcpServers)) {
    const old = new Map(
      (s.mcpServers || []).map((m) => [
        m.name,
        JSON.stringify({ ...m, envKeys: undefined, headerKeys: undefined }),
      ]),
    );
    for (const m of patch.mcpServers as { name?: string; enabled?: boolean }[]) {
      const prev = old.get(String(m?.name));
      if (
        (prev === undefined ||
          prev !== JSON.stringify({ ...m, envKeys: undefined, headerKeys: undefined })) &&
        m?.enabled !== false
      )
        out.push(`接入/修改 MCP 服务「${String(m?.name).slice(0, 32)}」`);
    }
  }
  return out;
}
