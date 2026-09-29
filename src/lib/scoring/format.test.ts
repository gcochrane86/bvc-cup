import { describe, it, expect } from 'vitest';
import { breakdownText, formatPoints, isBirdieOrBetter, shotLabel } from './format';

describe('formatPoints', () => {
  it('formats whole and fractional points', () => {
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(6)).toBe('6');
    expect(formatPoints(6.5)).toBe('6½');
    expect(formatPoints(0.5)).toBe('½');
    expect(formatPoints(0.25)).toBe('¼');
    expect(formatPoints(3.75)).toBe('3¾');
  });
});

describe('shotLabel', () => {
  it('is null with no shots', () => {
    expect(shotLabel(0, null)).toBeNull();
    expect(shotLabel(0, 0)).toBeNull();
  });
  it('labels one or two shots', () => {
    expect(shotLabel(1, null)).toBe('1 shot');
    expect(shotLabel(2, 2)).toBe('2 shots');
  });
  it('shows both counts when better-ball and singles differ', () => {
    expect(shotLabel(1, 0)).toBe('BB 1 · Singles 0');
    expect(shotLabel(0, 1)).toBe('BB 0 · Singles 1');
  });
});

describe('isBirdieOrBetter', () => {
  it('is true for a gross birdie or better', () => {
    expect(isBirdieOrBetter(3, 4)).toBe(true);
    expect(isBirdieOrBetter(2, 4)).toBe(true); // eagle
  });
  it('is false for par or worse, and for pick-ups', () => {
    expect(isBirdieOrBetter(4, 4)).toBe(false);
    expect(isBirdieOrBetter(6, 4)).toBe(false);
    expect(isBirdieOrBetter(null, 4)).toBe(false);
  });
});

describe('breakdownText', () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Day ${i + 1}`, points: i === 0 ? 3.5 : 1 }));
  it('lists each day while there are only a few', () => {
    expect(breakdownText(days(3))).toBe('Day 1: 3½ · Day 2: 1 · Day 3: 1');
    expect(breakdownText(days(5))).toBe('Day 1: 3½ · Day 2: 1 · Day 3: 1 · Day 4: 1 · Day 5: 1');
  });
  it('sums up a long season in one line', () => {
    expect(breakdownText(days(12))).toBe('12 days · 14½ points');
  });
});
