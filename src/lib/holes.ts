// A day's holes played: All 18 (null), the front 9, holes 1 to N (e.g. 1–12), or a chosen set (e.g. winter:
// 1–9, 14 and 18). Handicaps scale to however many there are.

export type HolesMode = 'all' | 'front' | 'to' | 'custom';
const ALL = Array.from({ length: 18 }, (_, i) => i + 1);
const upTo = (n: number) => ALL.filter((h) => h <= n);

/** Which choice a day's holes are, and the "1 to N" finishing hole (13 when it isn't one). */
export function holesPreset(holes: number[] | null | undefined): { mode: HolesMode; to: number } {
  if (!holes?.length || holes.length >= 18) return { mode: 'all', to: 13 };
  const sorted = [...holes].sort((a, b) => a - b);
  const runFromOne = sorted.every((h, i) => h === i + 1);
  if (runFromOne && sorted.length === 9) return { mode: 'front', to: 13 };
  if (runFromOne) return { mode: 'to', to: sorted.length };
  return { mode: 'custom', to: 13 };
}

/** The holes for a choice (null = all 18). "1 to N" runs 1–17 (18 holes is All 18). */
export function holesFor(mode: Exclude<HolesMode, 'custom'>, to: number): number[] | null {
  if (mode === 'all') return null;
  if (mode === 'front') return upTo(9);
  return upTo(Math.min(17, Math.max(1, to)));
}
