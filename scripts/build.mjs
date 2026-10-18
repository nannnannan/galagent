import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, copyFile, cp } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
await mkdir('dist/main', { recursive: true });
await mkdir('runtime/renderer/vendor', { recursive: true });
const cubismBanner = 'globalThis.Live2DCubismCore ??= { ColorBlendType_Normal: 0, ColorBlendType_AddCompatible: 1, ColorBlendType_MultiplyCompatible: 2, ColorBlendType_Add: 3, ColorBlendType_AddGlow: 4, ColorBlendType_Darken: 5, ColorBlendType_Multiply: 6, ColorBlendType_ColorBurn: 7, ColorBlendType_LinearBurn: 8, ColorBlendType_Lighten: 9, ColorBlendType_Screen: 10, ColorBlendType_ColorDodge: 11, ColorBlendType_Overlay: 12, ColorBlendType_SoftLight: 13, ColorBlendType_HardLight: 14, ColorBlendType_LinearLight: 15, ColorBlendType_Hue: 16, ColorBlendType_Color: 17 };';
await bundle({ entryPoints: ['prototypes/live2d/cubism-entry.ts'], outfile: 'runtime/renderer/vendor/cubism-framework.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome144', banner: { js: cubismBanner } });
await Promise.all([
  bundle({ entryPoints: ['runtime/main/index.ts'], outfile: 'dist/main/index.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24', sourcemap: true, external: ['electron', '@huggingface/transformers', 'sharp', 'ffmpeg-static'] }),
  bundle({ entryPoints: ['runtime/main/preload.ts'], outfile: 'dist/main/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] }),
]);
await viteBuild({ root: path.join(root, 'runtime/renderer'), base: './', publicDir: false, build: { outDir: path.join(root, 'dist/renderer'), emptyOutDir: true }, server: { host: '127.0.0.1' } });
await mkdir('dist/desktop', { recursive: true });
await copyFile('runtime/desktop/observer.ps1', 'dist/desktop/observer.ps1');
await cp('runtime/assets/character', 'dist/renderer/assets/character', { recursive: true });
await mkdir('dist/renderer/assets/live2d/kimi', { recursive: true });
await copyFile('prototypes/live2d/vendor/CubismSdkForWeb-5-r.5/Core/live2dcubismcore.min.js', 'dist/renderer/assets/live2d/live2dcubismcore.min.js');
for (const item of ['kimi.model3.json', 'kimi.moc3', 'kimi.physics3.json', 'kimi.cdi3.json', 'expressions', 'kimi.2048']) {
  await cp(`art/live2d/export/${item}`, `dist/renderer/assets/live2d/kimi/${item}`, { recursive: true });
}
for (const name of ['icon.png', 'icon.ico', 'tray.png']) await copyFile(`runtime/assets/${name}`, `dist/renderer/assets/${name}`);
await copyFile('runtime/workers/embedding.mjs', 'dist/main/embedding.mjs');
await mkdir('dist/licenses',{recursive:true});
await copyFile('runtime/assets/protocol/kimi-code-MIT.txt','dist/licenses/kimi-code-MIT.txt');
await copyFile('node_modules/ffmpeg-static/ffmpeg.exe.LICENSE','dist/licenses/ffmpeg-GPL.txt');
await copyFile('node_modules/ffmpeg-static/ffmpeg.exe.README','dist/licenses/ffmpeg-build.txt');
console.log('GalAgent desktop build ready.');
