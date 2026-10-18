import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ProxyAutostartOptions {
  baseUrl: string;
  desktopDir: string;
  fetchImpl?: typeof fetch;
  spawnImpl?: (scriptPath: string, cwd: string) => Promise<void>;
}

export interface ProxyAutostartResult {
  ok: boolean;
  status: 'not-local-proxy' | 'already-running' | 'started' | 'missing-script' | 'failed';
  port?: number;
  apiKey?: string;
  error?: string;
}

export function resolveLocalProxyDir(baseUrl: string, desktopDir: string): { port: number; dir: string } | null {
  try {
    const parsed = new URL(baseUrl);
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) return null;
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    if (port === 18890) {
      return { port, dir: path.join(desktopDir, 'mira反代', 'kimi-api') };
    }
    if (port === 8787) {
      return { port, dir: path.join(desktopDir, 'mira反代') };
    }
    return null;
  } catch {
    return null;
  }
}

async function probeHealth(port: number, apiKey: string | undefined, fetchImpl: typeof fetch): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetchImpl(`http://127.0.0.1:${port}/health`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { ok?: boolean; upstream?: string } | null;
    return Boolean(data && (data.ok || data.upstream));
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function defaultSpawnStartScript(scriptPath: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
      { cwd, windowsHide: true, stdio: 'ignore' },
    );
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error('Mira 反代启动超时'));
    }, 12000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Mira 反代启动退出码 ${code}`));
    });
  });
}

export async function ensureLocalProxyRunning(options: ProxyAutostartOptions): Promise<ProxyAutostartResult> {
  const target = resolveLocalProxyDir(options.baseUrl, options.desktopDir);
  if (!target) {
    return { ok: true, status: 'not-local-proxy' };
  }
  const fetchImpl = options.fetchImpl || fetch;
  const keyFile = path.join(target.dir, '.local-api-key');
  let apiKey: string | undefined;
  try {
    if (existsSync(keyFile)) {
      apiKey = (await readFile(keyFile, 'utf8')).trim() || undefined;
    }
  } catch {
    /* ignore */
  }

  if (await probeHealth(target.port, apiKey, fetchImpl)) {
    return { ok: true, status: 'already-running', port: target.port, apiKey };
  }

  const startScript = path.join(target.dir, 'start.ps1');
  if (!existsSync(startScript)) {
    return { ok: false, status: 'missing-script', port: target.port, error: `未找到反代启动脚本: ${startScript}` };
  }

  try {
    const runner = options.spawnImpl || defaultSpawnStartScript;
    await runner(startScript, target.dir);
    try {
      if (!apiKey && existsSync(keyFile)) {
        apiKey = (await readFile(keyFile, 'utf8')).trim() || undefined;
      }
    } catch {
      /* ignore */
    }
    if (await probeHealth(target.port, apiKey, fetchImpl)) {
      return { ok: true, status: 'started', port: target.port, apiKey };
    }
    return { ok: false, status: 'failed', port: target.port, error: '反代进程已执行但健康检查未就绪' };
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      port: target.port,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
