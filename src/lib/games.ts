// The games list: every game the app can score, by how many golfers play it. Every day's game picker reads
// from here, and Admin → Games switches games on/off and sets their defaults (the `games` table). Adding a
// game means an entry here plus its scoring rule.

export type GameKey =
  | 'stableford_match' | 'stableford' | 'flat_match'
  | 'two_v_one' | 'two_v_one_match' | 'two_v_one_flat' | 'two_v_one_best' | 'six_stableford' | 'six_flat'
  | 'fourball_matchplay' | 'fourball_stableford' | 'fourball_flat' | 'scramble';

/** A setting a game uses (a round column of the same name). */
export type SettingKey = 'match_off_low' | 'match_pct' | 'stableford_pct' | 'allowance_pct' | 'scramble_low_pct' | 'scramble_high_pct';
export type FourballFormat = 'matchplay' | 'stableford' | 'flat' | 'scramble';

export interface GameInfo {
  key: GameKey;
  name: string;
  /** Golfers in a group: 2, 3, or 4 (fourballs). */
  size: 2 | 3 | 4;
  /** Fair in a team event? (Not the six pointer: two team-mates could hand their partner the holes.) */
  teamOk: boolean;
  /** One line on how it's won. */
  about: string;
  /** Built-in defaults for its settings (the admin can change them in Admin → Games). */
  defaults: Partial<Record<SettingKey, number | boolean>>;
  /** Fourball games: the round's fourball_format value. */
  fourballFormat?: FourballFormat;
}

export const GAMES: GameInfo[] = [
  { key: 'stableford_match', name: 'Stableford match play', size: 2, teamOk: true, about: 'More Stableford points on a hole wins it.', defaults: { match_off_low: true, match_pct: 85 } },
  { key: 'stableford', name: 'Stableford', size: 2, teamOk: true, about: 'Higher Stableford total over 18 wins.', defaults: { stableford_pct: 100 } },
  { key: 'flat_match', name: 'Flat match play', size: 2, teamOk: true, about: 'Lower gross score wins each hole. No shots.', defaults: {} },
  { key: 'six_stableford', name: 'Six pointer (Stableford)', size: 3, teamOk: false, about: '4 / 2 / 0 a hole by Stableford points.', defaults: { stableford_pct: 100 } },
  { key: 'six_flat', name: 'Six pointer (flat)', size: 3, teamOk: false, about: '4 / 2 / 0 a hole by gross score. No shots.', defaults: {} },
  { key: 'two_v_one', name: '2 v 1 Stableford', size: 3, teamOk: true, about: "The single's Stableford total against the pair's better ball.", defaults: { stableford_pct: 100 } },
  { key: 'two_v_one_match', name: '2 v 1 Stableford match play', size: 3, teamOk: true, about: "Hole by hole: the single's points against the pair's best.", defaults: { stableford_pct: 100 } },
  { key: 'two_v_one_best', name: '2 v 1 Stableford (best individual)', size: 3, teamOk: true, about: "The single's own Stableford total against the better of the pair's own totals.", defaults: { stableford_pct: 100 } },
  { key: 'two_v_one_flat', name: '2 v 1 flat match play', size: 3, teamOk: true, about: "Hole by hole: the single's gross against the pair's best. No shots.", defaults: {} },
  { key: 'fourball_matchplay', name: 'Fourball match play', size: 4, teamOk: true, about: 'Better ball match play off the low.', defaults: { allowance_pct: 90 }, fourballFormat: 'matchplay' },
  { key: 'fourball_stableford', name: 'Fourball Stableford', size: 4, teamOk: true, about: 'Best Stableford points on a hole wins it, full handicaps.', defaults: {}, fourballFormat: 'stableford' },
  { key: 'fourball_flat', name: 'Fourball flat', size: 4, teamOk: true, about: 'Better ball match play, no shots.', defaults: {}, fourballFormat: 'flat' },
  { key: 'scramble', name: '2-man scramble', size: 4, teamOk: true, about: 'One ball per pair, team handicap from both players.', defaults: { scramble_low_pct: 35, scramble_high_pct: 15 }, fourballFormat: 'scramble' },
];

/** A games table row: what the admin manages. */
export interface GameRow { key: string; enabled: boolean; defaults: Record<string, unknown> }

export const gameInfo = (key: string) => GAMES.find((g) => g.key === key);
export const fourballKey = (format: FourballFormat): GameKey => GAMES.find((g) => g.fourballFormat === format)!.key;

/**
 * The games a day of this size can play: switched on, and fair for the event (team events: no six pointer).
 * keep: the day's current game, always listed so a game switched off later still shows where it's used.
 */
export function gamesFor(size: 2 | 3 | 4, opts: { teams: boolean; rows: GameRow[]; keep?: string }): GameInfo[] {
  const enabled = (key: string) => opts.rows.find((r) => r.key === key)?.enabled ?? true;
  return GAMES.filter((g) => g.size === size && (g.key === opts.keep || (enabled(g.key) && (g.teamOk || !opts.teams))));
}

/** A game's defaults: the admin's values over the built-in ones. */
export function defaultsFor(key: string, rows: GameRow[]): Partial<Record<SettingKey, number | boolean>> {
  const own = (rows.find((r) => r.key === key)?.defaults ?? {}) as Partial<Record<SettingKey, number | boolean>>;
  return { ...(gameInfo(key)?.defaults ?? {}), ...own };
}

/** A new day's games and settings: the first game switched on for each size, with the admin's defaults. */
export function newRoundDefaults(rows: GameRow[], teams: boolean) {
  const first = (size: 2 | 3 | 4) => gamesFor(size, { teams, rows })[0];
  const pair = first(2)?.key ?? 'stableford_match';
  const three = first(3)?.key ?? (teams ? 'two_v_one' : 'six_stableford');
  const d = (key: string) => defaultsFor(key, rows);
  return {
    pair_game: pair,
    three_game: three,
    fourball_format: first(4)?.fourballFormat ?? 'matchplay',
    allowance_pct: d('fourball_matchplay').allowance_pct as number,
    scramble_low_pct: d('scramble').scramble_low_pct as number,
    scramble_high_pct: d('scramble').scramble_high_pct as number,
    // One Stableford % per day: from its 2-player game if that uses one, else its 3-player game's.
    stableford_pct: (d(pair).stableford_pct ?? d(three).stableford_pct ?? 100) as number,
    match_pct: d('stableford_match').match_pct as number,
    match_off_low: d('stableford_match').match_off_low as boolean,
  };
}
