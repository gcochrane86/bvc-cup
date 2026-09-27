import { describe, it, expect } from 'vitest';
import { courseHandicap, roundHalfUp, playingStrokes, strokesOnHole } from './strokes';

describe('roundHalfUp', () => {
  it('rounds .5 up', () => {
    expect(roundHalfUp(4.5)).toBe(5);
    expect(roundHalfUp(13.5)).toBe(14);
  });
  it('rounds below .5 down', () => {
    expect(roundHalfUp(4.4)).toBe(4);
    expect(roundHalfUp(0)).toBe(0);
  });
});

describe('playingStrokes', () => {
  it('applies a 90% allowance to the difference', () => {
    expect(playingStrokes(10, 90)).toBe(9);
    expect(playingStrokes(5, 90)).toBe(5); // 4.5 -> 5
    expect(playingStrokes(4, 90)).toBe(4); // 3.6 -> 4
    expect(playingStrokes(1, 90)).toBe(1); // 0.9 -> 1
    expect(playingStrokes(0, 90)).toBe(0);
  });
  it('handles decimal handicap differences', () => {
    expect(playingStrokes(12.4 - 3.1, 90)).toBe(8); // 8.37 -> 8
  });
  it('uses 100% when asked', () => {
    expect(playingStrokes(7, 100)).toBe(7);
  });
});

describe('strokesOnHole', () => {
  it('gives nothing when the total is 0', () => {
    expect(strokesOnHole(0, 1)).toBe(0);
  });
  it('gives one stroke on holes with SI <= total', () => {
    expect(strokesOnHole(5, 5)).toBe(1);
    expect(strokesOnHole(5, 6)).toBe(0);
  });
  it('gives one on every hole at 18', () => {
    expect(strokesOnHole(18, 1)).toBe(1);
    expect(strokesOnHole(18, 18)).toBe(1);
  });
  it('gives two on the hardest holes above 18', () => {
    expect(strokesOnHole(20, 1)).toBe(2);
    expect(strokesOnHole(20, 2)).toBe(2);
    expect(strokesOnHole(20, 3)).toBe(1);
  });
});

describe('courseHandicap', () => {
  it('converts an index with slope and rating (WHS)', () => {
    // 12.4 × 125/113 + (71.3 − 72) = 13.717 − 0.7 = 13.02 → 13
    expect(courseHandicap(12.4, 125, 71.3, 72)).toBe(13);
  });
  it('rounds .5 up', () => {
    // 10 × 113/113 + (72.5 − 72) = 10.5 → 11
    expect(courseHandicap(10, 113, 72.5, 72)).toBe(11);
  });
  it('handles a plus handicap', () => {
    // −2 × 130/113 + (70 − 72) = −2.30 − 2 = −4.30 → −4
    expect(courseHandicap(-2, 130, 70, 72)).toBe(-4);
  });
  it('uses the index as-is when the course has no slope/rating', () => {
    expect(courseHandicap(12.4, null, null, 72)).toBe(12);
  });
});
