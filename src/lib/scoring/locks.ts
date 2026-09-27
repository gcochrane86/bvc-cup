import type { ConfirmedResult, MatchDef } from './types';

/** Mirrors the database's score_locked(): a confirmed match locks its players' holes up to its final hole. */
export function isScoreLocked(
  playerId: string,
  hole: number,
  matches: { def: MatchDef; result: ConfirmedResult | null }[],
): boolean {
  return matches.some(
    (m) =>
      m.result !== null &&
      hole <= m.result.finalHole &&
      (m.def.sideA.includes(playerId) || m.def.sideB.includes(playerId)),
  );
}
