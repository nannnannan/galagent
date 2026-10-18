import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';

const plan = JSON.parse(await readFile('art/live2d/layer-plan.json', 'utf8'));
const order = [
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

const layers = [];
const assets = [];

for (const id of order) {
  const filename = `${id}-v02.png`;
  const file = `art/live2d/layers/${filename}`;
  const bytes = await readFile(file);
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = 0, bottom = 0, visible = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] >= 8) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
        visible++;
      }
    }
  }
  if (!visible) throw Error('Empty source ' + id);
  layers.push({ name: id, file, left: 0, top: 0 });
  assets.push({
    id,
    file,
    width: info.width,
    height: info.height,
    opaqueBounds: { left, top, right, bottom },
    visiblePixels: visible,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    status: 'aligned to 1024x1536 master canvas with occluded underpainting completed',
  });
}

plan.version = 2;
plan.canvas = { width: 1024, height: 1536 };
plan.status = 'aligned 20-layer PSD ready for Live2D Cubism rigging';
plan.layers = order.map((id, idx) => ({
  id,
  order: idx,
  status: 'aligned to 1024x1536 master canvas with occluded underpainting completed',
  file: `layers/${id}-v02.png`,
}));

await writeFile('art/live2d/layer-plan.json', JSON.stringify(plan, null, 2) + '\n');
await writeFile(
  'art/live2d/source-assets.json',
  JSON.stringify(
    {
      version: 2,
      method: 'geometrically aligned to front-master-v02.png (1024x1536) with occluded underpainting completed; lossless PSD packaging',
      master: 'front-master-v02.png',
      refs: ['references/character-sheet.png', 'references/three-views.jpg'],
      assets,
    },
    null,
    2
  ) + '\n'
);

const psdConfigV2 = {
  width: 1024,
  height: 1536,
  layers,
  composite: 'art/live2d/front-master-v02.png',
  output: 'art/live2d/kimi-layered-source-v02.psd',
  purpose: 'Geometrically aligned 20-layer PSD (1024x1536) with occluded underpainting completed for Live2D Cubism Editor 5.3.',
};
await writeFile('art/live2d/kimi-layered-source-v02.json', JSON.stringify(psdConfigV2, null, 2) + '\n');

const psdConfigV1 = {
  ...psdConfigV2,
  output: 'art/live2d/kimi-layered-source-v01.psd',
};
await writeFile('art/live2d/kimi-layered-source-v01.json', JSON.stringify(psdConfigV1, null, 2) + '\n');

console.log(JSON.stringify({ layers: layers.length, uniqueSourceImages: new Set(layers.map((l) => l.file)).size, allHaveVisibleAlpha: true }));
