import { describe, it, expect } from 'vitest';
import { formatPoints, shotLabel } from './format';

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
