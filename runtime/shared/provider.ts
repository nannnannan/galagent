import { apiRoot, endpointUrl } from './endpoints';

export type ChatEndpoint = { baseUrl: string; model: string };
export type SavedChatEndpoint = Partial<ChatEndpoint> & { mode?: unknown; protocol?: unknown; needsConnection?: unknown };

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_CHAT_MODEL = 'gpt-4.1-mini';
export const CHAT_PROTOCOL = 'chat-completions';

export function chatBaseUrl(raw: string): string {
  const root = apiRoot(raw);
  // An explicitly pasted route at the host root must not acquire /v1 on reuse.
  return new URL(root).pathname === '/' ? endpointUrl('chat', raw) : root;
}

/** The old launcher's loopback ports are recognized only when reading a pre-migration profile. */
export function legacyProxyProvider(saved?: SavedChatEndpoint): boolean {
  if (!saved || saved.protocol === CHAT_PROTOCOL) return false;
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(?:18890|8787)(?:\/|$)/i.test(saved.baseUrl || '');
}

export function readChatEndpoint(saved?: SavedChatEndpoint): ChatEndpoint {
  if (!legacyProxyProvider(saved) && typeof saved?.baseUrl === 'string' && typeof saved.model === 'string') {
    const model = saved.model.trim();
    if (model && model.length <= 100) {
      try { return { baseUrl: chatBaseUrl(saved.baseUrl), model }; }
      catch { /* Invalid addresses from old profiles need a fresh connection. */ }
    }
  }
  return { baseUrl: OPENAI_BASE_URL, model: DEFAULT_CHAT_MODEL };
}
