import { playingStrokes, roundHalfUp } from './strokes';
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
  if (s.fourballFormat === 'scramble') return [scramble(groupId, [a1, a2], [b1, b2], s)];
  const lowest = Math.min(...four.map((p) => p.handicap));
  // Stableford: everyone plays off their full course handicap. Flat: no shots. Match play: off the lowest, at the allowance.
  const stableford = s.fourballFormat === 'stableford';
  const flat = s.fourballFormat === 'flat';
  const matches: MatchDef[] = [
    {
      id: `${groupId}:better_ball`,
      groupId,
      type: 'better_ball',
      sideA: [a1.playerId, a2.playerId],
      sideB: [b1.playerId, b2.playerId],
      points: s.betterBallPoints,
      strokes: Object.fromEntries(
        four.map((p) => [p.playerId, flat ? 0 : stableford ? p.handicap : playingStrokes(p.handicap - lowest, s.allowancePct)]),
      ),
      ...(stableford ? { stableford: true } : {}),
    },
  ];
  if (s.singlesEnabled) {
    const [bFirst, bSecond] = crossed ? [b2, b1] : [b1, b2];
    matches.push(singles(groupId, 'low_singles', a1, bFirst, s), singles(groupId, 'high_singles', a2, bSecond, s));
  }
  return matches;
}

/** Two-man scramble team handicap: lowPct of the lower course handicap plus highPct of the higher, rounded. */
export const scrambleHandicap = (a: number, b: number, lowPct = 35, highPct = 35) =>
  roundHalfUp((lowPct * Math.min(a, b) + highPct * Math.max(a, b)) / 100);

/** 2-man scramble: one ball per team. The better team plays off 0; the other gets the difference. No singles. */
function scramble(groupId: string, sideA: SlotPlayer[], sideB: SlotPlayer[], s: RoundSettings): MatchDef {
  const teamHcp = (side: SlotPlayer[]) => scrambleHandicap(side[0].handicap, side[1].handicap, s.scrambleLowPct, s.scrambleHighPct);
  const ta = teamHcp(sideA);
  const tb = teamHcp(sideB);
  const low = Math.min(ta, tb);
  const team = (side: SlotPlayer[], t: number) => side.map((p) => [p.playerId, t] as const);
  return {
    id: `${groupId}:better_ball`,
    groupId,
    type: 'better_ball',
    sideA: sideA.map((p) => p.playerId),
    sideB: sideB.map((p) => p.playerId),
    points: s.betterBallPoints,
    strokes: Object.fromEntries([...team(sideA, ta - low), ...team(sideB, tb - low)]),
    scramble: true,
    teamHandicap: Object.fromEntries([...team(sideA, ta), ...team(sideB, tb)]),
  };
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
