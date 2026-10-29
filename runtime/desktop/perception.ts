// Perception boundary (DUAL-CORE DC2). Screenshots and clipboard text are
// observation data only; they never become instructions. Keystroke contents are
// never collected. Raw screenshots stay in memory for a single evaluation and are
// never written to disk.
import { createHash } from 'node:crypto';

export const DEFAULT_CAPTURE_BLOCKLIST = [
    'KeePass', 'KeePassXC', '1Password', 'Bitwarden', 'LastPass', 'Dashlane', 'Keeper', 'Enpass', 'NordPass', 'RoboForm', 'pwsafe', 'KeeWeb',
    '网上银行', '网银', '手机银行', '支付宝', 'Alipay', 'PayPal', '密码管理',
];
export type ScreenShot = { id: string; at: number; dataUrl: string; signature: number[] };
export type CaptureContext = {
    enabled: boolean; paused: boolean; locked?: boolean; suspended?: boolean; fullscreen?: boolean;
    idleSeconds?: number; appName?: string; title?: string; blocklist: string[];
    /** User-chosen gap; the sampler never goes below its own minimum. */
    minIntervalMs?: number;
};
export type ScreenDecision = { shot?: ScreenShot; skipped?: 'disabled' | 'paused' | 'locked' | 'fullscreen' | 'idle' | 'blocked' | 'unchanged' | 'rate' | 'error' };
/** Grayscale thumbnail grid in [0,255]; mean absolute difference in [0,1]. */
export function signatureDistance(a: number[], b: number[]): number {
    if (!a.length || a.length !== b.length) return 1;
    let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / (a.length * 255);
}
export function blockedBy(context: Pick<CaptureContext, 'appName' | 'title' | 'blocklist'>): string | undefined {
    const haystacks = [context.appName || '', context.title || ''].map(s => s.toLowerCase());
    return context.blocklist.find(entry => entry.trim() && haystacks.some(h => h.includes(entry.trim().toLowerCase())));
}
export type Capturer = () => Promise<{ dataUrl: string; signature: number[] } | undefined>;
export class ScreenSampler {
    private lastSent?: { at: number; signature: number[] };
    private seq = 0;
    constructor(private capture: Capturer, private options: { minIntervalMs?: number; changeThreshold?: number; idleLimitSeconds?: number; clock?: () => number } = {}) {}
    get lastSentAt() { return this.lastSent?.at; }
    /** Changed screen ≤ 1 per minute; idle/locked/fullscreen/blocked/paused never capture. */
    async sample(context: CaptureContext): Promise<ScreenDecision> {
        const now = (this.options.clock || Date.now)();
        if (!context.enabled) return { skipped: 'disabled' };
        if (context.paused) return { skipped: 'paused' };
        if (context.locked !== false || context.suspended) return { skipped: 'locked' };
        if (context.fullscreen) return { skipped: 'fullscreen' };
        if ((context.idleSeconds ?? 0) >= (this.options.idleLimitSeconds ?? 300)) return { skipped: 'idle' };
        if (blockedBy(context)) return { skipped: 'blocked' };
        if (this.lastSent && now - this.lastSent.at < Math.max(this.options.minIntervalMs ?? 60000, context.minIntervalMs ?? 0)) return { skipped: 'rate' };
        let raw: Awaited<ReturnType<Capturer>>;
        try { raw = await this.capture(); } catch { return { skipped: 'error' }; }
        if (!raw || !raw.dataUrl.startsWith('data:image/')) return { skipped: 'error' };
        if (this.lastSent && signatureDistance(raw.signature, this.lastSent.signature) < (this.options.changeThreshold ?? 0.02)) return { skipped: 'unchanged' };
        this.lastSent = { at: now, signature: raw.signature };
        return { shot: { id: `screen:${new Date(now).toISOString()}#${++this.seq}`, at: now, dataUrl: raw.dataUrl, signature: raw.signature } };
    }
    reset() { this.lastSent = undefined; }
}

export type ClipboardEntry = { id: string; at: number; text: string; hash: string };
export type ClipboardRead = { text: string; excluded: boolean } | undefined;
/** Recent 50 clipboard texts, memory only. Entries flagged by password managers are skipped. */
export class ClipboardRing {
    readonly entries: ClipboardEntry[] = [];
    private lastHash = '';
    private seq = 0;
    constructor(private readonly capacity = 50, private clock: () => number = () => Date.now()) {}
    private hashOf(read: NonNullable<ClipboardRead>) { return createHash('sha256').update(read.excluded ? '\u0001excluded' : read.text.replace(/\u0000/g, '').trim()).digest('hex'); }
    /** Record the current clipboard as already seen without storing it. */
    prime(read: ClipboardRead) { this.lastHash = read ? this.hashOf(read) : ''; }
    offer(read: ClipboardRead): ClipboardEntry | undefined {
        if (!read) return;
        const text = read.text.replace(/\u0000/g, '').trim();
        const hash = this.hashOf(read);
        if (hash === this.lastHash) return;
        this.lastHash = hash;
        if (read.excluded || !text) return;
        const entry = { id: `clip:${++this.seq}:${hash.slice(0, 12)}`, at: this.clock(), text: text.slice(0, 2000), hash };
        const dupe = this.entries.findIndex(e => e.hash === hash); if (dupe >= 0) this.entries.splice(dupe, 1);
        this.entries.push(entry);
        while (this.entries.length > this.capacity) this.entries.shift();
        return entry;
    }
    recent(count = 5): ClipboardEntry[] { return this.entries.slice(-count); }
    clear() { this.entries.length = 0; this.lastHash = ''; }
}
