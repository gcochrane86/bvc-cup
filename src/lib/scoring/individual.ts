// Individual events: 2- and 3-player groups playing each other. A group's game is a MatchDef of type
// 'individual': the match play games reuse the fourball match maths; the totals games (Stableford, 2 v 1,
// six pointer) add up points over all 18 holes.
import { computeMatchState, playerHole, scoreKey, type ScoreIndex } from './matchState';
import { playingStrokes, strokesOnHole } from './strokes';
import type { ConfirmedResult, HoleInfo, IndividualGame, MatchDef, MatchState, Outcome, PlayerPoints, RoundSettings, Slot, Winner } from './types';

export interface GamePlayer { slot: Slot; playerId: string; handicap: number }

const POSITIONS: Slot[] = ['P1', 'P2', 'P3'];
const STABLEFORD_GAMES: IndividualGame[] = ['stableford', 'stableford_match', 'six_stableford', 'two_v_one'];
const isSix = (g: IndividualGame | undefined) => g === 'six_stableford' || g === 'six_flat';

const LABELS: Record<IndividualGame, string> = {
  stableford: 'Stableford',
  flat_match: 'Flat match play',
  stableford_match: 'Stableford match play',
  six_stableford: 'Six pointer (Stableford)',
  six_flat: 'Six pointer (flat)',
  two_v_one: '2 v 1 Stableford',
};
export const gameLabel = (game: IndividualGame) => LABELS[game];

/** The game a group of this size plays (none for other sizes). */
export function gameFor(size: number, s: RoundSettings): IndividualGame | null {
  if (size === 2) return s.pairGame ?? 'stableford_match';
  if (size === 3) return s.threeGame ?? 'six_stableford';
  return null;
}

/** players: each player's course handicap for the day, by position. Null for a group that isn't 2 or 3 players. */
export function buildGame(groupId: string, players: GamePlayer[], s: RoundSettings): MatchDef | null {
  const ps = POSITIONS.map((slot) => players.find((p) => p.slot === slot)).filter((p): p is GamePlayer => !!p);
  const game = gameFor(ps.length, s);
  if (!game) return null;
  const ids = ps.map((p) => p.playerId);
  const each = (f: (p: GamePlayer) => number) => Object.fromEntries(ps.map((p) => [p.playerId, f(p)]));
  const stablefordStrokes = each((p) => playingStrokes(p.handicap, s.stablefordPct ?? 100));
  let strokes: Record<string, number>;
  if (game === 'flat_match' || game === 'six_flat') strokes = each(() => 0);
  else if (game === 'stableford_match' && (s.matchOffLow ?? true)) {
    const low = Math.min(...ps.map((p) => p.handicap));
    strokes = each((p) => playingStrokes(p.handicap - low, s.matchPct ?? 85));
  } else if (game === 'stableford_match') strokes = each((p) => p.handicap);
  else strokes = stablefordStrokes;
  // Six pointer: everyone for themselves (one "side"). 1 v 1 and 2 v 1: P1 against the rest.
  const [sideA, sideB] = isSix(game) ? [ids, []] : [ids.slice(0, 1), ids.slice(1)];
  return {
    id: `${groupId}:individual`,
    groupId,
    type: 'individual',
    sideA,
    sideB,
    points: 0,
    strokes,
    game,
    players: ids,
    stablefordStrokes,
    ...(STABLEFORD_GAMES.includes(game) ? { stableford: true } : {}),
  };
}

/** 4 / 2 / 0 for 1st / 2nd / 3rd; players tied share the points of the places they cover. */
export function sixPoints(values: number[], higherIsBetter: boolean): number[] {
  const PLACES = [4, 2, 0];
  const order = values.map((v, i) => ({ v: higherIsBetter ? -v : v, i })).sort((a, b) => a.v - b.v);
  const out: number[] = Array(values.length).fill(0);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const share = PLACES.slice(k, j + 1).reduce((sum, p) => sum + p, 0) / (j - k + 1);
    for (let t = k; t <= j; t++) out[order[t].i] = share;
    k = j + 1;
  }
  return out;
}

/** Stableford points on a hole with the given strokes (own tee's par and SI); a pick-up scores 0. */
function holePoints(def: MatchDef, id: string, hole: HoleInfo, idx: ScoreIndex, strokes: Record<string, number>): number {
  const e = idx.get(scoreKey(id, hole.hole));
  if (!e || e.pickedUp || e.gross === null) return 0;
  const h = playerHole(def, id, hole);
  return Math.max(0, 2 + h.par - (e.gross - strokesOnHole(strokes[id] ?? 0, h.strokeIndex)));
}

/** Gross for the flat six pointer: a pick-up is worse than any real score (99, so two pick-ups tie). */
function grossOrWorst(id: string, hole: HoleInfo, idx: ScoreIndex): number {
  const e = idx.get(scoreKey(id, hole.hole));
  return !e || e.pickedUp || e.gross === null ? 99 : e.gross;
}

