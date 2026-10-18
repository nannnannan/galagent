import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(path.resolve('.tools/psd/package.json'));
const sharp = require('sharp');

const MASTER_PATH = path.resolve('art/live2d/front-master-v02.png');
const LAYERS_DIR = path.resolve('art/live2d/layers');
const SCRATCH_DIR = ((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.gemini/antigravity/brain/72b68a5c-eb99-461e-932c-e47d2c02b292/scratch");

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function pointInPoly(x, y, poly) {
  let inside = false;
  let minDistSq = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi);
    if (intersect) inside = !inside;
    const dx = xj - xi, dy = yj - yi;
    const t = clamp(((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const px = xi + t * dx, py = yi + t * dy;
    const dSq = (x - px) ** 2 + (y - py) ** 2;
    if (dSq < minDistSq) minDistSq = dSq;
  }
  const dist = Math.sqrt(minDistSq);
  return inside ? dist : -dist;
}

function polyMask(x, y, poly, feather = 1.5) {
  const sd = pointInPoly(x, y, poly);
  if (feather <= 0) return sd >= 0 ? 1 : 0;
  return smoothstep(-feather, feather, sd);
}

function ellipseMask(x, y, cx, cy, rx, ry, angleDeg = 0, feather = 1.2) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = x - cx, dy = y - cy;
  const lx = (dx * cos + dy * sin) / rx;
  const ly = (-dx * sin + dy * cos) / ry;
  const r = Math.sqrt(lx * lx + ly * ly);
  const approxPxDist = (1 - r) * Math.min(rx, ry);
  return smoothstep(-feather, feather, approxPxDist);
}

function gaussianEllipse(x, y, cx, cy, rx, ry, angleDeg = 0) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = x - cx, dy = y - cy;
  const lx = (dx * cos + dy * sin) / rx;
  const ly = (-dx * sin + dy * cos) / ry;
  const r2 = lx * lx + ly * ly;
  const r = Math.sqrt(r2);
  return Math.exp(-r2 * 1.45) * smoothstep(1.35, 0.15, r);
}

function inEyeZoneForBlush(x, y) {
  const lEye = ellipseMask(x, y, 461.8, 165.0, 21.0, 11.2, -3.5, 2.5);
  const rEye = ellipseMask(x, y, 537.5, 153.5, 21.5, 11.2, -3.5, 2.5);
  return Math.max(lEye, rEye);
}

function allocBuf(W, H) {
  return new Uint8Array(W * H * 4);
}

function getPx(buf, W, x, y) {
  const ix = clamp(Math.round(x), 0, W - 1);
  const iy = clamp(Math.round(y), 0, 1535);
  const i = (iy * W + ix) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
}

function sampleBilinear(buf, W, H, fx, fy) {
  const x0 = clamp(Math.floor(fx), 0, W - 1);
  const y0 = clamp(Math.floor(fy), 0, H - 1);
  const x1 = clamp(x0 + 1, 0, W - 1);
  const y1 = clamp(y0 + 1, 0, H - 1);
  const tx = fx - x0, ty = fy - y0;
  const i00 = (y0 * W + x0) * 4;
  const i10 = (y0 * W + x1) * 4;
  const i01 = (y1 * W + x0) * 4;
  const i11 = (y1 * W + x1) * 4;
  return [
    lerp(lerp(buf[i00], buf[i10], tx), lerp(buf[i01], buf[i11], tx), ty),
    lerp(lerp(buf[i00 + 1], buf[i10 + 1], tx), lerp(buf[i01 + 1], buf[i11 + 1], tx), ty),
    lerp(lerp(buf[i00 + 2], buf[i10 + 2], tx), lerp(buf[i01 + 2], buf[i11 + 2], tx), ty),
    lerp(lerp(buf[i00 + 3], buf[i10 + 3], tx), lerp(buf[i01 + 3], buf[i11 + 3], tx), ty),
  ];
}

function setPx(buf, W, x, y, r, g, b, a) {
  if (x < 0 || x >= W || y < 0 || y >= 1536) return;
  const i = (y * W + x) * 4;
  buf[i] = clamp(Math.round(r), 0, 255);
  buf[i + 1] = clamp(Math.round(g), 0, 255);
  buf[i + 2] = clamp(Math.round(b), 0, 255);
  buf[i + 3] = clamp(Math.round(a), 0, 255);
}

function blendPx(buf, W, x, y, r, g, b, alpha) {
  if (x < 0 || x >= W || y < 0 || y >= 1536 || alpha <= 0) return;
  const i = (y * W + x) * 4;
  const sa = clamp(alpha / 255, 0, 1);
  const da = buf[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  buf[i] = clamp(Math.round((r * sa + buf[i] * da * (1 - sa)) / outA), 0, 255);
  buf[i + 1] = clamp(Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / outA), 0, 255);
  buf[i + 2] = clamp(Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / outA), 0, 255);
  buf[i + 3] = clamp(Math.round(outA * 255), 0, 255);
}

function alphaOver(dst, src, W, H, opacity = 1.0) {
  for (let i = 0; i < W * H * 4; i += 4) {
    const sa = (src[i + 3] / 255) * opacity;
    if (sa <= 0) continue;
    const da = dst[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) continue;
    dst[i] = Math.round((src[i] * sa + dst[i] * da * (1 - sa)) / outA);
    dst[i + 1] = Math.round((src[i + 1] * sa + dst[i + 1] * da * (1 - sa)) / outA);
    dst[i + 2] = Math.round((src[i + 2] * sa + dst[i + 2] * da * (1 - sa)) / outA);
    dst[i + 3] = Math.round(outA * 255);
  }
}

async function saveLayer(buf, W, H, id) {
  const outPath = path.join(LAYERS_DIR, `${id}-v02.png`);
  await sharp(Buffer.from(buf.buffer), { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  let left = W, top = H, right = 0, bottom = 0, visiblePixels = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = buf[(y * W + x) * 4 + 3];
      if (a > 0) {
        visiblePixels++;
        if (x < left) left = x;
        if (y < top) top = y;
        if (x + 1 > right) right = x + 1;
        if (y + 1 > bottom) bottom = y + 1;
      }
    }
  }
  const fileBuf = fs.readFileSync(outPath);
  const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
  return {
    id,
    file: `art/live2d/layers/${id}-v02.png`,
    relFile: `layers/${id}-v02.png`,
    width: W,
    height: H,
    opaqueBounds: visiblePixels > 0 ? { left, top, right, bottom } : { left: 0, top: 0, right: 1, bottom: 1 },
    visiblePixels,
    sha256,
    status: 'aligned to 1024x1536 master canvas with authentic tsundere-cute Kimi facial layers',
  };
}

