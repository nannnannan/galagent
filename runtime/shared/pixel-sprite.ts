/**
 * GalAgent 像素小人格式 `galagent-pixel-pet@1`：纯数据（JSON）描述的分层像素角色。
 *
 * 纯 TypeScript，无 DOM / Node 依赖：主进程、渲染进程与 node 脚本（tsx）共用。
 * 角色 = 底图 base + 眼睛 / 嘴巴 / 腮红 / 腿部 / 附件叠层；表情和动作由叠层组合推导，
 * 不需要逐帧手绘。高级用户也可以用 `frames` 为某个动画直接提供整帧。
 */

export const PIXEL_PET_FORMAT = 'galagent-pixel-pet@1' as const;
/** JSON 文本大小上限（字节）。 */
export const PIXEL_PET_MAX_BYTES = 256 * 1024;
export const PIXEL_PET_MIN_SIZE = 16;
export const PIXEL_PET_MAX_SIZE = 64;
export const PIXEL_PET_MAX_PALETTE = 32;
/** 透明 / 不改变的像素。 */
export const PIXEL_TRANSPARENT = '.';
/** 仅叠层可用：把下方像素擦成透明。 */
export const PIXEL_ERASE = '_';

/** 应用层表情（与陪伴核心的 Expression 对齐）。 */
export const PIXEL_EXPRESSIONS = ['neutral', 'curious', 'pleased', 'flustered', 'annoyed', 'softened', 'blink'] as const;
/** 眼睛叠层可用的全部状态：表情 + 睡眠 / 晕眩 / 爱心。 */
export const PIXEL_EYE_STATES = [...PIXEL_EXPRESSIONS, 'sleep', 'dizzy', 'love'] as const;
export const PIXEL_MOUTHS = ['closed', 'open', 'smile', 'pout'] as const;
/** 渲染器支持的动作。 */
export const PIXEL_ACTIONS = ['idle', 'nod', 'sway', 'peek', 'sulk', 'celebrate', 'wave', 'sparkle', 'doodle', 'run', 'sleep', 'think', 'dizzy', 'love'] as const;
/** 循环动作（其余为一次性动作）。 */
export const PIXEL_LOOP_ACTIONS = ['run', 'sleep', 'think'] as const;
/** `frames` 整帧覆盖可用的动画名：所有动作 + walk（漫步）+ drag（被拎起）。 */
export const PIXEL_RAW_ANIMATIONS = [...PIXEL_ACTIONS, 'walk', 'drag'] as const;
export const PIXEL_EXTRA_KINDS = ['ears', 'tail', 'accessory', 'other'] as const;
export const PIXEL_MOTION_STYLES = ['walk', 'hop', 'float'] as const;

export type PixelExpression = (typeof PIXEL_EXPRESSIONS)[number];
export type PixelEyeState = (typeof PIXEL_EYE_STATES)[number];
export type PixelMouth = (typeof PIXEL_MOUTHS)[number];
export type PixelAction = (typeof PIXEL_ACTIONS)[number];
export type PixelRawAnimation = (typeof PIXEL_RAW_ANIMATIONS)[number];
export type PixelExtraKind = (typeof PIXEL_EXTRA_KINDS)[number];
export type PixelMotionStyle = (typeof PIXEL_MOTION_STYLES)[number];

/** 像素网格：每个字符串是一行，每个字符是一个调色板键。 */
export type PixelGrid = string[];
export type PixelPoint = [number, number];

export interface PixelExtra {
  /** 附件标识（同一角色内唯一）。 */
  id: string;
  kind?: PixelExtraKind;
  /** back = 画在底图后面（耳朵、尾巴）；front = 画在最上层（饰品）。默认 front。 */
  layer?: 'back' | 'front';
  /** 叠层左上角在角色坐标中的位置。 */
  at: PixelPoint;
  /** ≥1 帧；多帧时随 extrasPhase 循环播放（摆动）。 */
  frames: PixelGrid[];
}

