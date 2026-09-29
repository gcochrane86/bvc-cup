import { describe, it, expect } from 'vitest';
import { formatToPar, pairNet } from './pairNet';
import { indexScores } from './matchState';
import type { HoleInfo } from './types';

const holes: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));
type Cell = [player: string, hole: number, gross: number | 'P'];
const idx = (cells: Cell[]) =>
  indexScores(cells.map(([playerId, hole, g]) => ({ playerId, hole, gross: g === 'P' ? null : g, pickedUp: g === 'P' })));

describe('pairNet', () => {
  it("totals the pair's better net score per hole against par, off full handicaps", () => {
    // x off 0, y off 18 (a shot on every hole). Hole 1: x 4 (net 4), y 4 (net 3) → −1. Hole 2: x 3 (net 3) → −1.
    const r = pairNet(['x', 'y'], holes, idx([['x', 1, 4], ['y', 1, 4], ['x', 2, 3], ['y', 2, 6]]), { x: 0, y: 18 });
    expect(r).toEqual({ toPar: -2, thru: 2 });
  });

  it("uses the partner when one player picks up", () => {
    expect(pairNet(['x', 'y'], holes, idx([['x', 1, 'P'], ['y', 1, 5]]), { x: 0, y: 0 })).toEqual({ toPar: 1, thru: 1 });
  });

  it('counts a hole where both pick up as net double bogey', () => {
    expect(pairNet(['x', 'y'], holes, idx([['x', 1, 'P'], ['y', 1, 'P']]), { x: 0, y: 0 })).toEqual({ toPar: 2, thru: 1 });
  });

  it('only counts holes where both players have a score entered', () => {
    const r = pairNet(['x', 'y'], holes, idx([['x', 1, 4], ['y', 1, 4], ['x', 2, 3]]), { x: 0, y: 0 });
    expect(r).toEqual({ toPar: 0, thru: 1 });
  });

  it('is null before the pair has played a hole', () => {
    expect(pairNet(['x', 'y'], holes, idx([['x', 1, 4]]), { x: 0, y: 0 })).toBeNull();
  });

  it('formats to par as E, +n or −n', () => {
    expect([formatToPar(0), formatToPar(2), formatToPar(-3)]).toEqual(['E', '+2', '−3']);
  });
});
