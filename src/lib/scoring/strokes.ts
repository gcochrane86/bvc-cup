/** Round to the nearest whole number, halves up. Epsilon absorbs float noise (e.g. 4.4999999). */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

/** Strokes received for a handicap difference at an allowance percentage. */
export function playingStrokes(diff: number, pct: number): number {
  return roundHalfUp((diff * pct) / 100);
}

/** Strokes received on a hole of the given stroke index, from a total allocation. */
export function strokesOnHole(total: number, strokeIndex: number): number {
  if (total <= 0) return 0;
  const base = Math.floor(total / 18);
  return base + (strokeIndex <= total % 18 ? 1 : 0);
}
