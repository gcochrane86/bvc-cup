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
          const own = g.teeHoles[pid]?.find((x) => x.hole === h.hole) ?? h; // the player's own tee
          const net = e.gross - strokesOnHole(courseHcp, own.strokeIndex);
          r.holes++;
          r.gross += e.gross;
          r.grossToPar += e.gross - own.par;
          r.net += net;
          r.netToPar += net - own.par;
          r.stableford += Math.max(0, 2 + own.par - net);
          if (e.gross <= own.par - 1) r.birdies++;
          if (e.gross >= own.par + 3) r.trebles++;
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

/** A fourball pair's better-ball form: the pair's best score on each hole (both players entered). */
export interface PairFormRow {
  /** The two player ids, sorted and joined — the same pair on several days is one row. */
  key: string;
  playerIds: [string, string];
  team: Team;
  holes: number;
  /** Best gross to par per hole (each player's own tee par); both picked up counts +2. */
  grossToPar: number;
  /** Best net to par per hole off full course handicaps; both picked up counts +2. */
  netToPar: number;
  /** Best Stableford points per hole (0 when both picked up). */
  stableford: number;
  /** Points from the pair's confirmed fourball matches. */
  points: number;
  /** Holes where the pair's best gross was a birdie or better. */
  birdies: number;
  /** Holes where the pair's best gross was a treble bogey or worse, or both picked up. */
  trebles: number;
}

export function computePairForm(view: EventView, roundId: string | null): PairFormRow[] {
  const rows = new Map<string, PairFormRow>();
  for (const rv of view.rounds) {
    if (roundId && rv.round.id !== roundId) continue;
    for (const g of rv.groups) {
      const fourball = g.matches.find((m) => m.def.type === 'better_ball');
      if (!fourball) continue;
      for (const [side, team] of [[fourball.def.sideA, 'A'], [fourball.def.sideB, 'B']] as const) {
        const ids = [...side].sort() as [string, string];
        const key = ids.join('+');
        const r = rows.get(key) ?? { key, playerIds: ids, team, holes: 0, grossToPar: 0, netToPar: 0, stableford: 0, points: 0, birdies: 0, trebles: 0 };
        rows.set(key, r);
        for (const h of rv.holes) {
          const entries = ids.map((id) => g.scores.get(scoreKey(id, h.hole)));
          if (entries.some((e) => !e)) continue; // count a hole once both players have a score in
          r.holes++;
          const played = ids
            .map((id, i) => ({ id, e: entries[i]! }))
            .filter(({ e }) => !e.pickedUp && e.gross !== null)
            .map(({ id, e }) => {
              const own = g.teeHoles[id]?.find((x) => x.hole === h.hole) ?? h;
              const net = e.gross! - strokesOnHole(g.playingHcp[id] ?? 0, own.strokeIndex);
              return { gross: e.gross! - own.par, net: net - own.par, points: Math.max(0, 2 + own.par - net) };
            });
          if (!played.length) {
            r.grossToPar += 2;
            r.netToPar += 2;
            r.trebles++;
            continue;
          }
          const bestGross = Math.min(...played.map((x) => x.gross));
          r.grossToPar += bestGross;
          r.netToPar += Math.min(...played.map((x) => x.net));
          r.stableford += Math.max(...played.map((x) => x.points));
          if (bestGross <= -1) r.birdies++;
          if (bestGross >= 3) r.trebles++;
        }
        if (fourball.result) r.points += team === 'A' ? fourball.result.pointsA : fourball.result.pointsB;
      }
    }
  }
  return [...rows.values()];
}

/** What rankForm needs from a player's or a pair's row. */
type Ranked = Pick<FormRow, 'holes' | 'grossToPar' | 'netToPar' | 'stableford' | 'points' | 'birdies' | 'trebles'>;

const METRICS: Record<FormMetric, { value: (r: Ranked) => number; lowestFirst: boolean; needsHoles: boolean }> = {
  gross: { value: (r) => r.grossToPar, lowestFirst: true, needsHoles: true },
  net: { value: (r) => r.netToPar, lowestFirst: true, needsHoles: true },
  stableford: { value: (r) => r.stableford, lowestFirst: false, needsHoles: false },
  points: { value: (r) => r.points, lowestFirst: false, needsHoles: false },
  birdies: { value: (r) => r.birdies, lowestFirst: false, needsHoles: false },
  trebles: { value: (r) => r.trebles, lowestFirst: false, needsHoles: false },
};

/** Rows in ranking order; tied values share a rank (1, 1, 3). Players yet to play rank null for gross/net. */
export function rankForm<T extends Ranked>(rows: T[], metric: FormMetric): { row: T; rank: number | null; value: number }[] {
  const m = METRICS[metric];
  const ranked = rows
    .filter((r) => !m.needsHoles || r.holes > 0)
    .sort((a, b) => (m.lowestFirst ? m.value(a) - m.value(b) : m.value(b) - m.value(a)));
  const out: { row: T; rank: number | null; value: number }[] = [];
  ranked.forEach((row, i) => {
    const value = m.value(row);
    const prev = out[i - 1];
    out.push({ row, value, rank: prev && prev.value === value ? prev.rank : i + 1 });
  });
  for (const row of rows) if (m.needsHoles && row.holes === 0) out.push({ row, rank: null, value: 0 });
  return out;
}
