#!/usr/bin/env node
// 由参数化配方生成内置像素小人 JSON（runtime/shared/pixel-pets/<id>.json）。
// 用法：node scripts/pixel-pet/generate-builtins.mjs
// 原理：用椭圆 / 矩形等图元画出色块 → 自动描边 → 加阴影与高光；
// 腿部帧 = 带腿整图与底图的差分；附件（耳朵、尾巴、天线…）单独绘制并描边。
// 所有图案均为本项目原创，按 MIT 与仓库一同发布。
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PETS_DIR, sprite } from './lib.mjs';

const T = '.';

class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.g = Array.from({ length: h }, () => Array(w).fill(T)); }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.in(x, y) ? this.g[y][x] : T; }
  set(x, y, c) { if (this.in(x, y)) this.g[y][x] = c; }
  /** 同时设置 x 与镜像 x（左右对称）。 */
  sym(x, y, c) { this.set(x, y, c); this.set(this.w - 1 - x, y, c); }
  ellipse(cx, cy, rx, ry, c, keep = () => true) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && keep(x, y, this.get(x, y))) this.set(x, y, c);
    }
    return this;
  }
  /** 对称椭圆：以 cx 及其镜像各画一个。 */
  ellipse2(cx, cy, rx, ry, c, keep) { this.ellipse(cx, cy, rx, ry, c, keep); return this.ellipse(this.w - cx, cy, rx, ry, c, keep); }
  rect(x0, y0, x1, y1, c, keep = () => true) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (keep(x, y, this.get(x, y))) this.set(x, y, c);
    return this;
  }
  rect2(x0, y0, x1, y1, c, keep) { this.rect(x0, y0, x1, y1, c, keep); return this.rect(this.w - 1 - x1, y0, this.w - 1 - x0, y1, c, keep); }
  /** 逐行区间 [[y, x0, x1], ...]，对称绘制。 */
  spans2(list, c, keep) { for (const [y, x0, x1] of list) this.rect2(x0, y, x1, y, c, keep); return this; }
  spans(list, c, keep) { for (const [y, x0, x1] of list) this.rect(x0, y, x1, y, c, keep); return this; }
  /** 盖印字符图案；mirror=true 时同时盖到镜像位置（图案水平翻转）。 */
  stamp(x, y, rows, mirror = false) {
    rows.forEach((row, dy) => [...row].forEach((c, dx) => {
      if (c === T) return;
      this.set(x + dx, y + dy, c);
      if (mirror) this.set(this.w - 1 - (x + dx), y + dy, c);
    }));
    return this;
  }
  replace(from, to, keep = () => true) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.g[y][x] === from && keep(x, y)) this.g[y][x] = to;
    return this;
  }
  /** 透明格若 4 邻接任一非透明格 → 描边色。 */
  outline(c) {
    const marks = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.g[y][x] !== T) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const n = this.get(x + dx, y + dy); return n !== T && n !== c; })) marks.push([x, y]);
    }
    for (const [x, y] of marks) this.g[y][x] = c;
    return this;
  }
  /** region 中，下方 depth 格内出现非 region 的像素 → shade（底部阴影）。 */
  shadeBelow(region, shade, depth = 1, keep = () => true, against = () => true) {
    const marks = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.g[y][x] !== region || !keep(x, y)) continue;
      for (let d = 1; d <= depth; d++) { const n = this.get(x, y + d); if (n !== region && n !== shade && against(n)) { marks.push([x, y]); break; } }
    }
    for (const [x, y] of marks) this.g[y][x] = shade;
    return this;
  }
  /** region 中，上方紧邻 against 的像素 → shade（例如刘海下的皮肤阴影）。 */
  shadeUnder(region, against, shade) {
    const marks = [];
    for (let y = 1; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.g[y][x] === region && against.includes(this.g[y - 1][x])) marks.push([x, y]);
    for (const [x, y] of marks) this.g[y][x] = shade;
    return this;
  }
  /** region 中，水平方向靠近轮廓 depth 格以内的像素 → shade（两侧阴影，保持对称）。 */
  shadeSides(region, shade, depth = 1, keep = () => true) {
    const marks = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.g[y][x] !== region || !keep(x, y)) continue;
      for (let d = 1; d <= depth; d++) { const l = this.get(x - d, y), r = this.get(x + d, y); if ((l !== region && l !== shade) || (r !== region && r !== shade)) { marks.push([x, y]); break; } }
    }
    for (const [x, y] of marks) this.g[y][x] = shade;
    return this;
  }
  rows() { return this.g.map(r => r.join('')); }
  clone() { const c = new Canvas(this.w, this.h); c.g = this.g.map(r => [...r]); return c; }
}

// ------------------------------------------------------------- 眼睛与嘴巴图案

/** 左眼图案（右眼自动镜像）。k = 眼线 / 瞳孔，e = 虹膜，w = 高光，p = 爱心粉，j = 汗滴 / 泪光。 */
const EYES = {
  big: { // 3×4
    neutral: ['kkk', 'kwk', 'kek', 'kkk'],
    curious: ['kwk', 'kek', 'kkk', '...'],
    pleased: ['...', '.k.', 'k.k', '...'],
    flustered: ['k..', '.kk', 'k..', '...'],
    annoyed: ['k..', 'kkk', 'kek', '...'],
    softened: ['...', 'kkk', 'kek', 'kkk'],
    blink: ['...', '...', 'k.k', '.k.'],
    sleep: ['...', '...', 'kkk', '...'],
    dizzy: ['k.k', '.k.', 'k.k', '...'],
    love: ['p.p', 'ppp', '.p.', '...'],
  },
  small: { // 2×3
    neutral: ['..', 'kk', 'kk'],
    curious: ['kk', 'kw', 'kk'],
    pleased: ['..', '.k', 'k.'],
    flustered: ['k.', '.k', 'k.'],
    annoyed: ['k.', '.k', '..'],
    softened: ['..', 'kk', 'kw'],
    blink: ['..', '..', 'kk'],
    sleep: ['..', '..', 'kk'],
    dizzy: ['kk', 'kk', '..'],
    love: ['p.', 'pp', '..'],
  },
};
/** 双眼叠层：左眼放在 (lx, y)，右眼为镜像位置；返回锚点与各状态叠层。 */
function eyeSet(style, lx, y, w, overrides = {}) {
  const table = { ...EYES[style], ...overrides };
  const ew = table.neutral[0].length, eh = table.neutral.length, rx = w - lx - ew;
  const width = rx + ew - lx, eyes = {};
  for (const [state, pattern] of Object.entries(table)) {
    const rows = Array.from({ length: eh }, () => Array(width).fill(T));
    pattern.forEach((row, dy) => [...row].forEach((c, dx) => { if (c !== T) { rows[dy][dx] = c; rows[dy][width - 1 - dx] = c; } }));
    eyes[state] = rows.map(r => r.join(''));
  }
  return { anchor: [lx, y], eyes };
}
/** 对称叠层：给出左半图案（宽 half），右半镜像，总宽 2*half。 */
const mirrorRows = rows => rows.map(r => r + [...r].reverse().join(''));

