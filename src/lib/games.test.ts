import { describe, it, expect } from 'vitest';
import { GAMES, defaultsFor, fourballKey, gamesFor, newRoundDefaults } from './games';

describe('games list', () => {
  it('has every game once, grouped by golfers', () => {
    expect(GAMES.map((g) => g.key).sort()).toEqual([
      'flat_match', 'fourball_flat', 'fourball_matchplay', 'fourball_stableford', 'scramble', 'six_flat', 'six_stableford',
      'stableford', 'stableford_match', 'two_v_one', 'two_v_one_flat', 'two_v_one_match',
    ]);
    expect(gamesFor(2, { teams: false, rows: [] }).map((g) => g.key)).toEqual(['stableford_match', 'stableford', 'flat_match']);
  });

  it('team events never offer the six pointer', () => {
    expect(gamesFor(3, { teams: true, rows: [] }).map((g) => g.key)).toEqual(['two_v_one', 'two_v_one_match', 'two_v_one_flat']);
    expect(gamesFor(3, { teams: false, rows: [] }).map((g) => g.key)).toContain('six_stableford');
  });

  it('a game switched off is left out, unless the day already uses it', () => {
    const rows = [{ key: 'stableford', enabled: false, defaults: {} }];
    expect(gamesFor(2, { teams: false, rows }).map((g) => g.key)).not.toContain('stableford');
    expect(gamesFor(2, { teams: false, rows, keep: 'stableford' }).map((g) => g.key)).toContain('stableford');
  });

  it("defaults: the admin's values over the built-in ones", () => {
    expect(defaultsFor('scramble', [])).toEqual({ scramble_low_pct: 35, scramble_high_pct: 15 });
    expect(defaultsFor('scramble', [{ key: 'scramble', enabled: true, defaults: { scramble_high_pct: 35 } }])).toEqual({
      scramble_low_pct: 35,
      scramble_high_pct: 35,
    });
  });

  it('maps fourball games to the round fourball formats', () => {
    expect(fourballKey('matchplay')).toBe('fourball_matchplay');
    expect(fourballKey('scramble')).toBe('scramble');
    expect(GAMES.find((g) => g.key === 'fourball_flat')?.fourballFormat).toBe('flat');
  });
});

describe('newRoundDefaults', () => {
  it("a new day starts on the first game switched on for each size, with the admin's defaults", () => {
    const rows = [
      { key: 'stableford_match', enabled: false, defaults: {} },
      { key: 'scramble', enabled: true, defaults: { scramble_high_pct: 35 } },
      { key: 'stableford', enabled: true, defaults: { stableford_pct: 95 } },
    ];
    expect(newRoundDefaults(rows, false)).toEqual({
      pair_game: 'stableford', three_game: 'six_stableford', fourball_format: 'matchplay',
      allowance_pct: 90, scramble_low_pct: 35, scramble_high_pct: 35, stableford_pct: 95, match_pct: 85, match_off_low: true,
    });
    expect(newRoundDefaults(rows, true).three_game).toBe('two_v_one'); // team events: no six pointer
  });
});
