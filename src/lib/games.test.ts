import { describe, it, expect } from 'vitest';
import { GAMES, defaultsFor, fourballKey, gamesFor, newRoundDefaults } from './games';
import { gameLabel } from './scoring';

describe('games list', () => {
  it('has every game once, grouped by golfers', () => {
    expect(GAMES.map((g) => g.key).sort()).toEqual([
      'flat_match', 'fourball_flat', 'fourball_matchplay', 'fourball_stableford', 'scramble', 'six_flat', 'six_stableford',
      'stableford', 'stableford_match', 'two_v_one', 'two_v_one_best', 'two_v_one_flat', 'two_v_one_match', 'wolf_flat', 'wolf_stableford',
    ]);
    expect(gamesFor(2, { teams: false, rows: [] }).map((g) => g.key)).toEqual(['stableford_match', 'stableford', 'flat_match']);
  });

  it('team events never offer the six pointer', () => {
    expect(gamesFor(3, { teams: true, rows: [] }).map((g) => g.key)).toEqual(['two_v_one_best', 'two_v_one', 'two_v_one_match', 'two_v_one_flat']);
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
      allowance_pct: 90, scramble_low_pct: 35, scramble_high_pct: 35, stableford_pct: 95, match_pct: 85, match_off_low: true, wolf_off_low: false,
    });
    expect(newRoundDefaults(rows, true).three_game).toBe('two_v_one_best'); // team events: no six pointer; best individual first
  });
});

describe('game names', () => {
  it('say how each game is scored', () => {
    expect(GAMES.map((g) => g.name)).toEqual([
      'Stableford match play', 'Stableford total', 'Scratch match play',
      'Six pointer (Stableford)', 'Six pointer (scratch)', 'Wolf (Stableford)', 'Wolf (scratch)',
      '2 v 1 Stableford · better total', '2 v 1 Stableford · better ball', '2 v 1 Stableford match play', '2 v 1 scratch match play',
      'Better ball · off the low', 'Better ball · Stableford', 'Better ball · scratch', '2-man scramble',
    ]);
  });
  it('are the same wherever an individual game is labelled', () => {
    for (const g of GAMES.filter((x) => x.size < 4)) expect(gameLabel(g.key as Parameters<typeof gameLabel>[0])).toBe(g.name);
  });
});

describe('wolf in the games list', () => {
  it('is for normal events only, and Stableford wolf starts on full handicaps', () => {
    expect(gamesFor(3, { teams: true, rows: [] }).some((g) => g.key.startsWith('wolf'))).toBe(false);
    expect(gamesFor(3, { teams: false, rows: [] }).map((g) => g.key).slice(0, 4)).toEqual(['six_stableford', 'six_flat', 'wolf_stableford', 'wolf_flat']);
    expect(defaultsFor('wolf_stableford', [])).toEqual({ stableford_pct: 100, wolf_off_low: false });
    expect(newRoundDefaults([{ key: 'wolf_stableford', enabled: true, defaults: { wolf_off_low: true } }], false).wolf_off_low).toBe(true);
  });
});