const MOUTH = {
  small: { closed: mirrorRows(['.k', '..']), open: mirrorRows(['.k', 'km', '.k']), smile: mirrorRows(['k.', '.k']), pout: mirrorRows(['..', '.k', 'k.']) },
  cat: { closed: mirrorRows(['..n', '.k.', '..k']), open: mirrorRows(['..n', '.km', '..k']), smile: mirrorRows(['..n', 'k..', '.kk']), pout: mirrorRows(['..n', '..k', '.k.']) },
};

const blushSet = (x, y, w, c = 'p') => ({ anchor: [x, y], rows: [mirrorRows([c + c + T.repeat(w / 2 - 2)])[0]] });

// ------------------------------------------------------------- 组装

function diffRows(full, base, y0) {
  const out = [];
  for (let y = y0; y < full.h; y++) {
    let row = '';
    for (let x = 0; x < full.w; x++) {
      const a = full.g[y][x], b = base.g[y][x];
      row += a === b ? T : a === T ? '_' : a;
    }
    out.push(row);
  }
  return out;
}

function crop(canvases) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const c of canvases) for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (c.g[y][x] !== T) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { at: [x0, y0], frames: canvases.map(c => c.g.slice(y0, y1 + 1).map(r => r.slice(x0, x1 + 1).join(''))) };
}

function build(r) {
  const [w, h] = r.size, o = r.outline ?? 'o';
  const draw = legs => { const c = new Canvas(w, h); r.shapes(c, legs); c.outline(o); r.finish?.(c, legs); return c; };
  const base = draw(null);
  const spec = {
    format: sprite.PIXEL_PET_FORMAT, id: r.id, name: r.name, description: r.description, author: 'GalAgent', tags: r.tags,
    size: r.size, palette: r.palette, base: base.rows(),
    anchors: { eyes: r.eyes.anchor, mouth: r.mouth.anchor },
    eyes: r.eyes.eyes, mouth: r.mouth.shapes,
  };
  if (r.blush) { spec.anchors.blush = r.blush.anchor; spec.blush = r.blush.rows; }
  if (r.legFrames) {
    spec.anchors.feet = [0, r.feetY];
    spec.legs = Array.from({ length: r.legFrames }, (_, i) => diffRows(draw(i), base, r.feetY));
  }
  if (r.extras?.length) spec.extras = r.extras.map(e => {
    const drawn = Array.from({ length: e.frames }, (_, i) => { const c = new Canvas(w, h); e.draw(c, i); c.outline(e.outline ?? o); e.finish?.(c, i); return c; });
    // 3 帧摆动（中 / 右 / 左）展开为 中→右→中→左 的循环，播放更顺
    const frames = drawn.length === 3 ? [drawn[0], drawn[1], drawn[0], drawn[2]] : drawn;
    return { id: e.id, kind: e.kind, layer: e.layer ?? 'back', ...crop(frames) };
  });
  if (r.lineColor) spec.lineColor = r.lineColor;
  if (r.faceColor) spec.faceColor = r.faceColor;
  if (r.motion) spec.motion = { style: r.motion };
  return spec;
}

// ------------------------------------------------------------- 配方：人类小人

const SKIN = { s: '#ffe6d5', S: '#f6bfa6' };
const FACE = { k: '#2d1b2e', e: '#6b4fa8', w: '#ffffff', p: '#ff9eb0', m: '#c4475f' };

/** 通用 Q 版人类：oy = 整体下移（给帽子留空间）。 */
function human(o) {
  const oy = o.oy ?? 0, H = 32 + oy;
  const shapes = (c, legs) => {
    // 后发（长发垂到背后）
    if (o.hair === 'long') c.ellipse(16, 13 + oy, 11.5, 13, 'h', (x, y) => y > 10 + oy && y <= 27 + oy);
    // 身体
    c.spans2([[21 + oy, 13, 15], [22 + oy, 12, 15], [23 + oy, 11, 15], [24 + oy, 11, 15], [25 + oy, 11, 15], [26 + oy, 10, 15], [27 + oy, 10, 15]], 'c');
    c.rect2(8, 22 + oy, 9, 24 + oy, 'c').rect2(8, 25 + oy, 9, 25 + oy, 's');
    o.body?.(c, oy);
    // 头发与脸
    c.ellipse(16, 11.6 + oy, 11, 9.8, 'h');
    c.rect2(5, 12 + oy, 7, o.hair === 'short' ? 16 + oy : 19 + oy, 'h');
    c.ellipse(16, 14.4 + oy, 8.6, 7.4, 's', (x, y) => y >= 9 + oy);
    // 刘海（对称齿形）
    const fringe = o.fringe ?? [[9, 8, 15], [10, 8, 9], [10, 11, 13], [11, 8, 8], [11, 12, 12]];
    c.spans2(fringe.map(([y, a, b]) => [y + oy, a, b]), 'h', (x, y, cur) => cur === 's');
    // 腿
    if (legs !== null) {
      const fy = 28 + oy, lift = [[0, 0], [1, 0], [0, 0], [0, 1]][legs];
      for (const [side, up] of [[0, lift[0]], [1, lift[1]]]) {
        const x0 = side ? 17 : 13;
        if (!up) c.rect(x0, fy, x0 + 1, fy, o.legColor ?? 's');
        const sx0 = side ? 17 : 12;
        c.rect(sx0, fy + 1 - up, sx0 + 2, fy + 1 - up, 'b');
      }
    }
    o.hat?.(c, oy);
  };
  const finish = (c, legs) => {
    c.shadeBelow('h', 'H', 1);
    c.shadeUnder('s', ['h', 'H'], 'S');
    c.shadeBelow('c', 'C', 1);
    c.shadeSides('c', 'C', 1, (x, y) => y >= 23 + oy);
    // 发丝高光
    c.spans2([[4 + oy, 10, 12], [5 + oy, 9, 9]], 'L', (x, y, cur) => cur === 'h');
    o.details?.(c, oy, legs);
  };
  return {
    size: [32, H], shapes, finish, feetY: 28 + oy, legFrames: 4,
    eyes: eyeSet('big', 10, 13 + oy, 32), mouth: { anchor: [14, 19 + oy], shapes: MOUTH.small }, blush: blushSet(8, 18 + oy, 16),
    ...o,
  };
}

const sunnyGirl = human({
  id: 'sunny-girl', name: '小晴', description: '元气满满的短发女孩，橘色波波头上翘着一根呆毛，最喜欢晒太阳和给你打气。', tags: ['人类', '元气', '短发'],
  palette: { o: '#4a2a2a', ...SKIN, h: '#f08a3c', H: '#c45f28', L: '#ffc178', c: '#ffd34d', C: '#e9a92a', d: '#ffffff', r: '#ff5d6e', b: '#a0523a', ...FACE },
  hair: 'bob',
  body(c, oy) { c.spans2([[21 + oy, 13, 15], [22 + oy, 14, 15]], 'd'); c.sym(15, 23 + oy, 'r'); },
  details(c, oy) { c.stamp(21, 7 + oy, ['.r.', 'rrr', '.r.']); },
  oy: 2,
  extras: [{
    id: 'ahoge', kind: 'accessory', layer: 'front', frames: 3,
    draw(c, f) { for (const [x, y] of [[[16, 3], [16, 2], [17, 1], [18, 1]], [[16, 3], [16, 2], [16, 1], [17, 0]], [[16, 3], [16, 2], [15, 1], [14, 1]]][f]) c.set(x, y, 'h'); },
    // 只保留发丝上方的描边，避免在头发上留下黑点
    finish(c) { for (let x = 0; x < c.w; x++) for (let y = 4; y < c.h; y++) c.set(x, y, '.'); c.set(16, 3, 'h'); },
  }],
});

