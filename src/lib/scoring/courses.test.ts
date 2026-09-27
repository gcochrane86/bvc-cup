import { describe, it, expect } from 'vitest';
import { validateHoles } from './courses';
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
