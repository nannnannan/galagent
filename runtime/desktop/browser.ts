// Browser perception & metadata bridge (Blueprint Section 7 / Design 9.1).
// Tracks 4 metadata categories (activeTab, openTabs, history, bookmarks) plus
// separate active-tab pageContent with navigation expiry and blocklist gating.
// All browser inputs are observation data only and can never start tasks directly.
import { createHash } from 'node:crypto';
import { blockedBy, DEFAULT_CAPTURE_BLOCKLIST } from './perception';

export type BrowserTab = { tabId?: number; url: string; title: string; active?: boolean };
export type BrowserHistoryItem = { url: string; title: string; visitedAt: string };
export type BrowserBookmarkItem = { id: string; title: string; url?: string; parentId?: string; addedAt?: string };
export type BrowserPageContent = { url: string; title: string; text: string; capturedAt: string; readable: boolean; reason?: string };

export type BrowserReport = {
    source?: string;
    observedAt?: string;
    permissionDenied?: string[];
    activeTab?: { url: string; title?: string; tabId?: number } | null;
    openTabs?: BrowserTab[];
    history?: BrowserHistoryItem[];
    bookmarks?: BrowserBookmarkItem[];
    bookmarkChange?: { kind: 'added' | 'removed' | 'changed'; id: string; title?: string; url?: string };
    pageContent?: { url: string; title?: string; text?: string; readable?: boolean; reason?: string; fromBackgroundTab?: boolean; fromBookmarkOrHistory?: boolean };
};

export type BrowserSnapshot = {
    connected: boolean;
    source?: string;
    observedAt?: string;
    permissionDenied?: string[];
    activeTab?: { url: string; title: string; tabId?: number; updatedAt: string };
    openTabs: BrowserTab[];
    tabCount: number;
    bookmarkCount: number;
    historyCount: number;
    pageContent?: { url: string; title: string; excerpt: string; capturedAt: string; readable: boolean; reason?: string };
};

export type BrowserAttentionSignal = {
    id: string;
    important: boolean;
    summary: string;
    data: Record<string, unknown>;
};

const RESTRICTED_PROTOCOLS = /^(chrome|edge|about|chrome-extension|moz-extension|extension|devtools|view-source|javascript|data|blob):/i;

