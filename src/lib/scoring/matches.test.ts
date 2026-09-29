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
    // Singles are unchanged: off the low, singles allowance, match play.
    expect(ms[1].strokes).toEqual({ a1: 0, b1: 5 });
    expect(ms[1].stableford).toBeUndefined();
  });

  it('in a flat fourball, nobody gets a shot (gross match play); singles keep their allowance', () => {
    const ms = buildMatches('g1', players, { ...settings, fourballFormat: 'flat', singlesEnabled: true });
    expect(ms[0].strokes).toEqual({ a1: 0, a2: 0, b1: 0, b2: 0 });
    expect(ms[0].stableford).toBeUndefined();
    expect(ms[1].strokes).toEqual({ a1: 0, b1: 5 }); // singles: off the low at their allowance, as before
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

  it('uses the singles allowance for singles only', () => {
    const ms = buildMatches('g1', players, { ...settings, singlesEnabled: true, singlesAllowancePct: 100 });
    expect(ms[0].strokes).toEqual({ a1: 0, a2: 13, b1: 5, b2: 9 });
    expect(ms[1].strokes).toEqual({ a1: 0, b1: 5 });
    expect(ms[2].strokes).toEqual({ a2: 4, b2: 0 });
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
