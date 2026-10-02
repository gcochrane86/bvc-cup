export type Team = 'A' | 'B';
/** A1–B2: a fourball's positions. P1–P3: an individual group's (in a 2 v 1, P1 plays alone). */
export type Slot = 'A1' | 'A2' | 'B1' | 'B2' | 'P1' | 'P2' | 'P3';
export type MatchType = 'better_ball' | 'low_singles' | 'high_singles' | 'individual';
export type Outcome = Team | 'halved';
/** A result's winner: a side, halved, or (six pointer) a position. */
export type Winner = Outcome | 'P1' | 'P2' | 'P3';
export type PairGame = 'stableford' | 'flat_match' | 'stableford_match';
export type ThreeGame = 'six_stableford' | 'six_flat' | 'two_v_one' | 'two_v_one_match' | 'two_v_one_flat';
export type IndividualGame = PairGame | ThreeGame;
/** A player's figures from a confirmed individual game: game points and Stableford total. */
export interface PlayerPoints { points: number; stableford: number }
/** Season team events: points for each format, a win and a halve. */
export interface WinHalve { win: number; halve: number }
export interface SeasonPoints { fourball: WinHalve; singles: WinHalve; one_v_one: WinHalve; two_v_one_single: WinHalve; two_v_one_pair: WinHalve }

export interface HoleInfo {
  hole: number;
  par: number;
  strokeIndex: number;
}

export interface RoundSettings {
  allowancePct: number;
  betterBallPoints: number;
  singlesEnabled: boolean;
  singlesPoints: number;
  singlesAllowancePct: number;
  /** The fourball game: match play off the lowest handicap (default), Stableford off full handicaps, or flat (no shots). */
  fourballFormat?: 'matchplay' | 'stableford' | 'flat' | 'scramble';
  /** 2-man scramble: % of the lower and the higher partner's course handicap that make the team handicap (default 35 each). */
  scrambleLowPct?: number;
  scrambleHighPct?: number;
  /** Individual events: the 2-player game, the 3-player game, and handicap settings. */
  pairGame?: PairGame;
  threeGame?: ThreeGame;
  /** % of course handicap in the Stableford games (default 100). */
  stablefordPct?: number;
  /** Stableford match play off the low man: % of the difference (default 85). */
  matchPct?: number;
  /** Stableford match play: off the low man (default) or full handicaps. */
  matchOffLow?: boolean;
}

export interface SlotPlayer {
  slot: Slot;
  playerId: string;
  handicap: number;
}

/** One player's entry on one hole. gross is null when picked up. */
export interface ScoreEntry {
  playerId: string;
  hole: number;
  gross: number | null;
  pickedUp: boolean;
}

export interface MatchDef {
  id: string; // `${groupId}:${type}`
  groupId: string;
  type: MatchType;
  sideA: string[];
  sideB: string[];
  points: number;
  /** Total strokes received in this match, per player id. */
  strokes: Record<string, number>;
  /** Fourball Stableford: each side's best Stableford points win the hole (pick-up = 0). */
  stableford?: boolean;
  /** 2-man scramble: each team plays one ball; both players carry the team's score and shots. */
  scramble?: boolean;
  /** 2-man scramble: each player's team handicap (the round's % of the low and high partner's course handicap, added). */
  teamHandicap?: Record<string, number>;
  /** Players on a tee other than the day's main tee: that tee's holes (own par and stroke index). */
  teeHoles?: Record<string, HoleInfo[]>;
  /** Individual events: the game this group plays. */
  game?: IndividualGame;
  /** Individual events: the players in position order (P1, P2, P3). */
  players?: string[];
  /** Individual events: each player's strokes off full handicap × the Stableford % (for Stableford totals). */
  stablefordStrokes?: Record<string, number>;
  /** Points each side gets for a halve (default half the match's points). */
  halvePoints?: number;
}

export interface MatchState {
  started: boolean;
  thru: number;
  /** Positive = team A up, negative = team B up. */
  lead: number;
  /** Index 0 = hole 1. null = not yet counted. */
  holeWinners: (Outcome | null)[];
  /** Running lead after each hole. Index 0 = hole 1. */
  running: (number | null)[];
  decided: boolean;
  dormie: boolean;
  winner: Winner | null;
  finalHole: number | null;
  /** '4&3', '2 UP', 'Halved' — only when decided. */
  resultText: string | null;
  /** 'Not started', 'All Square', '2 UP', or resultText. */
  statusText: string;
  projectedA: number;
  projectedB: number;
  /** Individual totals games: each player's points so far (six pointer points, or Stableford points). */
  totals?: Record<string, number>;
  /** Individual games: each player's Stableford total off full handicap × the Stableford %, over the holes scored. */
  stableford?: Record<string, number>;
}

export interface ConfirmedResult {
  groupId: string;
  matchType: MatchType;
  winner: Winner;
  pointsA: number;
  pointsB: number;
  resultText: string;
  finalHole: number;
  /** Individual games: each player's game points and Stableford total. */
  playerPoints?: Record<string, PlayerPoints>;
}
