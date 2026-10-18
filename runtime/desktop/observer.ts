import { spawn, type ChildProcess } from 'node:child_process';
import type { Observation } from '../shared/contracts';

export type ClipboardSample = { text: string; excluded: boolean; baseline?: boolean };
export type ObserverOptions = { scriptPath: string; onObservation: (value: Observation) => void; onClipboard?: (value: ClipboardSample) => void; includeTitles?: boolean; includeClipboard?: boolean; enabled?: boolean };
const MAX_LINE = 32768;
/** Clipboard samples from the fixed helper. Sensitive-flagged content never carries text. */
export function parseClipboard(line: string): ClipboardSample | undefined {
  if (line.length > MAX_LINE) return;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(line); } catch { return; }
  const clip = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.clipboard as Record<string, unknown> | undefined : undefined;
  if (!clip || typeof clip !== 'object' || Array.isArray(clip) || typeof clip.excluded !== 'boolean') return;
  const text = !clip.excluded && typeof clip.text === 'string' ? clip.text.replace(/\u0000/g, '').slice(0, 2000) : '';
  return { text, excluded: clip.excluded, baseline: clip.baseline === true };
}
type SpawnHelper = (command: string, args: string[], options: { windowsHide: boolean; stdio: ['ignore', 'pipe', 'pipe'] }) => ChildProcess;

/** Strict boundary: discard unknown fields, raw titles when disabled, and stale samples. */
export function parseObservation(line: string, includeTitles = false, now = Date.now()): Observation | undefined {
  if (line.length > MAX_LINE) return;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(line); } catch { return; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.available !== 'boolean' || typeof raw.observedAt !== 'string') return;
  const timestamp = Date.parse(raw.observedAt);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 10_000) return;
  const result: Observation = { available: raw.available, observedAt: new Date(timestamp).toISOString() };
  for (const key of ['locked', 'suspended', 'fullscreen'] as const) if (typeof raw[key] === 'boolean') result[key] = raw[key];
  // An unlocked session must be positively established by the fixed helper.
  if (raw.locked !== false || raw.suspended === true) result.available = false;
  if (result.available) {
    if (typeof raw.appName !== 'string' || !/^[\p{L}\p{N}_. ()-]{1,128}$/u.test(raw.appName)) return;
    result.appName = raw.appName;
    if (typeof raw.idleSeconds === 'number' && Number.isFinite(raw.idleSeconds) && raw.idleSeconds >= 0 && raw.idleSeconds <= 4294968) result.idleSeconds = Math.floor(raw.idleSeconds);
    if (includeTitles && typeof raw.title === 'string') result.title = raw.title.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 256);
  }
  if (typeof raw.error === 'string' && /^[a-z-]{1,64}$/.test(raw.error)) result.error = raw.error;
  return result;
}

export class DesktopObserver {
  private active = false;
  private enabled: boolean;
  private includeTitles: boolean;
  private includeClipboard: boolean;
  private child?: ChildProcess;
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private failures = 0;
  private closing = false;
  private lastSample = 0;
  private staleReported = false;
  constructor(private readonly options: ObserverOptions, private readonly spawnHelper: SpawnHelper = spawn) {
    this.enabled = options.enabled ?? false;
    this.includeTitles = options.includeTitles ?? false;
    this.includeClipboard = options.includeClipboard ?? false;
  }
  start(): void { this.active = true; this.launch(); }
  stop(): void {
    this.active = false;
    this.clearTimers();
    this.shutdown();
  }
  setOptions(options: { enabled?: boolean; includeTitles?: boolean; includeClipboard?: boolean }): void {
    const enabled = options.enabled ?? this.enabled;
    const titles = options.includeTitles ?? this.includeTitles;
    const clipboard = options.includeClipboard ?? this.includeClipboard;
    if (enabled === this.enabled && titles === this.includeTitles && clipboard === this.includeClipboard) return;
    this.enabled = enabled; this.includeTitles = titles; this.includeClipboard = clipboard; this.failures = 0;
    this.clearTimers();
    this.unavailable(enabled ? 'options-changed' : 'observation-disabled');
    if (this.child) this.shutdown(); else this.launch();
  }
  private unavailable(error: string): void {
    this.options.onObservation({ available: false, observedAt: new Date().toISOString(), error });
  }
  private clearTimers(): void {
    if (this.retry) clearTimeout(this.retry);
    if (this.watchdog) clearInterval(this.watchdog);
    this.retry = undefined; this.watchdog = undefined;
  }
  private shutdown(): void {
    if (this.child && !this.closing) { this.closing = true; this.child.kill(); }
  }
  private launch(): void {
    if (!this.active || !this.enabled || this.child || this.retry || this.failures > 3) return;
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.options.scriptPath];
    if (this.includeTitles) args.push('-IncludeTitles');
    if (this.includeClipboard) args.push('-IncludeClipboard');
    const clipboardAtLaunch = this.includeClipboard;
    let child: ChildProcess;
    try { child = this.spawnHelper('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { this.failed(); return; }
    this.child = child; this.closing = false;
    let buffer = '';
    let discardLine = false;
    const titlesAtLaunch = this.includeTitles;
    this.lastSample = Date.now(); this.staleReported = false;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (this.closing || !this.active || !this.enabled || this.child !== child) return;
      for (const part of chunk.split(/(?<=\n)/)) {
        const ended = part.endsWith('\n');
        if (!discardLine) {
          buffer += part;
          if (buffer.length > MAX_LINE) { buffer = ''; discardLine = true; }
        }
        if (ended) {
          if (!discardLine) {
            const line = buffer.trim();
            if (line.includes('"clipboard"')) { const clip = parseClipboard(line); if (clip && clipboardAtLaunch && this.includeClipboard) this.options.onClipboard?.(clip); buffer = ''; discardLine = false; continue; }
            const sample = parseObservation(line, titlesAtLaunch && this.includeTitles);
            if (sample) { this.lastSample = Date.now(); this.staleReported = false; this.options.onObservation(sample); }
          }
          buffer = ''; discardLine = false;
        }
      }
    });
    // Drain errors without persisting script output or private process metadata.
    child.stderr?.resume();
    child.on('error', () => { if (this.child === child) this.unavailable('helper-error'); });
    child.once('close', () => {
      if (this.child !== child) return;
      const intentional = this.closing;
      this.child = undefined; this.closing = false;
      this.clearTimers();
      if (intentional) this.launch(); else this.failed();
    });
    this.watchdog = setInterval(() => {
      if (!this.closing && Date.now() - this.lastSample > 10_000 && !this.staleReported) {
        this.staleReported = true; this.unavailable('observation-stale');
      }
    }, 2000);
    this.watchdog.unref();
  }
  private failed(): void {
    this.unavailable('helper-exited');
    if (!this.active || !this.enabled) return;
    this.failures += 1;
    if (this.failures > 3) { this.unavailable('helper-retry-limit'); return; }
    this.retry = setTimeout(() => { this.retry = undefined; this.launch(); }, 1000 * 2 ** (this.failures - 1));
    this.retry.unref();
  }
}
