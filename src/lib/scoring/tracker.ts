import { gameResult, type TeamContext } from './individual';
import type { ConfirmedResult, MatchDef, MatchState, RoundSettings } from './types';

export interface Tracker {
  confirmedA: number;
  confirmedB: number;
  projectedA: number;
  projectedB: number;
  total: number;
  toWin: number;
}

export interface TrackedMatch {
  state: MatchState;
  result: ConfirmedResult | null;
}

/**
 * Smallest amount a team's total can move by: half of each match's points (a halved match).
 * E.g. 1-point fourballs only -> ½; add ½-point singles -> ¼.
 */
export function pointsStep(rounds: RoundSettings[]): number {
  const halves = rounds.flatMap((r) => [r.betterBallPoints / 2, ...(r.singlesEnabled ? [r.singlesPoints / 2] : [])]);
  const units = halves.map((h) => Math.round(h * 100)).filter((u) => u > 0);
  if (units.length === 0) return 0.5;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  return units.reduce(gcd) / 100;
}

/** step: see pointsStep. To win outright a team needs one step more than half the points. */
export function computeTracker(matches: TrackedMatch[], total: number, step = 0.5): Tracker {
  let confirmedA = 0;
  let confirmedB = 0;
  let liveA = 0;
  let liveB = 0;
  for (const m of matches) {
    if (m.result) {
      confirmedA += m.result.pointsA;
      confirmedB += m.result.pointsB;
    } else {
      liveA += m.state.projectedA;
      liveB += m.state.projectedB;
    }
  }
  return {
    confirmedA,
    confirmedB,
    projectedA: confirmedA + liveA,
    projectedB: confirmedB + liveB,
    total,
    toWin: total / 2 + step,
  };
}

export function roundPointsAvailable(s: RoundSettings, groupCount: number): number {
  return groupCount * (s.betterBallPoints + (s.singlesEnabled ? 2 * s.singlesPoints : 0));
}

export function resultFromState(def: MatchDef, state: MatchState, team?: TeamContext): ConfirmedResult | null {
  if (def.game) return gameResult(def, state, team); // individual games: team points in season events, each player's points
  if (!state.decided || !state.winner || state.finalHole === null || !state.resultText) return null;
  const [pointsA, pointsB] =
    state.winner === 'A' ? [def.points, 0] : state.winner === 'B' ? [0, def.points] : [def.halvePoints ?? def.points / 2, def.halvePoints ?? def.points / 2];
  return {
    groupId: def.groupId,
    matchType: def.type,
    winner: state.winner,
    pointsA,
    pointsB,
    resultText: state.resultText,
    finalHole: state.finalHole,
  };
}
