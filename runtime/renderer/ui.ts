import { MIRA_DEFAULT_BASE_URL, MIRA_DEFAULT_MODEL } from '../shared/provider';
import type { AppCommand, AppSnapshot, CommandResult, GalAgentBridge } from '../shared/contracts';
import { builtinPersonas } from '../shared/personas';

/** Browser preview (vite dev without Electron) renders the UI against a static snapshot. */
const previewPersona = builtinPersonas[0];
export const previewSnapshot: AppSnapshot = {
  identity: { id: 'preview', name: previewPersona.name, onboarding: 'intro', stage: 'S0' },
  persona: { active: previewPersona, list: builtinPersonas, greeted: false },
  pets: { catalog: [], revision: 0 },
  schedules: [], privacy: { redactedToday: 0, blockedToday: 0, recent: [] },
  activity: { kind: 'offline', label: '预览模式' },
  visual: { expression: 'neutral', action: 'idle', bubble: previewPersona.greeting, revision: 0 }, messages: [], memories: [], diary: [],
  settings: { observationEnabled: false, windowTitlesEnabled: false, initiativeEnabled: true, mischiefEnabled: true, roamingEnabled: true, ttsEnabled: false, ttsBaseUrl: '', ttsModel: 'tts-1', ttsVoice: '', ttsSpeed: 1, quietUntil: 0, proactiveIntervalMinutes: 5, proactiveHourlyLimit: 2, proactiveDailyLimit: 8, petScale: 1, reducedMotion: false, screenCaptureEnabled: true, clipboardEnabled: true, captureBlocklist: [], forbiddenPaths: [], petId: '', heartbeatSeconds: 60, unansweredMinutes: 20, reunionHours: 6, screenIntervalSeconds: 60, idleSleepMinutes: 10, bubbleSeconds: 12, roamSpeed: 1, quietHours: { enabled: false, start: '23:00', end: '08:00' }, funCaptions: true, sandbox: { level: 'standard', fileScope: 'workspace', shell: false, network: true, allowedDomains: [], redactSecrets: true, redactPersonal: false, sensitiveWords: [] } },
  provider: { configured: false, baseUrl: MIRA_DEFAULT_BASE_URL, model: MIRA_DEFAULT_MODEL }, status: { busy: false, online: false, embedding: 'idle', contextTokens: 0, contextBudget: 16000, tasks: [] }, observation: { available: false, observedAt: '' }, stats: { conversations: 0, memories: 0, proactiveToday: 0, tokensToday: 0 },
};
const offline: GalAgentBridge = { getSnapshot: async () => previewSnapshot, onSnapshot: () => () => {}, dispatch: async () => ({ ok: false, error: '浏览器预览未连接桌面程序，不能调用模型或保存数据。' }) };
/** Resolved on every access so a bridge installed after this module loads (tests, previews) is still used. */
export const bridge: GalAgentBridge = new Proxy({} as GalAgentBridge, { get: (_target, key) => Reflect.get(window.galagent || offline, key) });

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); if (className) element.className = className; if (text) element.textContent = text; return element;
}
export function button(text: string, action: () => void, className = 'btn') { const b = el('button', className, text); b.type = 'button'; b.onclick = action; return b; }
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, tone: 'info' | 'error' = 'info') {
  let box = document.querySelector<HTMLElement>('#toast');
  if (!box) { box = el('div', 'toast'); box.id = 'toast'; box.setAttribute('role', 'status'); document.body.append(box); }
  box.textContent = text; box.dataset.tone = tone; box.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => box!.classList.remove('visible'), 5200);
}
type Hook = (command: AppCommand) => void;
const hooks: Hook[] = [];
/** Lets the speech owner stop playback on commands that change who/how she talks. */
export function onCommand(hook: Hook) { hooks.push(hook); }
export async function command(value: AppCommand, quiet = false): Promise<CommandResult> {
  for (const hook of hooks) hook(value);
  try {
    const result = await bridge.dispatch(value);
    if (!result.ok && !quiet) toast(result.error || '这一步没有完成，请稍后重试。', 'error');
    return result;
  } catch (error) { if (!quiet) toast(error instanceof Error ? error.message : '操作失败', 'error'); return { ok: false, error: String(error) }; }
}
/** Labelled form row: <label><span>title<small>hint</small></span>control</label>. */
export function field(title: string, control: HTMLElement, hint = '', className = 'field') {
  const label = el('label', className); const text = el('span', 'field-text'); text.append(el('strong', '', title)); if (hint) text.append(el('small', '', hint)); label.append(text, control); return label;
}
export function toggle(checked: boolean, onChange: (value: boolean) => void, label = '') {
  const input = el('input', 'switch'); input.type = 'checkbox'; input.checked = checked; input.setAttribute('role', 'switch'); if (label) input.setAttribute('aria-label', label); input.onchange = () => onChange(input.checked); return input;
}
/** Free numeric entry: any finite value is sent; the core clamps it and the field shows the stored value. */
export function numberInput(value: number | undefined, onCommit: (value: number) => void, options: { step?: number; unit?: string; placeholder?: string } = {}) {
  const wrap = el('span', 'number-input'); const input = el('input'); input.type = 'number'; input.inputMode = 'decimal'; input.step = String(options.step ?? 'any'); input.value = value === undefined ? '' : String(value); if (options.placeholder) input.placeholder = options.placeholder;
  const commit = () => { const n = Number(input.value); if (input.value.trim() === '' || !Number.isFinite(n)) { toast('请输入有效的数字', 'error'); input.value = value === undefined ? '' : String(value); return; } if (n !== value) onCommit(n); };
  input.onchange = commit; input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } };
  wrap.append(input); if (options.unit) wrap.append(el('span', 'unit', options.unit)); return wrap;
}
export function select<T extends string>(value: T, options: [T, string][], onChange: (value: T) => void) {
  const s = el('select'); for (const [v, label] of options) { const o = el('option', '', label); o.value = v; s.append(o); } s.value = value; s.onchange = () => onChange(s.value as T); return s;
}
export function linesArea(values: string[], onCommit: (values: string[]) => void, rows = 4, placeholder = '') {
  const area = el('textarea'); area.rows = rows; area.value = values.join('\n'); area.placeholder = placeholder;
  area.onchange = () => onCommit(area.value.split('\n').map(x => x.trim()).filter(Boolean)); return area;
}
export const relativeTime = (iso: string) => {
  const diff = Date.parse(iso) - Date.now(), abs = Math.abs(diff), m = Math.round(abs / 60000);
  const text = m < 1 ? '不到 1 分钟' : m < 60 ? `${m} 分钟` : m < 1440 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}` : `${Math.round(m / 1440)} 天`;
  return diff >= 0 ? `${text}后` : `${text}前`;
};
export const clockText = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export const readFileText = (accept: string) => new Promise<string | undefined>(resolve => {
  const input = el('input'); input.type = 'file'; input.accept = accept;
  input.onchange = async () => { const file = input.files?.[0]; if (!file) return resolve(undefined); if (file.size > 300_000) { toast('文件过大', 'error'); return resolve(undefined); } resolve(await file.text()); };
  input.click();
});