const scholarBoy = human({
  id: 'scholar-boy', name: '书生', description: '安静的少年，戴着圆框眼镜，怀里抱着一本书，偶尔捧杯热茶陪你慢慢想事情。', tags: ['人类', '沉稳', '眼镜'],
  palette: { o: '#2b2530', ...SKIN, h: '#4a3b35', H: '#30262a', L: '#7b665a', c: '#4f7a6a', C: '#3a5a4f', d: '#f4f1ea', g: '#8a6ad0', y: '#c98b4b', Y: '#8f5c2f', b: '#3a3040', ...FACE },
  hair: 'short',
  fringe: [[9, 8, 15], [10, 8, 10], [10, 12, 15], [11, 8, 8], [11, 13, 14]],
  body(c, oy) {
    c.spans2([[21 + oy, 13, 15], [22 + oy, 14, 15], [23 + oy, 15, 15]], 'd');
    c.rect(12, 24 + oy, 19, 27 + oy, 'y'); c.rect(12, 24 + oy, 12, 27 + oy, 'Y'); c.rect(13, 25 + oy, 18, 25 + oy, 'Y');
    c.rect2(10, 24 + oy, 11, 25 + oy, 's');
  },
  legColor: 'C',
  extras: [{
    id: 'glasses', kind: 'accessory', layer: 'front', frames: 1,
    draw(c) { for (const x0 of [9, 18]) { c.rect(x0 + 1, 12, x0 + 3, 12, 'g'); c.rect(x0 + 1, 17, x0 + 3, 17, 'g'); c.rect(x0, 13, x0, 16, 'g'); c.rect(x0 + 4, 13, x0 + 4, 16, 'g'); } c.rect(14, 14, 17, 14, 'g'); },
    outline: 'g', finish(c) { c.replace('g', 'g'); },
  }],
});
// 眼镜不需要外描边：用“描边色=自身色”的方式跳过（outline 遇到自身色不扩散）。

const peachTwin = human({
  id: 'peach-twintail', name: '小桃', description: '扎着粉色双马尾的水手服少女，一激动双马尾就甩来甩去，最爱和你分享今天的小发现。', tags: ['人类', '双马尾', '活泼'],
  palette: { o: '#4a2738', ...SKIN, h: '#ff9cc2', H: '#e06d9c', L: '#ffd3e4', c: '#ffffff', C: '#d9e0f0', d: '#3c5a9a', r: '#ff5d6e', b: '#3c3045', ...FACE, e: '#c0407a' },
  hair: 'bob',
  fringe: [[9, 8, 15], [10, 8, 9], [10, 12, 14], [11, 8, 8], [11, 13, 13]],
  body(c, oy) { c.spans2([[21, 12, 15], [22, 11, 13]], 'd'); c.spans2([[22, 15, 15], [23, 14, 15]], 'r'); c.spans2([[27, 10, 15], [26, 10, 15]], 'd'); },
  legColor: 's',
  extras: [{
    id: 'twintails', kind: 'accessory', frames: 3,
    draw(c, f) {
      const s = [0, 1, -1][f];
      c.rect(4, 7, 5, 10, 'h'); c.rect(26, 7, 27, 10, 'h');
      c.ellipse(3.9 - s * 0.6, 16, 2.8, 6.2, 'h'); c.ellipse(28.1 - s * 0.6, 16, 2.8, 6.2, 'h');
    },
    finish(c) { c.shadeBelow('h', 'H', 1); c.spans2([[12, 3, 3], [13, 3, 3]], 'L', (x, y, cur) => cur === 'h'); },
  }, {
    id: 'bobbles', kind: 'accessory', layer: 'front', frames: 1,
    draw(c) { c.rect2(5, 6, 6, 7, 'r'); },
  }],
});

const starWitch = human({
  id: 'star-witch', name: '小魔女', description: '戴着星月尖帽的小魔女，紫色长发在夜风里轻轻摆动，会悄悄为你点亮几颗星星。', tags: ['人类', '魔法', '长发'],
  oy: 7,
  palette: { o: '#2a1f3d', ...SKIN, h: '#8b6fd6', H: '#5e47a8', L: '#c3b0ff', c: '#3c3f8f', C: '#2a2c66', d: '#ffd75e', t: '#33306b', T: '#211f4a', b: '#2a2440', ...FACE },
  hair: 'long',
  body(c, oy) { c.spans2([[21 + oy, 14, 15]], 'd'); c.sym(15, 24 + oy, 'd'); },
  hat(c, oy) {
    // 帽檐 + 尖顶（略微弯向右侧）
    c.spans([[oy + 2, 6, 25], [oy + 3, 5, 26]], 't');
    c.spans([[0, 19, 20], [1, 18, 20], [2, 17, 20], [3, 16, 20], [4, 15, 20], [5, 13, 20], [6, 12, 20], [7, 11, 21], [8, 10, 21]].filter(([y]) => y < oy + 2), 't');
  },
  details(c, oy) {
    c.shadeBelow('t', 'T', 1);
    c.spans([[oy + 1, 11, 20]], 'd', (x, y, cur) => cur === 't');
    c.stamp(14, 4, ['.d.', 'ddd', '.d.']);
  },
});


// Kimi：长白发 + 淡紫内层、女仆风木耳边发箍、右鬓三角棱镜发饰（内嵌彩虹）、深蓝星空披肩与 K 标记胸针。
const kimiStar = human({
  id: 'kimi-star', name: 'Kimi 娘', description: '来自 Kimi 的桌面少女：白发淡紫内层，戴着木耳边发箍和棱镜发饰，星空披肩上别着 K 标记，喜欢弹钢琴。', tags: ['人类', '长发', '星空', 'Kimi'],
  oy: 2,
  palette: { o: '#3a2f52', ...SKIN, h: '#efebf9', H: '#b9a4ec', L: '#ffffff', c: '#25305e', C: '#171f42', d: '#fff3b0', w: '#ffffff', W: '#e3dcf5', q: '#8fd3ff', Q: '#ff9ad5', g: '#ffd75e', b: '#2a2440', ...FACE, e: '#7a5cd6' },
  hair: 'long',
  body(c, oy) {
    // 星空披肩上的星点与胸前 K 标记胸针
    c.set(11, 24 + oy, 'd'); c.set(20, 25 + oy, 'd'); c.set(12, 27 + oy, 'd'); c.set(19, 27 + oy, 'd');
    c.spans2([[21 + oy, 14, 15]], 'w');
    c.stamp(14, 22 + oy, ['g.g', 'gg.', 'g.g']);
  },
  legColor: 'W',
  details(c, oy) {
    const hair = (x, y, cur) => cur === 'h' || cur === 'L' || cur === 'H';
    // 白发淡紫内层：发尾一圈透出淡紫
    c.replace('h', 'H', (x, y) => y >= 18 + oy);
    // 木耳边发箍：藏青发带 + 上沿白色木耳边
    c.spans([[5 + oy, 7, 24]], 'c', hair);
    for (let x = 8; x <= 23; x += 2) if (hair(x, 4 + oy, c.get(x, 4 + oy))) c.set(x, 4 + oy, 'W');
    // 右鬓三角棱镜发饰（内嵌彩虹）
    c.stamp(21, 8 + oy, ['.q.', 'qQq', 'gqQ']);
  },
});

