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
    // Wolf: a score edit that doesn't say keeps who was on their own.
    const lone = p.lone ?? existing?.lone;
    if (lone !== undefined) row.lone = lone;
    if (existing && p.ifAbsent) continue; // a par default never replaces a real score
    if (existing && Date.parse(existing.client_updated_at) >= Date.parse(p.clientUpdatedAt)) continue;
    out = p.gross === null && !p.pickedUp ? removeScoreRow(out, row) : upsertScoreRow(out, row);
  }
  return out;
}

export function hasPendingFor(pending: PendingScore[], roundId: string, playerIds: string[]): boolean {
  return pending.some((p) => p.roundId === roundId && playerIds.includes(p.playerId));
}

/** The server's view of the active event, as returned by the cheap catch-up check. */
export interface RemoteVersion {
  scores: number;
  /** Newest server change time (updated_at) among the server's scores. */
  latest: string | null;
  results: number;
}

/** True when local state has missed a change (e.g. Realtime dropped messages under its rate limit). */
export function isBehind(rows: ScoreRow[], results: number, remote: RemoteVersion): boolean {
  if (rows.length !== remote.scores || results !== remote.results) return true;
  if (remote.latest === null) return false;
  // The server's own change time, not the phones' typing times: a real score typed earlier on a phone with
  // no signal can reach the server after this phone's own (later-typed) entries.
  const localLatest = Math.max(-Infinity, ...rows.filter((r) => r.updated_at).map((r) => Date.parse(r.updated_at!)));
  return Date.parse(remote.latest) > localLatest;
}
