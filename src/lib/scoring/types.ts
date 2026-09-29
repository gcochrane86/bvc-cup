export type Team = 'A' | 'B';
export type Slot = 'A1' | 'A2' | 'B1' | 'B2';
export type MatchType = 'better_ball' | 'low_singles' | 'high_singles';
export type Outcome = Team | 'halved';

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
  /** The fourball game: match play off the lowest handicap (default), or Stableford off full handicaps. */
  fourballFormat?: 'matchplay' | 'stableford';
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
  /** Players on a tee other than the day's main tee: that tee's holes (own par and stroke index). */
  teeHoles?: Record<string, HoleInfo[]>;
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
  winner: Outcome | null;
  finalHole: number | null;
  /** '4&3', '2 UP', 'Halved' — only when decided. */
  resultText: string | null;
  /** 'Not started', 'All Square', '2 UP', or resultText. */
  statusText: string;
  projectedA: number;
  projectedB: number;
}

export interface ConfirmedResult {
  groupId: string;
  matchType: MatchType;
  winner: Outcome;
  pointsA: number;
  pointsB: number;
  resultText: string;
  finalHole: number;
}