export function sanitizeBrowserUrl(raw: unknown): string | undefined {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) return undefined;
    const trimmed = raw.trim();
    if (RESTRICTED_PROTOCOLS.test(trimmed)) return trimmed.split(/[?#]/)[0].slice(0, 120);
    try {
        const u = new URL(trimmed);
        if (!['http:', 'https:', 'file:'].includes(u.protocol)) return undefined;
        u.username = '';
        u.password = '';
        return u.toString().slice(0, 1000);
    } catch {
        return undefined;
    }
}

const cleanText = (raw: unknown, max: number) =>
    typeof raw === 'string' ? raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

export class BrowserPerception {
    private connected = false;
    private source?: string;
    private observedAt?: string;
    private permissionDenied: string[] = [];
    private activeTab?: { url: string; title: string; tabId?: number; updatedAt: string };
    private openTabs: BrowserTab[] = [];
    private history: BrowserHistoryItem[] = [];
    private bookmarks: BrowserBookmarkItem[] = [];
    private pageContent?: BrowserPageContent;
    private lastActiveKey = '';
    private lastBookmarkKey = '';
    private seq = 0;

    constructor(private clock: () => number = () => Date.now()) {}

    /** Ingest a browser report; returns deduplicated attention signals if meaningful changes occurred. */
    ingest(report: BrowserReport, options: { enabled: boolean; blocklist?: string[] }): BrowserAttentionSignal[] {
        if (!options.enabled) {
            this.clear();
            return [];
        }
        const now = this.clock();
        const isoNow = new Date(now).toISOString();
        const blocklist = options.blocklist || DEFAULT_CAPTURE_BLOCKLIST;
        const signals: BrowserAttentionSignal[] = [];

        this.connected = true;
        this.source = cleanText(report.source, 64) || 'edge-extension';
        this.observedAt = typeof report.observedAt === 'string' && Number.isFinite(Date.parse(report.observedAt))
            ? new Date(Date.parse(report.observedAt)).toISOString()
            : isoNow;

        if (Array.isArray(report.permissionDenied)) {
            this.permissionDenied = report.permissionDenied
                .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
                .map(p => p.trim().slice(0, 48))
                .slice(0, 10);
        }

        if (Array.isArray(report.openTabs)) {
            const tabs: BrowserTab[] = [];
            for (const item of report.openTabs.slice(0, 50)) {
                if (!item || typeof item !== 'object') continue;
                const url = sanitizeBrowserUrl(item.url);
                if (!url) continue;
                const title = cleanText(item.title, 200);
                if (blockedBy({ appName: url, title, blocklist })) continue;
                tabs.push({
                    ...(typeof item.tabId === 'number' && Number.isInteger(item.tabId) ? { tabId: item.tabId } : {}),
                    url,
                    title,
                    ...(typeof item.active === 'boolean' ? { active: item.active } : {}),
                });
            }
            this.openTabs = tabs;
        }

        if (report.activeTab !== undefined) {
            if (report.activeTab === null) {
                this.activeTab = undefined;
                this.pageContent = undefined;
                this.lastActiveKey = '';
            } else if (typeof report.activeTab === 'object') {
                const url = sanitizeBrowserUrl(report.activeTab.url);
                const title = cleanText(report.activeTab.title, 200);
                if (url && !blockedBy({ appName: url, title, blocklist })) {
                    const previousUrl = this.activeTab?.url;
                    this.activeTab = {
                        url,
                        title,
                        ...(typeof report.activeTab.tabId === 'number' ? { tabId: report.activeTab.tabId } : {}),
                        updatedAt: this.observedAt,
                    };
                    // Navigation invalidates previous pageContent immediately.
                    if (previousUrl && previousUrl !== url && this.pageContent && this.pageContent.url !== url) {
                        this.pageContent = undefined;
                    }
                    const activeKey = `${url}|${title}`;
                    if (activeKey !== this.lastActiveKey) {
                        this.lastActiveKey = activeKey;
                        const digest = createHash('sha256').update(activeKey).digest('hex').slice(0, 10);
                        signals.push({
                            id: `browser-tab:${++this.seq}:${digest}`,
                            important: false,
                            summary: `浏览器活动标签切换：${title ? title + ' · ' : ''}${url}`,
                            data: { category: 'activeTab', url, title, tabCount: this.openTabs.length },
                        });
                    }
                } else if (url && blockedBy({ appName: url, title, blocklist })) {
                    // Blocked site (e.g. online banking / password manager): clear active tab & page content.
                    this.activeTab = undefined;
                    this.pageContent = undefined;
                }
            }
        }

        if (Array.isArray(report.history)) {
            for (const h of report.history.slice(0, 100)) {
                if (!h || typeof h !== 'object') continue;
                const url = sanitizeBrowserUrl(h.url);
                if (!url) continue;
                const title = cleanText(h.title, 200);
                if (blockedBy({ appName: url, title, blocklist })) continue;
                const visitedAt = typeof h.visitedAt === 'string' && Number.isFinite(Date.parse(h.visitedAt))
                    ? new Date(Date.parse(h.visitedAt)).toISOString()
                    : this.observedAt;
                const existingIdx = this.history.findIndex(item => item.url === url);
                if (existingIdx >= 0) this.history.splice(existingIdx, 1);
                this.history.push({ url, title, visitedAt });
            }
            while (this.history.length > 200) this.history.shift();
        }

        if (Array.isArray(report.bookmarks)) {
            const list: BrowserBookmarkItem[] = [];
            for (const b of report.bookmarks.slice(0, 200)) {
                if (!b || typeof b !== 'object' || typeof b.id !== 'string' || !b.id.trim()) continue;
                const url = b.url ? sanitizeBrowserUrl(b.url) : undefined;
                const title = cleanText(b.title, 160);
                if (url && blockedBy({ appName: url, title, blocklist })) continue;
                list.push({
                    id: b.id.trim().slice(0, 64),
                    title,
                    ...(url ? { url } : {}),
                    ...(typeof b.parentId === 'string' ? { parentId: b.parentId.slice(0, 64) } : {}),
                    ...(typeof b.addedAt === 'string' && Number.isFinite(Date.parse(b.addedAt)) ? { addedAt: new Date(Date.parse(b.addedAt)).toISOString() } : {}),
                });
            }
            this.bookmarks = list;
        }

        if (report.bookmarkChange && typeof report.bookmarkChange === 'object') {
            const c = report.bookmarkChange;
            if (['added', 'removed', 'changed'].includes(c.kind) && typeof c.id === 'string' && c.id.trim()) {
                const url = c.url ? sanitizeBrowserUrl(c.url) : undefined;
                const title = cleanText(c.title, 160);
                if (!url || !blockedBy({ appName: url, title, blocklist })) {
                    const bmKey = `${c.kind}:${c.id}:${title}:${url || ''}`;
                    if (bmKey !== this.lastBookmarkKey) {
                        this.lastBookmarkKey = bmKey;
                        if (c.kind === 'added' && url) {
                            this.bookmarks = [...this.bookmarks.filter(b => b.id !== c.id), { id: c.id.slice(0, 64), title, url, addedAt: this.observedAt }].slice(-200);
                        } else if (c.kind === 'removed') {
                            this.bookmarks = this.bookmarks.filter(b => b.id !== c.id);
                        }
                        const label = c.kind === 'added' ? '新增收藏' : c.kind === 'removed' ? '移除收藏' : '更新收藏';
                        signals.push({
                            id: `browser-bookmark:${++this.seq}:${c.id.slice(0, 24)}`,
                            important: false,
                            summary: `浏览器${label}：${title || c.id}${url ? ' (' + url + ')' : ''}`,
                            data: { category: 'bookmark', change: c.kind, id: c.id, title, url },
                        });
                    }
                }
            }
        }

        if (report.pageContent && typeof report.pageContent === 'object') {
            const pc = report.pageContent;
            const url = sanitizeBrowserUrl(pc.url);
            const title = cleanText(pc.title, 200) || this.activeTab?.title || '';
            // Bookmarks, history, and background tabs must NEVER masquerade as current pageContent.
            if (pc.fromBackgroundTab || pc.fromBookmarkOrHistory || !url || !this.activeTab || this.activeTab.url !== url) {
                if (this.pageContent && (!this.activeTab || this.pageContent.url !== this.activeTab.url)) {
                    this.pageContent = undefined;
                }
            } else if (RESTRICTED_PROTOCOLS.test(url) || blockedBy({ appName: url, title, blocklist })) {
                this.pageContent = { url, title, text: '', capturedAt: this.observedAt, readable: false, reason: 'restricted-or-blocked' };
            } else if (pc.readable === false) {
                this.pageContent = { url, title, text: '', capturedAt: this.observedAt, readable: false, reason: cleanText(pc.reason, 80) || 'unreadable-page' };
            } else {
                const text = cleanText(pc.text, 4000);
                this.pageContent = {
                    url,
                    title,
                    text,
                    capturedAt: this.observedAt,
                    readable: text.length > 0,
                    ...(text.length === 0 ? { reason: cleanText(pc.reason, 80) || 'empty-content' } : {}),
                };
            }
        }

        return signals;
    }

    /** Query browser history by optional keyword and/or timestamp. */
    queryHistory(options: { keyword?: string; since?: string | number; limit?: number } = {}): BrowserHistoryItem[] {
        if (this.permissionDenied.includes('history')) return [];
        const kw = (options.keyword || '').trim().toLowerCase();
        const sinceMs = options.since !== undefined ? (typeof options.since === 'number' ? options.since : Date.parse(options.since)) : 0;
        const limit = Math.max(1, Math.min(50, options.limit || 10));
        return [...this.history]
            .reverse()
            .filter(item => {
                if (Number.isFinite(sinceMs) && sinceMs > 0 && Date.parse(item.visitedAt) < sinceMs) return false;
                if (kw && !item.url.toLowerCase().includes(kw) && !item.title.toLowerCase().includes(kw)) return false;
                return true;
            })
            .slice(0, limit);
    }

    getBookmarks(limit = 30): BrowserBookmarkItem[] {
        if (this.permissionDenied.includes('bookmarks')) return [];
        return this.bookmarks.slice(-Math.max(1, Math.min(100, limit)));
    }

    getPageContent(): BrowserPageContent | undefined {
        if (!this.pageContent || !this.activeTab || this.pageContent.url !== this.activeTab.url) return undefined;
        return { ...this.pageContent };
    }

    disconnect() {
        this.connected = false;
        this.pageContent = undefined;
    }

    clear() {
        this.connected = false;
        this.source = undefined;
        this.observedAt = undefined;
        this.permissionDenied = [];
        this.activeTab = undefined;
        this.openTabs = [];
        this.history = [];
        this.bookmarks = [];
        this.pageContent = undefined;
        this.lastActiveKey = '';
        this.lastBookmarkKey = '';
    }

    snapshot(): BrowserSnapshot {
        const currentContent = this.getPageContent();
        return {
            connected: this.connected,
            ...(this.source ? { source: this.source } : {}),
            ...(this.observedAt ? { observedAt: this.observedAt } : {}),
            ...(this.permissionDenied.length ? { permissionDenied: [...this.permissionDenied] } : {}),
            ...(this.activeTab ? { activeTab: { ...this.activeTab } } : {}),
            openTabs: this.openTabs.slice(0, 25).map(t => ({ ...t })),
            tabCount: this.openTabs.length,
            bookmarkCount: this.bookmarks.length,
            historyCount: this.history.length,
            ...(currentContent ? {
                pageContent: {
                    url: currentContent.url,
                    title: currentContent.title,
                    excerpt: currentContent.text.slice(0, 600),
                    capturedAt: currentContent.capturedAt,
                    readable: currentContent.readable,
                    ...(currentContent.reason ? { reason: currentContent.reason } : {}),
                },
            } : {}),
        };
    }
}
