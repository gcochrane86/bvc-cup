import { describe, it, expect } from 'vitest';
import { buildEventView, defaultRoundId, findGroup, firstIncompleteHole } from './view';
import type { RoundRow, ScoreRow, Snapshot } from './data/types';
import type { Slot, Team } from './scoring';

const baseRound: RoundRow = {
  id: 'r1', event_id: 'e', course_id: 'c', round_no: 1, date: '2026-10-01', name: 'Day 1',
  allowance_pct: 90, better_ball_points: 1, singles_enabled: false, singles_points: 0.5, singles_allowance_pct: 90,
};

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    event: { id: 'e', name: 'Cup', team_a_name: 'Blue', team_a_colour: '#00f', team_b_name: 'Red', team_b_colour: '#f00', is_active: true },
    players: [],
    courses: [{ id: 'c', name: 'Links' }],
    courseHoles: Array.from({ length: 18 }, (_, i) => ({ course_id: 'c', hole: i + 1, par: 4, stroke_index: i + 1 })),
    eventPlayers: ['a1', 'a2', 'b1', 'b2'].map((id) => ({ event_id: 'e', player_id: id, team: id[0].toUpperCase() as Team, handicap: 10 })),
    rounds: [baseRound],
    groups: [{ id: 'g1', round_id: 'r1', group_no: 1, tee_time: '09:00:00' }],
    groupPlayers: (['A1', 'A2', 'B1', 'B2'] as Slot[]).map((slot) => ({ group_id: 'g1', slot, player_id: slot.toLowerCase() })),
    scores: [],
    results: [],
    ...over,
  };
}

const hole1AWins: ScoreRow[] = ['a1', 'a2', 'b1', 'b2'].map((p) => ({
  round_id: 'r1', player_id: p, hole: 1, gross: p.startsWith('a') ? 4 : 5, picked_up: false, client_updated_at: '2026-10-01T09:10:00Z',
}));

describe('buildEventView', () => {
  it('is null without an active event', () => {
    expect(buildEventView(snapshot({ event: null }))).toBeNull();
  });

  it('derives match state and the tracker', () => {
    const v = buildEventView(snapshot({ scores: hole1AWins }))!;
    const m = v.rounds[0].groups[0].matches[0];
    expect(m.state).toMatchObject({ statusText: '1 UP', thru: 1 });
    expect(v.tracker).toMatchObject({ confirmedA: 0, projectedA: 1, projectedB: 0, total: 1, toWin: 1 });
    expect(v.teamOf).toMatchObject({ a1: 'A', b2: 'B' });
  });

  it('uses the confirmed result over current scores', () => {
    const v = buildEventView(
      snapshot({
        scores: hole1AWins,
        results: [{ group_id: 'g1', match_type: 'better_ball', winner: 'B', points_a: 0, points_b: 1, result_text: '2&1', final_hole: 17, confirmed_at: 'x' }],
      }),
    )!;
    expect(v.tracker).toMatchObject({ confirmedB: 1, projectedB: 1, projectedA: 0 });
    expect(v.rounds[0].completed).toBe(1);
    expect(v.rounds[0].groups[0].matches[0].result).toMatchObject({ winner: 'B', pointsB: 1, finalHole: 17 });
  });

  it('counts singles points in the total available', () => {
    const v = buildEventView(snapshot({ rounds: [baseRound, { ...baseRound, id: 'r2', round_no: 2, singles_enabled: true }] }))!;
    expect(v.tracker.total).toBe(3);
    expect(v.tracker.toWin).toBe(2);
  });

  it('survives an incomplete group', () => {
    const s = snapshot();
    const v = buildEventView({ ...s, groupPlayers: s.groupPlayers.slice(0, 3) })!;
    expect(v.rounds[0].groups[0].matches).toEqual([]);
    expect(v.tracker.total).toBe(1);
  });

  it('finds groups and the first incomplete hole', () => {
    const v = buildEventView(snapshot({ scores: hole1AWins }))!;
    const found = findGroup(v, 'g1')!;
    expect(found.round.round.id).toBe('r1');
    expect(firstIncompleteHole(found.group, found.round.holes)).toBe(2);
    expect(findGroup(v, 'nope')).toBeNull();
  });
});

describe('defaultRoundId', () => {
  const r = (id: string, date: string | null, round_no: number): RoundRow => ({ ...baseRound, id, date, round_no });
  const rounds = [r('d1', '2026-10-01', 1), r('d2', '2026-10-02', 2), r('d3', '2026-10-03', 3)];
  it('picks today’s round', () => expect(defaultRoundId(rounds, '2026-10-02')).toBe('d2'));
  it('picks the next round before the trip', () => expect(defaultRoundId(rounds, '2026-09-27')).toBe('d1'));
  it('picks the last round after the trip', () => expect(defaultRoundId(rounds, '2026-11-01')).toBe('d3'));
  it('is null with no rounds', () => expect(defaultRoundId([], '2026-10-01')).toBeNull());
});
