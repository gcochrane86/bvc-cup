import { describe, it, expect } from 'vitest';
import { holesFor, holesPreset } from './holes';

describe('holes played presets', () => {
  it('reads a day\'s holes as All 18, Front 9, 1 to N, or a chosen set', () => {
    expect(holesPreset(null)).toEqual({ mode: 'all', to: 13 });
    expect(holesPreset([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual({ mode: 'front', to: 13 });
    expect(holesPreset([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toEqual({ mode: 'to', to: 12 });
    expect(holesPreset([1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 18])).toEqual({ mode: 'custom', to: 13 });
    expect(holesPreset([2, 3, 4])).toEqual({ mode: 'custom', to: 13 });
  });
  it('turns a preset back into holes (null = all 18)', () => {
    expect(holesFor('all', 13)).toBeNull();
    expect(holesFor('front', 13)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(holesFor('to', 12)).toHaveLength(12);
    expect(holesFor('to', 25)).toHaveLength(17); // 1 to 17 at most (18 is All 18)
    expect(holesFor('to', 0)).toEqual([1]);
  });
});
