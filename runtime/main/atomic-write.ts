import path from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';

export async function atomicWrite(file: string, data: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.new`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}