export interface PixelPetSpec {
  format: typeof PIXEL_PET_FORMAT;
  $schema?: string;
  id: string;
  name: string;
  description: string;
  author?: string;
  tags?: string[];
  size: [number, number];
  palette: Record<string, string>;
  /** 底图：不含眼睛、嘴巴、腿（这些由叠层绘制）。 */
  base: PixelGrid;
  /** 叠层锚点 = 叠层左上角坐标。feet 缺省为底部对齐 x=0。 */
  anchors: { eyes: PixelPoint; mouth: PixelPoint; blush?: PixelPoint; feet?: PixelPoint };
  eyes: { neutral: PixelGrid } & Partial<Record<Exclude<PixelEyeState, 'neutral'>, PixelGrid>>;
  mouth: { closed: PixelGrid; open: PixelGrid; smile?: PixelGrid; pout?: PixelGrid };
  blush?: PixelGrid;
  /** 腿 / 脚的走路帧（≥2）；第 0 帧兼作站立。缺省时走路只上下弹跳。 */
  legs?: PixelGrid[];
  extras?: PixelExtra[];
  /** 自动生成闭眼 / 笑眼 / 晕眩眼时使用的线条颜色（调色板键）。缺省取中性眼里最暗的颜色。 */
  lineColor?: string;
  /** 若底图里画了眼睛，自动生成的眼型会先用该颜色（调色板键）涂掉中性眼的范围。 */
  faceColor?: string;
  motion?: { style?: PixelMotionStyle };
  /** 高级：按动画名提供完整整帧（尺寸 = size），会覆盖程序化组合。 */
  frames?: Partial<Record<PixelRawAnimation, PixelGrid[]>>;
}

export interface PixelFrameState {
  expression?: PixelEyeState;
  mouth?: PixelMouth;
  legFrame?: number;
  blush?: boolean;
  /** 0..1 循环相位，决定附件播放第几帧。 */
  extrasPhase?: number;
  /** 视线偏移（像素，-1..1）：眼睛整体平移，嘴巴水平平移。 */
  look?: [number, number];
  /** 若 spec.frames 中存在该动画，则直接返回整帧。 */
  animation?: string;
  frame?: number;
}

export type PixelPetValidation = { ok: true; spec: PixelPetSpec } | { ok: false; errors: string[] };

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
const EXTRA_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,23}$/;
const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const TOP_LEVEL_KEYS = new Set(['format', '$schema', 'id', 'name', 'description', 'author', 'tags', 'size', 'palette', 'base', 'anchors', 'eyes', 'mouth', 'blush', 'legs', 'extras', 'lineColor', 'faceColor', 'motion', 'frames']);
const MAX_ERRORS = 40;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** 解析 JSON 文本并校验；超过 256 KB 直接拒绝。 */
export function parsePixelPet(text: string): PixelPetValidation {
  if (typeof text !== 'string') return { ok: false, errors: ['输入必须是 JSON 文本'] };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > PIXEL_PET_MAX_BYTES) return { ok: false, errors: [`文件过大：${Math.ceil(bytes / 1024)} KB，上限 256 KB`] };
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch (error) {
    return { ok: false, errors: [`JSON 语法错误：${error instanceof Error ? error.message : String(error)}`] };
  }
  return validatePixelPet(raw);
}

