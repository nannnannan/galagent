import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
const svg = await readFile('runtime/assets/icon.svg');
const png = await sharp(svg).resize(256,256).png().toBuffer();
await writeFile('runtime/assets/icon.png', png);
await sharp(svg).resize(32,32).png().toFile('runtime/assets/tray.png');
// ICO containing the lossless 256px PNG, a supported Windows icon entry.
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[8]=0;header[9]=0;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
await writeFile('runtime/assets/icon.ico',Buffer.concat([header,png]));