/** Each player's Stableford total (off full handicap × the Stableford %) over every hole they've scored. */
function stablefordTotals(def: MatchDef, holes: HoleInfo[], idx: ScoreIndex): Record<string, number> {
  const ids = def.players ?? [...def.sideA, ...def.sideB];
  const strokes = def.stablefordStrokes ?? def.strokes;
  return Object.fromEntries(ids.map((id) => [id, holes.reduce((sum, h) => sum + holePoints(def, id, h, idx, strokes), 0)]));
}

export function computeGameState(def: MatchDef, holes: HoleInfo[], idx: ScoreIndex): MatchState {
  const stableford = stablefordTotals(def, holes, idx);
  if (def.game === 'flat_match' || def.game === 'stableford_match') return { ...computeMatchState(def, holes, idx), stableford };

  const sorted = [...holes].sort((x, y) => x.hole - y.hole);
  const ids = def.players ?? [...def.sideA, ...def.sideB];
  const totals: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const holeWinners: (Outcome | null)[] = Array(18).fill(null);
  const running: (number | null)[] = Array(18).fill(null);
  let thru = 0;
  let a = 0;
  let b = 0;
  for (const h of sorted) {
    // A hole counts once every player has a score for it.
    if (!ids.every((id) => idx.has(scoreKey(id, h.hole)))) break;
    if (isSix(def.game)) {
      const values = ids.map((id) => (def.game === 'six_flat' ? grossOrWorst(id, h, idx) : holePoints(def, id, h, idx, def.strokes)));
      sixPoints(values, def.game === 'six_stableford').forEach((p, i) => (totals[ids[i]] += p));
    } else {
      const pts = Object.fromEntries(ids.map((id) => [id, holePoints(def, id, h, idx, def.strokes)]));
      for (const id of ids) totals[id] += pts[id];
      // The pair's better ball: the higher of the two on the hole.
      const pa = Math.max(...def.sideA.map((id) => pts[id]));
      const pb = Math.max(...def.sideB.map((id) => pts[id]));
      a += pa;
      b += pb;
      holeWinners[h.hole - 1] = pa > pb ? 'A' : pb > pa ? 'B' : 'halved';
      running[h.hole - 1] = a - b;
    }
    thru = h.hole;
  }
  const started = thru > 0;
  const decided = sorted.length > 0 && thru === sorted[sorted.length - 1].hole;
  let winner: Winner | null = null;
  let statusText: string;
  let resultText: string | null = null;
  if (isSix(def.game)) {
    statusText = started ? ids.map((id) => totals[id]).join(' · ') : 'Not started';
    if (decided) {
      const best = Math.max(...ids.map((id) => totals[id]));
      const leaders = ids.filter((id) => totals[id] === best);
      winner = leaders.length === 1 ? (POSITIONS[ids.indexOf(leaders[0])] as Winner) : 'halved';
      resultText = winner === 'halved' ? 'Halved' : `${best} pts`;
    }
  } else {
    statusText = started ? `${a}–${b}` : 'Not started';
    if (decided) {
      winner = a > b ? 'A' : b > a ? 'B' : 'halved';
      const d = Math.abs(a - b);
      resultText = d === 0 ? 'Halved' : `By ${d} pt${d === 1 ? '' : 's'}`;
    }
  }
  return {
    started, thru, lead: a - b, holeWinners, running, decided, dormie: false, winner,
    finalHole: decided ? thru : null, resultText, statusText, projectedA: 0, projectedB: 0, totals, stableford,
  };
}

/** A decided individual game as a result to confirm: no team points, each player's points for the record. */
export function gameResult(def: MatchDef, state: MatchState): ConfirmedResult | null {
  if (!state.decided || !state.winner || state.finalHole === null || !state.resultText) return null;
  const ids = def.players ?? [...def.sideA, ...def.sideB];
  const playerPoints: Record<string, PlayerPoints> = Object.fromEntries(
    ids.map((id) => [id, { points: state.totals?.[id] ?? 0, stableford: state.stableford?.[id] ?? 0 }]),
  );
  return {
    groupId: def.groupId, matchType: def.type, winner: state.winner, pointsA: 0, pointsB: 0,
    resultText: state.resultText, finalHole: state.finalHole, playerPoints,
  };
}

/** The player(s) who won an individual game: a side's players, a position's player, or none when halved. */
export function winnerIds(def: MatchDef, winner: Winner): string[] {
  if (winner === 'A') return def.sideA;
  if (winner === 'B') return def.sideB;
  if (winner === 'halved') return [];
  const i = POSITIONS.indexOf(winner);
  return def.players?.[i] ? [def.players[i]] : [];
}

/**
 * Which of a day's games the admin needs to set: those for the group sizes in the day's groups, or before
 * groups are set, those the number of players allows (2 → a 2-ball, 3 → a 3-ball, more → either).
 */
export function gamesToSet(groupSizes: number[], players: number): { pair: boolean; three: boolean } {
  if (groupSizes.length) return { pair: groupSizes.includes(2), three: groupSizes.includes(3) };
  if (players === 2) return { pair: true, three: false };
  if (players === 3) return { pair: false, three: true };
  return { pair: true, three: true };
}

/** 2 or 3 players make one individual group (a 2-ball or a 3-ball); 4 or more play fourballs as a team event. */
export const eventKindFor = (players: number): 'team' | 'individual' => (players === 2 || players === 3 ? 'individual' : 'team');
