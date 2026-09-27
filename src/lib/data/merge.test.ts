import { describe, it, expect } from 'vitest';
import { applyPending, hasPendingFor, removeScoreRow, upsertScoreRow } from './merge';
import type { PendingScore } from './outbox';
import type { ScoreRow } from './types';

const row = (hole: number, gross: number | null, at: string): ScoreRow => ({
  round_id: 'r', player_id: 'x', hole, gross, picked_up: gross === null, client_updated_at: at,
});
const pend = (hole: number, gross: number | null, at: string, pickedUp = false): PendingScore => ({
  roundId: 'r', playerId: 'x', hole, gross, pickedUp, clientUpdatedAt: at,
});

describe('score merging', () => {
  it('upserts by round/player/hole', () => {
    const rows = upsertScoreRow([row(1, 4, '2026-10-01T10:00:00Z')], row(1, 5, '2026-10-01T10:01:00Z'));
    expect(rows).toEqual([row(1, 5, '2026-10-01T10:01:00Z')]);
  });

  it('removes by key', () => {
    expect(removeScoreRow([row(1, 4, 'x'), row(2, 4, 'x')], { round_id: 'r', player_id: 'x', hole: 1 })).toEqual([row(2, 4, 'x')]);
  });

  it('lays newer pending entries over server rows', () => {
    const rows = applyPending([row(1, 4, '2026-10-01T10:00:00+00:00')], [pend(1, 6, '2026-10-01T10:05:00.000Z')]);
    expect(rows[0].gross).toBe(6);
  });

  it('never lets an older pending entry replace a newer server row', () => {
    const rows = applyPending([row(1, 4, '2026-10-01T10:05:00+00:00')], [pend(1, 6, '2026-10-01T10:00:00.000Z')]);
    expect(rows[0].gross).toBe(4);
  });

  it('applies a pending clear as a removal', () => {
    expect(applyPending([row(1, 4, '2026-10-01T10:00:00Z')], [pend(1, null, '2026-10-01T10:05:00Z')])).toEqual([]);
  });

  it('applies a pending pick-up', () => {
    const rows = applyPending([], [pend(3, null, '2026-10-01T10:05:00Z', true)]);
    expect(rows).toEqual([{ round_id: 'r', player_id: 'x', hole: 3, gross: null, picked_up: true, client_updated_at: '2026-10-01T10:05:00Z' }]);
  });

  it('detects pending scores for a match’s players', () => {
    const pending = [pend(1, 4, 'x')];
    expect(hasPendingFor(pending, 'r', ['x', 'y'])).toBe(true);
    expect(hasPendingFor(pending, 'r', ['y'])).toBe(false);
    expect(hasPendingFor(pending, 'other', ['x'])).toBe(false);
  });
});
