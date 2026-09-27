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

/** Slope and course rating for the tees played: both blank (use indexes as-is) or both valid. */
export function validateRating(slope: number | null, rating: number | null): string[] {
  if (slope === null && rating === null) return [];
  if (slope === null || rating === null) return ['Enter both slope and course rating, or neither'];
  const errors: string[] = [];
  if (!Number.isInteger(slope) || slope < 55 || slope > 155) errors.push('Slope must be a whole number from 55 to 155');
  if (rating < 50 || rating > 90) errors.push('Course rating must be between 50 and 90');
  return errors;
}
