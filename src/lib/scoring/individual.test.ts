import { describe, it, expect } from 'vitest';
import { buildGame, computeGameState, gameFor, gameResult, sixPoints } from './individual';
import { indexScores } from './matchState';
import type { HoleInfo, RoundSettings, ScoreEntry } from './types';

const base: RoundSettings = { allowancePct: 90, betterBallPoints: 1, singlesEnabled: false, singlesPoints: 0.5, singlesAllowancePct: 90 };
// Par 4s, stroke index = hole number.
const holes: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));
const two = (h1: number, h2: number) => [
  { slot: 'P1' as const, playerId: 'p1', handicap: h1 },
  { slot: 'P2' as const, playerId: 'p2', handicap: h2 },
];
const three = (h1: number, h2: number, h3: number) => [...two(h1, h2), { slot: 'P3' as const, playerId: 'p3', handicap: h3 }];
/** Scores for holes 1..n: gross per player, or 'P' for a pick-up. */
function card(rows: Record<string, (number | 'P')[]>): ScoreEntry[] {
  return Object.entries(rows).flatMap(([playerId, gs]) =>
    gs.map((g, i) => ({ playerId, hole: i + 1, gross: g === 'P' ? null : g, pickedUp: g === 'P' })),
  );
}
const all = (n: number): (number | 'P')[] => Array(18).fill(n);
const twoVOne = { ...base, threeGame: 'two_v_one' as const };

describe('gameFor', () => {
  it("picks the round's 2-player or 3-player game by group size", () => {
    expect(gameFor(2, base)).toBe('stableford_match');
    expect(gameFor(2, { ...base, pairGame: 'flat_match' })).toBe('flat_match');
    expect(gameFor(3, base)).toBe('six_stableford');
    expect(gameFor(3, { ...base, threeGame: 'six_flat' })).toBe('six_flat');
    expect(gameFor(3, twoVOne)).toBe('two_v_one');
    expect(gameFor(1, base)).toBeNull();
    expect(gameFor(4, base)).toBeNull();
  });
});

describe('buildGame strokes', () => {
  it('Stableford match play off the low man at 85%: 8 v 20 gives the 20 ten shots', () => {
    const def = buildGame('g', two(8, 20), base)!;
    expect(def.type).toBe('individual');
    expect(def.game).toBe('stableford_match');
    expect(def.strokes).toEqual({ p1: 0, p2: 10 }); // 12 × 0.85 = 10.2 → 10
    expect(def.stableford).toBe(true);
    expect(def.sideA).toEqual(['p1']);
    expect(def.sideB).toEqual(['p2']);
  });
  it('equal handicaps off the low man give no shots; full handicaps give each their own', () => {
    expect(buildGame('g', two(12, 12), base)!.strokes).toEqual({ p1: 0, p2: 0 });
    expect(buildGame('g', two(8, 20), { ...base, matchOffLow: false })!.strokes).toEqual({ p1: 8, p2: 20 });
  });
  it('flat games give no shots; Stableford games use full handicap × the Stableford %', () => {
    expect(buildGame('g', two(8, 20), { ...base, pairGame: 'flat_match' })!.strokes).toEqual({ p1: 0, p2: 0 });
    expect(buildGame('g', two(8, 20), { ...base, pairGame: 'stableford', stablefordPct: 95 })!.strokes).toEqual({ p1: 8, p2: 19 });
    expect(buildGame('g', three(6, 14, 3), { ...base, threeGame: 'six_flat' })!.strokes).toEqual({ p1: 0, p2: 0, p3: 0 });
  });
  it('2 v 1: P1 is the single against the pair', () => {
    const def = buildGame('g', three(10, 12, 14), twoVOne)!;
    expect(def.game).toBe('two_v_one');
    expect(def.sideA).toEqual(['p1']);
    expect(def.sideB).toEqual(['p2', 'p3']);
  });
  it('a group of 1 or 4 has no game', () => {
    expect(buildGame('g', two(1, 2).slice(0, 1), base)).toBeNull();
  });
});

describe('sixPoints', () => {
  it('shares 6 points 4/2/0, ties splitting their places', () => {
    expect(sixPoints([5, 3, 1], true)).toEqual([4, 2, 0]);
    expect(sixPoints([3, 3, 1], true)).toEqual([3, 3, 0]);
    expect(sixPoints([4, 2, 2], true)).toEqual([4, 1, 1]);
    expect(sixPoints([2, 2, 2], true)).toEqual([2, 2, 2]);
    expect(sixPoints([4, 5, 6], false)).toEqual([4, 2, 0]); // gross: lower is better
  });
});

