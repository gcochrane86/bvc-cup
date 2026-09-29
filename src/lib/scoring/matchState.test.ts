import { describe, it, expect } from 'vitest';
import { computeMatchState, holeOutcome, indexScores } from './matchState';
import type { HoleInfo, MatchDef } from './types';

const holes: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));
const bb: MatchDef = {
  id: 'g:better_ball',
  groupId: 'g',
  type: 'better_ball',
  sideA: ['a1', 'a2'],
  sideB: ['b1', 'b2'],
  points: 1,
  strokes: { a1: 0, a2: 0, b1: 0, b2: 0 },
};

type Cell = [player: string, hole: number, gross: number | 'P'];
const idx = (cells: Cell[]) =>
  indexScores(cells.map(([playerId, hole, g]) => ({ playerId, hole, gross: g === 'P' ? null : g, pickedUp: g === 'P' })));

/** A result per hole: 'A' = A players 4 / B players 5, 'B' = the reverse, 'H' = all 4. */
function play(results: string): Cell[] {
  const cells: Cell[] = [];
  [...results].forEach((r, i) => {
    const hole = i + 1;
    const [a, b] = r === 'A' ? [4, 5] : r === 'B' ? [5, 4] : [4, 4];
    cells.push(['a1', hole, a], ['a2', hole, a], ['b1', hole, b], ['b2', hole, b]);
  });
  return cells;
}

describe('holeOutcome', () => {
  const h1 = holes[0];
  it('compares the best net score per side', () => {
    expect(holeOutcome(bb, h1, idx([['a1', 1, 4], ['a2', 1, 6], ['b1', 1, 5], ['b2', 1, 5]]))).toBe('A');
  });
  it('applies strokes on the hole', () => {
    const m = { ...bb, strokes: { ...bb.strokes, b1: 1 } }; // SI 1 -> b1 gets 1
    expect(holeOutcome(m, h1, idx([['a1', 1, 4], ['a2', 1, 6], ['b1', 1, 5], ['b2', 1, 6]]))).toBe('halved');
  });
  it('ignores a picked-up player and uses the partner', () => {
    expect(holeOutcome(bb, h1, idx([['a1', 1, 'P'], ['a2', 1, 6], ['b1', 1, 5], ['b2', 1, 7]]))).toBe('B');
  });
  it('gives the hole to the other side when one side has no score', () => {
    expect(holeOutcome(bb, h1, idx([['a1', 1, 'P'], ['a2', 1, 'P'], ['b1', 1, 9], ['b2', 1, 'P']]))).toBe('B');
  });
  it('halves the hole when nobody has a score', () => {
    expect(holeOutcome(bb, h1, idx([['a1', 1, 'P'], ['a2', 1, 'P'], ['b1', 1, 'P'], ['b2', 1, 'P']]))).toBe('halved');
  });
  it('in Stableford, the higher best-ball points win the hole', () => {
    const sf = { ...bb, stableford: true, strokes: { a1: 0, a2: 18, b1: 0, b2: 0 } }; // a2 gets a shot on every hole
    // a2: 5 − 1 = net 4 (2 pts) beats b1's gross 5 (1 pt).
    expect(holeOutcome(sf, h1, idx([['a1', 1, 7], ['a2', 1, 5], ['b1', 1, 5], ['b2', 1, 6]]))).toBe('A');
  });
  it('in Stableford, both sides on 0 points halve the hole even if one net score is lower', () => {
    const sf = { ...bb, stableford: true };
    // Net 6 (A) v net 7 (B) on a par 4: 0 points each — halved (match play would give it to A).
    const cells: Cell[] = [['a1', 1, 6], ['a2', 1, 8], ['b1', 1, 7], ['b2', 1, 9]];
    expect(holeOutcome(sf, h1, idx(cells))).toBe('halved');
    expect(holeOutcome(bb, h1, idx(cells))).toBe('A');
  });
  it('in Stableford, a pick-up scores 0 points', () => {
    const sf = { ...bb, stableford: true };
    expect(holeOutcome(sf, h1, idx([['a1', 1, 'P'], ['a2', 1, 'P'], ['b1', 1, 6], ['b2', 1, 'P']]))).toBe('halved'); // 0 v 0
    expect(holeOutcome(sf, h1, idx([['a1', 1, 'P'], ['a2', 1, 'P'], ['b1', 1, 5], ['b2', 1, 'P']]))).toBe('B'); // 0 v 1
  });
  it('returns null until every player has an entry', () => {
    expect(holeOutcome(bb, h1, idx([['a1', 1, 4], ['a2', 1, 4], ['b1', 1, 5]]))).toBeNull();
  });
});

describe('computeMatchState', () => {
  it('reports not started', () => {
    const s = computeMatchState(bb, holes, idx([]));
    expect(s).toMatchObject({ started: false, thru: 0, lead: 0, statusText: 'Not started', projectedA: 0, projectedB: 0, decided: false });
  });

  it('tracks the lead and projects the points to the leader', () => {
    const s = computeMatchState(bb, holes, idx(play('AHA')));
    expect(s).toMatchObject({ started: true, thru: 3, lead: 2, statusText: '2 UP', projectedA: 1, projectedB: 0 });
    expect(s.holeWinners.slice(0, 4)).toEqual(['A', 'halved', 'A', null]);
    expect(s.running.slice(0, 4)).toEqual([1, 1, 2, null]);
  });

  it('shows a B lead as a negative lead', () => {
    const s = computeMatchState(bb, holes, idx(play('B')));
    expect(s).toMatchObject({ lead: -1, statusText: '1 UP', projectedA: 0, projectedB: 1 });
  });

  it('projects half each when all square', () => {
    const s = computeMatchState(bb, holes, idx(play('AB')));
    expect(s).toMatchObject({ statusText: 'All Square', projectedA: 0.5, projectedB: 0.5 });
  });

  it('stops at the first incomplete hole', () => {
    const cells = play('AA').concat(play('AAAA').filter(([, h]) => h === 4));
    const s = computeMatchState(bb, holes, idx(cells));
    expect(s.thru).toBe(2);
    expect(s.holeWinners[3]).toBeNull();
  });

  it('flags dormie', () => {
    const s = computeMatchState(bb, holes, idx(play('AAAA' + 'H'.repeat(10)))); // thru 14, 4 up, 4 to play
    expect(s).toMatchObject({ thru: 14, lead: 4, dormie: true, decided: false, statusText: '4 UP' });
  });

  it('decides early and ignores later holes', () => {
    const s = computeMatchState(bb, holes, idx(play('AAAA' + 'H'.repeat(11) + 'B'))); // decided at 15
    expect(s).toMatchObject({ decided: true, finalHole: 15, thru: 15, winner: 'A', resultText: '4&3', statusText: '4&3' });
    expect(s.holeWinners[15]).toBeNull();
  });

  it('decides after 18 with a 1 UP win', () => {
    const s = computeMatchState(bb, holes, idx(play('A' + 'H'.repeat(17))));
    expect(s).toMatchObject({ decided: true, finalHole: 18, winner: 'A', resultText: '1 UP', projectedA: 1 });
  });

  it('halves after 18', () => {
    const s = computeMatchState(bb, holes, idx(play('AB' + 'H'.repeat(16))));
    expect(s).toMatchObject({ decided: true, winner: 'halved', resultText: 'Halved', projectedA: 0.5, projectedB: 0.5 });
  });

  it('handles a course with no holes', () => {
    expect(computeMatchState(bb, [], idx(play('A')))).toMatchObject({ started: false, thru: 0 });
  });
});
