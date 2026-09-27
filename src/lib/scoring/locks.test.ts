import { describe, it, expect } from 'vitest';
import { isScoreLocked } from './locks';
import type { ConfirmedResult, MatchDef } from './types';

const bb: MatchDef = { id: 'g:better_ball', groupId: 'g', type: 'better_ball', sideA: ['a1', 'a2'], sideB: ['b1', 'b2'], points: 1, strokes: {} };
const low: MatchDef = { id: 'g:low_singles', groupId: 'g', type: 'low_singles', sideA: ['a1'], sideB: ['b1'], points: 0.5, strokes: {} };
const res = (over: Partial<ConfirmedResult>): ConfirmedResult => ({
  groupId: 'g', matchType: 'better_ball', winner: 'A', pointsA: 1, pointsB: 0, resultText: '4&3', finalHole: 15, ...over,
});

describe('isScoreLocked', () => {
  it('locks holes up to the final hole of a confirmed match', () => {
    const ms = [{ def: bb, result: res({}) }];
    expect(isScoreLocked('a1', 15, ms)).toBe(true);
    expect(isScoreLocked('b2', 1, ms)).toBe(true);
    expect(isScoreLocked('a1', 16, ms)).toBe(false);
  });
  it('only locks the players in the confirmed match', () => {
    const ms = [{ def: bb, result: null }, { def: low, result: res({ matchType: 'low_singles', finalHole: 12 }) }];
    expect(isScoreLocked('b1', 10, ms)).toBe(true);
    expect(isScoreLocked('a2', 10, ms)).toBe(false);
  });
  it('does not lock anything without results', () => {
    expect(isScoreLocked('a1', 1, [{ def: bb, result: null }])).toBe(false);
  });
});
