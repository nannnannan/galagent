import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostName = 'com.galagent.edge_companion';

export function buildEdgeCompanionManifest({
  extensionId = process.env.GALAGENT_EDGE_EXTENSION_ID || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  hostScript = path.join(root, 'extensions', 'edge-companion', 'native-host.mjs'),
  outputDir = process.env.GALAGENT_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'GalAgent'),
} = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const launcherPath = path.join(outputDir, 'galagent-edge-host.cmd');
  const manifestPath = path.join(outputDir, `${hostName}.json`);
  const nodePath = process.execPath;
  const cmdContent = `@echo off\r\n"${nodePath}" "${hostScript}" %*\r\n`;
  fs.writeFileSync(launcherPath, cmdContent, 'utf8');
  const manifest = {
    name: hostName,
    description: 'GalAgent Edge Companion Native Messaging Host',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { hostName, launcherPath, manifestPath, manifest };
}

export function registerEdgeCompanionRegistry(manifestPath) {
  const regKey = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${hostName}`;
  execFileSync('reg.exe', ['add', regKey, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
    stdio: 'pipe',
    windowsHide: true,
  });
  return regKey;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const extensionId = process.argv[2] || process.env.GALAGENT_EDGE_EXTENSION_ID || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const info = buildEdgeCompanionManifest({ extensionId });
  const skipRegistry = process.argv.includes('--no-reg');
  const regKey = skipRegistry ? null : registerEdgeCompanionRegistry(info.manifestPath);
  console.log(JSON.stringify({ ok: true, ...info, regKey }, null, 2));
}