// ------------------------------------------------------------- 配方：更多人类（职业 / 年龄 / 肤色各不相同）

/** 程序员：乱乱的深蓝短发、头戴大耳机、灰色连帽卫衣。 */
const coderHoodie = human({
  id: 'coder-hoodie', name: '阿码', description: '戴着大耳机、穿灰色连帽卫衣的程序员少年，头发总是乱乱的，代码跑通的瞬间会悄悄握拳。', tags: ['人类', '程序员', '耳机'],
  oy: 1,
  palette: { o: '#232a3a', ...SKIN, h: '#33405e', H: '#222b45', L: '#6577a0', c: '#9aa6ba', C: '#76829a', d: '#ffffff', z: '#ff6b5e', Z: '#c94a40', g: '#3a3f4f', n: '#3e5c8a', b: '#eef2f8', ...FACE, e: '#3a4f86' },
  hair: 'short',
  fringe: [[9, 8, 15], [10, 8, 10], [10, 12, 13], [11, 8, 9], [11, 13, 13], [12, 8, 8]],
  legColor: 'n',
  body(c, oy) {
    c.rect2(9, 20 + oy, 12, 21 + oy, 'c'); // 帽兜露在肩后
    c.sym(14, 22 + oy, 'd'); c.sym(14, 23 + oy, 'd'); // 抽绳
    c.rect(12, 26 + oy, 19, 26 + oy, 'C'); // 袋鼠兜
  },
  extras: [{
    id: 'headphones', kind: 'accessory', layer: 'front', frames: 1,
    draw(c) {
      c.spans([[1, 11, 20], [2, 9, 10], [2, 21, 22], [3, 8, 8], [3, 23, 23]], 'g');
      c.rect2(7, 4, 7, 9, 'g');
      c.rect2(4, 10, 6, 15, 'z'); c.rect2(6, 11, 6, 14, 'Z');
    },
  }],
});

/** 宇航员：白色头盔开着面窗、橙色条纹航天服、头盔天线一闪一闪。 */
const astroKid = human({
  id: 'astro-kid', name: '星航', description: '穿白色航天服的小宇航员，头盔面窗里露出好奇的脸，天线灯一闪一闪，梦想是带你去看地球升起。', tags: ['人类', '宇航员', '太空'],
  oy: 2,
  palette: { o: '#2b3350', s: '#f1c29b', S: '#d6a07c', h: '#f4f6fb', H: '#c5cde0', L: '#ffffff', c: '#f4f6fb', C: '#c5cde0', v: '#7fb8ff', n: '#5a3a2a', r: '#ff8a3d', q: '#3d6fd8', b: '#5a6378', ...FACE, e: '#4a3a2a' },
  hair: 'short',
  fringe: [],
  legColor: 'c',
  body(c, oy) {
    c.spans2([[21 + oy, 12, 15]], 'C'); // 领圈
    c.rect2(10, 26 + oy, 15, 26 + oy, 'r'); // 腰间橙色条纹
    c.stamp(12, 23 + oy, ['.q.', 'qqq', '.q.']); // 胸前星形徽章
  },
  details(c, oy) {
    // 面窗边框：贴着头盔的那一圈皮肤换成蓝色镜框
    const marks = [];
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      if (c.g[y][x] !== 's' && c.g[y][x] !== 'S') continue;
      if ([[1, 0], [-1, 0], [0, -1]].some(([dx, dy]) => ['h', 'H', 'L'].includes(c.get(x + dx, y + dy)))) marks.push([x, y]);
    }
    for (const [x, y] of marks) c.set(x, y, 'v');
    // 面窗里露出一点棕色刘海
    c.spans2([[10 + oy, 9, 15], [11 + oy, 9, 10], [11 + oy, 13, 14]], 'n', (x, y, cur) => cur === 's' || cur === 'S');
  },
  extras: [{
    id: 'antenna', kind: 'accessory', frames: 2,
    draw(c, f) { c.rect(23, 1, 23, 4, 'H'); c.set(23, 0, f ? 'r' : 'q'); },
  }],
});

/** 小厨师：高高的白色厨师帽、红色领巾、双排扣白色厨师服。 */
const chefSpoon = human({
  id: 'chef-spoon', name: '阿勺', description: '戴着高高厨师帽的小厨师，系着红领巾，最拿手的是番茄炒蛋，总惦记着你今天有没有好好吃饭。', tags: ['人类', '厨师', '美食'],
  oy: 7,
  palette: { o: '#3a2620', s: '#c98a5e', S: '#a86c45', h: '#3b2a22', H: '#2a1d18', L: '#6a5040', c: '#fbfbf7', C: '#dcdcd2', t: '#ffffff', T: '#dedfd8', r: '#e5484d', R: '#b8333a', d: '#3a3a46', n: '#3a3a46', b: '#2b2b30', ...FACE, e: '#4a2e20' },
  hair: 'short',
  fringe: [[9, 8, 15], [10, 8, 9], [10, 11, 12], [11, 8, 8]],
  legColor: 'n',
  body(c, oy) {
    c.spans2([[21 + oy, 13, 15], [22 + oy, 14, 15]], 'r'); c.sym(15, 23 + oy, 'R'); // 领巾
    c.sym(13, 24 + oy, 'd'); c.sym(13, 26 + oy, 'd'); // 双排扣
  },
  hat(c, oy) {
    c.ellipse(16, 4.2, 6.6, 4, 't'); c.ellipse2(10.2, 5.4, 4.2, 3.4, 't');
    c.rect(8, 5, 23, oy + 3, 't');
  },
  details(c, oy) {
    c.shadeBelow('t', 'T', 1);
    for (const x of [11, 14, 17, 20]) c.rect(x, oy + 1, x, oy + 2, 'T', (xx, yy, cur) => cur === 't');
  },
});

/** 侦探：格纹猎鹿帽、金色短发、驼色风衣，手里一把放大镜。 */
const sleuthGirl = human({
  id: 'sleuth-girl', name: '小探', description: '戴着格纹猎鹿帽、穿驼色风衣的小侦探，举着放大镜到处找线索，最擅长帮你找回“刚才还在这儿”的东西。', tags: ['人类', '侦探', '推理'],
  oy: 3,
  palette: { o: '#3a2a1e', ...SKIN, h: '#f2c76b', H: '#c99a40', L: '#fff0b8', c: '#c08a52', C: '#94653a', t: '#8a6a4a', T: '#6b4f35', u: '#b8946a', d: '#ffffff', g: '#7a5a30', l: '#cfeaff', n: '#4a3a50', b: '#4a3428', ...FACE, e: '#3f6a52' },
  hair: 'bob',
  legColor: 'n',
  body(c, oy) {
    c.spans2([[21 + oy, 13, 15], [22 + oy, 14, 15]], 'd'); // 衬衫领口
    c.rect(10, 25 + oy, 21, 25 + oy, 'C'); // 腰带
    c.sym(14, 23 + oy, 'C'); c.sym(14, 27 + oy, 'C');
  },
  hat(c, oy) {
    c.ellipse(16, oy + 6, 11.4, 6.6, 't', (x, y) => y <= oy + 5);
    c.rect(11, oy + 6, 20, oy + 6, 'T'); // 前帽檐
    c.rect(15, oy - 2, 16, oy - 1, 'T'); // 头顶系好的护耳绳结
  },
  details(c, oy) {
    for (let y = 0; y <= oy + 5; y++) for (let x = 0; x < c.w; x++) if (c.get(x, y) === 't' && ((x - 16) % 3 === 0 || (y - oy) % 3 === 0)) c.set(x, y, 'u');
  },
  extras: [{
    id: 'magnifier', kind: 'accessory', layer: 'front', frames: 1,
    draw(c) {
      c.set(23, 27, 'g'); c.set(24, 26, 'g'); c.set(25, 25, 'g');
      c.ellipse(27, 22, 3, 3, 'g'); c.ellipse(27, 22, 2, 2, 'l'); c.set(26, 21, 'd');
    },
  }],
});

