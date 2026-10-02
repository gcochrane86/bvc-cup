import { describe, it, expect } from 'vitest';
import { applyPending, hasPendingFor, isBehind, removeScoreRow, upsertScoreRow } from './merge';
import type { PendingScore } from './outbox';
import type { ScoreRow } from './types';

/** updatedAt: the server's change time (defaults to the typing time); null = not yet sent. */
const row = (hole: number, gross: number | null, at: string, updatedAt: string | null = at): ScoreRow => ({
  round_id: 'r', player_id: 'x', hole, gross, picked_up: gross === null, client_updated_at: at, updated_at: updatedAt ?? undefined,
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

  it('an if-absent default fills an empty cell locally', () => {
    const rows = applyPending([], [{ ...pend(1, 4, '2026-10-01T10:05:00Z'), ifAbsent: true }]);
    expect(rows.map((r) => r.gross)).toEqual([4]);
  });

  it('an if-absent default never replaces a known score, even an older one', () => {
    const rows = applyPending([row(1, 5, '2026-10-01T10:00:00Z')], [{ ...pend(1, 4, '2026-10-01T10:05:00Z'), ifAbsent: true }]);
    expect(rows.map((r) => r.gross)).toEqual([5]);
  });

  it('applies a pending pick-up', () => {
    const rows = applyPending([], [pend(3, null, '2026-10-01T10:05:00Z', true)]);
    expect(rows).toEqual([{ round_id: 'r', player_id: 'x', hole: 3, gross: null, picked_up: true, client_updated_at: '2026-10-01T10:05:00Z' }]);
  });

  it('wolf: a pending edit keeps who was on their own unless it says', () => {
    const saved = [{ round_id: 'r', player_id: 'x', hole: 3, gross: 4, picked_up: false, client_updated_at: '2026-10-01T10:00:00Z', lone: true }];
    expect(applyPending(saved, [pend(3, 5, '2026-10-01T10:05:00Z')])[0]).toMatchObject({ gross: 5, lone: true });
    expect(applyPending(saved, [{ ...pend(3, 4, '2026-10-01T10:05:00Z'), lone: false }])[0]).toMatchObject({ gross: 4, lone: false });
  });

  it('detects pending scores for a match’s players', () => {
    const pending = [pend(1, 4, 'x')];
    expect(hasPendingFor(pending, 'r', ['x', 'y'])).toBe(true);
    expect(hasPendingFor(pending, 'r', ['y'])).toBe(false);
    expect(hasPendingFor(pending, 'other', ['x'])).toBe(false);
  });
});

describe('isBehind', () => {
  const rows = [row(1, 4, '2026-10-01T10:00:00+00:00'), row(2, 5, '2026-10-01T10:05:00+00:00')];
  it('is up to date when counts and the latest edit match', () => {
    expect(isBehind(rows, 1, { scores: 2, latest: '2026-10-01T10:05:00.000Z', results: 1 })).toBe(false);
  });
  it('is behind when the server has more scores', () => {
    expect(isBehind(rows, 1, { scores: 3, latest: '2026-10-01T10:05:00.000Z', results: 1 })).toBe(true);
  });
  it('is behind when a score was edited on the server', () => {
    expect(isBehind(rows, 1, { scores: 2, latest: '2026-10-01T10:09:00.000Z', results: 1 })).toBe(true);
  });
  it('is behind when a result was confirmed or unlocked', () => {
    expect(isBehind(rows, 1, { scores: 2, latest: '2026-10-01T10:05:00.000Z', results: 0 })).toBe(true);
  });
  it("compares the server's change time, not the phones' typing times", () => {
    // This phone's own default was typed at 10:30, but the server last changed a score at 10:20 (a late real score
    // typed at 10:10 on a phone with no signal). The server change must still be noticed.
    const local = [row(1, 4, '2026-10-01T10:30:00Z', '2026-10-01T10:15:00Z'), row(2, 5, '2026-10-01T10:05:00Z')];
    expect(isBehind(local, 1, { scores: 2, latest: '2026-10-01T10:20:00Z', results: 1 })).toBe(true);
    expect(isBehind(local, 1, { scores: 2, latest: '2026-10-01T10:15:00Z', results: 1 })).toBe(false);
  });
  it("ignores this phone's unsent rows (no server time) when finding its latest", () => {
    const local = [row(1, 4, '2026-10-01T10:30:00Z', null), row(2, 5, '2026-10-01T10:05:00Z')];
    expect(isBehind(local, 1, { scores: 2, latest: '2026-10-01T10:20:00Z', results: 1 })).toBe(true);
  });
  it('is up to date with no scores anywhere', () => {
    expect(isBehind([], 0, { scores: 0, latest: null, results: 0 })).toBe(false);
  });
});
