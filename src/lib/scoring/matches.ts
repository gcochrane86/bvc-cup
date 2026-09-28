import { playingStrokes } from './strokes';
import type { MatchDef, MatchType, RoundSettings, SlotPlayer } from './types';

/** crossed: singles are A1 v B2 and A2 v B1 instead of A1 v B1 and A2 v B2 (random or chosen pairings). */
export function buildMatches(groupId: string, players: SlotPlayer[], s: RoundSettings, crossed = false): MatchDef[] {
  const by = new Map(players.map((p) => [p.slot, p]));
  const a1 = by.get('A1');
  const a2 = by.get('A2');
  const b1 = by.get('B1');
  const b2 = by.get('B2');
  if (!a1 || !a2 || !b1 || !b2) return [];

  const four = [a1, a2, b1, b2];
  const lowest = Math.min(...four.map((p) => p.handicap));
  const matches: MatchDef[] = [
    {
      id: `${groupId}:better_ball`,
      groupId,
      type: 'better_ball',
      sideA: [a1.playerId, a2.playerId],
      sideB: [b1.playerId, b2.playerId],
      points: s.betterBallPoints,
      strokes: Object.fromEntries(
        four.map((p) => [p.playerId, playingStrokes(p.handicap - lowest, s.allowancePct)]),
      ),
    },
  ];
  if (s.singlesEnabled) {
    const [bFirst, bSecond] = crossed ? [b2, b1] : [b1, b2];
    matches.push(singles(groupId, 'low_singles', a1, bFirst, s), singles(groupId, 'high_singles', a2, bSecond, s));
  }
  return matches;
}

function singles(groupId: string, type: MatchType, a: SlotPlayer, b: SlotPlayer, s: RoundSettings): MatchDef {
  const lowest = Math.min(a.handicap, b.handicap);
  return {
    id: `${groupId}:${type}`,
    groupId,
    type,
    sideA: [a.playerId],
    sideB: [b.playerId],
    points: s.singlesPoints,
    strokes: {
      [a.playerId]: playingStrokes(a.handicap - lowest, s.singlesAllowancePct),
      [b.playerId]: playingStrokes(b.handicap - lowest, s.singlesAllowancePct),
    },
  };
}