/** 古风少女：黑色长发盘着发髻、金簪与流苏、薄荷绿交领襦裙、红色腰带。 */
const hanfuGirl = human({
  id: 'hanfu-girl', name: '青禾', description: '穿薄荷绿交领襦裙的古风少女，发髻上插着金簪，流苏随步子轻轻摇，说话慢慢的，喜欢陪你读诗喝茶。', tags: ['人类', '古风', '汉服', '长发'],
  oy: 4,
  palette: { o: '#2a2230', ...SKIN, h: '#2b2233', H: '#1b1520', L: '#5e4e70', c: '#bfe3d0', C: '#8fc4ab', d: '#ffffff', r: '#d9485b', g: '#e7b84a', q: '#ff8fa3', b: '#7a5a4a', ...FACE, e: '#5a3a2a' },
  hair: 'long',
  fringe: [[9, 8, 15], [10, 8, 9], [10, 13, 15], [11, 8, 8]],
  legColor: 'c',
  body(c, oy) {
    c.rect2(7, 22 + oy, 9, 25 + oy, 'c'); c.rect2(8, 25 + oy, 9, 25 + oy, 's'); // 宽袖
    for (const [x, y] of [[13, 21], [14, 22], [15, 23], [16, 24], [18, 21], [17, 22]]) c.set(x, y + oy, 'd'); // 交领（右衽）
    c.rect(10, 25 + oy, 21, 25 + oy, 'r'); // 腰带
  },
  hat(c, oy) { c.ellipse(16, oy - 0.2, 4.6, 3.6, 'h'); },
  details(c, oy) {
    c.rect(10, oy - 1, 13, oy - 1, 'g'); c.set(9, oy - 2, 'g'); // 金簪
    c.stamp(7, oy + 6, ['.q.', 'qgq', '.q.']); // 鬓边小花
    c.spans2([[oy + 1, 14, 14]], 'L', (x, y, cur) => cur === 'h');
  },
  extras: [{
    id: 'tassel', kind: 'accessory', layer: 'front', frames: 3,
    draw(c, f) { const s = [0, 1, -1][f]; c.rect(20, 5, 20, 7, 'g'); c.rect(20 + s, 8, 20 + s, 10, 'q'); },
  }],
});

/** 老爷爷：秃顶白发、浓白眉与白胡子、棕色开衫。 */
const grandpaFu = human({
  id: 'grandpa-fu', name: '福爷爷', description: '笑眯眯的白胡子老爷爷，穿着棕色开衫，肚子里装满了老故事，常念叨“慢慢来，不着急”。', tags: ['人类', '长者', '胡子'],
  palette: { o: '#3a2c26', s: '#f5d2b8', S: '#e0ad8f', h: '#ececf2', H: '#c3c4cf', L: '#ffffff', w: '#fff6ee', c: '#9b6b43', C: '#7a5230', d: '#f3e6c8', n: '#5a5a66', b: '#4a3a30', ...FACE, e: '#4a3a30' },
  hair: 'short',
  fringe: [],
  legColor: 'n',
  body(c) {
    c.spans2([[21, 14, 15], [22, 15, 15], [23, 15, 15], [24, 15, 15], [25, 15, 15], [26, 15, 15], [27, 15, 15]], 'd'); // 开衫里的衬衫
    c.sym(14, 24, 'C'); c.sym(14, 26, 'C');
  },
  details(c) {
    // 秃顶：头顶的白发换成皮肤，留一点反光
    c.replace('h', 's', (x, y) => y <= 8 && x >= 9 && x <= 22); c.replace('L', 's', (x, y) => y <= 8);
    c.replace('H', 's', (x, y) => y <= 8 && x >= 9 && x <= 22);
    c.set(12, 4, 'w'); c.set(13, 4, 'w'); c.set(11, 5, 'w');
    c.spans2([[11, 9, 12]], 'h'); // 浓眉
    c.spans2([[18, 12, 15]], 'h'); // 八字胡
    c.ellipse(16, 21.6, 4.6, 2.8, 'h', (x, y) => y >= 21); c.shadeBelow('h', 'H', 1, (x, y) => y >= 21);
  },
});

/** 运动少年：红色棒球帽、蓝色 7 号球衣、短裤和白球鞋。 */
const sportyKid = human({
  id: 'sporty-kid', name: '阿跑', description: '戴红色棒球帽、穿 7 号球衣的运动少年，精力多到用不完，看你久坐就拉你起来伸伸腰。', tags: ['人类', '运动', '棒球帽'],
  oy: 2,
  palette: { o: '#2a2020', s: '#e0a57c', S: '#c4865c', h: '#2a2222', H: '#1a1414', L: '#5a4a4a', c: '#3f7be0', C: '#2c5cb0', t: '#e5484d', T: '#b8333a', d: '#ffffff', n: '#2c3a5a', b: '#ffffff', ...FACE, e: '#3a2a20' },
  hair: 'short',
  fringe: [[9, 8, 15], [10, 8, 9], [10, 12, 13]],
  body(c, oy) {
    c.stamp(14, 22 + oy, ['ddd', '..d', '.d.', '.d.']); // 7 号
    c.rect(10, 26 + oy, 21, 27 + oy, 'n'); // 短裤
  },
  hat(c, oy) {
    c.ellipse(16, oy + 8.6, 11, 7.2, 't', (x, y) => y <= oy + 7);
    c.rect(5, oy + 8, 23, oy + 8, 't'); // 帽口
    c.spans([[oy + 7, 24, 28], [oy + 8, 24, 30], [oy + 9, 25, 29]], 'T'); // 歪向一侧的帽檐
    c.set(16, oy + 1, 'T');
  },
  details(c, oy) { c.spans2([[oy + 3, 12, 13], [oy + 4, 11, 11]], 'd', (x, y, cur) => cur === 't'); c.rect(5, oy + 8, 23, oy + 8, 'T', (x, y, cur) => cur === 't'); },
});

// ------------------------------------------------------------- 配方：动物与奇妙生物

