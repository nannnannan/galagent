// GalAgent Edge/Chromium MV3 background service worker.
// Sends four metadata categories (activeTab, openTabs, history, bookmarks) and
// active-tab pageContent over Native Messaging (or local loopback fallback).
const HOST_NAME = 'com.galagent.companion';
let port = null;
let reconnectTimer = null;

function connectNative() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
    port.onDisconnect.addListener(() => {
      port = null;
      if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connectNative(); }, 5000);
    });
    void pushSnapshot();
  } catch {
    port = null;
  }
}

function sendReport(report) {
  const payload = { source: 'edge-mv3', observedAt: new Date().toISOString(), ...report };
  if (port) {
    try { port.postMessage(payload); return; } catch { port = null; }
  }
}

async function collectOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const openTabs = tabs
      .filter(t => t.url && !t.incognito)
      .slice(0, 50)
      .map(t => ({ tabId: t.id, url: t.url, title: t.title || '', active: !!t.active }));
    const active = openTabs.find(t => t.active) || null;
    return { activeTab: active ? { tabId: active.tabId, url: active.url, title: active.title } : null, openTabs };
  } catch {
    return { permissionDenied: ['tabs'] };
  }
}

async function collectRecentHistory() {
  try {
    const items = await chrome.history.search({ text: '', maxResults: 30, startTime: Date.now() - 24 * 3600 * 1000 });
    return {
      history: items
        .filter(i => i.url)
        .map(i => ({ url: i.url, title: i.title || '', visitedAt: new Date(i.lastVisitTime || Date.now()).toISOString() })),
    };
  } catch {
    return { permissionDenied: ['history'] };
  }
}

async function collectBookmarks() {
  try {
    const recent = await chrome.bookmarks.getRecent(40);
    return {
      bookmarks: recent.map(b => ({
        id: String(b.id),
        title: b.title || '',
        url: b.url || undefined,
        parentId: b.parentId ? String(b.parentId) : undefined,
        addedAt: b.dateAdded ? new Date(b.dateAdded).toISOString() : undefined,
      })),
    };
  } catch {
    return { permissionDenied: ['bookmarks'] };
  }
}

async function pushSnapshot() {
  const [tabsPart, historyPart, bookmarksPart] = await Promise.all([
    collectOpenTabs(),
    collectRecentHistory(),
    collectBookmarks(),
  ]);
  const denied = [
    ...(tabsPart.permissionDenied || []),
    ...(historyPart.permissionDenied || []),
    ...(bookmarksPart.permissionDenied || []),
  ];
  sendReport({
    ...tabsPart,
    ...historyPart,
    ...bookmarksPart,
    ...(denied.length ? { permissionDenied: denied } : {}),
  });
}

chrome.tabs.onActivated.addListener(() => { void collectOpenTabs().then(sendReport); });
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab && !tab.incognito && (changeInfo.status === 'complete' || changeInfo.title || changeInfo.url)) {
    void collectOpenTabs().then(sendReport);
  }
});
chrome.tabs.onRemoved.addListener(() => { void collectOpenTabs().then(sendReport); });
chrome.bookmarks.onCreated.addListener((id, node) => {
  sendReport({ bookmarkChange: { kind: 'added', id: String(id), title: node.title || '', url: node.url || undefined } });
});
chrome.bookmarks.onRemoved.addListener(id => {
  sendReport({ bookmarkChange: { kind: 'removed', id: String(id) } });
});
chrome.bookmarks.onChanged.addListener((id, info) => {
  sendReport({ bookmarkChange: { kind: 'changed', id: String(id), title: info.title || '', url: info.url || undefined } });
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'galagent:page-content' || !sender.tab || sender.tab.incognito || !sender.tab.active) return;
  sendReport({
    pageContent: {
      url: sender.tab.url || message.url || '',
      title: sender.tab.title || message.title || '',
      text: String(message.text || '').slice(0, 4000),
      readable: true,
    },
  });
});

connectNative();
