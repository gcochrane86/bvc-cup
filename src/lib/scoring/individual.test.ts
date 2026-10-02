import { describe, it, expect } from 'vitest';
import { buildGame, computeGameState, eventKindFor, gameFor, gameResult, gamesToSet, projectedTeamPoints, seasonDayCheck, sixPoints, teamPoints, winnerIds, wolfHole, wolfTeeOrder } from './individual';
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

describe('winnerIds', () => {
  it('names the winning player or players of an individual game', () => {
    const one = buildGame('g', two(0, 0), base)!;
    expect(winnerIds(one, 'A')).toEqual(['p1']);
    expect(winnerIds(one, 'halved')).toEqual([]);
    const solo = buildGame('g', three(0, 0, 0), twoVOne)!;
    expect(winnerIds(solo, 'B')).toEqual(['p2', 'p3']);
    const six = buildGame('g', three(0, 0, 0), base)!;
    expect(winnerIds(six, 'P3')).toEqual(['p3']);
  });
});

describe('gamesToSet', () => {
  it("follows the day's groups once they're set", () => {
    expect(gamesToSet([3], 7)).toEqual({ pair: false, three: true });
    expect(gamesToSet([2, 2], 7)).toEqual({ pair: true, three: false });
    expect(gamesToSet([2, 3], 5)).toEqual({ pair: true, three: true });
  });
  it('before groups are set, goes by the number of players', () => {
    expect(gamesToSet([], 2)).toEqual({ pair: true, three: false });
    expect(gamesToSet([], 3)).toEqual({ pair: false, three: true });
    expect(gamesToSet([], 5)).toEqual({ pair: true, three: true });
    expect(gamesToSet([], 0)).toEqual({ pair: true, three: true });
  });
});

describe('eventKindFor', () => {
  it('2 or 3 players play an individual game; 4 or more play fourballs as a team event', () => {
    expect(eventKindFor(2)).toBe('individual');
    expect(eventKindFor(3)).toBe('individual');
    expect(eventKindFor(4)).toBe('team');
    expect(eventKindFor(12)).toBe('team');
    expect(eventKindFor(0)).toBe('team');
    expect(eventKindFor(1)).toBe('team');
  });
});

describe('2 v 1 match play games', () => {
  it('Stableford match play: the single against the pair\'s best points, hole by hole', () => {
    const def = buildGame('g', three(0, 0, 0), { ...base, threeGame: 'two_v_one_match' })!;
    expect(def.stableford).toBe(true);
    // Single pars, p2 bogeys, p3 birdies the 1st: the pair's best wins the 1st, halves the 2nd.
    const st = computeGameState(def, holes, indexScores(card({ p1: [4, 4], p2: [5, 5], p3: [3, 4] })));
    expect(st.statusText).toBe('1 UP');
    expect(st.lead).toBe(-1);
  });
  it('flat match play: gross, no shots', () => {
    const def = buildGame('g', three(0, 20, 20), { ...base, threeGame: 'two_v_one_flat' })!;
    expect(def.strokes).toEqual({ p1: 0, p2: 0, p3: 0 });
    const st = computeGameState(def, holes, indexScores(card({ p1: [3], p2: [4], p3: [5] })));
    expect(st.lead).toBe(1);
  });
  it('puts the given single first', () => {
    const def = buildGame('g', three(0, 0, 0), twoVOne, { single: 'p3' })!;
    expect(def.sideA).toEqual(['p3']);
    expect(def.sideB).toEqual(['p1', 'p2']);
  });
});