const mochiCat = {
  id: 'mochi-cat', name: '麻薯', description: '圆滚滚的奶白猫，一天要睡十八个小时，醒着的时候会慢吞吞地蹭你的鼠标。', tags: ['猫', '慵懒', '圆滚滚'],
  size: [32, 32],
  palette: { o: '#4b3434', f: '#fff6ea', F: '#efd6c2', q: '#f2b48a', n: '#ff8fa3', i: '#ffc2cc', b: '#efd6c2', ...FACE },
  shapes(c, legs) {
    c.ellipse(16, 19.5, 12.2, 9.6, 'f', (x, y) => y <= 28);
    c.spans2([[6, 6, 7], [7, 6, 8], [8, 6, 9], [9, 6, 10], [10, 6, 11]], 'f');
    if (legs !== null) { const up = [[0, 0], [1, 0], [0, 0], [0, 1]][legs]; c.rect(9, 29 - up[0], 12, 29 - up[0], 'f'); c.rect(19, 29 - up[1], 22, 29 - up[1], 'f'); }
  },
  finish(c) {
    c.shadeBelow('f', 'F', 1); c.shadeSides('f', 'F', 1, (x, y) => y > 19);
    c.spans2([[8, 7, 7], [9, 7, 8], [10, 8, 8]], 'i');
    c.spans([[10, 14, 17], [11, 15, 16]], 'q'); c.spans2([[11, 11, 12], [11, 19, 20]].slice(0, 1), 'q');
  },
  eyes: eyeSet('small', 10, 15, 32), mouth: { anchor: [13, 18], shapes: MOUTH.cat }, blush: blushSet(8, 18, 16),
  feetY: 28, legFrames: 4,
  extras: [{
    id: 'tail', kind: 'tail', frames: 3,
    draw(c, f) { const tip = [[29, 17], [30, 19], [28, 16]][f]; c.spans([[26, 24, 27], [25, 26, 28], [24, 27, 28], [23, 28, 29], [22, 28, 29], [21, 28, 29], [20, 28, 29]], 'q'); c.rect(tip[0] - 1, tip[1], tip[0], tip[1] + 2, 'q'); },
    finish(c) { c.shadeBelow('q', 'q'); },
  }],
};

const foxKit = {
  id: 'fox-kit', name: '橘子', description: '机灵的小橘狐，大尾巴蓬松得像一团火，听到你的声音耳朵就会竖起来。', tags: ['狐狸', '机灵', '毛茸茸'],
  size: [32, 32],
  palette: { o: '#4a2418', f: '#f5893a', F: '#d0662a', y: '#fff3e3', Y: '#ecd2bd', d: '#5a3326', i: '#ffd0b3', n: '#3a2018', b: '#5a3326', ...FACE, e: '#8a4a20' },
  shapes(c, legs) {
    c.spans2([[2, 6, 6], [3, 6, 7], [4, 6, 8], [5, 6, 9], [6, 6, 10], [7, 6, 11]], 'f');
    c.spans2([[21, 12, 15], [22, 11, 15], [23, 11, 15], [24, 11, 15], [25, 11, 15], [26, 11, 15], [27, 11, 15]], 'f');
    c.ellipse(16, 14, 10.8, 8.6, 'f');
    c.ellipse(16, 18.2, 8.6, 4.2, 'y', (x, y) => y >= 16);
    c.spans2([[22, 14, 15], [23, 13, 15], [24, 13, 15], [25, 14, 15]], 'y');
    if (legs !== null) { const up = [[0, 0], [1, 0], [0, 0], [0, 1]][legs]; c.rect(12, 28 - up[0], 14, 29 - up[0], 'd'); c.rect(17, 28 - up[1], 19, 29 - up[1], 'd'); }
  },
  finish(c) {
    const edge = n => n === 'o' || n === '.';
    c.shadeBelow('f', 'F', 1, undefined, edge); c.shadeBelow('y', 'Y', 1, undefined, edge);
    c.spans2([[3, 7, 7], [4, 7, 7], [5, 7, 8], [6, 8, 8]], 'i');
    c.spans2([[2, 6, 6], [3, 6, 6]], 'd');
  },
  eyes: eyeSet('big', 10, 13, 32), mouth: { anchor: [13, 18], shapes: MOUTH.cat }, blush: blushSet(8, 18, 16),
  feetY: 28, legFrames: 4,
  extras: [{
    id: 'tail', kind: 'tail', frames: 3,
    draw(c, f) {
      const sway = [0, 1, -1][f];
      c.ellipse(26 + sway * 0.6, 20, 4.2, 6.8, 'f'); c.ellipse(25, 25.5, 3.5, 2.5, 'f');
      c.ellipse(26.4 + sway * 0.8, 14.8, 2.6, 2.6, 'y');
    },
    finish(c) { c.shadeBelow('f', 'F'); },
  }],
};

const roboUnit = {
  id: 'robo-unit', name: '小铆', description: '认真负责的小机器人秘书，屏幕脸上的像素眼会眨，系着小领结帮你记日程。', tags: ['机器人', '秘书', '认真'],
  size: [32, 32],
  palette: { o: '#2a3247', g: '#eef3fa', G: '#b8c4d8', q: '#1f2a44', Q: '#2e3d61', a: '#7fe0c9', A: '#4fb39d', e: '#7ff4ff', r: '#ff6b81', p: '#ff9eb0', w: '#ffffff', b: '#8793ab' },
  shapes(c, legs) {
    c.spans2([[5, 8, 15], [6, 7, 15]], 'g'); c.rect(6, 7, 25, 18, 'g'); c.spans2([[19, 7, 15], [20, 8, 15]], 'g');
    c.rect2(4, 11, 5, 14, 'a');
    c.spans2([[22, 11, 15], [23, 10, 15], [24, 10, 15], [25, 10, 15], [26, 10, 15], [27, 11, 15]], 'g');
    c.rect2(8, 23, 8, 25, 'G');
    if (legs !== null) { const up = [[0, 0], [1, 0], [0, 0], [0, 1]][legs]; c.rect(12, 28 - up[0], 14, 29 - up[0], 'b'); c.rect(17, 28 - up[1], 19, 29 - up[1], 'b'); }
  },
  finish(c) {
    c.shadeBelow('g', 'G', 1); c.shadeSides('g', 'G', 1, (x, y) => y > 21);
    c.spans2([[8, 9, 15], [9, 8, 15], [10, 8, 15], [11, 8, 15], [12, 8, 15], [13, 8, 15], [14, 8, 15], [15, 8, 15], [16, 9, 15]], 'q');
    c.rect(9, 9, 10, 9, 'Q'); c.set(9, 10, 'Q');
    c.rect2(4, 11, 4, 14, 'A');
    c.stamp(13, 21, ['rr..rr', 'rrrrrr', 'rr..rr']);
    c.rect2(13, 24, 15, 26, 'a'); c.stamp(15, 25, ['rr']);
  },
  eyes: eyeSet('small', 11, 11, 32, {
    neutral: ['ee', 'ee', 'ee'], curious: ['ee', 'ee', 'e.'], pleased: ['..', '.e', 'e.'], flustered: ['e.', '.e', 'e.'], annoyed: ['..', 'ee', 'ee'],
    softened: ['..', 'ee', '..'], blink: ['..', '..', 'ee'], sleep: ['..', '..', 'ee'], dizzy: ['ee', 'e.', 'ee'], love: ['r.', 'rr', '..'],
  }),
  mouth: { anchor: [14, 15], shapes: { closed: mirrorRows(['ee', '..']), open: mirrorRows(['ee', 'e.']), smile: mirrorRows(['e.', '.e']), pout: mirrorRows(['.e', 'e.']) } },
  blush: blushSet(9, 15, 14, 'p'),
  lineColor: 'e', faceColor: 'q', feetY: 28, legFrames: 4,
  extras: [{
    id: 'antenna', kind: 'accessory', frames: 2,
    draw(c, f) { c.rect(15, 2, 16, 4, 'G'); c.ellipse(16 + (f ? 0.5 : -0.5), 1.5, 1.6, 1.6, f ? 'a' : 'r'); },
  }],
};

