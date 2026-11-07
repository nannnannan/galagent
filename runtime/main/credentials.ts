import { app, safeStorage } from 'electron';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { AppSnapshot } from '../shared/contracts';
import type { McpSecrets } from '../core/mcp';
import type { WeChatSession } from '../core/wechat/bridge';
import { sameOrigin } from '../shared/endpoints';
import { atomicWrite } from './atomic-write';

export function createCredentials(
  dataDir: string,
  override: string | undefined,
  snapshot: () => AppSnapshot | undefined,
) {
  const credentials = {
    async get() {
      const fromEnv =
        process.env.GALAGENT_API_KEY || process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY;
      if (fromEnv) return fromEnv;
      try {
        const encrypted = await readFile(path.join(dataDir, 'provider-key.bin'));
        if (safeStorage.isEncryptionAvailable()) {
          const key = safeStorage.decryptString(encrypted);
          if (key) return key;
        }
      } catch {
        /* no saved application key */
      }
      const provider = snapshot()?.provider;
      if (!override && provider?.mode !== 'native-api' && provider?.baseUrl === 'http://127.0.0.1:18890/v1')
        try {
          return (
            (
              await readFile(
                path.join(app.getPath('desktop'), 'mira反代', 'kimi-api', '.local-api-key'),
                'utf8',
              )
            ).trim() || undefined
          );
        } catch {
          /* existing proxy has no key file */
        }
      return undefined;
    },
    async set(key: string) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥保护不可用，未保存密钥。');
      await atomicWrite(path.join(dataDir, 'provider-key.bin'), safeStorage.encryptString(key));
    },
  };
  const ttsCredentials = {
    async get() {
      if (process.env.MIMO_API_KEY || process.env.TTS_API_KEY)
        return process.env.MIMO_API_KEY || process.env.TTS_API_KEY;
      try {
        const encrypted = await readFile(path.join(dataDir, 'tts-key.bin'));
        if (safeStorage.isEncryptionAvailable()) {
          const key = safeStorage.decryptString(encrypted);
          if (key) return key;
        }
      } catch {
        /* no separate tts key */
      }
      // Only reuse the provider key for a TTS endpoint on the same origin; never send it to a third-party TTS host.
      const snap = snapshot();
      try {
        if (
          snap?.settings.ttsBaseUrl &&
          new URL(snap.settings.ttsBaseUrl.trim()).origin === new URL(snap.provider.baseUrl).origin
        )
          return await credentials.get();
      } catch {
        /* invalid URL */
      }
      return undefined;
    },
    async set(key: string) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥保护不可用，未保存 TTS 密钥。');
      await atomicWrite(path.join(dataDir, 'tts-key.bin'), safeStorage.encryptString(key));
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
  const mcpSecrets = {
    async all(): Promise<Record<string, McpSecrets>> {
      try {
        const encrypted = await readFile(path.join(dataDir, 'mcp-secrets.bin'));
        if (safeStorage.isEncryptionAvailable())
          return JSON.parse(safeStorage.decryptString(encrypted)) || {};
      } catch {
        /* none saved */
      }
      return {};
    },
    async get(server: string): Promise<McpSecrets> {
      return (await mcpSecrets.all())[server] || {};
    },
    async set(server: string, secrets: McpSecrets) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥保护不可用，未保存 MCP 密钥。');
      const all = await mcpSecrets.all();
      if (Object.keys(secrets.env || {}).length || Object.keys(secrets.headers || {}).length)
        all[server] = secrets;
      else delete all[server];
      await atomicWrite(
        path.join(dataDir, 'mcp-secrets.bin'),
        safeStorage.encryptString(JSON.stringify(all)),
      );
    },
  };
  /** 语音输入的密钥：单独 DPAPI 加密；没有单独密钥时，只在地址与语音输出 / 对话模型同源时借用它们的密钥。 */
  const sttCredentials = {
    async get() {
      if (process.env.STT_API_KEY) return process.env.STT_API_KEY;
      try {
        const encrypted = await readFile(path.join(dataDir, 'stt-key.bin'));
        if (safeStorage.isEncryptionAvailable()) {
          const key = safeStorage.decryptString(encrypted);
          if (key) return key;
        }
      } catch {
        /* none */
      }
      const snap = snapshot(),
        url = snap?.settings.sttBaseUrl;
      if (sameOrigin(url, snap?.settings.ttsBaseUrl)) return await ttsCredentials.get();
      if (sameOrigin(url, snap?.provider.baseUrl)) return await credentials.get();
      return undefined;
    },
    async set(key: string) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥保护不可用，未保存语音输入密钥。');
      await atomicWrite(path.join(dataDir, 'stt-key.bin'), safeStorage.encryptString(key));
    },
  };
  /** The key to try against `baseUrl` when listing models: the one typed in the form, else a saved key for exactly that origin. */
  async function keyFor(kind: 'chat' | 'tts' | 'stt', baseUrl: string, typed?: string) {
    if (typed?.trim()) return typed.trim();
    const snap = snapshot()!;
    const saved: [string | undefined, () => Promise<string | undefined>][] = [
      [snap.provider.baseUrl, () => credentials.get()],
      [snap.settings.ttsBaseUrl, () => ttsCredentials.get()],
      [snap.settings.sttBaseUrl, () => sttCredentials.get()],
    ];
    const order =
      kind === 'chat'
        ? saved
        : kind === 'tts'
          ? [saved[1], saved[0], saved[2]]
          : [saved[2], saved[1], saved[0]];
    for (const [url, get] of order)
      if (sameOrigin(url, baseUrl)) {
        const k = await get();
        if (k) return k;
      }
    return undefined;
  }
  return { credentials, ttsCredentials, sttCredentials, mcpSecrets, wechatSecrets, keyFor };
}
