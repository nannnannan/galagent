// Outbound privacy guard. Everything that leaves this machine (model requests,
// executor tool results, TTS text, FetchURL targets) passes through here so keys,
// passwords and the user's own sensitive words are replaced before they go out.
// This is an application-level guard, not an operating-system sandbox.
import type { PrivacyEvent, PrivacyView, SandboxLevel, SandboxSettings } from '../shared/contracts';
import type { Store } from './store';

export const SANDBOX_PRESETS: Record<SandboxLevel, Omit<SandboxSettings, 'level' | 'allowedDomains' | 'sensitiveWords'>> = {
  strict: { fileScope: 'workspace-read', shell: false, shellConfirm: true, network: false, redactSecrets: true, redactPersonal: true },
  standard: { fileScope: 'read-anywhere', shell: true, shellConfirm: true, network: true, redactSecrets: true, redactPersonal: false },
  open: { fileScope: 'anywhere', shell: true, shellConfirm: false, network: true, redactSecrets: true, redactPersonal: false },
  /** 完全放开: everything the app can grant. Outbound redaction stays on by default (its own switch). */
  full: { fileScope: 'anywhere', shell: true, shellConfirm: false, network: true, lanAccess: true, credentialFiles: true, redactSecrets: true, redactPersonal: false },
};
export const DEFAULT_SANDBOX: SandboxSettings = { level: 'standard', ...SANDBOX_PRESETS.standard, allowedDomains: [], sensitiveWords: [] };

