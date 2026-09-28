import { describe, it, expect } from 'vitest';
import { computeForm, rankForm } from './form';
import { buildEventView } from './view';
import type { RoundRow, ScoreRow, Snapshot } from './data/types';
import type { Slot, Team } from './scoring';

const round = (id: string, round_no: number): RoundRow => ({
  id, event_id: 'e', course_id: 'c', round_no, date: null, name: `Day ${round_no}`,
  allowance_pct: 90, better_ball_points: 1, singles_enabled: false, singles_points: 0.5, singles_allowance_pct: 90,
  singles_pairing: 'handicap',
});
const score = (round_id: string, player_id: string, hole: number, gross: number | null): ScoreRow => ({
  round_id, player_id, hole, gross, picked_up: gross === null, client_updated_at: '2026-10-01T09:00:00Z',
});

// Par 4 everywhere, SI = hole; everyone off 10 (no slope/rating), so 1 shot on holes 1–10.
function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    event: { id: 'e', name: 'Cup', team_a_name: 'Blue', team_a_colour: '#00f', team_b_name: 'Red', team_b_colour: '#f00', is_active: true, show_form: true },
    players: [],
    courses: [{ id: 'c', name: 'Links', slope_rating: null, course_rating: null }],
    courseHoles: Array.from({ length: 18 }, (_, i) => ({ course_id: 'c', hole: i + 1, par: 4, stroke_index: i + 1 })),
    eventPlayers: ['a1', 'a2', 'b1', 'b2'].map((id) => ({ event_id: 'e', player_id: id, team: id[0].toUpperCase() as Team, handicap: 10 })),
    rounds: [round('r1', 1), round('r2', 2)],
    groups: [
      { id: 'g1', round_id: 'r1', group_no: 1, tee_time: null, singles_crossed: false },
      { id: 'g2', round_id: 'r2', group_no: 1, tee_time: null, singles_crossed: false },
    ],
    groupPlayers: ['g1', 'g2'].flatMap((g) =>
      (['A1', 'A2', 'B1', 'B2'] as Slot[]).map((slot) => ({ group_id: g, slot, player_id: slot.toLowerCase(), handicap: null })),
    ),
    scores: [
      score('r1', 'a1', 1, 3), // birdie (net eagle)
      score('r1', 'a1', 2, 7), // treble bogey
      score('r1', 'a1', 3, null), // picked up
      score('r1', 'b1', 1, 4), // par
      score('r2', 'b1', 1, 3), // Day 2 birdie
    ],
    results: [
      { group_id: 'g1', match_type: 'better_ball', winner: 'A', points_a: 1, points_b: 0, result_text: '2&1', final_hole: 17, confirmed_at: 'x' },
    ],
    ...over,
  };
}
const row = (rows: ReturnType<typeof computeForm>, id: string) => rows.find((r) => r.playerId === id)!;

describe('form', () => {
  it('totals gross and net over completed holes, leaving pick-ups out', () => {
    const rows = computeForm(buildEventView(snapshot())!, 'r1');
    expect(row(rows, 'a1')).toMatchObject({ holes: 2, gross: 10, grossToPar: 2, net: 8, netToPar: 0 });
    expect(row(rows, 'b1')).toMatchObject({ holes: 1, gross: 4, grossToPar: 0, net: 3, netToPar: -1 });
  });

  it('counts birdies and treble bogeys or worse (pick-ups included)', () => {
    const rows = computeForm(buildEventView(snapshot())!, 'r1');
    expect(row(rows, 'a1')).toMatchObject({ birdies: 1, trebles: 2 });
    expect(row(rows, 'b1')).toMatchObject({ birdies: 0, trebles: 0 });
  });

  it("gives each player their side's points from confirmed matches", () => {
    const rows = computeForm(buildEventView(snapshot())!, null);
    expect(['a1', 'a2', 'b1', 'b2'].map((id) => row(rows, id).points)).toEqual([1, 1, 0, 0]);
  });

  it('scores stableford: 2 for net par, +1 per shot better, 0 for a pick-up', () => {
    const rows = computeForm(buildEventView(snapshot())!, 'r1');
    // a1: hole 1 gross 3 − 1 shot = net 2 (4 pts); hole 2 net 6 (0); hole 3 picked up (0) → 4 over 3 holes
    expect(row(rows, 'a1')).toMatchObject({ stableford: 4, pickups: 1 });
    // b1: hole 1 gross 4 − 1 shot = net 3 (3 pts)
    expect(row(rows, 'b1')).toMatchObject({ stableford: 3, pickups: 0 });
    expect(rankForm(rows, 'stableford').map((r) => [r.row.playerId, r.rank])).toEqual([['a1', 1], ['b1', 2], ['a2', 3], ['b2', 3]]);
  });

  it('can cover all days or one day', () => {
    const view = buildEventView(snapshot())!;
    expect(row(computeForm(view, null), 'b1')).toMatchObject({ holes: 2, birdies: 1 });
    expect(row(computeForm(view, 'r2'), 'b1')).toMatchObject({ holes: 1, birdies: 1, gross: 3 });
    expect(row(computeForm(view, 'r2'), 'a1')).toMatchObject({ holes: 0, points: 0 });
  });

  it('ranks best to par first, with players yet to play at the bottom', () => {
    const ranked = rankForm(computeForm(buildEventView(snapshot())!, 'r1'), 'net');
    expect(ranked.map((r) => [r.row.playerId, r.rank])).toEqual([['b1', 1], ['a1', 2], ['a2', null], ['b2', null]]);
  });

  it('ranks counts most first and shares the rank on a tie', () => {
    const ranked = rankForm(computeForm(buildEventView(snapshot())!, null), 'points');
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3, 3]);
    expect(rankForm(computeForm(buildEventView(snapshot())!, 'r1'), 'trebles')[0].row.playerId).toBe('a1');
  });
});
