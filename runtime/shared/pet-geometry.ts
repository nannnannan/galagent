// Where the desktop pet may go. The window is a large transparent canvas — most of it is empty sky that
// holds the speech bubble, the sway and the particles — so the window edge is NOT the pet's edge. What the
// user can see is the sprite's footprint inside the window; that box is what we keep on screen, which lets
// the head reach the top of the display and the feet reach the taskbar while the empty canvas hangs off.
//
// Fractions are of the window size, measured from its top-left. The renderer sends the real numbers once it
// has laid the sprite out; the defaults below are the built-in 32-pixel pets at scale 1.
export type Rect = { x: number; y: number; width: number; height: number };
export type Footprint = { left: number; top: number; right: number; bottom: number };

/** Window size at scale 1. */
export const PET_SIZE = { width: 320, height: 440 } as const;

/** Sprite box inside the window (fractions), used before the renderer has reported its own. */
export const PET_FOOTPRINT: Footprint = { left: 0.25, top: 0.58, right: 0.75, bottom: 0.96 };

/** Keeps the footprint on screen: the visible pet may touch every edge, the canvas may not leave the desk. */
export function clampPet(bounds: Rect, footprint: Footprint = PET_FOOTPRINT, area: Rect): Rect {
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  const left = bounds.x + footprint.left * bounds.width, right = bounds.x + footprint.right * bounds.width;
  const top = bounds.y + footprint.top * bounds.height, bottom = bounds.y + footprint.bottom * bounds.height;
  let x = bounds.x, y = bounds.y;
  if (right > area.x + area.width) x -= right - (area.x + area.width);
  if (left < area.x) x += area.x - left;
  if (bottom > area.y + area.height) y -= bottom - (area.y + area.height);
  if (top < area.y) y += area.y - top;
  // A window taller than the desk cannot satisfy both edges; prefer the feet on the bottom edge.
  if (top + height < area.y) y = area.y + area.height - height;
  return { x: Math.round(x), y: Math.round(y), width, height };
}

/** Where a roaming walk turns around: the visible pet touches 12 px inside the work area on each side. */
export function roamRange(area: Rect, footprint: Footprint, width: number, margin = 12): { min: number; max: number } {
  const min = Math.round(area.x + margin - footprint.left * width);
  const max = Math.round(area.x + area.width - margin - footprint.right * width);
  return max > min ? { min, max } : { min: area.x, max: area.x };
}

/** The usual resting spot: sprite bottom-right of the work area, `margin` px from the screen edge. */
export function cornerPosition(area: Rect, footprint: Footprint, width: number, height: number, margin = 24): Rect {
  return {
    width, height,
    x: Math.round(area.x + area.width - margin - footprint.right * width),
    y: Math.round(area.y + area.height - margin - footprint.bottom * height),
  };
}

/** Reads a footprint sent by the renderer, falling back to the default when anything is off. */
export function validFootprint(value: unknown): Footprint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const keys = ['left', 'top', 'right', 'bottom'] as const;
  if (!keys.every(k => typeof v[k] === 'number' && Number.isFinite(v[k]))) return undefined;
  const f = { left: v.left as number, top: v.top as number, right: v.right as number, bottom: v.bottom as number };
  if (f.left < 0 || f.top < 0 || f.right > 1 || f.bottom > 1) return undefined;
  if (f.right - f.left < 0.05 || f.bottom - f.top < 0.05) return undefined;
  return f;
}