/** 严格校验任意输入是否为合法的像素小人；返回中文错误（带路径）。 */
export function validatePixelPet(raw: unknown): PixelPetValidation {
  const errors: string[] = [];
  const err = (path: string, message: string) => { if (errors.length < MAX_ERRORS) errors.push(`${path}：${message}`); };
  if (!isRecord(raw)) return { ok: false, errors: ['根节点必须是 JSON 对象'] };

  for (const key of Object.keys(raw)) if (!TOP_LEVEL_KEYS.has(key)) err(key, '未知字段');
  if (raw.format !== PIXEL_PET_FORMAT) err('format', `必须为 "${PIXEL_PET_FORMAT}"`);
  if (raw.$schema !== undefined && typeof raw.$schema !== 'string') err('$schema', '必须是字符串');
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) err('id', '必须是 2–40 位小写字母、数字或连字符，且以字母或数字开头');
  checkText(raw.name, 'name', 1, 24, true, err);
  checkText(raw.description, 'description', 1, 200, true, err);
  checkText(raw.author, 'author', 1, 60, false, err);
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.length > 8) err('tags', '必须是最多 8 项的字符串数组');
    else raw.tags.forEach((tag, i) => { if (typeof tag !== 'string' || tag.length < 1 || tag.length > 16) err(`tags[${i}]`, '必须是 1–16 字的字符串'); });
  }

  let width = 0, height = 0;
  if (!Array.isArray(raw.size) || raw.size.length !== 2 || !raw.size.every(v => isInt(v) && v >= PIXEL_PET_MIN_SIZE && v <= PIXEL_PET_MAX_SIZE)) {
    err('size', `必须是 [宽, 高]，每项为 ${PIXEL_PET_MIN_SIZE}–${PIXEL_PET_MAX_SIZE} 的整数`);
  } else [width, height] = raw.size as [number, number];

  const keys = new Set<string>();
  if (!isRecord(raw.palette)) err('palette', '必须是对象：{ "字符": "#rrggbb" }');
  else {
    const entries = Object.entries(raw.palette);
    if (entries.length === 0) err('palette', '至少需要 1 种颜色');
    if (entries.length > PIXEL_PET_MAX_PALETTE) err('palette', `颜色最多 ${PIXEL_PET_MAX_PALETTE} 种，当前 ${entries.length} 种`);
    for (const [key, color] of entries) {
      if ([...key].length !== 1 || key === PIXEL_TRANSPARENT || key === PIXEL_ERASE || /\s/.test(key)) err(`palette["${key}"]`, `键必须是单个非空白字符，且不能是 "${PIXEL_TRANSPARENT}" 或 "${PIXEL_ERASE}"`);
      else if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) err(`palette["${key}"]`, '颜色必须是 #rrggbb 或 #rrggbbaa');
      else keys.add(key);
    }
  }
  const sized = width > 0 && height > 0;

  const grid = (value: unknown, path: string, opts: { erase: boolean; exact?: boolean; at?: PixelPoint | null }) => {
    if (!Array.isArray(value) || value.length === 0) { err(path, '必须是非空的字符串数组（每项一行）'); return false; }
    if (value.length > PIXEL_PET_MAX_SIZE) { err(path, `行数不能超过 ${PIXEL_PET_MAX_SIZE}`); return false; }
    let rowWidth = -1, ok = true;
    for (let y = 0; y < value.length; y++) {
      const row = value[y];
      if (typeof row !== 'string') { err(`${path}[${y}]`, '每一行必须是字符串'); ok = false; continue; }
      const chars = [...row];
      if (rowWidth < 0) rowWidth = chars.length;
      if (chars.length === 0) { err(`${path}[${y}]`, '行不能为空'); ok = false; continue; }
      if (chars.length !== rowWidth) { err(`${path}[${y}]`, `行宽 ${chars.length} 与第 0 行的 ${rowWidth} 不一致`); ok = false; }
      if (opts.exact && sized && chars.length !== width) { err(`${path}[${y}]`, `行宽必须等于 size 宽 ${width}，当前 ${chars.length}`); ok = false; }
      for (let x = 0; x < chars.length; x++) {
        const c = chars[x];
        if (c === PIXEL_TRANSPARENT) continue;
        if (c === PIXEL_ERASE) { if (!opts.erase) { err(`${path}[${y}][${x}]`, `"${PIXEL_ERASE}"（擦除）只能用于叠层`); ok = false; } continue; }
        if (!keys.has(c)) { err(`${path}[${y}][${x}]`, `字符 "${c}" 不在调色板中`); ok = false; }
      }
    }
    if (opts.exact && sized && value.length !== height) { err(path, `行数必须等于 size 高 ${height}，当前 ${value.length}`); ok = false; }
    if (opts.at && sized && rowWidth > 0) {
      const [ax, ay] = opts.at;
      if (ax + rowWidth > width || ay + value.length > height) { err(path, `叠层放在 (${ax}, ${ay}) 时尺寸 ${rowWidth}×${value.length} 超出画布 ${width}×${height}`); ok = false; }
    }
    return ok;
  };
  const point = (value: unknown, path: string): PixelPoint | null => {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(isInt)) { err(path, '必须是 [x, y] 整数坐标'); return null; }
    const [x, y] = value as PixelPoint;
    if (x < 0 || y < 0 || (sized && (x >= width || y >= height))) { err(path, `坐标 (${x}, ${y}) 超出画布`); return null; }
    return [x, y];
  };

  grid(raw.base, 'base', { erase: false, exact: true });

  let eyesAt: PixelPoint | null = null, mouthAt: PixelPoint | null = null, blushAt: PixelPoint | null = null, feetAt: PixelPoint | null = null;
  if (!isRecord(raw.anchors)) err('anchors', '必须是对象，至少包含 eyes 与 mouth');
  else {
    for (const key of Object.keys(raw.anchors)) if (!['eyes', 'mouth', 'blush', 'feet'].includes(key)) err(`anchors.${key}`, '未知锚点（可用：eyes、mouth、blush、feet）');
    eyesAt = point(raw.anchors.eyes, 'anchors.eyes');
    mouthAt = point(raw.anchors.mouth, 'anchors.mouth');
    if (raw.anchors.blush !== undefined) blushAt = point(raw.anchors.blush, 'anchors.blush');
    if (raw.anchors.feet !== undefined) feetAt = point(raw.anchors.feet, 'anchors.feet');
  }

  if (!isRecord(raw.eyes)) err('eyes', '必须是对象，至少包含 neutral');
  else {
    if (raw.eyes.neutral === undefined) err('eyes.neutral', '缺少中性眼（必填）');
    for (const [key, value] of Object.entries(raw.eyes)) {
      if (!(PIXEL_EYE_STATES as readonly string[]).includes(key)) { err(`eyes.${key}`, `未知眼睛状态（可用：${PIXEL_EYE_STATES.join('、')}）`); continue; }
      grid(value, `eyes.${key}`, { erase: true, at: eyesAt });
    }
  }
  if (!isRecord(raw.mouth)) err('mouth', '必须是对象，至少包含 closed 与 open');
  else {
    if (raw.mouth.closed === undefined) err('mouth.closed', '缺少闭嘴（必填）');
    if (raw.mouth.open === undefined) err('mouth.open', '缺少张嘴（必填）');
    for (const [key, value] of Object.entries(raw.mouth)) {
      if (!(PIXEL_MOUTHS as readonly string[]).includes(key)) { err(`mouth.${key}`, `未知嘴型（可用：${PIXEL_MOUTHS.join('、')}）`); continue; }
      grid(value, `mouth.${key}`, { erase: true, at: mouthAt });
    }
  }
  if (raw.blush !== undefined) {
    if (!blushAt && isRecord(raw.anchors) && raw.anchors.blush === undefined) err('anchors.blush', '提供了 blush 叠层时必须设置 blush 锚点');
    grid(raw.blush, 'blush', { erase: true, at: blushAt });
  }
  if (raw.legs !== undefined) {
    if (!Array.isArray(raw.legs) || raw.legs.length < 2 || raw.legs.length > 8) err('legs', '必须是 2–8 帧的数组');
    else raw.legs.forEach((frame, i) => {
      if (!grid(frame, `legs[${i}]`, { erase: true, at: feetAt })) return;
      const rows = (frame as string[]).length;
      if (!feetAt && sized && rows > height) err(`legs[${i}]`, '腿部叠层高于画布');
    });
  }
  if (raw.extras !== undefined) {
    if (!Array.isArray(raw.extras) || raw.extras.length > 8) err('extras', '必须是最多 8 项的数组');
    else {
      const ids = new Set<string>();
      raw.extras.forEach((extra, i) => {
        const path = `extras[${i}]`;
        if (!isRecord(extra)) { err(path, '必须是对象'); return; }
        for (const key of Object.keys(extra)) if (!['id', 'kind', 'layer', 'at', 'frames'].includes(key)) err(`${path}.${key}`, '未知字段');
        if (typeof extra.id !== 'string' || !EXTRA_ID_PATTERN.test(extra.id)) err(`${path}.id`, '必须是 1–24 位小写字母、数字或连字符');
        else if (ids.has(extra.id)) err(`${path}.id`, `与其他附件重复："${extra.id}"`);
        else ids.add(extra.id);
        if (extra.kind !== undefined && !(PIXEL_EXTRA_KINDS as readonly string[]).includes(extra.kind as string)) err(`${path}.kind`, `可用：${PIXEL_EXTRA_KINDS.join('、')}`);
        if (extra.layer !== undefined && extra.layer !== 'back' && extra.layer !== 'front') err(`${path}.layer`, '只能是 "back" 或 "front"');
        const at = point(extra.at, `${path}.at`);
        if (!Array.isArray(extra.frames) || extra.frames.length < 1 || extra.frames.length > 8) err(`${path}.frames`, '必须是 1–8 帧的数组');
        else extra.frames.forEach((frame, f) => grid(frame, `${path}.frames[${f}]`, { erase: true, at }));
      });
    }
  }
  for (const key of ['lineColor', 'faceColor'] as const) {
    const value = raw[key];
    if (value !== undefined && (typeof value !== 'string' || !keys.has(value))) err(key, '必须是调色板中的一个键');
  }
  if (raw.motion !== undefined) {
    if (!isRecord(raw.motion)) err('motion', '必须是对象');
    else {
      for (const key of Object.keys(raw.motion)) if (key !== 'style') err(`motion.${key}`, '未知字段');
      if (raw.motion.style !== undefined && !(PIXEL_MOTION_STYLES as readonly string[]).includes(raw.motion.style as string)) err('motion.style', `可用：${PIXEL_MOTION_STYLES.join('、')}`);
    }
  }
  if (raw.frames !== undefined) {
    if (!isRecord(raw.frames)) err('frames', '必须是对象：{ 动画名: [整帧, ...] }');
    else for (const [key, list] of Object.entries(raw.frames)) {
      if (!(PIXEL_RAW_ANIMATIONS as readonly string[]).includes(key)) { err(`frames.${key}`, `未知动画（可用：${PIXEL_RAW_ANIMATIONS.join('、')}）`); continue; }
      if (!Array.isArray(list) || list.length < 1 || list.length > 16) { err(`frames.${key}`, '必须是 1–16 帧的数组'); continue; }
      list.forEach((frame, f) => grid(frame, `frames.${key}[${f}]`, { erase: false, exact: true }));
    }
  }

  if (errors.length >= MAX_ERRORS) errors.push(`错误过多，仅显示前 ${MAX_ERRORS} 条`);
  return errors.length ? { ok: false, errors } : { ok: true, spec: raw as unknown as PixelPetSpec };
}