describe('computeGameState', () => {
  it('flat match play: lower gross wins the hole, finishes early', () => {
    const def = buildGame('g', two(0, 20), { ...base, pairGame: 'flat_match' })!;
    const st = computeGameState(def, holes, indexScores(card({ p1: Array(10).fill(4), p2: Array(10).fill(5) })));
    expect(st.decided).toBe(true);
    expect(st.resultText).toBe('10&8');
    expect(st.winner).toBe('A');
    expect(st.stableford?.p1).toBe(20); // 10 pars off 0 = 20 points
  });

  it('Stableford (1 v 1): higher total wins over 18; a pick-up scores 0', () => {
    const def = buildGame('g', two(0, 0), { ...base, pairGame: 'stableford' })!;
    const p2 = all(4);
    p2[0] = 'P';
    const st = computeGameState(def, holes, indexScores(card({ p1: all(4), p2 })));
    expect(st.totals).toEqual({ p1: 36, p2: 34 });
    expect(st.decided).toBe(true);
    expect(st.winner).toBe('A');
    expect(st.resultText).toBe('By 2 pts');
    expect(st.statusText).toBe('36–34');
  });

  it('a hole only counts once every player has a score', () => {
    const def = buildGame('g', two(0, 0), { ...base, pairGame: 'stableford' })!;
    const st = computeGameState(def, holes, indexScores(card({ p1: [4, 4, 4], p2: [4, 4] })));
    expect(st.thru).toBe(2);
    expect(st.totals).toEqual({ p1: 4, p2: 4 });
    expect(st.decided).toBe(false);
  });

  it("2 v 1: the single against the pair's better ball; halved on equal totals", () => {
    const def = buildGame('g', three(0, 0, 0), twoVOne)!;
    // Single pars everything (36). Pair: p2 bogeys every hole, p3 birdies the 1st and pars the rest: best ball 3 + 17×2 = 37.
    const p3 = all(4);
    p3[0] = 3;
    const st = computeGameState(def, holes, indexScores(card({ p1: all(4), p2: all(5), p3 })));
    expect(st.winner).toBe('B');
    expect(st.statusText).toBe('36–37');
    const level = computeGameState(def, holes, indexScores(card({ p1: all(4), p2: all(5), p3: all(4) })));
    expect(level.winner).toBe('halved');
    expect(level.resultText).toBe('Halved');
  });

  it('six pointer (flat): a pick-up is worst on the hole; two pick-ups tie', () => {
    const def = buildGame('g', three(0, 0, 0), { ...base, threeGame: 'six_flat' })!;
    const st = computeGameState(def, holes.slice(0, 1), indexScores(card({ p1: [5], p2: ['P'], p3: ['P'] })));
    expect(st.totals).toEqual({ p1: 4, p2: 1, p3: 1 });
  });

  it('six pointer (Stableford): totals, statusText in position order, winner by position', () => {
    const def = buildGame('g', three(0, 0, 0), base)!;
    // Each hole: p2 birdies (3 pts), p1 pars (2), p3 bogeys (1) → 2/4/0 a hole.
    const st = computeGameState(def, holes, indexScores(card({ p1: all(4), p2: all(3), p3: all(5) })));
    expect(st.totals).toEqual({ p1: 36, p2: 72, p3: 0 });
    expect(st.statusText).toBe('36 · 72 · 0');
    expect(st.winner).toBe('P2');
    expect(st.decided).toBe(true);
  });
});

describe('gameResult', () => {
  it("carries the winner, no team points, and each player's points", () => {
    const def = buildGame('g', two(0, 0), { ...base, pairGame: 'stableford' })!;
    const st = computeGameState(def, holes, indexScores(card({ p1: all(4), p2: all(5) })));
    const r = gameResult(def, st)!;
    expect(r).toMatchObject({ matchType: 'individual', winner: 'A', pointsA: 0, pointsB: 0, finalHole: 18, resultText: 'By 18 pts' });
    expect(r.playerPoints).toEqual({ p1: { points: 36, stableford: 36 }, p2: { points: 18, stableford: 18 } });
  });
  it('is null until the game is decided', () => {
    const def = buildGame('g', two(0, 0), { ...base, pairGame: 'stableford' })!;
    expect(gameResult(def, computeGameState(def, holes, indexScores([])))).toBeNull();
  });
});
