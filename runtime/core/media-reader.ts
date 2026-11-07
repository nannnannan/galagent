import path from 'node:path';
import { tmpdir } from 'node:os';
import { stat, readFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';

type MediaOptions = {
  region?: { x: number; y: number; width: number; height: number };
  full_resolution?: boolean;
};
type MediaHooks = {
  upload?: (bytes: Buffer, mimeType: string, filename: string) => Promise<{ id: string } | undefined>;
  encode: (exe: string, args: string[]) => Promise<{ status: string; output: string }>;
};

const VIDEO_EXT_MIMES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.3gp': 'video/3gpp',
};
export function detectVideoMime(file: string, header?: Buffer): string | undefined {
  if (header && header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = header.subarray(8, 12).toString('ascii');
    return brand === 'qt  ' ? 'video/quicktime' : brand.startsWith('3gp') ? 'video/3gpp' : 'video/mp4';
  }
  if (
    header &&
    header.length >= 4 &&
    header[0] === 0x1a &&
    header[1] === 0x45 &&
    header[2] === 0xdf &&
    header[3] === 0xa3
  )
    return header.subarray(0, 64).toString('latin1').toLowerCase().includes('webm')
      ? 'video/webm'
      : 'video/x-matroska';
  if (
    header &&
    header.length >= 12 &&
    header.subarray(0, 4).toString('ascii') === 'RIFF' &&
    header.subarray(8, 12).toString('ascii') === 'AVI '
  )
    return 'video/x-msvideo';
  if (header && header.length >= 3 && header.subarray(0, 3).toString('ascii') === 'FLV') return 'video/x-flv';
  if (
    header &&
    header.length >= 4 &&
    header[0] === 0x00 &&
    header[1] === 0x00 &&
    header[2] === 0x01 &&
    (header[3] === 0xba || header[3] === 0xb3)
  )
    return 'video/mpeg';
  return VIDEO_EXT_MIMES[path.extname(file).toLowerCase()];
}
const hasVideoMagic = (header: Buffer) => Boolean(detectVideoMime('', header));
export async function readMedia(file: string, options: MediaOptions, hooks: MediaHooks) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error('Media must be a file at most 100 MB');
  if (/\.(mp4|mpeg|mpg|mov|mkv|avi|webm|flv|3gp)$/i.test(file)) return readVideo(file, options, hooks);
  const head = await readFile(file).then(
    (b) => b.subarray(0, 64),
    () => Buffer.alloc(0),
  );
  if (hasVideoMagic(head)) return readVideo(file, options, hooks);
  let image = sharp(file, { animated: false }),
    metadata = await image.metadata();
  if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format || ''))
    throw new Error('Unsupported media format; convert to PNG/JPEG/WebP/GIF first');
  if (options.region) {
    if (
      options.region.x + options.region.width > (metadata.width || 0) ||
      options.region.y + options.region.height > (metadata.height || 0)
    )
      throw new Error('Crop exceeds image boundaries');
    image = image.extract({
      left: options.region.x,
      top: options.region.y,
      width: options.region.width,
      height: options.region.height,
    });
  } else if (!options.full_resolution)
    image = image.resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true });
  const bytes = await image.png().toBuffer();
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Image exceeds delivery limit; use region');
  const part = { type: 'image_url', image_url: { url: 'data:image/png;base64,' + bytes.toString('base64') } },
    note = `<system>Read image file. Mime type: image/png. Size: ${bytes.length} bytes. Original dimensions: ${metadata.width}x${metadata.height}. If you generate or edit images or videos via commands or scripts, read the result back immediately before continuing.</system>`;
  return {
    content: `Image from ${file}; original ${metadata.width}x${metadata.height}.\n${note}`,
    attachments: [part],
    parts: [
      { type: 'text', text: `<image path="${file}">` },
      part,
      { type: 'text', text: '</image>' },
      { type: 'text', text: note },
    ],
  };
}
async function readVideo(file: string, options: MediaOptions, hooks: MediaHooks) {
  if (options.region) throw new Error('region is for images only');
  const raw = await readFile(file);
  if (!raw.length) throw new Error('Video file is empty');
  let mimeType = detectVideoMime(file, raw.subarray(0, 64)) || 'video/mp4',
    delivery = raw;
  const uploaded = await hooks.upload?.(raw, mimeType, path.basename(file)).catch(() => undefined);
  if (!uploaded?.id && (!hasVideoMagic(raw.subarray(0, 64)) || raw.length > 16 * 1024 * 1024)) {
    if (!ffmpeg) throw new Error('Video decoder unavailable');
    const directory = await mkdtemp(path.join(tmpdir(), 'galagent-video-')),
      target = path.join(directory, 'normalized.mp4'),
      executable = ffmpeg.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    try {
      const task = await hooks.encode(executable, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        file,
        '-vf',
        'scale=1280:720:force_original_aspect_ratio=decrease',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        target,
      ]);
      if (task.status !== 'done') throw new Error(task.output || 'Video decoding failed');
      delivery = await readFile(target);
      mimeType = 'video/mp4';
      if (delivery.length > 16 * 1024 * 1024)
        throw new Error('Video exceeds 16 MiB limit even after encoding');
    } finally {
      await unlink(target).catch(() => {});
      await rmdir(directory).catch(() => {});
    }
  }
  const part = uploaded?.id
    ? { type: 'video_url', video_url: { url: 'ms://' + uploaded.id, id: uploaded.id } }
    : { type: 'video_url', video_url: { url: `data:${mimeType};base64,${delivery.toString('base64')}` } };
  const note = `<system>Read video file. Mime type: ${mimeType}. Size: ${delivery.length} bytes. If you generate or edit images or videos via commands or scripts, read the result back immediately before continuing.</system>`;
  return {
    content: `<video path="${file}"></video>\n${note}`,
    attachments: [part],
    parts: [
      { type: 'text', text: `<video path="${file}">` },
      part,
      { type: 'text', text: '</video>' },
      { type: 'text', text: note },
    ],
  };
}