const cloudSprite = {
  id: 'cloud-sprite', name: '棉花云', description: '软绵绵的小云朵精灵，飘在桌面上发呆，开心时会冒出彩虹色的小星星。', tags: ['精灵', '软绵绵', '漂浮'],
  size: [32, 32], outline: 'o', motion: 'float',
  palette: { o: '#6f7bb3', f: '#ffffff', F: '#dde6ff', u: '#c6d2f7', ...FACE, k: '#3a3f6b' },
  shapes(c, legs) {
    c.ellipse(16, 18.5, 12.6, 7.4, 'f');
    c.ellipse2(10.5, 13.5, 5.6, 5.4, 'f');
    c.ellipse(16, 10.6, 6.4, 5.8, 'f');
    c.ellipse2(5.6, 20.5, 4.2, 4.2, 'f');
    if (legs !== null) { const s = [0, 1, 0, -1][legs]; c.ellipse(11 + s * 0.5, 25.4, 3, 2.2, 'f'); c.ellipse(21 + s * 0.5, 25.4, 3, 2.2, 'f'); }
  },
  finish(c) { c.shadeBelow('f', 'F', 2); c.shadeBelow('F', 'u', 1, () => true); c.replace('u', 'F'); },
  eyes: eyeSet('big', 10, 15, 32), mouth: { anchor: [14, 20], shapes: MOUTH.small }, blush: blushSet(8, 19, 16),
  feetY: 24, legFrames: 4,
};

const tinyDino = {
  id: 'tiny-dino', name: '小恐博士', description: '额头戴着护目镜、穿小白大褂的绿色小恐龙，正在研究为什么今天的你也这么努力。', tags: ['恐龙', '科学家', '好奇'],
  size: [32, 32],
  palette: { o: '#233a24', g: '#79cc6a', G: '#4f9e4a', y: '#f4f0c6', Y: '#dcd59a', r: '#ff9a55', l: '#9ee6ff', L: '#e8fbff', z: '#5a5f73', d: '#ffffff', D: '#d5dde8', b: '#4f9e4a', ...FACE },
  shapes(c, legs) {
    c.spans2([[2, 15, 15], [3, 14, 15]], 'r'); c.spans2([[3, 10, 10], [4, 9, 11]], 'r');
    c.ellipse(16, 13.5, 11, 9.2, 'g');
    c.ellipse(16, 18.6, 6.6, 3.4, 'y', (x, y) => y >= 17);
    c.spans2([[22, 11, 15], [23, 10, 15], [24, 10, 15], [25, 10, 15], [26, 10, 15], [27, 10, 15]], 'd');
    c.spans2([[22, 15, 15], [23, 14, 15], [24, 14, 15], [25, 14, 15], [26, 14, 15]], 'y');
    c.rect2(8, 23, 8, 24, 'g');
    if (legs !== null) { const up = [[0, 0], [1, 0], [0, 0], [0, 1]][legs]; c.rect(11, 28 - up[0], 14, 29 - up[0], 'g'); c.rect(17, 28 - up[1], 20, 29 - up[1], 'g'); }
  },
  finish(c) {
    c.shadeBelow('g', 'G', 1); c.shadeBelow('d', 'D', 1); c.shadeSides('d', 'D', 1, (x, y) => y > 23);
    c.rect(5, 7, 26, 7, 'z', (x, y, cur) => cur === 'g' || cur === 'G');
    c.stamp(9, 5, ['.zzz.', 'zllLz', 'zlllz', '.zzz.'], true);
    c.spans2([[28, 11, 11], [29, 11, 11]], 'G');
  },
  eyes: eyeSet('big', 10, 12, 32), mouth: { anchor: [14, 18], shapes: MOUTH.small }, blush: blushSet(7, 16, 18),
  feetY: 28, legFrames: 4,
  extras: [{
    id: 'tail', kind: 'tail', frames: 3,
    draw(c, f) { const t = [0, 1, -1][f]; c.spans([[25, 22, 26], [24, 24, 27], [23, 26, 28 + (t > 0 ? 1 : 0)], [22 + (t < 0 ? -1 : 0), 27, 29]], 'g'); },
    finish(c) { c.shadeBelow('g', 'G'); },
  }],
};

const puffBunny = {
  id: 'puff-bunny', name: '团子兔', description: '雪白的团子兔，长耳朵会随着心情一抖一抖，走路总是一蹦一跳的。', tags: ['兔子', '软萌', '蹦跳'],
  size: [32, 32], motion: 'hop',
  palette: { o: '#4d3a4a', f: '#ffffff', F: '#e9dcef', i: '#ffbfd0', n: '#ff8fa3', b: '#e9dcef', ...FACE },
  shapes(c, legs) {
    c.ellipse(16, 16.5, 10.2, 8, 'f');
    c.ellipse(16, 25, 6.8, 4.4, 'f');
    if (legs !== null) { const up = [[0, 0], [1, 0], [0, 0], [0, 1]][legs]; c.rect(10, 28 - up[0], 13, 29 - up[0], 'f'); c.rect(18, 28 - up[1], 21, 29 - up[1], 'f'); }
  },
  finish(c) { c.shadeBelow('f', 'F', 1); c.shadeSides('f', 'F', 1, (x, y) => y > 22); },
  eyes: eyeSet('big', 10, 15, 32), mouth: { anchor: [13, 19], shapes: MOUTH.cat }, blush: blushSet(8, 19, 16),
  feetY: 28, legFrames: 4,
  extras: [{
    id: 'ears', kind: 'ears', frames: 3,
    draw(c, f) {
      const lean = [0, 1, -1][f];
      c.ellipse(11.5 + lean * 0.5, 5.6, 2.4, 5.4, 'f'); c.ellipse(20.5 + lean * 0.5, 5.6, 2.4, 5.4, 'f');
      c.ellipse(11.5 + lean * 0.5, 6, 1, 3.8, 'i'); c.ellipse(20.5 + lean * 0.5, 6, 1, 3.8, 'i');
    },
  }],
};

