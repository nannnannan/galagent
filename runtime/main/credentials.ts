import { safeStorage } from 'electron';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { AppSnapshot } from '../shared/contracts';
import type { McpSecrets } from '../core/mcp';
import type { WeChatSession } from '../core/wechat/bridge';
import { checkBaseUrl, sameOrigin } from '../shared/endpoints';
import { OPENAI_BASE_URL } from '../shared/provider';
import { atomicWrite } from './atomic-write';

export function createCredentials(
  dataDir: string,
  snapshot: () => AppSnapshot | undefined,
) {
  async function readProtected(file: string): Promise<string | undefined> {
    try {
      if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(await readFile(file));
    } catch { /* Absent or unavailable for this Windows user. */ }
    return undefined;
  }
  function scopedKey(name: string, label: string) {
    const file = path.join(dataDir, name + '-bound.bin');
    const set = async (key: string, baseUrl: string) => {
      const origin = new URL(checkBaseUrl(baseUrl, label)).origin;
      if (!safeStorage.isEncryptionAvailable()) throw new Error(`系统密钥保护不可用，未保存${label}。`);
      await atomicWrite(file, safeStorage.encryptString(JSON.stringify({ origin, key })));
    };
    return {
      set,
      async get(baseUrl?: string) {
        const plain = await readProtected(file);
        try {
          const saved = plain ? JSON.parse(plain) as { origin?: string; key?: string } : undefined;
          if (sameOrigin(baseUrl, saved?.origin) && typeof saved?.key === 'string' && saved.key) return saved.key;
        } catch { /* Unrecognized key metadata is never sent. */ }
        return undefined;
      },
      async migrateLegacy(baseUrl?: string) {
        if (!baseUrl || await readProtected(file)) return;
        const key = await readProtected(path.join(dataDir, name + '.bin'));
        if (key) await set(key, baseUrl);
      },
    };
  }
  const chatKey = scopedKey('provider-key', '对话密钥');
  const ttsKey = scopedKey('tts-key', '语音输出密钥');
  const sttKey = scopedKey('stt-key', '语音输入密钥');
  const credentials = {
    ...chatKey,
    async get(baseUrl = snapshot()?.provider.baseUrl) {
      const saved = await chatKey.get(baseUrl);
      if (saved) return saved;
      if (sameOrigin(baseUrl, process.env.GALAGENT_API_BASE_URL)) return process.env.GALAGENT_API_KEY || undefined;
      if (sameOrigin(baseUrl, OPENAI_BASE_URL) &&
        (!process.env.OPENAI_BASE_URL || sameOrigin(baseUrl, process.env.OPENAI_BASE_URL)) &&
        (!process.env.OPENAI_API_BASE || sameOrigin(baseUrl, process.env.OPENAI_API_BASE))) return process.env.OPENAI_API_KEY || undefined;
      if (sameOrigin(baseUrl, 'https://api.moonshot.cn') || sameOrigin(baseUrl, 'https://api.moonshot.ai')) {
        return process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || undefined;
      }
      return undefined;
    },
  };
  const ttsCredentials = {
    ...ttsKey,
    async get(baseUrl = snapshot()?.settings.ttsBaseUrl) {
      if (!baseUrl) return undefined;
      const saved = await ttsKey.get(baseUrl);
      if (saved) return saved;
      if (sameOrigin(baseUrl, process.env.TTS_API_BASE_URL) && process.env.TTS_API_KEY) return process.env.TTS_API_KEY;
      if (sameOrigin(baseUrl, 'https://api.xiaomimimo.com') && process.env.MIMO_API_KEY) return process.env.MIMO_API_KEY;
      const provider = snapshot()?.provider;
      return provider?.configured && sameOrigin(baseUrl, provider.baseUrl) ? credentials.get(baseUrl) : undefined;
    },
  };
  /** 微信绑定（bot 令牌、绑定的微信号、回复窗口）：整份用 DPAPI 加密，只在桌面进程里。 */
  const wechatSecrets = {
    async load(): Promise<WeChatSession | undefined> {
      try {
        const encrypted = await readFile(path.join(dataDir, 'wechat-session.bin'));
        if (safeStorage.isEncryptionAvailable())
          return JSON.parse(safeStorage.decryptString(encrypted)) as WeChatSession;
      } catch {
        /* not bound */
      }
      return undefined;
    },
    async save(session: WeChatSession | undefined) {
      const file = path.join(dataDir, 'wechat-session.bin');
      if (!session) {
        await writeFile(file, '').catch(() => {});
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥保护不可用，未保存微信绑定。');
      await atomicWrite(file, safeStorage.encryptString(JSON.stringify(session)));
    },
  };
  type StoredMcpSecrets = McpSecrets & { scope?: string };
  let mcpWrite: Promise<void> = Promise.resolve();
  const mcpSecrets = {
    async all(): Promise<Record<string, StoredMcpSecrets>> {
      try {
        const encrypted = await readFile(path.join(dataDir, 'mcp-secrets.bin'));
        if (safeStorage.isEncryptionAvailable())
          return JSON.parse(safeStorage.decryptString(encrypted)) || {};
      } catch {
        /* none saved */
      }
      return {};
    },
    async get(server: string, scope: string): Promise<McpSecrets> {
      const all = await mcpSecrets.all();
      const entry = Object.hasOwn(all, server) ? all[server] : undefined;
      return entry?.scope === scope ? { env: entry.env, headers: entry.headers } : {};
    },
    set(server: string, secrets: McpSecrets, scope: string) {
      return updateMcpSecrets(all => {
        if (Object.keys(secrets.env || {}).length || Object.keys(secrets.headers || {}).length)
          Object.defineProperty(all, server, { value: { ...secrets, scope }, enumerable: true, writable: true, configurable: true });
        else if (Object.hasOwn(all, server) && all[server]?.scope === scope) delete all[server];
        return true;
      });
    },
    bindLegacy(scopes: ReadonlyMap<string, string>) {
      return updateMcpSecrets(all => {
        let changed = false;
        for (const [name, entry] of Object.entries(all)) {
          if (entry && !entry.scope && scopes.has(name)) {
            all[name] = { ...entry, scope: scopes.get(name) };
            changed = true;
          }
        }
        return changed;
      });
    },
  };
  function updateMcpSecrets(update: (all: Record<string, StoredMcpSecrets>) => boolean) {
    const work = mcpWrite.then(async () => {
      const all = await mcpSecrets.all();
      if (!update(all)) return;
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥保护不可用，未保存 MCP 密钥。');
      await atomicWrite(path.join(dataDir, 'mcp-secrets.bin'), safeStorage.encryptString(JSON.stringify(all)));
    });
    mcpWrite = work.catch(() => {});
    return work;
  }
  /** 语音输入的密钥：单独 DPAPI 加密；没有单独密钥时，只在地址与语音输出 / 对话模型同源时借用它们的密钥。 */
  const sttCredentials = {
    ...sttKey,
    async get(baseUrl = snapshot()?.settings.sttBaseUrl) {
      if (!baseUrl) return undefined;
      const saved = await sttKey.get(baseUrl);
      if (saved) return saved;
      if (sameOrigin(baseUrl, process.env.STT_API_BASE_URL) && process.env.STT_API_KEY) return process.env.STT_API_KEY;
      const snap = snapshot();
      if (sameOrigin(baseUrl, snap?.settings.ttsBaseUrl)) return ttsCredentials.get(baseUrl);
      return snap?.provider.configured && sameOrigin(baseUrl, snap.provider.baseUrl) ? credentials.get(baseUrl) : undefined;
    },
  };
  /** The key to try against `baseUrl` when listing models: the one typed in the form, else a saved key for exactly that origin. */
  async function keyFor(kind: 'chat' | 'tts' | 'stt', baseUrl: string, typed?: string) {
    if (typed?.trim()) return typed.trim();
    if (kind === 'chat') return credentials.get(baseUrl);
    const snap = snapshot()!;
    const saved: [string | undefined, () => Promise<string | undefined>][] = [
      [snap.provider.configured ? snap.provider.baseUrl : undefined, () => credentials.get(baseUrl)],
      [snap.settings.ttsBaseUrl, () => ttsCredentials.get(baseUrl)],
      [snap.settings.sttBaseUrl, () => sttCredentials.get(baseUrl)],
    ];
    const order = kind === 'tts' ? [saved[1], saved[0], saved[2]] : [saved[2], saved[1], saved[0]];
    for (const [url, get] of order)
      if (sameOrigin(url, baseUrl)) {
        const k = await get();
        if (k) return k;
      }
    return undefined;
  }
  return { credentials, ttsCredentials, sttCredentials, mcpSecrets, wechatSecrets, keyFor };
}
