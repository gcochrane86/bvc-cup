// How big guide pages and photos are kept: enough detail across the short side to read small yardage
// numbers (a tall strokesaver page keeps its width), within what phones handle comfortably.
const SHORT = 1500;
const LONG = 5000;
const PIXELS = 8e6;

/** The factor (at most 1) to shrink an image of w × h by. */
export function guideScale(w: number, h: number): number {
  return Math.min(1, SHORT / Math.min(w, h), LONG / Math.max(w, h), Math.sqrt(PIXELS / (w * h)));
}

/** JPEG quality for guide pages and photos: high enough that text edges stay crisp. */
export const GUIDE_QUALITY = 0.88;
