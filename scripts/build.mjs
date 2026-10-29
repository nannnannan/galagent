import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
const root = process.cwd();
await mkdir('dist/main', { recursive: true });
await Promise.all([
  bundle({ entryPoints: ['runtime/main/index.ts'], outfile: 'dist/main/index.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24', sourcemap: true, external: ['electron', '@huggingface/transformers', 'sharp', 'ffmpeg-static'] }),
  bundle({ entryPoints: ['runtime/main/preload.ts'], outfile: 'dist/main/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] }),
]);
await viteBuild({ root: path.join(root, 'runtime/renderer'), base: './', publicDir: false, build: { outDir: path.join(root, 'dist/renderer'), emptyOutDir: true }, server: { host: '127.0.0.1' } });
await mkdir('dist/desktop', { recursive: true });
await copyFile('runtime/desktop/observer.ps1', 'dist/desktop/observer.ps1');
for (const name of ['icon.png', 'icon.ico', 'tray.png']) await copyFile(`runtime/assets/${name}`, `dist/renderer/assets/${name}`);
await copyFile('runtime/workers/embedding.mjs', 'dist/main/embedding.mjs');
await mkdir('dist/licenses',{recursive:true});
await copyFile('runtime/assets/protocol/kimi-code-MIT.txt','dist/licenses/kimi-code-MIT.txt');
// ffmpeg-static names its notices after the platform binary (ffmpeg.exe.* on Windows, ffmpeg.* elsewhere).
for (const [suffix, target] of [['LICENSE', 'ffmpeg-GPL.txt'], ['README', 'ffmpeg-build.txt']]) {
  const source = ['ffmpeg.exe', 'ffmpeg'].map(bin => `node_modules/ffmpeg-static/${bin}.${suffix}`).find(file => existsSync(file));
  if (source) await copyFile(source, `dist/licenses/${target}`);
  else console.warn(`ffmpeg ${suffix} notice not found; run ffmpeg-static install before packaging.`);
}
console.log('GalAgent desktop build ready.');