describe('teamPoints', () => {
  const pts = { fourball: { win: 2, halve: 1 }, singles: { win: 1, halve: 0.5 }, one_v_one: { win: 1, halve: 0.5 }, two_v_one_single: { win: 2, halve: 1 }, two_v_one_pair: { win: 1, halve: 0.5 } };
  const one = buildGame('g', two(0, 0), base)!;
  const solo = buildGame('g', three(0, 0, 0), twoVOne)!;
  const teamOf = { p1: 'B' as const, p2: 'A' as const, p3: 'A' as const };
  it('1 v 1: the winner\'s team gets the win; a halve gives each team its halve', () => {
    expect(teamPoints(one, 'A', teamOf, pts)).toEqual({ A: 0, B: 1 });
    expect(teamPoints(one, 'halved', teamOf, pts)).toEqual({ A: 0.5, B: 0.5 });
  });
  it("2 v 1: the single's win (double) for their team; the pair's win is for the pair together", () => {
    expect(teamPoints(solo, 'A', teamOf, pts)).toEqual({ A: 0, B: 2 });
    expect(teamPoints(solo, 'B', teamOf, pts)).toEqual({ A: 1, B: 0 });
    expect(teamPoints(solo, 'halved', teamOf, pts)).toEqual({ A: 0.5, B: 1 });
  });
  it('projects from who is ahead', () => {
    const st = computeGameState(solo, holes, indexScores(card({ p1: [3], p2: [4], p3: [5] })));
    expect(projectedTeamPoints(solo, st, teamOf, pts)).toEqual({ A: 0, B: 2 });
    expect(projectedTeamPoints(solo, computeGameState(solo, holes, indexScores([])), teamOf, pts)).toEqual({ A: 0, B: 0 });
  });
  it('gameResult in a season event carries team points', () => {
    const st = computeGameState(one, holes, indexScores(card({ p1: all(4), p2: all(5) })));
    expect(gameResult(one, st, { teamOf, points: pts })).toMatchObject({ winner: 'A', pointsA: 0, pointsB: 1 });
  });
});

describe('seasonDayCheck', () => {
  const teamOf = { a1: 'A' as const, a2: 'A' as const, a3: 'A' as const, b1: 'B' as const, b2: 'B' as const };
  it('2 golfers from different teams: a 1 v 1', () => {
    expect(seasonDayCheck(['a1', 'b1'], teamOf)).toEqual({ format: 'one_v_one' });
  });
  it('3 golfers split 2–1: a 2 v 1, the one on their own playing alone', () => {
    expect(seasonDayCheck(['a1', 'a2', 'b1'], teamOf)).toEqual({ format: 'two_v_one', single: 'b1' });
  });
  it('4 or more: fourballs', () => {
    expect(seasonDayCheck(['a1', 'a2', 'b1', 'b2'], teamOf)).toEqual({ format: 'fourballs' });
  });
  it('golfers all from one team are not allowed', () => {
    expect(seasonDayCheck(['a1', 'a2'], teamOf)).toEqual({ error: 'same_team', team: 'A' });
    expect(seasonDayCheck(['a1', 'a2', 'a3'], teamOf)).toEqual({ error: 'same_team', team: 'A' });
  });
  it('needs at least 2 golfers, all on a team', () => {
    expect(seasonDayCheck(['a1'], teamOf)).toEqual({ error: 'too_few' });
    expect(seasonDayCheck(['a1', 'x9'], teamOf)).toEqual({ error: 'no_team' });
  });
});

describe('seasonDayCheck: fourball days', () => {
  it('need at least 2 golfers from each team', () => {
    const teamOf = { a1: 'A' as const, a2: 'A' as const, a3: 'A' as const, b1: 'B' as const, b2: 'B' as const };
    expect(seasonDayCheck(['a1', 'a2', 'a3', 'b1'], teamOf)).toEqual({ error: 'fourball_teams' });
    expect(seasonDayCheck(['a1', 'a2', 'b1', 'b2', 'a3'], teamOf)).toEqual({ format: 'fourballs' });
  });
});

