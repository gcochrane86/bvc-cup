import { describe, it, expect } from 'vitest';
import { computeTracker, resultFromState, roundPointsAvailable } from './tracker';
import type { ConfirmedResult, MatchDef, MatchState } from './types';

const state = (over: Partial<MatchState>): MatchState => ({
  started: false, thru: 0, lead: 0, holeWinners: [], running: [], decided: false, dormie: false,
  winner: null, finalHole: null, resultText: null, statusText: 'Not started', projectedA: 0, projectedB: 0, ...over,
});
const def: MatchDef = { id: 'g:better_ball', groupId: 'g', type: 'better_ball', sideA: ['a1', 'a2'], sideB: ['b1', 'b2'], points: 1, strokes: {} };
const confirmed = (over: Partial<ConfirmedResult>): ConfirmedResult => ({
  groupId: 'g', matchType: 'better_ball', winner: 'A', pointsA: 1, pointsB: 0, resultText: '2&1', finalHole: 17, ...over,
});

describe('computeTracker', () => {
  it('adds live projections on top of confirmed points', () => {
    const t = computeTracker(
      [
        { state: state({ projectedA: 1 }), result: confirmed({}) }, // confirmed A 1 (projection ignored)
        { state: state({ projectedA: 0.5, projectedB: 0.5 }), result: null },
        { state: state({ projectedB: 1 }), result: null },
        { state: state({}), result: null }, // not started
      ],
      12,
    );
    expect(t).toEqual({ confirmedA: 1, confirmedB: 0, projectedA: 1.5, projectedB: 1.5, total: 12, toWin: 6.5 });
  });
});

describe('roundPointsAvailable', () => {
  it('counts better-ball only', () => {
    expect(roundPointsAvailable({ allowancePct: 90, betterBallPoints: 1, singlesEnabled: false, singlesPoints: 0.5, singlesAllowancePct: 90 }, 3)).toBe(3);
  });
  it('adds two singles per group when enabled', () => {
    expect(roundPointsAvailable({ allowancePct: 90, betterBallPoints: 1, singlesEnabled: true, singlesPoints: 0.5, singlesAllowancePct: 90 }, 3)).toBe(6);
  });
});

describe('resultFromState', () => {
  it('is null until decided', () => {
    expect(resultFromState(def, state({ started: true, thru: 5, lead: 2 }))).toBeNull();
  });
  it('gives the points to the winner', () => {
    const r = resultFromState(def, state({ decided: true, winner: 'B', finalHole: 16, resultText: '3&2' }));
    expect(r).toEqual({ groupId: 'g', matchType: 'better_ball', winner: 'B', pointsA: 0, pointsB: 1, resultText: '3&2', finalHole: 16 });
  });
  it('splits a halved half-point singles into quarters', () => {
    const r = resultFromState({ ...def, type: 'low_singles', points: 0.5 }, state({ decided: true, winner: 'halved', finalHole: 18, resultText: 'Halved' }));
    expect(r).toMatchObject({ pointsA: 0.25, pointsB: 0.25 });
  });
});
