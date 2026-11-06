// 微信收件：用户从微信发来的图片和文件，和 GalAgent 的记忆、存档放在同一个数据目录下（用户 2026-11-06 要求）。
// 放数据目录而不是安装目录：安装包升级会清空安装目录，这里不会。旁边的「记录.jsonl」一行一条，记下收到了什么。
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { WECHAT_INBOX } from '../privacy';

/** A file name off the wire: no folders, no reserved characters, no leading dots, never empty. */
export function safeName(name: string): string {
  const base = basename(name.replace(/\\/g, '/')).replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').trim();
  return base.slice(-120) || '微信文件';
}
export function imageExtension(b: Uint8Array): string {
  const isWebp = b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return b[0] === 0xff && b[1] === 0xd8 ? '.jpg' : b[0] === 0x89 && b[1] === 0x50 ? '.png' : b[0] === 0x47 && b[1] === 0x49 ? '.gif' : isWebp ? '.webp' : '.bin';
}
/** Saves one received item and appends it to the record; returns where it landed. */
export async function saveInbound(dataDir: string, kind: 'image' | 'file', name: string, bytes: Uint8Array, now = new Date()): Promise<string> {
  const dir = join(dataDir, WECHAT_INBOX); await mkdir(dir, { recursive: true });
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const label = kind === 'image' ? `微信图片${imageExtension(bytes)}` : safeName(name);
  const file = join(dir, `${stamp}-${randomBytes(2).toString('hex')} ${label}`);
  await writeFile(file, bytes, { flag: 'wx' });
  await appendFile(join(dir, '记录.jsonl'), JSON.stringify({ at: now.toISOString(), kind, name: label, file: basename(file), bytes: bytes.length }) + '\n');
  return file;
}