function checkText(value: unknown, path: string, min: number, max: number, required: boolean, err: (p: string, m: string) => void) {
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || value.trim().length < min || [...value].length > max) err(path, `${required ? '必填，' : ''}必须是 ${min}–${max} 字的字符串`);
}

// ---------------------------------------------------------------- 组合

type Cells = string[][];

function blank(width: number, height: number): Cells {
  return Array.from({ length: height }, () => Array<string>(width).fill(PIXEL_TRANSPARENT));
}

function stamp(cells: Cells, grid: PixelGrid | undefined, ax: number, ay: number) {
  if (!grid) return;
  const height = cells.length, width = cells[0]?.length ?? 0;
  for (let y = 0; y < grid.length; y++) {
    const ty = ay + y;
    if (ty < 0 || ty >= height) continue;
    const row = [...grid[y]];
    for (let x = 0; x < row.length; x++) {
      const tx = ax + x, c = row[x];
      if (tx < 0 || tx >= width || c === PIXEL_TRANSPARENT) continue;
      cells[ty][tx] = c === PIXEL_ERASE ? PIXEL_TRANSPARENT : c;
    }
  }
}

const derivedCache = new WeakMap<PixelPetSpec, Map<string, PixelGrid>>();

/** 解析某个眼睛状态实际使用的叠层（含自动推导的闭眼 / 笑眼 / 晕眩眼）。 */
export function resolveEyes(spec: PixelPetSpec, state: PixelEyeState): PixelGrid {
  const eyes = spec.eyes as Record<string, PixelGrid | undefined>;
  const own = eyes[state];
  if (own) return own;
  switch (state) {
    case 'blink': return derivedEyes(spec, 'closed');
    case 'sleep': return eyes.blink ?? derivedEyes(spec, 'closed');
    case 'pleased': return derivedEyes(spec, 'happy');
    case 'love': return eyes.pleased ?? derivedEyes(spec, 'happy');
    case 'dizzy': return derivedEyes(spec, 'cross');
    default: return spec.eyes.neutral;
  }
}

