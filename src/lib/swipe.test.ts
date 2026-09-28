import { describe, it, expect } from 'vitest';
import { REVEAL, dragOffset, settleOpen } from './swipe';

describe('swipe to reveal delete', () => {
  it('follows the finger left, but not right past closed', () => {
    expect(dragOffset(false, -30)).toBe(-30);
    expect(dragOffset(false, 40)).toBe(0);
  });
  it('resists dragging far past the delete button', () => {
    expect(dragOffset(false, -300)).toBeGreaterThan(-REVEAL - 40);
  });
  it('starts from the open position when already open', () => {
    expect(dragOffset(true, 20)).toBe(-REVEAL + 20);
  });
  it('snaps open past halfway, closed otherwise', () => {
    expect(settleOpen(false, -(REVEAL / 2) - 1)).toBe(true);
    expect(settleOpen(false, -10)).toBe(false);
    expect(settleOpen(true, 50)).toBe(false); // swiping back right closes it
    expect(settleOpen(true, 5)).toBe(true);
  });
});