const jellySlime = {
  id: 'jelly-slime', name: '果冻', description: '薄荷味的果冻史莱姆，Q 弹透亮，头顶的小叶子会跟着弹跳晃来晃去。', tags: ['史莱姆', 'Q弹', '透明'],
  size: [32, 32], motion: 'hop',
  palette: { o: '#1f5d4f', g: '#8fe8c4ee', G: '#5cc6a2f0', w: '#ffffff', W: '#d9fff0', l: '#69c25a', L: '#3f8f3a', ...FACE, k: '#1f3b36' },
  shapes(c) {
    c.ellipse(16, 21.5, 12.6, 9.4, 'g', (x, y) => y <= 29);
    c.ellipse(16, 15, 8, 6, 'g');
  },
  finish(c) { c.shadeBelow('g', 'G', 2); c.shadeSides('g', 'G', 1, (x, y) => y > 22); c.stamp(9, 14, ['ww', 'w.']); c.set(12, 13, 'W'); },
  eyes: eyeSet('big', 10, 17, 32), mouth: { anchor: [14, 22], shapes: MOUTH.small }, blush: blushSet(7, 21, 18),
  extras: [{
    id: 'leaf', kind: 'accessory', frames: 2,
    draw(c, f) { c.rect(15, 7, 15, 9, 'L'); if (f) c.stamp(15, 5, ['.ll', 'lll']); else c.stamp(13, 5, ['ll.', 'lll']); },
  }],
};

const booGhost = {
  id: 'boo-ghost', name: '幽幽', description: '有点怕生的小幽灵，半透明的身体飘来飘去，被摸摸头会害羞地脸红。', tags: ['幽灵', '害羞', '漂浮'],
  size: [32, 32], motion: 'float',
  palette: { o: '#5b4a7d', f: '#fbf8ffee', F: '#e3d9f7ee', ...FACE, k: '#3a2d52' },
  shapes(c, legs) {
    c.ellipse(16, 13.5, 10, 9.5, 'f');
    c.rect(6, 13, 25, 24, 'f');
    const s = legs ?? 0, bumps = [[7, 11, 15, 19, 23], [8, 12, 16, 20, 24], [7, 11, 15, 19, 23], [6, 10, 14, 18, 22]][s % 4];
    for (const bx of bumps) c.ellipse(bx + 1.5, 25, 2, 1.6 + (legs === null ? 0 : 0.4), 'f', (x, y) => x >= 6 && x <= 25);
  },
  finish(c) { c.shadeBelow('f', 'F', 1); c.shadeSides('f', 'F', 1, (x, y) => y > 14); },
  eyes: eyeSet('big', 10, 13, 32), mouth: { anchor: [14, 18], shapes: MOUTH.small }, blush: blushSet(8, 17, 16),
  feetY: 23, legFrames: 4,
};

const pebblePenguin = {
  id: 'pebble-penguin', name: '豆豆企鹅', description: '围着红围巾的小企鹅，走路摇摇摆摆，冷冷的天也想和你挤在一起取暖。', tags: ['企鹅', '围巾', '摇摆'],
  size: [32, 32],
  palette: { o: '#1e2233', n: '#3b4a75', N: '#2a3556', w: '#ffffff', W: '#dfe6f2', y: '#ffb347', Y: '#e08a2a', r: '#ff5d6e', R: '#c93e50', ...FACE, k: '#1e2233' },
  shapes(c, legs) {
    c.ellipse(16, 16.5, 10.6, 11.6, 'n', (x, y) => y <= 27);
    c.ellipse2(5.2, 19.5, 2, 4, 'n');
    c.ellipse2(12.6, 13.6, 4.4, 4.6, 'w'); c.ellipse(16, 21, 7, 6.2, 'w', (x, y) => y <= 27);
    if (legs !== null) { const up = [[0, 0], [1, 0], [0, 0], [0, 1]][legs]; c.rect(10, 28 - up[0], 13, 28 - up[0], 'y'); c.rect(18, 28 - up[1], 21, 28 - up[1], 'y'); }
  },
  finish(c) {
    c.shadeBelow('n', 'N', 1); c.shadeBelow('w', 'W', 1); c.shadeSides('w', 'W', 1, (x, y) => y > 20);
    c.rect(8, 19, 23, 20, 'r', (x, y, cur) => cur !== 'o' && cur !== '.'); c.rect(8, 20, 23, 20, 'R', (x, y, cur) => cur === 'r');
  },
  eyes: eyeSet('small', 10, 13, 32), mouth: { anchor: [14, 16], shapes: { closed: mirrorRows(['yy', '.Y']), open: mirrorRows(['yy', 'ym', '.Y']), smile: mirrorRows(['yy', '.Y']), pout: mirrorRows(['.y', '.Y']) } },
  blush: blushSet(8, 16, 16), feetY: 28, legFrames: 4,
  extras: [{
    id: 'scarf', kind: 'accessory', layer: 'front', frames: 2,
    draw(c, f) { c.rect(19, 21, 20, 24 + f, 'r'); c.set(f ? 21 : 18, 24 + f, 'r'); },
    finish(c) { c.shadeBelow('r', 'R'); },
  }],
};

const shroomSprout = {
  id: 'shroom-sprout', name: '蘑蘑', description: '戴着红点大帽子的小蘑菇，下雨天会特别有精神，偶尔抖落几颗孢子星星。', tags: ['蘑菇', '森林', '小个子'],
  size: [32, 32],
  palette: { o: '#4a2626', r: '#f0505c', R: '#c23a48', w: '#fff7ee', u: '#e6cfb4', f: '#fff1de', F: '#efd5b8', b: '#c28e66', ...FACE },
  shapes(c, legs) {
    c.ellipse(16, 18.8, 8.4, 7.4, 'f');
    c.ellipse(16, 11.5, 13.4, 9, 'r', (x, y) => y <= 13);
    c.rect(5, 14, 26, 14, 'u');
    if (legs !== null) { const up = [[0, 0], [1, 0], [0, 0], [0, 1]][legs]; c.rect(12, 26 - up[0], 14, 27 - up[0], 'b'); c.rect(17, 26 - up[1], 19, 27 - up[1], 'b'); }
  },
  finish(c) {
    c.shadeBelow('r', 'R', 1); c.shadeBelow('f', 'F', 1); c.shadeUnder('f', ['u'], 'F');
    c.ellipse(16, 6, 2.6, 2, 'w'); c.ellipse2(8.6, 9.2, 2, 1.6, 'w'); c.ellipse2(12, 12.2, 1.1, 1, 'w');
  },
  eyes: eyeSet('big', 10, 16, 32), mouth: { anchor: [14, 21], shapes: MOUTH.small }, blush: blushSet(8, 20, 16),
  feetY: 26, legFrames: 4,
};

const RECIPES = [sunnyGirl, scholarBoy, kimiStar, starWitch, peachTwin, coderHoodie, astroKid, chefSpoon, sleuthGirl, hanfuGirl, grandpaFu, sportyKid, mochiCat, foxKit, roboUnit, cloudSprite, tinyDino, puffBunny, jellySlime, booGhost, pebblePenguin, shroomSprout];

let failed = 0;
for (const recipe of RECIPES) {
  const spec = build(recipe);
  const result = sprite.validatePixelPet(spec);
  if (!result.ok) { failed++; console.error(`✗ ${recipe.id}\n  - ${result.errors.join('\n  - ')}`); continue; }
  // 数字二元组（尺寸、坐标）压成一行，便于阅读
  await writeFile(join(PETS_DIR, `${spec.id}.json`), `${JSON.stringify(spec, null, 2).replace(/\[\s+(-?\d+),\s+(-?\d+)\s+\]/g, '[$1, $2]')}\n`);
  console.log(`✓ ${spec.id} ${spec.name}`);
}
process.exit(failed ? 1 : 0);