export function resolveMouth(spec: PixelPetSpec, mouth: PixelMouth): PixelGrid {
  return spec.mouth[mouth] ?? (mouth === 'open' ? spec.mouth.open : spec.mouth.closed);
}

function derivedEyes(spec: PixelPetSpec, kind: 'closed' | 'happy' | 'cross'): PixelGrid {
  let cache = derivedCache.get(spec);
  if (!cache) derivedCache.set(spec, cache = new Map());
  const hit = cache.get(kind);
  if (hit) return hit;
  const neutral = spec.eyes.neutral.map(row => [...row]);
  const h = neutral.length, w = neutral[0]?.length ?? 0;
  const line = spec.lineColor ?? darkestKey(spec, neutral);
  const out = blank(w, h);
  if (spec.faceColor) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (neutral[y][x] !== PIXEL_TRANSPARENT) out[y][x] = spec.faceColor;
  // 按列把中性眼分割成若干只眼睛
  const used = Array.from({ length: w }, (_, x) => neutral.some(row => row[x] !== PIXEL_TRANSPARENT && row[x] !== PIXEL_ERASE));
  for (let x = 0; x < w; x++) {
    if (!used[x] || (x > 0 && used[x - 1])) continue;
    let x1 = x;
    while (x1 + 1 < w && used[x1 + 1]) x1++;
    let y0 = h, y1 = -1;
    for (let y = 0; y < h; y++) for (let xx = x; xx <= x1; xx++) if (neutral[y][xx] !== PIXEL_TRANSPARENT && neutral[y][xx] !== PIXEL_ERASE) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const ew = x1 - x + 1, eh = y1 - y0 + 1;
    const set = (px: number, py: number) => { if (px >= 0 && px < w && py >= 0 && py < h) out[py][px] = line; };
    if (kind === 'cross') {
      const n = Math.max(2, Math.min(ew, eh, 5)), ox = x + Math.floor((ew - n) / 2), oy = y0 + Math.floor((eh - n) / 2);
      for (let i = 0; i < n; i++) { set(ox + i, oy + i); set(ox + n - 1 - i, oy + i); }
      continue;
    }
    const mid = y0 + Math.ceil((eh - 1) / 2);
    const leftHalf = (x + x1) / 2 < (w - 1) / 2;
    for (let xx = x; xx <= x1; xx++) {
      const edge = xx === x || xx === x1;
      // closed：︶（两端略高），happy：︵（两端略低）；2 像素宽的笑眼用外低内高的斜线
      let dy = ew >= 3 && edge ? (kind === 'closed' ? -1 : 1) : 0;
      if (ew === 2 && kind === 'happy' && eh >= 2) dy = (xx === x) === leftHalf ? 0 : -1;
      set(xx, Math.max(y0, Math.min(y1, mid + dy)));
    }
  }
  const grid = out.map(row => row.join(''));
  cache.set(kind, grid);
  return grid;
}

