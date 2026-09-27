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

export function computeTracker(matches: TrackedMatch[], total: number): Tracker {
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
    toWin: total / 2 + 0.5,
  };
}

export function roundPointsAvailable(s: RoundSettings, groupCount: number): number {
  return groupCount * (s.betterBallPoints + (s.singlesEnabled ? 2 * s.singlesPoints : 0));
}

export function resultFromState(def: MatchDef, state: MatchState): ConfirmedResult | null {
  if (!state.decided || !state.winner || state.finalHole === null || !state.resultText) return null;
  const [pointsA, pointsB] =
    state.winner === 'A' ? [def.points, 0] : state.winner === 'B' ? [0, def.points] : [def.points / 2, def.points / 2];
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
