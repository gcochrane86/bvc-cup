import { describe, it, expect } from 'vitest';
import { buildMatches } from './matches';
import type { RoundSettings, SlotPlayer } from './types';

const settings: RoundSettings = {
  allowancePct: 90,
  betterBallPoints: 1,
  singlesEnabled: false,
  singlesPoints: 0.5,
  singlesAllowancePct: 90,
};
const players: SlotPlayer[] = [
  { slot: 'A1', playerId: 'a1', handicap: 4 },
  { slot: 'A2', playerId: 'a2', handicap: 18 },
  { slot: 'B1', playerId: 'b1', handicap: 9 },
  { slot: 'B2', playerId: 'b2', handicap: 14 },
];

describe('buildMatches', () => {
  it('builds one better-ball match with strokes off the lowest handicap', () => {
    const ms = buildMatches('g1', players, settings);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({
      id: 'g1:better_ball',
      groupId: 'g1',
      type: 'better_ball',
      sideA: ['a1', 'a2'],
      sideB: ['b1', 'b2'],
      points: 1,
    });
    // 14*.9=12.6->13, 5*.9=4.5->5, 10*.9=9
    expect(ms[0].strokes).toEqual({ a1: 0, a2: 13, b1: 5, b2: 9 });
  });

  it('in fourball Stableford, everyone gets their full course handicap and the match scores points', () => {
    const ms = buildMatches('g1', players, { ...settings, fourballFormat: 'stableford', singlesEnabled: true });
    expect(ms[0].strokes).toEqual({ a1: 4, a2: 18, b1: 9, b2: 14 }); // not off the low, no allowance
    expect(ms[0].stableford).toBe(true);
    // Singles play the same game: full handicaps, most Stableford points wins the hole.
    expect(ms[1].strokes).toEqual({ a1: 4, b1: 9 });
    expect(ms[1].stableford).toBe(true);
    expect(ms[2].strokes).toEqual({ a2: 18, b2: 14 });
  });

  it('in a scratch fourball, nobody gets a shot, in the singles either', () => {
    const ms = buildMatches('g1', players, { ...settings, fourballFormat: 'flat', singlesEnabled: true });
    expect(ms[0].strokes).toEqual({ a1: 0, a2: 0, b1: 0, b2: 0 });
    expect(ms[0].stableford).toBeUndefined();
    expect(ms[1].strokes).toEqual({ a1: 0, b1: 0 });
    expect(ms[2].strokes).toEqual({ a2: 0, b2: 0 });
  });

  it('in a 2-man scramble, each team plays off 35% of each player added; the better team gives the difference', () => {
    // A: 4 and 18 → 1.4 + 6.3 = 7.7 → 8. B: 9 and 14 → 3.15 + 4.9 = 8.05 → 8. Level: no shots.
    const level = buildMatches('g1', players, { ...settings, fourballFormat: 'scramble' });
    expect(level).toHaveLength(1); // no singles in a scramble, even if switched on
    expect(level[0].strokes).toEqual({ a1: 0, a2: 0, b1: 0, b2: 0 });
    expect(level[0].scramble).toBe(true);
    expect(level[0].teamHandicap).toEqual({ a1: 8, a2: 8, b1: 8, b2: 8 });
    // The example: 5 and 9 → 1.75 + 3.15 = 4.9 → 5; v 10 and 20 → 3.5 + 7 = 10.5 → 11: 6 shots to B.
    const ex = buildMatches(
      'g1',
      [
        { slot: 'A1', playerId: 'a1', handicap: 5 }, { slot: 'A2', playerId: 'a2', handicap: 9 },
        { slot: 'B1', playerId: 'b1', handicap: 10 }, { slot: 'B2', playerId: 'b2', handicap: 20 },
      ],
      { ...settings, fourballFormat: 'scramble', singlesEnabled: true },
    );
    expect(ex).toHaveLength(1);
    expect(ex[0].teamHandicap).toEqual({ a1: 5, a2: 5, b1: 11, b2: 11 });
    expect(ex[0].strokes).toEqual({ a1: 0, a2: 0, b1: 6, b2: 6 });
  });

  it('a scramble can weight the low and high handicap differently (e.g. 35% of the low, 15% of the high)', () => {
    const four: SlotPlayer[] = [
      { slot: 'A1', playerId: 'a1', handicap: 20 }, { slot: 'A2', playerId: 'a2', handicap: 8 },
      { slot: 'B1', playerId: 'b1', handicap: 10 }, { slot: 'B2', playerId: 'b2', handicap: 12 },
    ];
    // A: 35% of 8 + 15% of 20 = 2.8 + 3 = 5.8 → 6 (whichever slot the low player is in). B: 3.5 + 1.8 = 5.3 → 5.
    const ms = buildMatches('g1', four, { ...settings, fourballFormat: 'scramble', scrambleLowPct: 35, scrambleHighPct: 15 });
    expect(ms[0].teamHandicap).toEqual({ a1: 6, a2: 6, b1: 5, b2: 5 });
    expect(ms[0].strokes).toEqual({ a1: 1, a2: 1, b1: 0, b2: 0 });
  });

  it('match play (the default) is unchanged', () => {
    expect(buildMatches('g1', players, { ...settings, fourballFormat: 'matchplay' })).toEqual(buildMatches('g1', players, settings));
    expect(buildMatches('g1', players, settings)[0].stableford).toBeUndefined();
  });

  it('adds low and high singles when enabled', () => {
    const ms = buildMatches('g1', players, { ...settings, singlesEnabled: true });
    expect(ms.map((m) => m.type)).toEqual(['better_ball', 'low_singles', 'high_singles']);
    expect(ms[1]).toMatchObject({ id: 'g1:low_singles', sideA: ['a1'], sideB: ['b1'], points: 0.5 });
    expect(ms[1].strokes).toEqual({ a1: 0, b1: 5 }); // 5*.9=4.5->5
    expect(ms[2]).toMatchObject({ id: 'g1:high_singles', sideA: ['a2'], sideB: ['b2'], points: 0.5 });
    expect(ms[2].strokes).toEqual({ a2: 4, b2: 0 }); // 4*.9=3.6->4
  });

  it("off the low: singles use the fourball's allowance, off the lower of the two (any old singles allowance is ignored)", () => {
    const ms = buildMatches('g1', players, { ...settings, allowancePct: 100, singlesEnabled: true, singlesAllowancePct: 50 });
    expect(ms[0].strokes).toEqual({ a1: 0, a2: 14, b1: 5, b2: 10 });
    expect(ms[1].strokes).toEqual({ a1: 0, b1: 5 }); // 9 - 4
    expect(ms[2].strokes).toEqual({ a2: 4, b2: 0 }); // 18 - 14: a2 gets 14 in the fourball but 4 in his singles
  });

  it('returns no matches for an incomplete group', () => {
    expect(buildMatches('g1', players.slice(0, 3), settings)).toEqual([]);
  });

  it('can cross the singles: A1 v B2 and A2 v B1, with strokes for those pairs', () => {
    const ms = buildMatches('g1', players, { ...settings, singlesEnabled: true }, true);
    expect(ms[1]).toMatchObject({ id: 'g1:low_singles', sideA: ['a1'], sideB: ['b2'] });
    expect(ms[1].strokes).toEqual({ a1: 0, b2: 9 }); // 14-4=10 -> 9
    expect(ms[2]).toMatchObject({ id: 'g1:high_singles', sideA: ['a2'], sideB: ['b1'] });
    expect(ms[2].strokes).toEqual({ a2: 8, b1: 0 }); // 18-9=9 -> 8.1 -> 8
    expect(ms[0].strokes).toEqual({ a1: 0, a2: 13, b1: 5, b2: 9 }); // fourball unchanged
  });
});
