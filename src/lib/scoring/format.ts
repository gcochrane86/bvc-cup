const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' };

export function formatPoints(n: number): string {
  const whole = Math.floor(n);
  const frac = FRACTIONS[String(Math.round((n - whole) * 100) / 100)] ?? '';
  if (!frac) return String(whole);
  return `${whole === 0 ? '' : whole}${frac}`;
}

/** Label for a player's shots on a hole: better-ball count, plus singles when it differs. */
export function shotLabel(bb: number, singles: number | null): string | null {
  if (singles !== null && singles !== bb) return `BB ${bb} · Singles ${singles}`;
  if (bb === 0) return null;
  return bb === 1 ? '1 shot' : `${bb} shots`;
}

/** A gross birdie or better (picked-up holes have no gross). */
export function isBirdieOrBetter(gross: number | null, par: number): boolean {
  return gross !== null && gross <= par - 1;
}
