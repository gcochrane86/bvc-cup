// Cropping a photo before upload. The frame is in fractions of the photo as shown (0–1 across and down),
// so it doesn't depend on screen size; sourceRect turns it into the photo's own pixels.

export interface Box { x: number; y: number; w: number; h: number }
export const FULL: Box = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.1;

/** Keep the frame inside the photo and at least a tenth of it each way. */
export function clampBox(b: Box): Box {
  const w = Math.min(1, Math.max(MIN, b.w));
  const h = Math.min(1, Math.max(MIN, b.h));
  return { x: Math.min(Math.max(0, b.x), 1 - w), y: Math.min(Math.max(0, b.y), 1 - h), w, h };
}

/** Hold the frame to a shape (width ÷ height, 0 = free) on a photo of imgW × imgH: height follows width, or width shrinks if it won't fit. */
export function lockRatio(b: Box, ratio: number, imgW: number, imgH: number): Box {
  if (!ratio) return b;
  let w = b.w;
  let h = (w * imgW) / (ratio * imgH);
  if (h > 1) {
    h = 1;
    w = (ratio * imgH) / imgW;
  }
  return clampBox({ ...b, w, h });
}

/** The frame in the photo's pixels. */
export function sourceRect(b: Box, imgW: number, imgH: number): { sx: number; sy: number; sw: number; sh: number } {
  return { sx: Math.round(b.x * imgW), sy: Math.round(b.y * imgH), sw: Math.round(b.w * imgW), sh: Math.round(b.h * imgH) };
}

/** A photo's size after this many quarter turns. */
export const turnedSize = (w: number, h: number, turns: number) => (turns % 2 ? { w: h, h: w } : { w, h });
