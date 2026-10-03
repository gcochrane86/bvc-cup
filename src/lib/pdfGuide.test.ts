import { describe, expect, it } from 'vitest';
import { pageHoles } from './pdfGuide';

describe('pageHoles', () => {
  it('page N goes on hole N, from the page hole 1 is on; pages before it and after hole 18 are skipped (0)', () => {
    expect(pageHoles(3, 1, {})).toEqual([1, 2, 3]);
    // A cover page: hole 1 is on page 2.
    const twenty = pageHoles(20, 2, {});
    expect(twenty[0]).toBe(0);
    expect(twenty[1]).toBe(1);
    expect(twenty[18]).toBe(18);
    expect(twenty[19]).toBe(0); // page 20: past hole 18
  });
  it('a page can be moved to another hole or skipped; two pages can share a hole', () => {
    expect(pageHoles(4, 1, { 2: 1, 4: 0 })).toEqual([1, 1, 3, 0]);
  });
});