const list = (value: unknown, fallback: string[], max: number, width: number) => {
  if (!Array.isArray(value)) return [...fallback];
  const out: string[] = [];
  for (const item of value) if (typeof item === 'string') { const entry = item.trim().slice(0, width); if (entry && !out.includes(entry)) out.push(entry); }
  return out.slice(0, max);
};
/** Picking a level applies its preset; individual switches may then be changed. */
export function normalizeSandbox(raw: unknown, previous: SandboxSettings = DEFAULT_SANDBOX): SandboxSettings {
  if (raw === undefined) return { ...previous };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('沙箱设置格式无效');
  const r = raw as Partial<SandboxSettings>;
  const level = r.level ?? previous.level;
  if (!['strict', 'standard', 'open', 'full'].includes(level)) throw new Error('沙箱级别无效');
  // A new level resets the two "full" switches unless its preset sets them.
  const base: SandboxSettings = level !== previous.level ? { ...previous, lanAccess: false, credentialFiles: false, level, ...SANDBOX_PRESETS[level] } : { ...previous };
  const out: SandboxSettings = { ...base };
  if (r.fileScope !== undefined) { if (!['workspace-read', 'workspace', 'read-anywhere', 'anywhere'].includes(r.fileScope)) throw new Error('文件范围无效'); out.fileScope = r.fileScope; }
  // Settings saved before shellConfirm existed: keep asking unless the level is open.
  if (typeof out.shellConfirm !== 'boolean') out.shellConfirm = out.level !== 'open' && out.level !== 'full';
  for (const key of ['shell', 'shellConfirm', 'network', 'lanAccess', 'credentialFiles', 'redactSecrets', 'redactPersonal'] as const) if (r[key] !== undefined) { if (typeof r[key] !== 'boolean') throw new Error('沙箱开关格式无效'); out[key] = r[key]; }
  out.allowedDomains = list(r.allowedDomains, base.allowedDomains, 100, 200).map(d => d.toLowerCase().replace(/^\*\./, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(d => /^[a-z0-9.-]+$/.test(d));
  out.sensitiveWords = list(r.sensitiveWords, base.sensitiveWords, 200, 100);
  return out;
}

type Rule = { kind: string; label: string; pattern: RegExp; personal?: boolean; check?: (match: string) => boolean; group?: number };
const luhn = (digits: string) => { let sum = 0; for (let i = 0; i < digits.length; i++) { let d = Number(digits[digits.length - 1 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; };
const idCard = (id: string) => { const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]; const sum = w.reduce((s, x, i) => s + x * Number(id[i]), 0); return '10X98765432'[sum % 11] === id[17].toUpperCase(); };
const rules: Rule[] = [
  { kind: 'private-key', label: '私钥', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  { kind: 'api-key', label: '密钥', pattern: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,})\b/g },
  { kind: 'jwt', label: '令牌', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'bearer', label: '令牌', pattern: /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g, group: 1 },
  { kind: 'credential', label: '口令', pattern: /(?<![A-Za-z0-9])[A-Za-z0-9_]*(?:api[_-]?key|secret(?:[_-]?access)?[_-]?key|secret|token|access[_-]?key|client[_-]?secret|password|passwd|pwd)["']?\s*[:=]\s*["']?([^\s"'`,;，。；{}\[\]\\]{6,})/gi, group: 1 },
  { kind: 'credential', label: '口令', pattern: /(?:密码|口令|密钥|支付密码|验证码)\s*(?:[:：=]|是|为)\s*([^\s，。,；;"'`{}\[\]\\]{4,})/g, group: 1 },
  { kind: 'id-card', label: '身份证号', personal: true, pattern: /(?<![0-9A-Za-z])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![0-9A-Za-z])/g, check: idCard },
  { kind: 'bank-card', label: '银行卡号', personal: true, pattern: /(?<![0-9A-Za-z])[3-6]\d{3}(?:[ -]?\d{4}){2,3}(?:[ -]?\d{1,3})?(?![0-9A-Za-z])/g, check: m => { const d = m.replace(/\D/g, ''); return d.length >= 16 && d.length <= 19 && luhn(d); } },
  { kind: 'phone', label: '手机号', personal: true, pattern: /(?<![0-9A-Za-z])(?:\+?86[ -]?)?1[3-9]\d{9}(?![0-9A-Za-z])/g },
  { kind: 'email', label: '邮箱', personal: true, pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type Redaction = { text: string; kinds: string[]; count: number };
export function redactText(text: string, settings: Pick<SandboxSettings, 'redactSecrets' | 'redactPersonal' | 'sensitiveWords'>): Redaction {
  let out = text, count = 0;
  const kinds = new Set<string>();
  // Inline media payloads are opaque base64; scanning them only produces false hits.
  // Value captures stop at quotes, braces and backslashes so masking never breaks the JSON around a secret.
  // Digit rules refuse to start or end inside an alphanumeric run so record IDs (UUID segments) are never mangled.
  if (out.startsWith('data:')) return { text: out, kinds: [], count: 0 };
  for (const rule of rules) {
    if (rule.personal ? !settings.redactPersonal : !settings.redactSecrets) continue;
    out = out.replace(rule.pattern, (match, ...groups) => {
      if (rule.check && !rule.check(match)) return match;
      count++; kinds.add(rule.kind);
      const mask = `〔已隐藏·${rule.label}〕`;
      const value = rule.group ? groups[rule.group - 1] : undefined;
      return typeof value === 'string' && value ? match.replace(value, mask) : mask;
    });
  }
  const words = settings.sensitiveWords.filter(w => w.trim().length >= 2);
  if (words.length) {
    const pattern = new RegExp(words.map(escape).sort((a, b) => b.length - a.length).join('|'), 'gi');
    out = out.replace(pattern, () => { count++; kinds.add('custom'); return '〔已隐藏·敏感词〕'; });
  }
  return { text: out, kinds: [...kinds], count };
}

export class PrivacyGuard {
  constructor(private settings: () => SandboxSettings, private store?: Store, private clock = () => Date.now()) {}
  private record(channel: string, action: PrivacyEvent['action'], kinds: string[], count: number) {
    if (!this.store) return;
    const audit = this.store.get<{ day: string; redacted: number; blocked: number; recent: PrivacyEvent[] }>('privacy-audit');
    const day = new Date(this.clock()).toLocaleDateString('en-CA');
    const next = audit && audit.day === day ? audit : { day, redacted: 0, blocked: 0, recent: audit?.recent || [] };
    if (action === 'redacted') next.redacted += count; else next.blocked += 1;
    const last = next.recent.at(-1);
    // Consecutive identical hits (the same clipboard entry re-sent every heartbeat) fold into one row.
    if (last && last.channel === channel && last.action === action && last.kinds.join() === kinds.join() && this.clock() - Date.parse(last.at) < 60_000) last.count += count;
    else next.recent.push({ at: new Date(this.clock()).toISOString(), channel, action, kinds, count });
    next.recent = next.recent.slice(-60);
    this.store.put('state', 'privacy-audit', next);
  }
  text(text: string, channel: string): string {
    const result = redactText(text, this.settings());
    if (result.count) this.record(channel, 'redacted', result.kinds, result.count);
    return result.text;
  }
  /** Redacts content of chat-completion messages; protocol fields (tool calls, ids, reasoning) are untouched. */
  messages<T extends { content?: unknown }>(messages: T[], channel: string): T[] {
    let total = 0; const kinds = new Set<string>();
    const scrub = (value: string) => { const r = redactText(value, this.settings()); total += r.count; r.kinds.forEach(k => kinds.add(k)); return r.text; };
    const out = messages.map(message => {
      if (typeof message.content === 'string') return { ...message, content: scrub(message.content) };
      if (Array.isArray(message.content)) return { ...message, content: message.content.map(part => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? { ...part, text: scrub((part as { text: string }).text) } : part) };
      return message;
    });
    if (total) this.record(channel, 'redacted', [...kinds], total);
    return out;
  }
  /** FetchURL exfiltration check: secrets in the URL itself are refused, not rewritten. */
  assertUrl(url: URL, channel = 'fetch') {
    const s = this.settings();
    if (!s.network) { this.record(channel, 'blocked', ['network-off'], 1); throw new Error('Network tools are disabled by the GalAgent sandbox'); }
    const host = url.hostname.toLowerCase();
    if (s.allowedDomains.length && !s.allowedDomains.some(d => host === d || host.endsWith('.' + d))) { this.record(channel, 'blocked', ['domain'], 1); throw new Error(`Host ${host} is not in the sandbox allow-list`); }
    let decoded = url.href; try { decoded = decodeURIComponent(url.href); } catch { /* keep raw */ }
    const hit = redactText(decoded, { redactSecrets: true, redactPersonal: s.redactPersonal, sensitiveWords: s.sensitiveWords });
    if (hit.count) { this.record(channel, 'blocked', hit.kinds, 1); throw new Error('URL appears to carry sensitive data; request blocked by the GalAgent sandbox'); }
  }
  blocked(channel: string, kind: string) { this.record(channel, 'blocked', [kind], 1); }
  view(): PrivacyView {
    const audit = this.store?.get<{ day: string; redacted: number; blocked: number; recent: PrivacyEvent[] }>('privacy-audit');
    const today = audit?.day === new Date(this.clock()).toLocaleDateString('en-CA');
    return { redactedToday: today ? audit!.redacted : 0, blockedToday: today ? audit!.blocked : 0, recent: [...(audit?.recent || [])].reverse().slice(0, 30) };
  }
  clear() { this.store?.remove('privacy-audit'); }
}

/** Files that are never readable by tools whatever the sandbox level. */
/** GalAgent's own encrypted keys and app data: never readable by tools, at any level. */
export function galagentSecret(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').toLowerCase(), base = normalized.split('/').pop() || '';
  return /^(provider-key|tts-key|mcp-secrets)\.bin$/.test(base) || /\/appdata\/roaming\/galagent(\/|$)/.test(normalized);
}
export function sensitivePath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  const base = normalized.split('/').pop() || '';
  if (/^(\.env(\..*)?|id_rsa|id_dsa|id_ed25519|id_ecdsa|credentials(\.json)?|\.netrc|_netrc|\.npmrc|\.pypirc|\.git-credentials|wallet\.dat|login data|cookies|web data|key[34]\.db|logins\.json|provider-key\.bin|tts-key\.bin|mcp-secrets\.bin)$/.test(base)) return true;
  if (/\.(pem|key|p12|pfx|kdbx|kdb|keychain|ovpn|gpg)$/.test(base)) return true;
  return /\/(\.ssh|\.aws|\.gnupg|\.kube|\.azure|\.config\/gcloud|\.docker)(\/|$)/.test(normalized) || /\/appdata\/roaming\/galagent(\/|$)/.test(normalized);
}
