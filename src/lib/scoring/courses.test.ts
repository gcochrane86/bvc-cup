import { describe, it, expect } from 'vitest';
import { validateHoles, validateRating } from './courses';
import type { HoleInfo } from './types';

const good: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));

describe('validateHoles', () => {
  it('accepts a valid course', () => {
    expect(validateHoles(good)).toEqual([]);
  });
  it('rejects bad par and SI values', () => {
    const bad = good.map((h) => (h.hole === 3 ? { ...h, par: 7 } : h.hole === 4 ? { ...h, strokeIndex: 19 } : h));
    expect(validateHoles(bad)).toEqual(['Hole 3: par must be 3–6', 'Hole 4: SI must be 1–18']);
  });
  it('rejects duplicate SI', () => {
    const dup = good.map((h) => (h.hole === 2 ? { ...h, strokeIndex: 1 } : h));
    expect(validateHoles(dup)).toEqual(['SI 1 is used more than once']);
  });
  it('requires 18 holes', () => {
    expect(validateHoles(good.slice(0, 9))).toContain('A course needs 18 holes');
  });
});

describe('validateRating', () => {
  it('accepts both blank', () => expect(validateRating(null, null)).toEqual([]));
  it('accepts a real slope and rating', () => expect(validateRating(125, 71.3)).toEqual([]));
  it('needs both or neither', () => {
    expect(validateRating(125, null)).toEqual(['Enter both slope and course rating, or neither']);
  });
  it('rejects out-of-range values', () => {
    expect(validateRating(200, 30)).toEqual(['Slope must be a whole number from 55 to 155', 'Course rating must be between 50 and 90']);
  });
});
