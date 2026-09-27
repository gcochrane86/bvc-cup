import type { HoleInfo } from './types';

export function validateHoles(holes: HoleInfo[]): string[] {
  const errors: string[] = [];
  if (holes.length !== 18) errors.push('A course needs 18 holes');
  for (const h of holes) {
    if (!Number.isInteger(h.par) || h.par < 3 || h.par > 6) errors.push(`Hole ${h.hole}: par must be 3–6`);
    if (!Number.isInteger(h.strokeIndex) || h.strokeIndex < 1 || h.strokeIndex > 18)
      errors.push(`Hole ${h.hole}: SI must be 1–18`);
  }
  const si = holes.map((h) => h.strokeIndex);
  const dupes = [...new Set(si.filter((v, i) => si.indexOf(v) !== i))];
  for (const d of dupes) errors.push(`SI ${d} is used more than once`);
  return errors;
}
