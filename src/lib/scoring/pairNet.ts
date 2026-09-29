import { playerHole, scoreKey, type ScoreIndex } from './matchState';
import { strokesOnHole } from './strokes';
import type { HoleInfo } from './types';

export interface PairNet {
  /** The pair's better-ball net score against par, over the holes counted. */
  toPar: number;
  /** Holes counted (both players have an entry). */
  thru: number;
}

/**
 * A pair's better-ball net score to par, off each player's full course handicap. Only holes where both
 * players have an entry count; a pick-up leaves it to the partner, and both picking up counts as net
 * double bogey (a Stableford 0). Players on another tee use that tee's par and stroke index. Null before
 * the pair has played a hole.
 */
export function pairNet(
  ids: string[],
  holes: HoleInfo[],
  idx: ScoreIndex,
  courseHcp: Record<string, number>,
  teeHoles?: Record<string, HoleInfo[]>,
): PairNet | null {
  let toPar = 0;
  let thru = 0;
  for (const h of holes) {
    const entries = ids.map((id) => idx.get(scoreKey(id, h.hole)));
    if (entries.some((e) => !e)) continue;
    const nets = ids
      .map((id, i) => ({ id, e: entries[i]! }))
      .filter(({ e }) => !e.pickedUp && e.gross !== null)
      .map(({ id, e }) => {
        const own = playerHole({ teeHoles }, id, h);
        return e.gross! - strokesOnHole(courseHcp[id] ?? 0, own.strokeIndex) - own.par;
      });
    toPar += nets.length ? Math.min(...nets) : 2;
    thru++;
  }
  return thru ? { toPar, thru } : null;
}

/** 'E', '+2' or '−3' (a true minus sign). */
export function formatToPar(n: number): string {
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `−${-n}`;
}
