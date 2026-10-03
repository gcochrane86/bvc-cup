import { describe, expect, it } from 'vitest';
import { guideScale } from './imageSize';

describe('guideScale (how much to shrink a guide page or photo)', () => {
  it('a phone photo shrinks to 1500 across its short side', () => {
    expect(guideScale(4000, 3000)).toBe(0.5); // 2000 × 1500
  });
  it('a tall strokesaver page keeps its width: 1000 × 3600 stays as it is (the old 1600 long-side cap made it 445 wide)', () => {
    expect(guideScale(1000, 3600)).toBe(1);
  });
  it('never more than 5000 on the long side or 8 million pixels', () => {
    expect(guideScale(3000, 10800)).toBeCloseTo(5000 / 10800);
    expect(guideScale(4000, 4000)).toBeCloseTo(Math.min(1500 / 4000, Math.sqrt(8e6 / 16e6)));
  });
  it('never enlarges', () => {
    expect(guideScale(800, 600)).toBe(1);
  });
});
