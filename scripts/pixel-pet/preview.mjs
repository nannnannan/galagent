#!/usr/bin/env node
// 用法：node scripts/pixel-pet/preview.mjs <文件.json | 内置id | --all> [输出.png]
// 生成 ×6 精灵表：第 1 行为全部眼睛状态，第 2 行为嘴型、走路帧与附件摆动帧。
// --all：为所有内置小人生成 docs/evidence/pixel-pets/<id>.png 与 gallery.png。
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ROOT, Sheet, builtinIds, loadPet, renderSheet, sprite } from './lib.mjs';

const [ref, outArg] = process.argv.slice(2);
if (!ref) {
  console.error('用法：node scripts/pixel-pet/preview.mjs <文件.json | 内置id | --all> [输出.png]');
  process.exit(2);
}

try {
  if (ref === '--all') {
    const outDir = resolve(outArg ?? join(ROOT, 'docs/evidence/pixel-pets'));
    await mkdir(outDir, { recursive: true });
    const specs = [];
    for (const id of await builtinIds()) {
      const spec = await loadPet(id);
      specs.push(spec);
      await renderSheet(spec).png(join(outDir, `${id}.png`));
    }
    await gallery(specs).png(join(outDir, 'gallery.png'));
    console.log(`已生成 ${specs.length} 张精灵表与 gallery.png → ${outDir}`);
  } else {
    const spec = await loadPet(ref);
    const out = resolve(outArg ?? `${spec.id}-preview.png`);
    await renderSheet(spec).png(out);
    console.log(`已生成预览：${out}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

/** 总览：每只小人一格（中性 / 开心 / 张嘴 / 走路帧），每行 3 只。 */
function gallery(specs) {
  const scale = 4, pad = 3, perRow = 3;
  const states = [{}, { expression: 'pleased', mouth: 'smile', blush: true }, { mouth: 'open', expression: 'curious' }, { legFrame: 1, extrasPhase: 0.5 }];
  const maxW = Math.max(...specs.map(s => s.size[0])), maxH = Math.max(...specs.map(s => s.size[1]));
  const cellW = (maxW + pad * 2) * scale, cellH = (maxH + pad * 2) * scale, groupW = cellW * states.length + 8 * scale;
  const sheet = new Sheet(groupW * perRow, Math.ceil(specs.length / perRow) * cellH);
  specs.forEach((spec, i) => {
    const gx = (i % perRow) * groupW, gy = Math.floor(i / perRow) * cellH;
    sheet.fill(gx + 2, gy + 2, groupW - 8 * scale, cellH - 4, i % 2 ? [236, 228, 244, 255] : [240, 236, 228, 255]);
    states.forEach((state, s) => {
      const [w, h] = spec.size;
      sheet.blit(sprite.composeFrame(spec, state), w, h, gx + s * cellW + (cellW - w * scale) / 2 | 0, gy + (cellH - h * scale - pad * scale), scale);
    });
  });
  return sheet;
}
