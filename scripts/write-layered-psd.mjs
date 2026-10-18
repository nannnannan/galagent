// Lossless PNG-to-PSD packaging. Crops transparent margins while preserving exact canvas (left, top) coordinates and pixel values.
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const { writePsdBuffer, readPsd, initializeCanvas } = await import('../.tools/psd/node_modules/ag-psd/dist/index.js');

initializeCanvas(
  () => {
    throw Error('Canvas rendering is not used for lossless packaging');
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
);

const readFull = async (file) => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
};

const readTrimmedLayer = async (entry) => {
  const { data, info } = await sharp(entry.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  let left = W, top = H, right = 0, bottom = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 0) {
        if (x < left) left = x;
        if (y < top) top = y;
        if (x + 1 > right) right = x + 1;
        if (y + 1 > bottom) bottom = y + 1;
      }
    }
  }
  if (right <= left || bottom <= top) {
    throw new Error(`Layer ${entry.name} (${entry.file}) has no visible pixels`);
  }
  const cropW = right - left;
  const cropH = bottom - top;
  const cropped = new Uint8ClampedArray(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) {
    const srcStart = ((top + y) * W + left) * 4;
    const dstStart = y * cropW * 4;
    cropped.set(data.subarray(srcStart, srcStart + cropW * 4), dstStart);
  }
  return {
    name: entry.name,
    left: (entry.left || 0) + left,
    top: (entry.top || 0) + top,
    hidden: !!entry.hidden,
    imageData: { data: cropped, width: cropW, height: cropH },
  };
};

const children = [];
for (const entry of config.layers) {
  children.push(await readTrimmedLayer(entry));
}

const psd = {
  width: config.width,
  height: config.height,
  children,
  imageResources: {
    resolutionInfo: {
      horizontalResolution: 72,
      horizontalResolutionUnit: 'PPI',
      widthUnit: 'Inches',
      verticalResolution: 72,
      verticalResolutionUnit: 'PPI',
      heightUnit: 'Inches',
    },
  },
};

if (config.composite) {
  psd.imageData = await readFull(config.composite);
}

const bytes = writePsdBuffer(psd, { generateThumbnail: false, trimImageData: false });
const decoded = readPsd(bytes, { useImageData: true, skipThumbnail: true });

for (let i = 0; i < children.length; i++) {
  if (
    children[i].left !== decoded.children[i].left ||
    children[i].top !== decoded.children[i].top ||
    !Buffer.from(children[i].imageData.data).equals(Buffer.from(decoded.children[i].imageData.data))
  ) {
    throw Error(`Layer pixel/bounds roundtrip changed for ${children[i].name}`);
  }
}

await writeFile(config.output, bytes);
console.log(JSON.stringify({ output: config.output, layers: children.length, bytes: bytes.length, lossless: true }));