async function loadAlignedCharHead(name, W, H, masterOrig) {
  const { data } = await sharp(path.resolve(`runtime/assets/character/${name}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(masterOrig);
  const polyInnerHead = [
    [432, 85], [495, 72], [552, 88],
    [556, 145], [552, 182], [542, 200], [528, 212], [514, 220], [500, 224],
    [486, 220], [472, 212], [456, 200], [444, 182], [437, 160], [434, 130]
  ];
  const deg = 12.0;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const px0 = 500, py0 = 205;
  for (let y = 65; y <= 230; y++) {
    for (let x = 425; x <= 565; x++) {
      const sd = pointInPoly(x, y, polyInnerHead);
      const w = smoothstep(-4.0, 4.0, sd);
      if (w <= 0) continue;
      let dx = x - px0, dy = y - py0;
      // Compensate 3/4 perspective foreshortening on the left half of the face so left & right eyes match in width & roundness
      if (dx < 0) dx *= 0.88;
      const sx = px0 + dx * cos + dy * sin - 4.0;
      const sy = py0 - dx * sin + dy * cos + 2.0;
      if (sx >= 0 && sx < W - 1 && sy >= 0 && sy < H - 1) {
        const [r, g, b] = sampleBilinear(data, W, H, sx, sy);
        const i = (y * W + x) * 4;
        out[i] = Math.round(out[i] * (1 - w) + r * w);
        out[i + 1] = Math.round(out[i + 1] * (1 - w) + g * w);
        out[i + 2] = Math.round(out[i + 2] * (1 - w) + b * w);
      }
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  const { data: masterOrig, info } = await sharp(MASTER_PATH).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  // Load authentic artist-painted Kimi heads aligned in upright-12 space (balanced, symmetrical, zero foreshortening distortion)
  const chNeutral = await loadAlignedCharHead('neutral', W, H, masterOrig);
  const chFlustered = await loadAlignedCharHead('flustered', W, H, masterOrig);
  const chAnnoyed = await loadAlignedCharHead('annoyed', W, H, masterOrig);
  const chCurious = await loadAlignedCharHead('curious', W, H, masterOrig);
  const chBlink = await loadAlignedCharHead('blink', W, H, masterOrig);

  // Use masterOrig for the body/neck/hair master base so the neck below y=221 has zero double-chin line
  const master = masterOrig;

  // Load the full-HD portrait reference (media_1792212404668_dc421556.jpg, 682x1024) for 2x supersampled hand-painted iris texture
  const HD_REF_PATH = path.resolve(SCRATCH_DIR, '../.user_uploaded/media_1792212404668_dc421556.jpg');
  const { data: dcIrisRef, info: dcIrisInfo } = await sharp(HD_REF_PATH).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const dcW = dcIrisInfo.width, dcH = dcIrisInfo.height;

  const { data: backHairV1 } = await sharp(path.join(LAYERS_DIR, 'back-hair-v01.png'))
    .resize(W, H)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // -------------------------------------------------------------------------
  // 1. Define exact anatomical polygons & masks in 1024x1536 master space
  // -------------------------------------------------------------------------

  const polyHeadbandLeft = [
    [396, 8], [450, 2], [535, 3], [565, 22],
    [548, 42], [510, 22], [468, 26], [442, 46],
    [426, 76], [416, 114], [408, 138], [395, 132], [392, 72]
  ];
  const polyHeadOrnamentRight = [
    [546, 12], [608, 12], [648, 70], [648, 112],
    [646, 155], [642, 190], [625, 222],
    [592, 222], [584, 195], [574, 166], [562, 162],
    [555, 135], [546, 106], [538, 60]
  ];

  // Exact jawline & cheek contour of upright-12 Kimi head
  const polyFaceSkin = [
    [436, 96], [492, 82], [548, 92],
    [555, 145], [573, 147], [578, 165], [572, 186], [556, 188],
    [552, 180], [546, 194], [537, 206], [525, 215], [517, 220],
    [512, 224], [506, 225], [500, 224], [493, 221],
    [485, 217], [472, 212], [459, 201], [449, 188], [442, 174],
    [437, 158], [435, 138]
  ];

  // Bangs polygon covering the crown + full natural center bangs tips from front-master-v02.png
  const polyBangs = [
    [412, 134], [424, 72], [445, 38], [475, 20], [515, 18], [548, 36],
    [562, 75], [572, 138], [556, 143], [542, 139], [519, 144],
    [508, 173], [484, 173], [482, 153], [444, 154], [424, 154]
  ];

  const polySideHairLeft = [
    [408, 130], [435, 135], [442, 168], [446, 205],
    [445, 265], [442, 345], [440, 412], [446, 438],
    [422, 438], [402, 405], [396, 355], [404, 285],
    [405, 220], [398, 165]
  ];

  const polySideHairRight = [
    [555, 138], [578, 142], [588, 195], [596, 265],
    [600, 350], [606, 405], [590, 438], [560, 438],
    [568, 402], [568, 340], [555, 265], [548, 205], [556, 175]
  ];

  const polyArmLeft = [
    [396, 365], [412, 408], [406, 462], [385, 535],
    [352, 600], [336, 622], [334, 646], [304, 650],
    [298, 690], [285, 762], [244, 762], [238, 695],
    [258, 640], [244, 616], [275, 594], [274, 560],
    [322, 495], [368, 440]
  ];

  const polyArmRight = [
    [580, 365], [618, 440], [666, 498], [712, 562],
    [708, 594], [738, 614], [724, 640], [742, 695],
    [736, 762], [696, 762], [684, 690], [678, 648],
    [652, 646], [646, 620], [634, 600], [600, 535],
    [575, 462], [572, 408]
  ];

  const polyWaistChainsAndBook = [
    [382, 460], [435, 465], [555, 465], [592, 460],
    [600, 560], [596, 708], [525, 708], [520, 595],
    [455, 595], [438, 612], [402, 612], [380, 535]
  ];
  const polyFluteAndRibbon = [
    [562, 465], [595, 465], [648, 680], [682, 895],
    [712, 1205], [692, 1228], [652, 1020], [606, 760], [575, 575]
  ];

  const polyBodyAndSkirt = [
    [487, 214], [529, 214], [529, 238], [568, 256], [622, 262],
    [658, 302], [708, 425], [732, 490], [708, 515], [755, 596],
    [822, 660], [798, 725], [835, 805], [802, 860], [822, 905],
    [786, 938], [815, 1005], [786, 1055], [808, 1145], [792, 1205],
    [810, 1265], [750, 1315], [685, 1352], [598, 1320], [585, 1485],
    [422, 1485], [402, 1395], [295, 1438], [285, 1378], [186, 1310],
    [195, 1235], [122, 1185], [118, 1105], [168, 985], [225, 865],
    [172, 795], [182, 735], [166, 655], [276, 515], [254, 490],
    [298, 415], [352, 295], [382, 260], [435, 256], [486, 238]
  ];

  const layers = {
    'back-hair': allocBuf(W, H),
    'body-and-skirt': allocBuf(W, H),
    'arm-left': allocBuf(W, H),
    'arm-right': allocBuf(W, H),
    'waist-accessories': allocBuf(W, H),
    'face-base': allocBuf(W, H),
    'eye-white-left': allocBuf(W, H),
    'eye-white-right': allocBuf(W, H),
    'iris-left': allocBuf(W, H),
    'iris-right': allocBuf(W, H),
    'eyelash-left': allocBuf(W, H),
    'eyelash-right': allocBuf(W, H),
    'eyebrow-left': allocBuf(W, H),
    'eyebrow-right': allocBuf(W, H),
    'mouth-interior': allocBuf(W, H),
    'mouth-closed': allocBuf(W, H),
    'side-hair-left': allocBuf(W, H),
    'side-hair-right': allocBuf(W, H),
    'bangs': allocBuf(W, H),
    'head-accessories': allocBuf(W, H),
  };

  // -------------------------------------------------------------------------
  // 2. Authentic Artist-Painted Facial Features Aligned to front-master-v02.png
  //    & Supersampled from Full-HD Portrait Reference (media_1792212404668_dc421556.jpg)
  // -------------------------------------------------------------------------
  // Original tilted arch functions on raw masterOrig (used when cleaning upper-lid skin on raw bangs before head-straightening warp)
  function origArchYL(x) {
    const dx = (x - 463.0) / 18.0;
    const outer = clamp(-dx, 0, 1.25);
    return 156.8 - 2.4 * dx + 5.2 * dx * dx + 1.8 * outer * outer;
  }
  function origArchYR(x) {
    const dx = (x - 536.5) / 18.2;
    const outer = clamp(dx, 0, 1.25);
    const inner = clamp(-dx, 0, 1.25);
    return 147.2 - 1.1 * dx + 5.0 * dx * dx + 1.1 * outer * outer + 0.5 * inner * inner;
  }

  // Straightened, 100% level & mirror-symmetric eye centers around face axis x = 500.0:
  // Left eye center: (463.2, 160.3), Right eye center: (536.8, 160.3)
  const eyeLCx = 463.2, eyeLCy = 160.3;
  const eyeRCx = 536.8, eyeRCy = 160.3;

  // Mirror-symmetric upper & lower eyelid curves for the straightened face (poised tsundere anime eye arch):
  function archYL(x) {
    const dx = (x - eyeLCx) / 18.1;
    const innerSigned = dx; // +1 at inner corner towards nose, -1 at outer corner towards temple
    const outer = clamp(-innerSigned, 0, 1.25);
    const inner = clamp(innerSigned, 0, 1.25);
    return 152.0 + 0.45 * innerSigned + 5.1 * dx * dx + 1.45 * outer * outer + 0.35 * inner * inner;
  }
  function archYR(x) {
    const dx = (x - eyeRCx) / 18.1;
    const innerSigned = -dx; // +1 at inner corner towards nose, -1 at outer corner towards temple
    const outer = clamp(-innerSigned, 0, 1.25);
    const inner = clamp(innerSigned, 0, 1.25);
    return 152.0 + 0.45 * innerSigned + 5.1 * dx * dx + 1.45 * outer * outer + 0.35 * inner * inner;
  }
  function botYL(x) {
    const dx = (x - eyeLCx) / 18.1;
    return 169.0 + 0.35 * dx - 6.7 * dx * dx;
  }
  function botYR(x) {
    const dx = (x - eyeRCx) / 18.1;
    return 169.0 - 0.35 * dx - 6.7 * dx * dx;
  }

  // 2A. Eye Whites: Soft 3D spherical sclera + upper-lid AO shadow + warm outer-corner recess + delicate lower rim & lower lash ticks
  for (let y = 142; y <= 178; y++) {
    for (let x = 438; x <= 562; x++) {
      for (const [side, ecx, topFn, botFn, xMin, xMax, isLeft] of [
        ['left', eyeLCx, archYL, botYL, 445.4, 480.8, true],
        ['right', eyeRCx, archYR, botYR, 519.2, 554.6, false],
      ]) {
        if (x < xMin - 2 || x > xMax + 2) continue;
        const top = topFn(x), bot = botFn(x);
        const u = (x - ecx) / 18.1;
        const outerSide = isLeft ? clamp(-u, 0, 1.15) : clamp(u, 0, 1.15);
        const innerSide = isLeft ? clamp(u, 0, 1.15) : clamp(-u, 0, 1.15);

        if (y >= top - 0.5 && y <= bot + 2.2) {
          const mTop = smoothstep(top - 0.3, top + 0.9, y);
          const mBot = smoothstep(bot + 0.80, bot - 0.70, y);
          const mSide = smoothstep(xMin, xMin + 2.2, x) * smoothstep(xMax, xMax - 2.2, x);
          const mSclera = mTop * mBot * mSide;
          if (mSclera > 0.01) {
            const tY = clamp((y - top) / Math.max(1, bot - top), 0, 1);
            const tX = Math.abs(u);
            // Rich spherical 3D shading: cool lavender-grey upper shadow under lashes -> warm ivory-white lower sclera
            const shadow = smoothstep(0.46, 0.0, tY) * 0.88 + smoothstep(0.54, 1.0, tX) * 0.32;
            let r = lerp(253, 198, clamp(shadow, 0, 1));
            let g = lerp(248, 192, clamp(shadow, 0, 1));
            let b = lerp(252, 220, clamp(shadow, 0, 1));

            // Warm rose-terracotta outer-corner recess (眼尾三角区阴影) & inner tear-duct warmth (内眼角微红)
            const cornerWarmth = smoothstep(0.52, 0.96, outerSide) * 0.74 + smoothstep(0.65, 0.98, innerSide) * 0.48;
            r = lerp(r, 210, cornerWarmth);
            g = lerp(g, 148, cornerWarmth);
            b = lerp(b, 160, cornerWarmth);

            // Delicate lower-eyelid rim line on outer half of open eye
            const botRim = smoothstep(0.95, 0.15, Math.abs(y - (bot - 0.20))) * smoothstep(-0.25, 0.65, outerSide);
            r = lerp(r, 162, botRim * 0.62);
            g = lerp(g, 112, botRim * 0.62);
            b = lerp(b, 126, botRim * 0.62);

            setPx(layers[`eye-white-${side}`], W, x, y, r, g, b, mSclera * 255);
          }

          // 3 delicate lower-outer eyelash ticks (下睫毛细节) attached to eye-white so they fold away cleanly on blink
          const wingSign = isLeft ? -1 : 1;
          for (const [uL, lenL, slopeL] of [
            [0.44, 1.7, 0.35],
            [0.62, 2.0, 0.42],
            [0.78, 2.1, 0.48],
          ]) {
            const lx0 = ecx + wingSign * 18.1 * uL;
            const ly0 = botFn(lx0) - 0.2;
            const tL = (y - ly0) / lenL;
            if (tL >= 0.0 && tL <= 1.0) {
              const targetX = lx0 + wingSign * slopeL * (tL * lenL);
              const distL = Math.abs(x - targetX);
              const aL = smoothstep(0.75, 0.12, distL) * (1.0 - tL * 0.75);
              if (aL > 0.01) {
                blendPx(layers[`eye-white-${side}`], W, x, y, 128, 78, 92, aL * 142);
              }
            }
          }
        }
      }
    }
  }

  // 2B. Irises: Direct 2x Supersampled Hand-Painted HD Iris Transfer from media_1792212404668_dc421556.jpg
  //     Fused at Exact Level, Symmetrical Converged Gaze Coordinates!
  function sampleHdIrisAt(isLeft, nx, ny) {
    // Rotate normalized coords by +6.0 deg to counter-rotate dc421556's tilted head into an upright vertical pupil!
    const rad = (6.0 * Math.PI) / 180.0;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rnx = nx * cos - ny * sin;
    let rny = nx * sin + ny * cos;
    // In dc421556, the upper eyelash covers rny < -0.74; mirror-extend the clean upper-indigo dome smoothly for the hidden top edge
    if (rny < -0.72) {
      rny = -0.72 - (rny + 0.72) * 0.25;
    }
    const dcCx = isLeft ? 246.5 : 416.0;
    const dcCy = isLeft ? 362.2 : 292.8;
    const dcRx = isLeft ? 25.4 : 25.6;
    const dcRy = isLeft ? 23.8 : 24.2;

    const sx = dcCx + rnx * dcRx;
    const sy = dcCy + rny * dcRy;

    // Smooth 5-tap supersampling from the 682x1024 HD reference (NO harsh unsharp-mask grain!)
    const [cR, cG, cB] = sampleBilinear(dcIrisRef, dcW, dcH, sx, sy);
    const [lR, lG, lB] = sampleBilinear(dcIrisRef, dcW, dcH, sx - 0.55, sy);
    const [rR, rG, rB] = sampleBilinear(dcIrisRef, dcW, dcH, sx + 0.55, sy);
    const [uR, uG, uB] = sampleBilinear(dcIrisRef, dcW, dcH, sx, sy - 0.55);
    const [dR, dG, dB] = sampleBilinear(dcIrisRef, dcW, dcH, sx, sy + 0.55);

    const fineR = cR * 0.44 + (lR + rR + uR + dR) * 0.14;
    const fineG = cG * 0.44 + (lG + rG + uG + dG) * 0.14;
    const fineB = cB * 0.44 + (lB + rB + uB + dB) * 0.14;

    return [
      clamp(fineR, 0, 255),
      clamp(fineG, 0, 255),
      clamp(fineB, 0, 255),
    ];
  }

  function buildAuthenticHdIris(targetBuf, icx, icy, rx, ry, isLeft) {
    for (let y = Math.floor(icy - ry - 2); y <= Math.ceil(icy + ry + 2); y++) {
      for (let x = Math.floor(icx - rx - 2); x <= Math.ceil(icx + rx + 2); x++) {
        // Slightly squoval anime iris silhouette (fuller sides & gentle bottom curve matching master-eyes-4x.png)
        const nx = (x - icx) / rx;
        const ny = (y - icy) / ry;
        const rEll = Math.sqrt(nx * nx + ny * ny);
        const rSquoval = Math.pow(Math.pow(Math.abs(nx), 2.3) + Math.pow(Math.abs(ny), 2.1), 1.0 / 2.2);
        const rNorm = lerp(rEll, rSquoval, 0.45);
        const mIris = smoothstep(1.04, 0.90, rNorm);
        if (mIris <= 0.005) continue;

        // 1) Sample 2x supersampled hand-painted HD iris from media_1792212404668_dc421556.jpg
        let [r, g, b] = sampleHdIrisAt(isLeft, nx, ny);
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const tY = clamp((ny + 1.0) * 0.5, 0, 1);

        // 2) Harmonize the HD iris with front-master-v02 / upright-12-neutral's velvety watercolor-anime gradient
        const velvetR = lerp(74, 212, smoothstep(0.18, 0.88, tY));
        const velvetG = lerp(70, 204, smoothstep(0.18, 0.88, tY));
        const velvetB = lerp(118, 236, smoothstep(0.18, 0.88, tY));
        const isPupilOrRing = smoothstep(125.0, 82.0, lum) * smoothstep(0.75, 0.25, rNorm);
        const isCatchlight = smoothstep(188.0, 226.0, lum);
        const isMainCatchlightZone = ellipseMask(nx, ny, -0.08, -0.46, 0.42, 0.36, 0, 0.25);
        const velvetBlend = 0.28 * (1.0 - isPupilOrRing * 0.85) * (1.0 - isCatchlight * isMainCatchlightZone * 0.95);
        r = lerp(r, velvetR, velvetBlend);
        g = lerp(g, velvetG, velvetBlend);
        b = lerp(b, velvetB, velvetBlend);

        const secondaryHighlight = isCatchlight * (1.0 - isMainCatchlightZone);
        if (secondaryHighlight > 0.01) {
          r = lerp(r, 218, secondaryHighlight * 0.38);
          g = lerp(g, 212, secondaryHighlight * 0.38);
          b = lerp(b, 240, secondaryHighlight * 0.30);
        }

        // 3) Subtle upper-eyelash cast shadow across the top 22% of the iris
        const topShadow = smoothstep(0.24, 0.01, tY) * (1.0 - isCatchlight * isMainCatchlightZone * 0.90);
        r = lerp(r, 46, topShadow * 0.45);
        g = lerp(g, 42, topShadow * 0.45);
        b = lerp(b, 82, topShadow * 0.40);

        // 4) Clean, natural outer limbal ring (deep smoky indigo on left/right sides, soft translucent lavender at bottom)
        const limbal = smoothstep(0.80, 0.98, rNorm);
        const bottomSoftness = smoothstep(0.52, 0.88, tY) * (1.0 - 0.40 * Math.abs(nx));
        const limbalWeight = lerp(0.80, 0.28, bottomSoftness);
        const limR = lerp(48, 142, bottomSoftness);
        const limG = lerp(42, 130, bottomSoftness);
        const limB = lerp(84, 182, bottomSoftness);
        r = lerp(r, limR, limbal * limbalWeight);
        g = lerp(g, limG, limbal * limbalWeight);
        b = lerp(b, limB, limbal * limbalWeight);

        setPx(targetBuf, W, x, y, r, g, b, mIris * 255);
      }
    }
  }
  // Exact level, mirror-symmetric converged focal centers (left iris 466.6, right iris 533.4, both at y = 160.4):
  buildAuthenticHdIris(layers['iris-left'], 466.6, 160.4, 11.4, 10.0, true);
  buildAuthenticHdIris(layers['iris-right'], 533.4, 160.4, 11.4, 10.0, false);

  // 2C. Eyelashes: Authentic Velvety Espresso-Umber Upper Eyelash + Warm Upper-Lid Shading (100% mirror-symmetrical!)
  function buildLushEyelash(targetBuf, ecx, archFn, isLeft) {
    const halfSpan = 18.3;
    for (let y = 136; y <= 172; y++) {
      for (let x = Math.floor(ecx - halfSpan - 6); x <= Math.ceil(ecx + halfSpan + 6); x++) {
        const dx = x - ecx;
        const u = dx / halfSpan;
        if (Math.abs(u) > 1.24) continue;

        const ay = archFn(x);
        const env = Math.cos(clamp(u, -1, 1) * Math.PI * 0.5);
        const outerSide = isLeft ? clamp(-u, 0, 1.24) : clamp(u, 0, 1.24);
        const innerSide = isLeft ? clamp(u, -1, 1) : clamp(-u, -1, 1);

        // 1) Natural Warm Upper-Eyelid Socket Shading (NO white bar or dark smudge!)
        if (Math.abs(u) < 1.02) {
          const lidEnv = Math.pow(clamp(1.0 - Math.abs(u) * 0.96, 0, 1), 0.70);
          const foldShade = smoothstep(1.9, 0.3, Math.abs(y - (ay - 2.1))) * lidEnv;
          if (foldShade > 0.01) {
            blendPx(targetBuf, W, x, y, 228, 184, 184, foldShade * 42);
          }
          const rootBlush = smoothstep(1.5, 0.3, Math.abs(y - (ay - 0.85))) * lidEnv;
          if (rootBlush > 0.01) {
            blendPx(targetBuf, W, x, y, 198, 134, 142, rootBlush * 64);
          }
        }

        // 2) Delicate, Natural Double-Eyelid Crease (双眼皮线 — fine & concentrated on the inner-to-middle arch)
        if (innerSide > -0.50 && innerSide < 0.74) {
          const uCrease = (innerSide - 0.12) / 0.62;
          if (Math.abs(uCrease) < 1.0) {
            const creaseY = ay - 3.4 + 0.35 * u * u + 0.25 * innerSide;
            const creaseDist = Math.abs(y - creaseY);
            const creaseEnv = Math.cos(uCrease * Math.PI * 0.5);
            const creaseA = smoothstep(0.72, 0.15, creaseDist) * Math.pow(creaseEnv, 0.80);
            if (creaseA > 0.01) {
              blendPx(targetBuf, W, x, y, 158, 110, 118, creaseA * 72);
            }
          }
        }

        // 3) Main Calligraphic Upper Eyelash Arch with Rich Espresso-Umber / Warm Plum Shading:
        if (Math.abs(u) <= 1.08) {
          const lashCenterY = ay - 0.12;
          const halfThick = 0.68 + 1.40 * Math.pow(clamp(env, 0, 1), 0.48) + 0.76 * smoothstep(0.15, 0.82, outerSide) * smoothstep(1.08, 0.78, outerSide);
          const dist = Math.abs(y - lashCenterY);
          const outerFeather = smoothstep(halfThick + 1.05, Math.max(0, halfThick - 0.25), dist);
          const bottomRimCore = smoothstep(halfThick * 0.85, 0.0, Math.abs(y - (lashCenterY + halfThick * 0.35)));
          const endTapering = smoothstep(1.09, 0.88, Math.abs(u));
          const alpha = outerFeather * endTapering;
          if (alpha > 0.01) {
            const tVertLash = clamp((lashCenterY + halfThick - y) / Math.max(1.0, 2.0 * halfThick), 0, 1);
            // Rich espresso-plum bottom rim -> warm dark chocolate-umber middle -> soft rose-umber top edge
            let r = lerp(32, lerp(78, 128, tVertLash), 1.0 - bottomRimCore * 0.82);
            let g = lerp(18, lerp(46, 86, tVertLash), 1.0 - bottomRimCore * 0.82);
            let b = lerp(28, lerp(56, 98, tVertLash), 1.0 - bottomRimCore * 0.82);

            // Whisper-subtle hair-overlap sheen (only 10% so it never looks like a grey smudge!)
            const crestSheen = smoothstep(0.55, 0.90, tVertLash) * Math.exp(-Math.pow((u + (isLeft ? -0.08 : 0.08)) / 0.22, 2));
            r = lerp(r, 168, crestSheen * 0.10);
            g = lerp(g, 148, crestSheen * 0.10);
            b = lerp(b, 168, crestSheen * 0.12);

            blendPx(targetBuf, W, x, y, r, g, b, alpha * 253);
          }
        }

        // 4) Feathered Outer Eyelash Wing Spikes (眼尾睫毛簇)
        const wingSign = isLeft ? -1 : 1;
        for (const [uStart, dyOff, len, slopeW, thickW] of [
          [0.48, -1.2, 3.5, -0.36, 0.80],
          [0.74, -0.5, 4.3, -0.25, 0.98],
          [0.86, +0.9, 3.6, -0.04, 0.82],
        ]) {
          const x0 = ecx + wingSign * halfSpan * uStart;
          const y0 = archFn(x0) + dyOff;
          const tW = (x - x0) * wingSign / len;
          if (tW >= -0.25 && tW <= 1.05) {
            const wy = y0 + slopeW * (tW * len);
            const wDist = Math.abs(y - wy);
            const wThick = thickW * (1.0 - 0.72 * clamp(tW, 0, 1));
            const wAlpha = smoothstep(wThick + 0.70, Math.max(0, wThick - 0.20), wDist) * smoothstep(1.05, 0.18, tW) * smoothstep(-0.25, 0.08, tW);
            if (wAlpha > 0.01) {
              blendPx(targetBuf, W, x, y, 52, 30, 42, wAlpha * 238);
            }
          }
        }
      }
    }
  }
  buildLushEyelash(layers['eyelash-left'], eyeLCx, archYL, true);
  buildLushEyelash(layers['eyelash-right'], eyeRCx, archYR, false);

  // 2D. Mouth Closed (Level, Symmetrical Gentle Smile Line matching original art without hanging U-shadow!)
  //     & Mouth Interior (matching flustered.png 害羞原图 at the exact same center!)
  const mouthCx = 500.2, mouthCy = 201.2;
  {
    // 1) Build mouth-closed directly in straightened level coordinates around (500.2, 201.2):
    //    Delicate upward-curving smile line with subtle central highlight softening and ZERO hanging lower-lip shadow blob!
    const halfSpan = 6.6;
    for (let y = 196; y <= 206; y++) {
      for (let x = 491; x <= 510; x++) {
        const dx = x - mouthCx;
        const u = dx / halfSpan;
        if (Math.abs(u) > 1.06) continue;
        const env = Math.cos(clamp(u, -1, 1) * Math.PI * 0.5);
        // Gentle upward smile curve: center (u=0) at mouthCy + 0.45, corners (u=+-1) curving gently up to mouthCy - 0.40
        const yCurve = mouthCy + 0.45 - 0.85 * u * u;
        const halfThick = 0.26 + 0.40 * env;
        const dist = Math.abs(y - yCurve);
        const cornerTaper = smoothstep(1.06, 0.72, Math.abs(u));
        // Subtle 2px central highlight softening matching front-master-v02.png without splitting or drooping
        const centerHighlightSoft = 1.0 - 0.36 * Math.exp(-Math.pow(u / 0.14, 2));
        const mLine = smoothstep(halfThick + 0.62, Math.max(0, halfThick - 0.18), dist) * cornerTaper * centerHighlightSoft;
        if (mLine > 0.01) {
          const r = lerp(182, 202, env);
          const g = lerp(124, 140, env);
          const b = lerp(130, 146, env);
          setPx(layers['mouth-closed'], W, x, y, r, g, b, Math.round(mLine * 192));
        }
      }
    }

    // 2) Mouth-interior at straightened center (500.2, 201.2): Authentic anime parted mouth matching flustered.png!
    for (let y = 194; y <= 209; y++) {
      for (let x = 488; x <= 513; x++) {
        const lx = x - mouthCx;
        const ly = y - mouthCy;
        const rx = 5.0, ry = 2.9;
        const nx = lx / rx;
        const topCurve = -ry * (0.78 + 0.22 * Math.cos(clamp(nx, -1, 1) * Math.PI));
        const botCurve = ry * (0.90 - 0.22 * nx * nx);
        const midY = 0.5 * (topCurve + botCurve);
        const halfH = Math.max(0.5, 0.5 * (botCurve - topCurve));
        const ny = (ly - midY) / halfH;
        const rNorm = Math.sqrt(nx * nx + ny * ny);

        const mInt = smoothstep(1.05, 0.76, rNorm);
        if (mInt > 0.01) {
          const tVert = clamp((ly - topCurve) / (2 * halfH), 0, 1);
          // Soft rose-coral upper cavity -> warm pastel pink tongue matching mouths-6x.png bottom-left (NO dark top shadow!)
          let r = lerp(214, 244, smoothstep(0.08, 0.68, tVert));
          let g = lerp(136, 174, smoothstep(0.08, 0.68, tVert));
          let b = lerp(140, 174, smoothstep(0.08, 0.68, tVert));

          const rim = smoothstep(0.72, 0.98, rNorm);
          r = lerp(r, 198, rim * 0.35);
          g = lerp(g, 130, rim * 0.35);
          b = lerp(b, 136, rim * 0.35);

          blendPx(layers['mouth-interior'], W, x, y, r, g, b, mInt * 238);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Face Base: Preserve Authentic Artist-Painted 3D Face Shading, Sunlit Nose Bridge,
  //    Warm Nose-Tip Pinpoint, Forehead Bangs-Shadow & Cheek Blush from masterOrig + chNeutral!
  // -------------------------------------------------------------------------
  for (let y = 80; y <= 228; y++) {
    for (let x = 425; x <= 582; x++) {
      const mFace = polyMask(x, y, polyFaceSkin, 1.2);
      if (mFace <= 0) continue;

      const [mr, mg, mb, ma] = getPx(masterOrig, W, x, y);
      const [nr, ng, nb] = getPx(chNeutral, W, x, y);
      // Use 62% chNeutral in the upper/mid-face for warm 3D nose & cheek shading, tapering to 100% masterOrig along the outer jaw/chin
      const sdFace = pointInPoly(x, y, polyFaceSkin);
      const wNeutral = 0.62 * smoothstep(1.0, 5.5, sdFace) * smoothstep(216.0, 192.0, y);
      let r = mr * (1.0 - wNeutral) + nr * wNeutral;
      let g = mg * (1.0 - wNeutral) + ng * wNeutral;
      let b = mb * (1.0 - wNeutral) + nb * wNeutral;

      // 1) Clean the entire eye, brow, outer-corner, and glabella band into one continuous, warm 3D skin gradient
      //    (No smoothstep x-clamps at 446/551 that left vertical brown bars, and no pale white boxes!)
      const inLeftSocket = ellipseMask(x, y, 462.5, 165.0, 27.5, 16.5, -6.5, 6.0);
      const inRightSocket = ellipseMask(x, y, 536.5, 154.0, 27.5, 16.5, -6.5, 6.0);
      const inLeftUpperLid = ellipseMask(x, y, 461.5, 146.0, 24.5, 13.5, -6.5, 5.5);
      const inRightUpperLid = ellipseMask(x, y, 534.5, 136.0, 24.5, 13.5, -6.5, 5.5);
      const inGlabella = ellipseMask(x, y, 499.5, 155.0, 26.0, 17.5, -6.5, 6.5);
      const inEyeSocket = clamp(Math.max(inLeftSocket, inRightSocket, inLeftUpperLid, inRightUpperLid, inGlabella * 0.92), 0, 1);
      if (inEyeSocket > 0) {
        // Level height after head straightening: yLevel = y + (x - 500.2) * (10.2 / 73.5)
        const yLevel = y + (x - 500.2) * (10.2 / 73.5);
        const tS = smoothstep(134.0, 174.0, yLevel);
        let sr = lerp(251.5, 249.0, tS);
        let sg = lerp(232.0, 211.0, tS);
        let sb = lerp(230.0, 207.0, tS);

        // Soft 3D upper-eyelid warmth matching zoom-char-blink.png so closed eyelids look rounded, never pale/flat
        const lLidWarm = gaussianEllipse(x, y, 463.0, 161.0, 15.0, 7.0, -7.5);
        const rLidWarm = gaussianEllipse(x, y, 536.5, 150.8, 15.0, 7.0, -7.5);
        const lidWarm = clamp(lLidWarm + rLidWarm, 0, 1) * 0.22;
        sr = lerp(sr, 244.0, lidWarm);
        sg = lerp(sg, 194.0, lidWarm);
        sb = lerp(sb, 192.0, lidWarm);

        r = lerp(r, sr, inEyeSocket);
        g = lerp(g, sg, inEyeSocket);
        b = lerp(b, sb, inEyeSocket);
      }

      // 2) Clean the small side-hair wisp on the far-left cheek edge and any cool/silver hair pixels along the outer jawline
      const inLeftCheekEdge = smoothstep(459.5, 452.0, x)
        * smoothstep(162.0, 170.0, y)
        * smoothstep(206.0, 196.0, y)
        * smoothstep(0.2, 2.2, sdFace);
      const skinWarmth = (r - g) + (g - b) * 0.9;
      const inJawSilverClean = smoothstep(166.0, 176.0, y)
        * smoothstep(-0.2, 1.4, sdFace)
        * smoothstep(16.0, 6.0, skinWarmth);
      const edgeClean = clamp(Math.max(inLeftCheekEdge, inJawSilverClean), 0, 1);
      if (edgeClean > 0) {
        const tY = smoothstep(172.0, 204.0, y);
        const cr = lerp(249, 253, tY);
        const cg = lerp(210, 236, tY);
        const cb = lerp(206, 232, tY);
        r = lerp(r, cr, edgeClean);
        g = lerp(g, cg, edgeClean);
        b = lerp(b, cb, edgeClean);
      }

      // 3) Single, continuous warm-taupe jawline contour right on the outer edge of polyFaceSkin (y >= 174)
      const jawRim = smoothstep(172.0, 182.0, y)
        * smoothstep(-1.2, -0.2, sdFace)
        * (1.0 - smoothstep(0.4, 1.5, sdFace))
        * smoothstep(441.0, 447.0, x)
        * smoothstep(555.0, 548.0, x);
      if (jawRim > 0) {
        r = lerp(r, 138, jawRim * 0.82);
        g = lerp(g, 104, jawRim * 0.82);
        b = lerp(b, 104, jawRim * 0.82);
      }

      // 5) Reinforce the warm peach-coral cheek blush & delicate "///" hatching lines
      const cheekGuard = smoothstep(444.5, 452.5, x) * smoothstep(554.0, 546.0, x) * (1.0 - inEyeZoneForBlush(x, y));
      if (cheekGuard > 0.005) {
        const lBlush = gaussianEllipse(x, y, 465.0, 180.5, 18.0, 9.5, -7.5);
        const rBlush = gaussianEllipse(x, y, 533.0, 170.0, 19.0, 9.8, -7.5);
        const blushW = clamp((lBlush + rBlush * 0.95) * cheekGuard, 0, 1);
        r = lerp(r, 247, blushW * 0.30);
        g = lerp(g, 190, blushW * 0.30);
        b = lerp(b, 186, blushW * 0.30);

        const lCore = gaussianEllipse(x, y, 465.5, 180.2, 12.0, 5.5, -7.5);
        const rCore = gaussianEllipse(x, y, 532.5, 169.8, 12.5, 5.8, -7.5);
        const slashPhase = Math.sin(((x - 500.0) * 0.88 + (y - 176.0) * 0.48) * 1.38);
        const slashMask = smoothstep(0.55, 0.94, slashPhase) * Math.max(lCore, rCore) * cheekGuard;
        r = lerp(r, 234, slashMask * 0.22);
        g = lerp(g, 160, slashMask * 0.22);
        b = lerp(b, 162, slashMask * 0.22);
      }

      // 6) Crisp, Subtle 3D Nose Pinpoint at (497.2, 182.6) (which warps to dead-center 500.2, 182.6!)
      const nosePinpoint = ellipseMask(x, y, 497.2, 182.6, 1.0, 1.3, -12, 0.65);
      if (nosePinpoint > 0) {
        r = lerp(r, 206, nosePinpoint * 0.42);
        g = lerp(g, 152, nosePinpoint * 0.42);
        b = lerp(b, 152, nosePinpoint * 0.42);
      }

      // 7) Clean the full static mouth mark from masterOrig & chNeutral on face-base
      const inMouthMark = ellipseMask(x, y, 501.8, 201.5, 12.5, 5.8, -4.0, 2.2);
      if (inMouthMark > 0) {
        r = lerp(r, 253, inMouthMark);
        g = lerp(g, 239, inMouthMark);
        b = lerp(b, 237, inMouthMark);
      }

      setPx(layers['face-base'], W, x, y, r, g, b, mFace * ma);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Hair & Head Accessory Layers
  // -------------------------------------------------------------------------

  for (let y = 0; y <= 228; y++) {
    for (let x = 388; x <= 656; x++) {
      const [r, g, b, a] = getPx(masterOrig, W, x, y);
      if (a === 0) continue;
      const mHB = polyMask(x, y, polyHeadbandLeft, 1.5);
      const mOrn = polyMask(x, y, polyHeadOrnamentRight, 1.5);
      const m = Math.max(mHB, mOrn);
      if (m > 0) setPx(layers['head-accessories'], W, x, y, r, g, b, m * a);
    }
  }

  const rawSkinFade = new Float32Array(W * H);
  rawSkinFade.fill(1.0);
  for (let y = 110; y <= 176; y++) {
    for (let x = 408; x <= 578; x++) {
      const [r, g, b] = getPx(masterOrig, W, x, y);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const skinOrBrowness = (r - g) + Math.max(0, r - b) * 0.8;

      // Full width of left & right eye/upper-lid sockets (including outer corners 438..485 and 515..560!)
      const inLeftEyeZone = smoothstep(436.0, 441.0, x) * smoothstep(486.0, 481.0, x) * smoothstep(origArchYL(x) - 16.0, origArchYL(x) - 9.0, y);
      const inRightEyeZone = smoothstep(514.0, 519.0, x) * smoothstep(560.0, 554.0, x) * smoothstep(origArchYR(x) - 16.0, origArchYR(x) - 9.0, y);
      const inEyeZone = Math.max(inLeftEyeZone, inRightEyeZone);

      // Any pixel in the eye/lid zone that is warm skin (r - b > 2.2), dark brown lash/crease (lum < 198 && b - r < 5), or below the open lash arch is faded to 0 (transparent)!
      const isWarmOrDarkLash = Math.max(
        smoothstep(2.0, 5.5, r - b),
        smoothstep(7.5, 13.0, r - g),
        smoothstep(198.0, 175.0, lum) * smoothstep(6.0, 1.0, b - r),
        smoothstep(236.0, 243.0, g) * smoothstep(236.0, 243.0, b)
      );
      const belowLeftArch = smoothstep(436.0, 441.0, x) * smoothstep(484.5, 481.5, x) * smoothstep(origArchYL(x) - 5.5, origArchYL(x) - 2.0, y);
      const belowRightArch = smoothstep(515.5, 519.0, x) * smoothstep(560.0, 554.0, x) * smoothstep(origArchYR(x) - 5.5, origArchYR(x) - 2.0, y);
      const fadeLash = Math.max(inEyeZone * isWarmOrDarkLash, belowLeftArch, belowRightArch);

      const inCenterTipSkin = smoothstep(154.0, 161.0, y) * smoothstep(468.0, 474.0, x) * smoothstep(518.0, 512.0, x)
        * Math.max(smoothstep(12.0, 18.0, skinOrBrowness), smoothstep(3.0, 7.0, r - b));

      rawSkinFade[y * W + x] = 1.0 - clamp(Math.max(fadeLash, inCenterTipSkin), 0, 1);
    }
  }

  for (let y = 16; y <= 176; y++) {
    for (let x = 408; x <= 578; x++) {
      let [r, g, b, a] = getPx(masterOrig, W, x, y);
      if (a === 0) continue;

      const mBangs = polyMask(x, y, polyBangs, 1.5);
      if (mBangs <= 0) continue;
      const mAcc = Math.max(
        polyMask(x, y, polyHeadbandLeft, 1.0),
        polyMask(x, y, polyHeadOrnamentRight, 1.0)
      );

      const inStaticBrowL = ellipseMask(x, y, 461.5, 136.5, 16.5, 4.5, -7.5, 1.6);
      const inStaticBrowR = ellipseMask(x, y, 532.0, 129.0, 17.5, 4.5, 7.5, 1.6);
      const inStaticBrow = Math.max(inStaticBrowL, inStaticBrowR);
      if (inStaticBrow > 0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const wInpaint = inStaticBrow * smoothstep(232.0, 198.0, lum) * smoothstep(10.0, 18.0, r - g);
        if (wInpaint > 0) {
          const [lr, lg, lb] = getPx(masterOrig, W, x, Math.max(115, y - 5));
          r = lerp(r, Math.max(lr, 244), wInpaint);
          g = lerp(g, Math.max(lg, 232), wInpaint);
          b = lerp(b, Math.max(lb, 242), wInpaint);
        }
      }

      let skinFade = 1.0;
      if (y > 118) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += rawSkinFade[(y + dy) * W + (x + dx)];
          }
        }
        skinFade = sum / 9.0;
      }

      const finalAlpha = mBangs * (1 - mAcc * 0.92) * skinFade * a;
      if (finalAlpha > 2) {
        setPx(layers['bangs'], W, x, y, r, g, b, finalAlpha);
      }
    }
  }

  for (let y = 128; y <= 442; y++) {
    for (let x = 392; x <= 452; x++) {
      const [r, g, b, a] = getPx(master, W, x, y);
      if (a === 0) continue;
      const mSideL = polyMask(x, y, polySideHairLeft, 1.5);
      if (mSideL <= 0) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const notDarkNavy = smoothstep(70, 115, lum);
      const alpha = mSideL * notDarkNavy * a;
      if (alpha > 2) setPx(layers['side-hair-left'], W, x, y, r, g, b, alpha);
    }
    for (let x = 544; x <= 612; x++) {
      const [r, g, b, a] = getPx(master, W, x, y);
      if (a === 0) continue;
      const mSideR = polyMask(x, y, polySideHairRight, 1.5);
      if (mSideR <= 0) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const notDarkNavy = smoothstep(75, 120, lum);
      const alpha = mSideR * notDarkNavy * a;
      if (alpha > 2) setPx(layers['side-hair-right'], W, x, y, r, g, b, alpha);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Arms & Waist Accessories
  // -------------------------------------------------------------------------

  for (let y = 360; y <= 768; y++) {
    for (let x = 234; x <= 416; x++) {
      const [r, g, b, a] = getPx(master, W, x, y);
      if (a === 0) continue;
      const mArmL = polyMask(x, y, polyArmLeft, 1.2);
      if (mArmL <= 0) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const isDarkNavy = (b - r > 12 && lum < 105) ? 1 : 0;
      const fg = isDarkNavy ? 0 : smoothstep(75, 115, lum);
      const alpha = mArmL * fg * a;
      if (alpha > 2) setPx(layers['arm-left'], W, x, y, r, g, b, alpha);
    }
    for (let x = 568; x <= 746; x++) {
      const [r, g, b, a] = getPx(master, W, x, y);
      if (a === 0) continue;
      const mArmR = polyMask(x, y, polyArmRight, 1.2);
      if (mArmR <= 0) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const isDarkNavy = (b - r > 12 && lum < 105) ? 1 : 0;
      const fg = isDarkNavy ? 0 : smoothstep(75, 115, lum);
      const alpha = mArmR * fg * a;
      if (alpha > 2) setPx(layers['arm-right'], W, x, y, r, g, b, alpha);
    }
  }

  for (let y = 455; y <= 1232; y++) {
    for (let x = 378; x <= 716; x++) {
      const [r, g, b, a] = getPx(master, W, x, y);
      if (a === 0) continue;
      const mFlute = polyMask(x, y, polyFluteAndRibbon, 1.2);
      const mBook = (x >= 522 && x <= 596 && y >= 598 && y <= 708)
        ? polyMask(x, y, [[524, 602], [588, 600], [595, 695], [532, 705]], 1.2)
        : 0;
      const mChainZone = polyMask(x, y, polyWaistChainsAndBook, 1.2);
      let chainMask = 0;
      if (mChainZone > 0 && y < 612) {
        const isWarmGoldOrSilver = (r > 95 && g > 85 && (r - b > -12)) ? smoothstep(90, 140, (r + g) * 0.5) : 0;
        chainMask = mChainZone * isWarmGoldOrSilver * 0.85;
      }
      const alpha = clamp(Math.max(mFlute, mBook, chainMask), 0, 1) * a;
      if (alpha > 2) setPx(layers['waist-accessories'], W, x, y, r, g, b, alpha);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Body-and-Skirt and Back-Hair
  // -------------------------------------------------------------------------

  for (let y = 200; y <= 1490; y++) {
    for (let x = 115; x <= 840; x++) {
      const mBody = polyMask(x, y, polyBodyAndSkirt, 1.2);
      if (mBody <= 0) continue;
      let [r, g, b, a] = getPx(master, W, x, y);

      // Clean any baked-in chin outline at the top of the neck (x=484..531, y=212..228)
      // so both rest pose and head turns (ParamAngleX) reveal a 100% smooth, continuous neck shadow!
      if (y >= 212 && y <= 228 && x >= 484 && x <= 531) {
        const inNeckTop = smoothstep(484.0, 489.0, x) * smoothstep(531.0, 525.5, x) * smoothstep(228.5, 225.5, y);
        if (inNeckTop > 0) {
          const [nr, ng, nb] = getPx(master, W, clamp(x, 491, 524), 229);
          r = lerp(r, nr, inNeckTop);
          g = lerp(g, ng, inNeckTop);
          b = lerp(b, nb, inNeckTop);
        }
      }

      const inArmLZone = polyMask(x, y, polyArmLeft, 4.0);
      const inArmRZone = polyMask(x, y, polyArmRight, 4.0);
      const armZone = Math.max(inArmLZone, inArmRZone);
      if (armZone > 0 && y >= 375 && y <= 768) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const isBrightSleeveOrHand = smoothstep(65, 105, lum);
        const w = armZone * isBrightSleeveOrHand;
        const nr = 32, ng = 34, nb = 74;
        r = r * (1 - w) + nr * w;
        g = g * (1 - w) + ng * w;
        b = b * (1 - w) + nb * w;
      }

      if (a > 0) setPx(layers['body-and-skirt'], W, x, y, r, g, b, mBody * a);
    }
  }

  for (let y = 20; y <= 840; y++) {
    for (let x = 80; x <= 915; x++) {
      const [mr, mg, mb, ma] = getPx(master, W, x, y);
      if (ma === 0) continue;
      const mBody = polyMask(x, y, polyBodyAndSkirt, 1.0);
      const mHeadAcc = Math.max(
        polyMask(x, y, polyHeadbandLeft, 1.5),
        polyMask(x, y, polyHeadOrnamentRight, 1.5)
      );
      const mFaceOrBangs = Math.max(
        polyMask(x, y, polyFaceSkin, 1.5),
        polyMask(x, y, polyBangs, 1.5)
      );
      if (mBody < 0.5 && mHeadAcc < 0.5 && mFaceOrBangs < 0.5) {
        setPx(layers['back-hair'], W, x, y, mr, mg, mb, ma);
      } else if (x >= 340 && x <= 660 && y >= 110 && y <= 780) {
        const mCore = ellipseMask(x, y, 500, 395, 128, 265, 0, 16);
        if (mCore > 0) {
          const [br, bg, bb, ba] = getPx(backHairV1, W, x, y);
          const inFaceJawHalo = (y <= 232 && x >= 435 && x <= 562) ? 1 : 0;
          const coreAlpha = mCore * ma;
          if (ba > 200 && !inFaceJawHalo) {
            setPx(layers['back-hair'], W, x, y, (br + 220) * 0.5, (bg + 214) * 0.5, (bb + 236) * 0.5, coreAlpha);
          } else {
            setPx(layers['back-hair'], W, x, y, 220, 214, 236, coreAlpha);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 7. Straighten the Head & Facial Axis (Leveling the -7.9° Eye Slant & Aligning Nose/Mouth/Chin on x = 500.2)
  // -------------------------------------------------------------------------
  function sampleBilinearPremult(buf, w, h, fx, fy) {
    const x0 = clamp(Math.floor(fx), 0, w - 1);
    const y0 = clamp(Math.floor(fy), 0, h - 1);
    const x1 = clamp(x0 + 1, 0, w - 1);
    const y1 = clamp(y0 + 1, 0, h - 1);
    const tx = fx - Math.floor(fx);
    const ty = fy - Math.floor(fy);
    const idx = [
      (y0 * w + x0) * 4, (y0 * w + x1) * 4,
      (y1 * w + x0) * 4, (y1 * w + x1) * 4
    ];
    const wts = [
      (1 - tx) * (1 - ty), tx * (1 - ty),
      (1 - tx) * ty, tx * ty
    ];
    let pr = 0, pg = 0, pb = 0, pa = 0;
    for (let k = 0; k < 4; k++) {
      const a = buf[idx[k] + 3] / 255;
      const wk = wts[k];
      pr += buf[idx[k]] * a * wk;
      pg += buf[idx[k] + 1] * a * wk;
      pb += buf[idx[k] + 2] * a * wk;
      pa += a * wk;
    }
    if (pa <= 1e-5) return [0, 0, 0, 0];
    return [pr / pa, pg / pa, pb / pa, pa * 255];
  }

  function srcFromStraightHead(x, y) {
    if (y >= 275) return [x, y];
    const cx = 500.2;
    const slopeTan = 10.2 / 73.5; // 0.13878
    let wVert = 1.0;
    if (y < 110) {
      wVert = 0.18 + 0.82 * smoothstep(25, 110, y);
    } else if (y > 205) {
      wVert = 1.0 - smoothstep(205, 252, y);
    }
    const headXMask = smoothstep(380, 425, x) * smoothstep(635, 580, x);
    const sy = y - (x - cx) * slopeTan * wVert * headXMask;

    const jawShift = 5.5 * smoothstep(164, 218, y) * (1.0 - smoothstep(232, 268, y))
      * smoothstep(420, 452, x) * smoothstep(585, 548, x);
    const noseW = Math.exp(-Math.pow((x - cx) / 17.5, 2) - Math.pow((y - 182.6) / 12.0, 2));
    const mouthW = Math.exp(-Math.pow((x - cx) / 16.0, 2) - Math.pow((y - 201.0) / 9.5, 2));
    const noseOffset = -(3.0 + jawShift) * noseW;
    const mouthOffset = (2.3 - jawShift) * mouthW;

    const sx = x + jawShift + noseOffset + mouthOffset;
    return [sx, sy];
  }

  for (const id of ['back-hair', 'body-and-skirt', 'face-base', 'side-hair-left', 'side-hair-right', 'bangs', 'head-accessories']) {
    const srcBuf = layers[id];
    const warpedBuf = allocBuf(W, H);
    for (let y = 0; y < H; y++) {
      if (y >= 275) {
        const rowStart = y * W * 4;
        warpedBuf.set(srcBuf.subarray(rowStart, rowStart + W * 4), rowStart);
        continue;
      }
      for (let x = 0; x < W; x++) {
        const [sx, sy] = srcFromStraightHead(x, y);
        const [r, g, b, a] = sampleBilinearPremult(srcBuf, W, H, sx, sy);
        if (a > 0.5) {
          setPx(warpedBuf, W, x, y, r, g, b, a);
        }
      }
    }
    layers[id] = warpedBuf;
  }

  // 8. Eyebrows: Crisp, Level, Mirror-Symmetric Warm Cocoa-Taupe Brows Softly Veiled by Straightened Silver Bangs!
  function buildSoftAnimeBrow(targetBuf, bcx, bcy, isLeft) {
    const halfSpan = 14.8;
    for (let y = Math.round(bcy - 10); y <= Math.round(bcy + 10); y++) {
      for (let x = Math.round(bcx - 17); x <= Math.round(bcx + 17); x++) {
        const dx = x - bcx;
        const u = dx / halfSpan;
        if (Math.abs(u) >= 1.0) continue;
        const innerSigned = isLeft ? u : -u; // +1 at inner corner, -1 at outer corner
        const env = Math.cos(u * Math.PI * 0.5);
        const yCurve = bcy + 0.35 * innerSigned - 1.15 * (1.0 - u * u);

        const [br, bg, bb, ba] = getPx(layers['bangs'], W, x, y);
        const bangLum = (br + bg + bb) / 3.0;
        const hairVeil = (ba / 255.0) * smoothstep(215, 242, bangLum);
        const veilAlphaScale = 1.0 - hairVeil * 0.48;

        const halfThick = 0.28 + 0.52 * env;
        const dist = Math.abs(y - yCurve);
        const m = smoothstep(halfThick + 0.72, Math.max(0, halfThick - 0.22), dist) * Math.pow(env, 0.58);
        if (m > 0.01) {
          const outerT = clamp((isLeft ? -u : u) * 0.5 + 0.5, 0, 1);
          let r = lerp(114, 138, outerT);
          let g = lerp(82, 104, outerT);
          let b = lerp(90, 114, outerT);
          r = lerp(r, 196, hairVeil * 0.45);
          g = lerp(g, 182, hairVeil * 0.45);
          b = lerp(b, 206, hairVeil * 0.45);
          blendPx(targetBuf, W, x, y, r, g, b, m * 182 * veilAlphaScale);
        }
      }
    }
  }
  buildSoftAnimeBrow(layers['eyebrow-left'], 463.2, 134.0, true);
  buildSoftAnimeBrow(layers['eyebrow-right'], 536.8, 134.0, false);

  const orderedIds = [
    'back-hair',
    'body-and-skirt',
    'arm-left',
    'arm-right',
    'waist-accessories',
    'face-base',
    'eye-white-left',
    'eye-white-right',
    'iris-left',
    'iris-right',
    'eyelash-left',
    'eyelash-right',
    'mouth-interior',
    'mouth-closed',
    'side-hair-left',
    'side-hair-right',
    'bangs',
    'eyebrow-left',
    'eyebrow-right',
    'head-accessories',
  ];

  const assetsMeta = [];
  for (const id of orderedIds) {
    const meta = await saveLayer(layers[id], W, H, id);
    assetsMeta.push(meta);
  }

  const sourceAssetsPayload = {
    version: 2,
    method: 'geometrically aligned to front-master-v02.png (1024x1536) with authentic tsundere-cute Kimi facial layers',
    master: 'front-master-v02.png',
    refs: ['references/character-sheet.png', 'references/three-views.jpg'],
    assets: assetsMeta.map(({ relFile, ...rest }) => rest),
  };
  fs.writeFileSync(path.resolve('art/live2d/source-assets.json'), JSON.stringify(sourceAssetsPayload, null, 2) + '\n');

  const layerPlanPayload = {
    version: 2,
    canvas: { width: W, height: H },
    master: 'front-master-v02.png',
    status: 'aligned 20-layer source ready for PSD packaging and Cubism rigging',
    layers: assetsMeta.map((m, idx) => ({
      id: m.id,
      order: idx,
      status: m.status,
      file: m.relFile,
    })),
  };
  fs.writeFileSync(path.resolve('art/live2d/layer-plan.json'), JSON.stringify(layerPlanPayload, null, 2) + '\n');

  // -------------------------------------------------------------------------
  // 7. Render High-Res 6-Expression + Blink Closeup Preview from Separated Layers
  // -------------------------------------------------------------------------
  function warpLayer(src, deformFn) {
    const out = allocBuf(W, H);
    for (let y = 0; y < 320; y++) {
      for (let x = 340; x < 660; x++) {
        const [sx, sy] = deformFn(x, y);
        if (sx >= 0 && sx < W - 1 && sy >= 0 && sy < H - 1) {
          const [r, g, b, a] = sampleBilinear(src, W, H, sx, sy);
          setPx(out, W, x, y, r, g, b, a);
        }
      }
    }
    return out;
  }

  function renderExpressionHead(exp) {
    const comp = allocBuf(W, H);
    alphaOver(comp, layers['back-hair'], W, H);
    alphaOver(comp, layers['body-and-skirt'], W, H);
    alphaOver(comp, layers['face-base'], W, H);

    const eyeOpen = exp.eyeOpen ?? 1.0;
    const eyeSmile = exp.eyeSmile ?? 0.0;
    const gx = exp.eyeBallX ?? 0.0;
    const gy = exp.eyeBallY ?? 0.0;

    if (eyeOpen > 0.05 && eyeSmile < 0.7) {
      alphaOver(comp, layers['eye-white-left'], W, H);
      alphaOver(comp, layers['eye-white-right'], W, H);
      for (const side of ['left', 'right']) {
        const wBuf = layers[`eye-white-${side}`];
        const iBuf = warpLayer(layers[`iris-${side}`], (x, y) => [x - gx * 4.5, y + gy * 3.5]);
        for (let y = 135; y <= 190; y++) {
          for (let x = 435; x <= 565; x++) {
            const idx = (y * W + x) * 4;
            const maskA = wBuf[idx + 3] / 255;
            if (maskA > 0 && iBuf[idx + 3] > 0) {
              blendPx(comp, W, x, y, iBuf[idx], iBuf[idx + 1], iBuf[idx + 2], iBuf[idx + 3] * maskA);
            }
          }
        }
      }
    }

    for (const [side, ecx, ecy, isLeft] of [['left', eyeLCx, eyeLCy, true], ['right', eyeRCx, eyeRCy, false]]) {
      const lashWarped = warpLayer(layers[`eyelash-${side}`], (x, y) => {
        const restArchY = isLeft ? archYL(x) : archYR(x);
        const u = (x - ecx) / 18.6;
        const outerU = isLeft ? -u : u;
        if (eyeSmile > 0.5) {
          const smileLineY = (ecy + 1.4) - 2.8 * Math.max(0, 1.0 - u * u) - 0.5 * outerU;
          const dy = y - smileLineY;
          const scale = dy < 0 ? 0.45 : 0.78;
          return [x, restArchY + dy / scale];
        }
        const closeLineY = (ecy + 2.2) - 2.6 * u * u - 1.0 * outerU;
        const center = closeLineY * (1 - eyeOpen) + restArchY * eyeOpen;
        const dy = y - center;
        const scale = dy < 0
          ? 0.42 * (1 - eyeOpen) + 1.0 * eyeOpen
          : 0.78 * (1 - eyeOpen) + 1.0 * eyeOpen;
        return [x, restArchY + dy / scale];
      });
      alphaOver(comp, lashWarped, W, H);
    }

    const mOpen = exp.mouthOpen ?? 0.0;
    const mForm = exp.mouthForm ?? 0.0;
    if (mOpen >= 0.08) {
      const intWarped = warpLayer(layers['mouth-interior'], (x, y) => {
        const sx = (0.94 + 0.14 * mOpen) * (1.0 + 0.08 * mForm);
        const sy = 0.45 + 0.62 * mOpen;
        const cornerNorm = clamp((x - mouthCx) / 5.6, -1.2, 1.2);
        const cornerLift = -mForm * 0.75 * cornerNorm * cornerNorm;
        return [mouthCx + (x - mouthCx) / sx, mouthCy + (y - mouthCy - cornerLift) / sy];
      });
      alphaOver(comp, intWarped, W, H);
    } else {
      const clWarped = warpLayer(layers['mouth-closed'], (x, y) => {
        const deltaForm = mForm;
        const cornerNorm = clamp((x - mouthCx) / 7.8, -1.2, 1.2);
        const cornerLift = -deltaForm * 1.05 * cornerNorm * cornerNorm;
        const centerArch = deltaForm * 0.35 * Math.max(0, 1.0 - cornerNorm * cornerNorm);
        const sx = 1.0 + 0.12 * deltaForm;
        return [mouthCx + (x - mouthCx) / sx, y - cornerLift - centerArch];
      });
      alphaOver(comp, clWarped, W, H);
    }

    alphaOver(comp, layers['side-hair-left'], W, H);
    alphaOver(comp, layers['side-hair-right'], W, H);
    alphaOver(comp, layers['bangs'], W, H);

    const browY = exp.browY ?? 0.0;
    const browAng = exp.browAngle ?? 0.0;
    for (const [side, bcx, isLeft] of [['left', 463.2, true], ['right', 536.8, false]]) {
      const browWarped = warpLayer(layers[`eyebrow-${side}`], (x, y) => {
        const innerSigned = isLeft ? (x - bcx) / 14.8 : (bcx - x) / 14.8;
        const dy = -browY * 4.2 - browAng * innerSigned * 3.5;
        return [x, y - dy];
      });
      alphaOver(comp, browWarped, W, H);
    }

    alphaOver(comp, layers['head-accessories'], W, H);
    return comp;
  }

  const expList = [
    { name: 'neutral', eyeOpen: 1.0, eyeSmile: 0, mouthOpen: 0, mouthForm: 0, browY: 0, browAngle: 0, eyeBallX: 0, eyeBallY: 0 },
    { name: 'flustered', eyeOpen: 0.95, eyeSmile: 0, mouthOpen: 0.85, mouthForm: -0.65, browY: -0.1, browAngle: 0.85, eyeBallX: -0.25, eyeBallY: -0.10 },
    { name: 'annoyed', eyeOpen: 0.86, eyeSmile: 0, mouthOpen: 0, mouthForm: -0.95, browY: -0.45, browAngle: -0.85, eyeBallX: 0, eyeBallY: 0.06 },
    { name: 'curious', eyeOpen: 1.0, eyeSmile: 0, mouthOpen: 0.65, mouthForm: -0.15, browY: 0.55, browAngle: 0.35, eyeBallX: 0, eyeBallY: 0.06 },
    { name: 'pleased', eyeOpen: 0, eyeSmile: 1.0, mouthOpen: 0, mouthForm: 0.95, browY: 0.3, browAngle: 0.2, eyeBallX: 0, eyeBallY: 0 },
    { name: 'softened', eyeOpen: 0.94, eyeSmile: 0, mouthOpen: 0, mouthForm: 0.85, browY: 0.15, browAngle: 0.65, eyeBallX: -0.08, eyeBallY: -0.05 },
    { name: 'blink', eyeOpen: 0, eyeSmile: 0, mouthOpen: 0, mouthForm: 0, browY: -0.05, browAngle: 0, eyeBallX: 0, eyeBallY: 0 },
  ];

  for (const exp of expList) {
    const buf = renderExpressionHead(exp);
    await sharp(Buffer.from(buf.buffer), { raw: { width: W, height: H, channels: 4 } })
      .extract({ left: 340, top: 0, width: 340, height: 320 })
      .png()
      .toFile(path.join(SCRATCH_DIR, `rebuilt-exp-${exp.name}.png`));
  }

  const restComp = renderExpressionHead(expList[0]);
  const restCompPath = path.join(SCRATCH_DIR, 'composite-v02-rest.png');
  await sharp(Buffer.from(restComp.buffer), { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(restCompPath);

  const cmpBuffers = [masterOrig, chNeutral, chFlustered, restComp];
  const cmpCrops = [];
  for (const buf of cmpBuffers) {
    cmpCrops.push(
      await sharp(Buffer.from(buf.buffer), { raw: { width: W, height: H, channels: 4 } })
        .extract({ left: 420, top: 105, width: 160, height: 130 })
        .resize(320, 260, { kernel: 'nearest' })
        .png()
        .toBuffer()
    );
  }
  await sharp({
    create: { width: 640, height: 520, channels: 4, background: { r: 24, g: 24, b: 32, alpha: 1 } },
  })
    .composite([
      { input: cmpCrops[0], left: 0, top: 0 },
      { input: cmpCrops[1], left: 320, top: 0 },
      { input: cmpCrops[2], left: 0, top: 260 },
      { input: cmpCrops[3], left: 320, top: 260 },
    ])
    .png()
    .toFile(path.join(SCRATCH_DIR, 'compare-4-faces-2x.png'));

  console.log('Rebuilt v02 layers in upright-12 space and saved 7 previews + compare-4-faces-2x.png.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
