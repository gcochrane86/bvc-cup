import type { PendingScore } from './outbox';
import type { ScoreRow } from './types';

type Key = Pick<ScoreRow, 'round_id' | 'player_id' | 'hole'>;

export const rowKey = (r: Key) => `${r.round_id}:${r.player_id}:${r.hole}`;

export function upsertScoreRow(rows: ScoreRow[], row: ScoreRow): ScoreRow[] {
  const k = rowKey(row);
  return [...rows.filter((r) => rowKey(r) !== k), row];
}

export function removeScoreRow(rows: ScoreRow[], key: Key): ScoreRow[] {
  const k = rowKey(key);
  return rows.filter((r) => rowKey(r) !== k);
}

/** Overlay not-yet-sent local edits, unless the server already has something newer. */
export function applyPending(rows: ScoreRow[], pending: PendingScore[]): ScoreRow[] {
  let out = rows;
  for (const p of pending) {
    const row: ScoreRow = {
      round_id: p.roundId,
      player_id: p.playerId,
      hole: p.hole,
      gross: p.gross,
      picked_up: p.pickedUp,
      client_updated_at: p.clientUpdatedAt,
    };
    const existing = out.find((r) => rowKey(r) === rowKey(row));
    if (existing && Date.parse(existing.client_updated_at) >= Date.parse(p.clientUpdatedAt)) continue;
    out = p.gross === null && !p.pickedUp ? removeScoreRow(out, row) : upsertScoreRow(out, row);
  }
  return out;
}

export function hasPendingFor(pending: PendingScore[], roundId: string, playerIds: string[]): boolean {
  return pending.some((p) => p.roundId === roundId && playerIds.includes(p.playerId));
}
