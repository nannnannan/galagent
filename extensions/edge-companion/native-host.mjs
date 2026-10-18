// Chromium/Edge Native Messaging framing helper (32-bit LE length prefix + UTF-8 JSON).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function encodeNativeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.length > 1024 * 1024) throw new Error('Native message exceeds 1 MiB limit');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function createNativeDecoder(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > 1024 * 1024) throw new Error('Incoming native message exceeds 1 MiB limit');
      if (buffer.length < 4 + length) break;
      const slice = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      onMessage(JSON.parse(slice.toString('utf8')));
    }
  };
}

export function writeBrowserBridgeReport(
  report,
  dataDir = process.env.GALAGENT_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'GalAgent'),
) {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, 'browser-bridge.json');
  const tmp = `${target}.${process.pid}.tmp`;
  const payload = {
    ...report,
    observedAt: typeof report?.observedAt === 'string' && report.observedAt ? report.observedAt : new Date().toISOString(),
  };
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, target);
  return target;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const decode = createNativeDecoder((message) => {
    try {
      writeBrowserBridgeReport(message);
      process.stdout.write(encodeNativeMessage({ ok: true, receivedAt: new Date().toISOString() }));
    } catch (error) {
      process.stdout.write(encodeNativeMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  });
  process.stdin.on('data', (chunk) => {
    try {
      decode(chunk);
    } catch {
      process.exit(1);
    }
  });
}