describe('2 v 1 Stableford (best individual)', () => {
  it("the single's own total against the better of the pair's own totals", () => {
    const def = buildGame('g', three(0, 0, 0), { ...base, threeGame: 'two_v_one_best' })!;
    expect(def.stableford).toBe(true);
    // Single pars everything: 36. Pair: p2 bogeys everything (18); p3 birdies the 1st, pars the rest (37).
    const p3 = all(4);
    p3[0] = 3;
    const st = computeGameState(def, holes, indexScores(card({ p1: all(4), p2: all(5), p3 })));
    expect(st.statusText).toBe('36–37');
    expect(st.winner).toBe('B');
    // Better ball would have been the same here; with p3 bogeying the 1st, the best individual total is 35.
    const p3b = all(4);
    p3b[0] = 5;
    expect(computeGameState(def, holes, indexScores(card({ p1: all(4), p2: all(5), p3: p3b }))).winner).toBe('A');
  });
});

describe('match play over fewer holes', () => {
  it('finishes when the lead is more than the holes left to play', () => {
    const nine = holes.slice(0, 9);
    const def = buildGame('g', two(0, 0), { ...base, pairGame: 'flat_match' })!;
    const st = computeGameState(def, nine, indexScores(card({ p1: Array(5).fill(4), p2: Array(5).fill(5) })));
    expect(st.decided).toBe(true);
    expect(st.resultText).toBe('5&4');
  });
  it('counts only the holes being played (1–9, 14 and 18)', () => {
    const winter = holes.filter((h) => h.hole <= 9 || h.hole === 14 || h.hole === 18);
    const def = buildGame('g', two(0, 0), { ...base, pairGame: 'flat_match' })!;
    // Level after 9; p1 wins the 14th: 1 UP with one to play.
    const p1 = [...Array(9).fill(4), ...Array(4).fill(4), 3];
    const p2 = [...Array(9).fill(4), ...Array(4).fill(4), 4];
    const st = computeGameState(def, winter, indexScores(card({ p1, p2 })));
    expect(st.thru).toBe(14);
    expect(st.statusText).toBe('1 UP');
    expect(st.dormie).toBe(true);
  });
});