function darkestKey(spec: PixelPetSpec, cells: Cells): string {
  let best = '', bestLum = Infinity;
  for (const row of cells) for (const c of row) {
    if (c === PIXEL_TRANSPARENT || c === PIXEL_ERASE || c === best) continue;
    const rgba = parseColor(spec.palette[c] ?? '#000000');
    const lum = rgba[0] * 0.299 + rgba[1] * 0.587 + rgba[2] * 0.114;
    if (rgba[3] > 0 && lum < bestLum) { bestLum = lum; best = c; }
  }
  return best || Object.keys(spec.palette)[0];
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
const mod = (v: number, n: number) => ((Math.floor(v) % n) + n) % n;

/** 组合出某个状态下的字符网格（size[1] 行 × size[0] 列）。纯函数、确定性。 */
export function composeGrid(spec: PixelPetSpec, state: PixelFrameState = {}): PixelGrid {
  const [width, height] = spec.size;
  const raw = state.animation ? (spec.frames as Record<string, PixelGrid[] | undefined> | undefined)?.[state.animation] : undefined;
  if (raw && raw.length) {
    const frame = raw[mod(state.frame ?? 0, raw.length)];
    return frame.map(row => [...row].map(c => (c === PIXEL_ERASE ? PIXEL_TRANSPARENT : c)).join(''));
  }
  const cells = blank(width, height);
  const phase = state.extrasPhase ?? 0;
  const extraFrame = (extra: PixelExtra) => extra.frames[mod(phase * extra.frames.length, extra.frames.length)];
  for (const extra of spec.extras ?? []) if (extra.layer === 'back') stamp(cells, extraFrame(extra), extra.at[0], extra.at[1]);
  stamp(cells, spec.base, 0, 0);
  if (spec.legs?.length) {
    const legs = spec.legs[mod(state.legFrame ?? 0, spec.legs.length)];
    const [fx, fy] = spec.anchors.feet ?? [0, height - legs.length];
    stamp(cells, legs, fx, fy);
  }
  if (state.blush && spec.blush && spec.anchors.blush) stamp(cells, spec.blush, spec.anchors.blush[0], spec.anchors.blush[1]);
  const lx = clampInt(state.look?.[0] ?? 0, -1, 1), ly = clampInt(state.look?.[1] ?? 0, -1, 1);
  stamp(cells, resolveEyes(spec, state.expression ?? 'neutral'), spec.anchors.eyes[0] + lx, spec.anchors.eyes[1] + ly);
  stamp(cells, resolveMouth(spec, state.mouth ?? 'closed'), spec.anchors.mouth[0] + lx, spec.anchors.mouth[1]);
  for (const extra of spec.extras ?? []) if (extra.layer !== 'back') stamp(cells, extraFrame(extra), extra.at[0], extra.at[1]);
  return cells.map(row => row.join(''));
}

const colorCache = new Map<string, [number, number, number, number]>();
/** "#rrggbb" / "#rrggbbaa" → [r, g, b, a]（0..255）。 */
export function parseColor(color: string): [number, number, number, number] {
  let hit = colorCache.get(color);
  if (!hit) {
    const hex = color.slice(1);
    hit = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255];
    colorCache.set(color, hit);
  }
  return hit;
}

