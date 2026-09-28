// "Form" rankings: per-player stats across the event (or one day), from the same derived view as the
// leaderboard. Gross/net are over completed holes (pick-ups left out) and ranked to par, so players
// who have played different numbers of holes compare fairly.
import { scoreKey, strokesOnHole, type Team } from './scoring';
import type { EventView } from './view';

export type FormMetric = 'gross' | 'net' | 'stableford' | 'points' | 'birdies' | 'trebles';

export interface FormRow {
  playerId: string;
  team: Team;
  /** Holes with a gross score (pick-ups not counted). */
  holes: number;
  gross: number;
  grossToPar: number;
  /** Gross minus shots from the player's full course handicap for that day's course. */
  net: number;
  netToPar: number;
  /** Points from confirmed matches: each player gets their side's points. */
  points: number;
  /** Birdies or better (gross). */
  birdies: number;
  /** Treble bogey or worse, including pick-ups. */
  trebles: number;
  /** Stableford points (full course handicap): 2 for net par, +1 per shot better, 0 for a pick-up. */
  stableford: number;
  /** Holes picked up (they score 0 stableford points and are left out of gross/net). */
  pickups: number;
}

export function computeForm(view: EventView, roundId: string | null): FormRow[] {
  const rows = new Map<string, FormRow>(
    Object.entries(view.teamOf).map(([playerId, team]) => [
      playerId,
      { playerId, team, holes: 0, gross: 0, grossToPar: 0, net: 0, netToPar: 0, points: 0, birdies: 0, trebles: 0, stableford: 0, pickups: 0 },
    ]),
  );
  for (const rv of view.rounds) {
    if (roundId && rv.round.id !== roundId) continue;
    for (const g of rv.groups) {
      for (const pid of Object.values(g.slots)) {
        const r = pid ? rows.get(pid) : undefined;
        if (!pid || !r) continue;
        const courseHcp = g.playingHcp[pid] ?? 0;
        for (const h of rv.holes) {
          const e = g.scores.get(scoreKey(pid, h.hole));
          if (!e) continue;
          if (e.pickedUp || e.gross === null) {
            r.trebles++;
            r.pickups++;
            continue;
          }
          const net = e.gross - strokesOnHole(courseHcp, h.strokeIndex);
          r.holes++;
          r.gross += e.gross;
          r.grossToPar += e.gross - h.par;
          r.net += net;
          r.netToPar += net - h.par;
          r.stableford += Math.max(0, 2 + h.par - net);
          if (e.gross <= h.par - 1) r.birdies++;
          if (e.gross >= h.par + 3) r.trebles++;
        }
      }
      for (const m of g.matches) {
        if (!m.result) continue;
        for (const id of m.def.sideA) {
          const r = rows.get(id);
          if (r) r.points += m.result.pointsA;
        }
        for (const id of m.def.sideB) {
          const r = rows.get(id);
          if (r) r.points += m.result.pointsB;
        }
      }
    }
  }
  return [...rows.values()];
}

const METRICS: Record<FormMetric, { value: (r: FormRow) => number; lowestFirst: boolean; needsHoles: boolean }> = {
  gross: { value: (r) => r.grossToPar, lowestFirst: true, needsHoles: true },
  net: { value: (r) => r.netToPar, lowestFirst: true, needsHoles: true },
  stableford: { value: (r) => r.stableford, lowestFirst: false, needsHoles: false },
  points: { value: (r) => r.points, lowestFirst: false, needsHoles: false },
  birdies: { value: (r) => r.birdies, lowestFirst: false, needsHoles: false },
  trebles: { value: (r) => r.trebles, lowestFirst: false, needsHoles: false },
};

/** Rows in ranking order; tied values share a rank (1, 1, 3). Players yet to play rank null for gross/net. */
export function rankForm(rows: FormRow[], metric: FormMetric): { row: FormRow; rank: number | null; value: number }[] {
  const m = METRICS[metric];
  const ranked = rows
    .filter((r) => !m.needsHoles || r.holes > 0)
    .sort((a, b) => (m.lowestFirst ? m.value(a) - m.value(b) : m.value(b) - m.value(a)));
  const out: { row: FormRow; rank: number | null; value: number }[] = [];
  ranked.forEach((row, i) => {
    const value = m.value(row);
    const prev = out[i - 1];
    out.push({ row, value, rank: prev && prev.value === value ? prev.rank : i + 1 });
  });
  for (const row of rows) if (m.needsHoles && row.holes === 0) out.push({ row, rank: null, value: 0 });
  return out;
}