describe('wolf', () => {
  // Group saved as Adams, Brown, Clark; handicaps 10, 10, 6.
  const ppl = [
    { slot: 'P1' as const, playerId: 'a', handicap: 10, name: 'Alex Adams' },
    { slot: 'P2' as const, playerId: 'b', handicap: 10, name: 'Ben Brown' },
    { slot: 'P3' as const, playerId: 'c', handicap: 6, name: 'Chris Clark' },
  ];
  const flat = { ...base, threeGame: 'wolf_flat' as const };
  const stab = { ...base, threeGame: 'wolf_stableford' as const };
  /** One hole: gross per player and who played on their own. */
  const hole = (n: number, gross: Record<string, number>, lone?: string): ScoreEntry[] =>
    Object.entries(gross).map(([playerId, g]) => ({ playerId, hole: n, gross: g, pickedUp: false, lone: playerId === lone }));

  it('tees off lowest handicap first (equal handicaps in name order), then rotates each hole', () => {
    const def = buildGame('g', ppl, flat)!;
    expect(def.players).toEqual(['c', 'a', 'b']);
    expect(def.sideA).toEqual(['c', 'a', 'b']);
    expect(wolfTeeOrder(def, holes, 1)).toEqual(['c', 'a', 'b']); // Adams is the wolf (second off)
    expect(wolfTeeOrder(def, holes, 2)).toEqual(['a', 'b', 'c']);
    expect(wolfTeeOrder(def, holes, 3)).toEqual(['b', 'c', 'a']);
    expect(wolfTeeOrder(def, holes, 4)).toEqual(['c', 'a', 'b']);
    // A day playing only some holes rotates through the holes it plays: 1–9, 14, 18 → the 14th is the 10th hole.
    const some = holes.filter((h) => h.hole <= 9 || h.hole === 14 || h.hole === 18);
    expect(wolfTeeOrder(def, some, 14)).toEqual(['c', 'a', 'b']);
  });

  it('shots: scratch none; Stableford full handicaps, or off the low', () => {
    expect(buildGame('g', ppl, flat)!.strokes).toEqual({ a: 0, b: 0, c: 0 });
    expect(buildGame('g', ppl, stab)!.strokes).toEqual({ a: 10, b: 10, c: 6 });
    expect(buildGame('g', ppl, stab)!.stableford).toBe(true);
    expect(buildGame('g', ppl, { ...stab, wolfOffLow: true, stablefordPct: 90 })!.strokes).toEqual({ a: 4, b: 4, c: 0 }); // 4 × 0.9 = 3.6 → 4
  });

  it('a lone winner gets 2, a winning pair 1 each, a tie nothing; a hole counts once someone is marked as on their own', () => {
    const def = buildGame('g', ppl, flat)!;
    const idx = indexScores([
      ...hole(1, { c: 4, a: 3, b: 5 }, 'a'), // Adams (wolf) solo, 3 v 4: Adams +2
      ...hole(2, { a: 5, b: 4, c: 4 }, 'c'), // Brown partners Adams, Clark alone, 4 v 4: tie
      ...hole(3, { b: 4, c: 5, a: 4 }, 'c'), // Clark (wolf) solo, 5 v 4: Adams & Brown +1 each
      ...hole(4, { c: 4, a: 4, b: 4 }), // scored, but nobody marked yet: not counted
    ]);
    const st = computeGameState(def, holes, idx);
    expect(st.totals).toEqual({ c: 0, a: 3, b: 1 });
    expect(st.thru).toBe(3);
    expect(st.statusText).toBe('0 · 3 · 1');
    expect(st.wolves).toEqual({ c: 1, a: 1, b: 1 }); // holes counted as wolf: Adams (1), Brown (2), Clark (3)
    expect(wolfHole(def, holes[0], idx)).toEqual({ lone: 'a', winners: ['a'], points: { c: 0, a: 2, b: 0 } });
    expect(wolfHole(def, holes[1], idx)).toEqual({ lone: 'c', winners: [], points: { c: 0, a: 0, b: 0 } });
    expect(wolfHole(def, holes[2], idx)).toEqual({ lone: 'c', winners: ['a', 'b'], points: { c: 0, a: 1, b: 1 } });
    expect(wolfHole(def, holes[3], idx)).toBeNull();
    // Asking "what if": the pop-up can try a player before it's saved.
    expect(wolfHole(def, holes[3], idx, 'b')).toEqual({ lone: 'b', winners: [], points: { c: 0, a: 0, b: 0 } });
  });

  it('Stableford wolf: most points wins the hole (a pick-up scores 0)', () => {
    const def = buildGame('g', ppl, stab)!;
    // Hole 1 (SI 1): everyone gets a shot. Clark 3 → net 2 = 4 pts; Adams 4 → 3 pts; Brown picks up → 0.
    const idx = indexScores([
      { playerId: 'c', hole: 1, gross: 3, pickedUp: false, lone: true },
      { playerId: 'a', hole: 1, gross: 4, pickedUp: false },
      { playerId: 'b', hole: 1, gross: null, pickedUp: true },
    ]);
    expect(wolfHole(def, holes[0], idx)).toEqual({ lone: 'c', winners: ['c'], points: { c: 2, a: 0, b: 0 } });
  });

  it('decided after the last hole: the most points wins', () => {
    const def = buildGame('g', ppl, flat)!;
    const three = holes.slice(0, 3);
    const idx = indexScores([...hole(1, { c: 4, a: 3, b: 5 }, 'a'), ...hole(2, { a: 5, b: 4, c: 4 }, 'c'), ...hole(3, { b: 4, c: 5, a: 4 }, 'c')]);
    const st = computeGameState(def, three, idx);
    expect(st.decided).toBe(true);
    expect(st.winner).toBe('P2'); // Adams, second in the tee order
    expect(winnerIds(def, st.winner!)).toEqual(['a']);
    expect(gameResult(def, st)!.playerPoints!.a.points).toBe(3);
  });
});

