// GalAgent content script: extracts visible text excerpt from the active page only.
(() => {
  try {
    if (document.visibilityState !== 'visible') return;
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!text) return;
    chrome.runtime.sendMessage({
      type: 'galagent:page-content',
      url: location.href,
      title: document.title || '',
      text,
    });
  } catch {
    // Restricted pages cannot report content.
  }
})();
