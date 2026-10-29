// 像素小人脚本共用工具：注册 tsx 以便直接 import TS 源码，加载 / 渲染精灵表。
import { register } from 'tsx/esm/api';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register();

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PETS_DIR = join(ROOT, 'runtime/shared/pixel-pets');
export const sprite = await import(pathToFileURL(join(ROOT, 'runtime/shared/pixel-sprite.ts')).href);

/** 按路径或内置 id 读取并校验；失败时抛出带中文错误列表的异常。 */
export async function loadPet(ref) {
  const file = existsSync(ref) ? resolve(ref) : join(PETS_DIR, `${ref}.json`);
  if (!existsSync(file)) throw new Error(`找不到小人文件或内置 id：${ref}`);
  const result = sprite.parsePixelPet(await readFile(file, 'utf8'));
  if (!result.ok) {
    const error = new Error(`校验失败：${file}\n  - ${result.errors.join('\n  - ')}`);
    error.errors = result.errors;
    throw error;
  }
  return result.spec;
}

export async function builtinIds() {
  return (await readdir(PETS_DIR)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
}

/** 简易 RGBA 画布（不依赖 DOM）。 */
export class Sheet {
  constructor(width, height, bg = [246, 240, 250, 255]) {
    this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) this.data.set(bg, i * 4);
  }
  fill(x0, y0, w, h, rgba) {
    for (let y = Math.max(0, y0); y < Math.min(this.height, y0 + h); y++)
      for (let x = Math.max(0, x0); x < Math.min(this.width, x0 + w); x++) this.data.set(rgba, (y * this.width + x) * 4);
  }
  /** 以 scale 倍最近邻放大绘制一帧 RGBA（alpha 混合）。 */
  blit(rgba, fw, fh, ox, oy, scale) {
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const i = (y * fw + x) * 4, a = rgba[i + 3] / 255;
      if (!a) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = ox + x * scale + dx, py = oy + y * scale + dy;
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) continue;
        const j = (py * this.width + px) * 4;
        for (let c = 0; c < 3; c++) this.data[j + c] = rgba[i + c] * a + this.data[j + c] * (1 - a);
        this.data[j + 3] = 255;
      }
    }
  }
  async png(file) {
    const { default: sharp } = await import('sharp');
    await sharp(Buffer.from(this.data.buffer), { raw: { width: this.width, height: this.height, channels: 4 } }).png().toFile(file);
  }
}

/** 预览帧列表：第 1 行全部眼睛状态，第 2 行嘴型 + 走路帧 + 附件帧。 */
export function previewFrames(spec) {
  const { PIXEL_EYE_STATES, PIXEL_MOUTHS } = sprite;
  const blushy = new Set(['flustered', 'softened', 'love']);
  const row1 = PIXEL_EYE_STATES.map(expression => ({ expression, blush: blushy.has(expression), mouth: expression === 'pleased' || expression === 'love' ? 'smile' : expression === 'annoyed' ? 'pout' : 'closed' }));
  const row2 = PIXEL_MOUTHS.map(mouth => ({ mouth }));
  for (let i = 0; i < (spec.legs?.length ?? 0); i++) row2.push({ legFrame: i });
  const extraFrames = Math.max(0, ...(spec.extras ?? []).map(e => e.frames.length));
  for (let i = 1; i < extraFrames; i++) row2.push({ extrasPhase: i / extraFrames });
  return [row1, row2];
}

export function renderSheet(spec, { scale = 6, pad = 2, rows = previewFrames(spec) } = {}) {
  const [w, h] = spec.size, cellW = (w + pad * 2) * scale, cellH = (h + pad * 2) * scale;
  const cols = Math.max(...rows.map(r => r.length));
  const sheet = new Sheet(cols * cellW, rows.length * cellH);
  rows.forEach((row, r) => row.forEach((state, c) => {
    if ((r + c) % 2) sheet.fill(c * cellW, r * cellH, cellW, cellH, [238, 230, 245, 255]);
    sheet.blit(sprite.composeFrame(spec, state), w, h, c * cellW + pad * scale, r * cellH + pad * scale, scale);
  }));
  return sheet;
}
