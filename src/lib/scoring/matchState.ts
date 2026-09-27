import { strokesOnHole } from './strokes';
import type { HoleInfo, MatchDef, MatchState, Outcome, ScoreEntry } from './types';

export type ScoreIndex = Map<string, ScoreEntry>;

export const scoreKey = (playerId: string, hole: number) => `${playerId}:${hole}`;

export function indexScores(scores: ScoreEntry[]): ScoreIndex {
  return new Map(scores.map((s) => [scoreKey(s.playerId, s.hole), s]));
}

function sideBest(ids: string[], hole: HoleInfo, match: MatchDef, idx: ScoreIndex): number | null {
  let best: number | null = null;
  for (const id of ids) {
    const e = idx.get(scoreKey(id, hole.hole));
    if (!e || e.pickedUp || e.gross === null) continue;
    const net = e.gross - strokesOnHole(match.strokes[id] ?? 0, hole.strokeIndex);
    if (best === null || net < best) best = net;
  }
  return best;
}

export function holeOutcome(match: MatchDef, hole: HoleInfo, idx: ScoreIndex): Outcome | null {
  const everyone = [...match.sideA, ...match.sideB];
  if (!everyone.every((id) => idx.has(scoreKey(id, hole.hole)))) return null;
  const a = sideBest(match.sideA, hole, match, idx);
  const b = sideBest(match.sideB, hole, match, idx);
  if (a === null && b === null) return 'halved';
  if (a === null) return 'B';
  if (b === null) return 'A';
  return a < b ? 'A' : b < a ? 'B' : 'halved';
}

export function computeMatchState(match: MatchDef, holes: HoleInfo[], idx: ScoreIndex): MatchState {
  const sorted = [...holes].sort((x, y) => x.hole - y.hole);
  const holeWinners: (Outcome | null)[] = Array(18).fill(null);
  const running: (number | null)[] = Array(18).fill(null);
  let lead = 0;
  let thru = 0;
  let decided = false;
  let finalHole: number | null = null;

  for (const h of sorted) {
    const o = holeOutcome(match, h, idx);
    if (o === null) break;
    if (o === 'A') lead++;
    else if (o === 'B') lead--;
    holeWinners[h.hole - 1] = o;
    running[h.hole - 1] = lead;
    thru = h.hole;
    const remaining = 18 - h.hole;
    if (Math.abs(lead) > remaining || remaining === 0) {
      decided = true;
      finalHole = h.hole;
      break;
    }
  }

  const remaining = 18 - thru;
  const started = thru > 0;
  const winner: Outcome | null = decided ? (lead > 0 ? 'A' : lead < 0 ? 'B' : 'halved') : null;
  let resultText: string | null = null;
  if (decided) {
    resultText = lead === 0 ? 'Halved' : remaining === 0 ? `${Math.abs(lead)} UP` : `${Math.abs(lead)}&${remaining}`;
  }
  const statusText =
    resultText ?? (!started ? 'Not started' : lead === 0 ? 'All Square' : `${Math.abs(lead)} UP`);
  const dormie = !decided && started && lead !== 0 && Math.abs(lead) === remaining;
  const [projectedA, projectedB] = !started
    ? [0, 0]
    : lead > 0
      ? [match.points, 0]
      : lead < 0
        ? [0, match.points]
        : [match.points / 2, match.points / 2];

  return { started, thru, lead, holeWinners, running, decided, dormie, winner, finalHole, resultText, statusText, projectedA, projectedB };
}