/** 字符网格 → RGBA（非预乘）。 */
export function gridToRgba(spec: PixelPetSpec, grid: PixelGrid): Uint8ClampedArray {
  const [width, height] = spec.size;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = [...(grid[y] ?? '')];
    for (let x = 0; x < width; x++) {
      const c = row[x];
      if (!c || c === PIXEL_TRANSPARENT || c === PIXEL_ERASE) continue;
      const color = spec.palette[c];
      if (!color) continue;
      const [r, g, b, a] = parseColor(color), i = (y * width + x) * 4;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
    }
  }
  return out;
}

/** 组合出 RGBA 像素（长度 = 宽 × 高 × 4）。纯函数、确定性。 */
export function composeFrame(spec: PixelPetSpec, state: PixelFrameState = {}): Uint8ClampedArray {
  return gridToRgba(spec, composeGrid(spec, state));
}

/** 底图（含第 0 帧腿）的非透明包围盒，用于头顶标签定位与预览裁切。 */
export function opaqueBounds(spec: PixelPetSpec, grid: PixelGrid = composeGrid(spec)): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  grid.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === PIXEL_TRANSPARENT) return;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }));
  return x1 < 0 ? { x: 0, y: 0, width: spec.size[0], height: spec.size[1] } : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** 动作名 → 是否为受支持动作。 */
export const isPixelAction = (value: string): value is PixelAction => (PIXEL_ACTIONS as readonly string[]).includes(value);
