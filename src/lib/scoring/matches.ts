import { playingStrokes } from './strokes';
import type { MatchDef, MatchType, RoundSettings, SlotPlayer } from './types';

export function buildMatches(groupId: string, players: SlotPlayer[], s: RoundSettings): MatchDef[] {
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
    matches.push(singles(groupId, 'low_singles', a1, b1, s), singles(groupId, 'high_singles', a2, b2, s));
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
