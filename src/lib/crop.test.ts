import { describe, expect, it } from 'vitest';
import { clampBox, lockRatio, sourceRect, turnedSize, FULL } from './crop';

describe('crop', () => {
  it('keeps the frame inside the photo and not too small', () => {
    expect(clampBox({ x: 0.9, y: -0.2, w: 0.5, h: 0.5 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(clampBox({ x: 0, y: 0, w: 1.4, h: 0.01 })).toEqual({ x: 0, y: 0, w: 1, h: 0.1 });
  });

  it('a shape keeps its proportions on the actual photo (a 4000×3000 landscape photo)', () => {
    // Square on a 4:3 photo: a frame 0.6 wide is 2400px, so 2400px tall = 0.8 of the height.
    expect(lockRatio({ x: 0.1, y: 0.1, w: 0.6, h: 0.5 }, 1, 4000, 3000)).toEqual({ x: 0.1, y: 0.1, w: 0.6, h: 0.8 });
    // Too tall to fit: shrink the width instead (portrait 3:4 at full height on a 4:3 photo).
    const p = lockRatio({ x: 0, y: 0, w: 1, h: 1 }, 0.75, 4000, 3000);
    expect(p.h).toBe(1);
    expect(p.w).toBeCloseTo(0.5625); // 2250px wide ÷ 4000
    // Free: unchanged.
    expect(lockRatio({ x: 0.1, y: 0.1, w: 0.6, h: 0.5 }, 0, 4000, 3000)).toEqual({ x: 0.1, y: 0.1, w: 0.6, h: 0.5 });
  });

  it('turns the frame into pixels of the photo', () => {
    expect(sourceRect({ x: 0.25, y: 0.1, w: 0.5, h: 0.8 }, 4000, 3000)).toEqual({ sx: 1000, sy: 300, sw: 2000, sh: 2400 });
    expect(sourceRect(FULL, 4000, 3000)).toEqual({ sx: 0, sy: 0, sw: 4000, sh: 3000 });
  });

  it('a quarter turn swaps width and height', () => {
    expect(turnedSize(4000, 3000, 1)).toEqual({ w: 3000, h: 4000 });
    expect(turnedSize(4000, 3000, 2)).toEqual({ w: 4000, h: 3000 });
  });
});
