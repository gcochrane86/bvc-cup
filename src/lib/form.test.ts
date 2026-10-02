import { describe, it, expect } from 'vitest';
import { computeForm, computePairForm, rankForm } from './form';
import { buildEventView } from './view';
import type { RoundRow, ScoreRow, Snapshot } from './data/types';
import type { Slot, Team } from './scoring';

const round = (id: string, round_no: number): RoundRow => ({
  id, event_id: 'e', course_id: 'c', round_no, date: null, name: `Day ${round_no}`,
  allowance_pct: 90, better_ball_points: 1, singles_enabled: false, singles_points: 0.5, singles_allowance_pct: 90,
  singles_pairing: 'handicap', fourball_format: 'matchplay', scramble_low_pct: 35, scramble_high_pct: 35, pair_game: 'stableford_match', three_game: 'six_stableford', stableford_pct: 100, match_pct: 85, match_off_low: true,
});
const score = (round_id: string, player_id: string, hole: number, gross: number | null): ScoreRow => ({
  round_id, player_id, hole, gross, picked_up: gross === null, client_updated_at: '2026-10-01T09:00:00Z',
});

// Par 4 everywhere, SI = hole; everyone off 10 (no slope/rating), so 1 shot on holes 1–10.
function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    event: { id: 'e', name: 'Cup', team_a_name: 'Blue', team_a_colour: '#00f', team_b_name: 'Red', team_b_colour: '#f00', is_active: true, show_form: true, show_leaderboard: true, show_photos: true, watch_token: null, kind: 'team', season: false, points: { fourball: { win: 2, halve: 1 }, singles: { win: 1, halve: 0.5 }, one_v_one: { win: 1, halve: 0.5 }, two_v_one_single: { win: 2, halve: 1 }, two_v_one_pair: { win: 1, halve: 0.5 } }, },
    players: [],
    courses: [{ id: 'c', name: 'Links', tee: null, slope_rating: null, course_rating: null }],
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
    roundTees: [],
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

  it("scores a player on another tee against that tee's par", () => {
    const s = snapshot();
    const c2Holes = s.courseHoles.map((h) => ({ ...h, course_id: 'c2', ...(h.hole === 1 ? { par: 5 } : {}) }));
    const view = buildEventView({
      ...s,
      courses: [...s.courses, { id: 'c2', name: 'Links', tee: 'Red', slope_rating: null, course_rating: null }],
      courseHoles: [...s.courseHoles, ...c2Holes],
      roundTees: [{ round_id: 'r1', player_id: 'b1', course_id: 'c2' }],
    })!;
    // b1's 4 on hole 1 is now on a par 5: gross −1, a birdie.
    expect(row(computeForm(view, 'r1'), 'b1')).toMatchObject({ grossToPar: -1, birdies: 1 });
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

describe('pair form', () => {
  // Everyone off 10: a shot on holes 1 and 2 (SI 1, 2), par 4.
  const pairSnapshot = (over: Partial<Snapshot> = {}) =>
    snapshot({
      scores: [
        score('r1', 'a1', 1, 3), score('r1', 'a2', 1, 5), score('r1', 'b1', 1, 4), score('r1', 'b2', 1, null), // b2 picked up
        score('r1', 'a1', 2, null), score('r1', 'a2', 2, null), score('r1', 'b1', 2, 5), score('r1', 'b2', 2, 6), // both As picked up
        score('r2', 'a1', 1, 4), score('r2', 'a2', 1, 4), score('r2', 'b1', 1, 4), score('r2', 'b2', 1, 4),
        score('r2', 'a1', 2, 4), // a2 has no score on r2 hole 2: not counted yet
      ],
      ...over,
    });
  const pair = (rows: ReturnType<typeof computePairForm>, a: string, b: string) => rows.find((r) => r.key === [a, b].sort().join('+'))!;

  it('counts a pair on better ball over the days chosen, adding up days with the same pair', () => {
    const rows = computePairForm(buildEventView(pairSnapshot())!, null);
    expect(rows).toHaveLength(2);
    expect(pair(rows, 'a1', 'a2')).toMatchObject({ team: 'A', playerIds: ['a1', 'a2'], holes: 3, grossToPar: 1, netToPar: -1, stableford: 7, birdies: 1, trebles: 1, points: 1 });
    expect(pair(rows, 'b1', 'b2')).toMatchObject({ team: 'B', holes: 3, grossToPar: 1, netToPar: -2, stableford: 8, birdies: 0, trebles: 0, points: 0 });
  });

  it('can cover one day', () => {
    expect(pair(computePairForm(buildEventView(pairSnapshot())!, 'r2'), 'b1', 'b2')).toMatchObject({ holes: 1, netToPar: -1, points: 0 });
  });

  it('gives a different pairing its own row', () => {
    const s = pairSnapshot();
    const v = buildEventView({
      ...s,
      eventPlayers: [...s.eventPlayers, { event_id: 'e', player_id: 'a3', team: 'A', handicap: 10 }],
      groupPlayers: s.groupPlayers.map((gp) => (gp.group_id === 'g2' && gp.slot === 'A2' ? { ...gp, player_id: 'a3' } : gp)),
    })!;
    expect(computePairForm(v, null).map((r) => r.key).sort()).toEqual(['a1+a2', 'a1+a3', 'b1+b2']);
  });

  it('ranks pairs with the same rules as players', () => {
    const ranked = rankForm(computePairForm(buildEventView(pairSnapshot())!, null), 'net');
    expect(ranked.map((r) => [r.row.key, r.rank])).toEqual([['b1+b2', 1], ['a1+a2', 2]]);
  });
});

describe('form on scramble days', () => {
  // Everyone off 10 (team handicap 7): hole 9 is SI 9 — a shot off full handicaps, none off the team's 7.
  const scrambleSnap = () =>
    snapshot({
      rounds: [{ ...round('r1', 1), fourball_format: 'scramble' }, round('r2', 2)],
      scores: ['a1', 'a2', 'b1', 'b2'].map((p) => score('r1', p, 9, 4)),
      results: [],
    });
  it("leaves scramble days out of individual rankings (team scores are not anyone's own)", () => {
    const rows = computeForm(buildEventView(scrambleSnap())!, null);
    expect(rows.every((r) => r.holes === 0)).toBe(true);
  });
  it("counts scramble days for pairs, off the team's handicap", () => {
    const rows = computePairForm(buildEventView(scrambleSnap())!, null);
    expect(rows.find((r) => r.key === 'a1+a2')).toMatchObject({ holes: 1, grossToPar: 0, netToPar: 0, stableford: 2 });
  });
});

describe('season events', () => {
  it("credits a 2 v 1's points to each golfer by what they earned, not by team totals", () => {
    const s = snapshot({
      event: { ...snapshot().event!, season: true },
      rounds: [{ ...round('r1', 1), three_game: 'two_v_one' }],
      groups: [{ id: 'g1', round_id: 'r1', group_no: 1, tee_time: null, singles_crossed: false }],
      groupPlayers: [
        { group_id: 'g1', slot: 'P1', player_id: 'b1', handicap: null },
        { group_id: 'g1', slot: 'P2', player_id: 'a1', handicap: null },
        { group_id: 'g1', slot: 'P3', player_id: 'a2', handicap: null },
      ],
      scores: [],
      // The single (b1, Team B) won: Team B 2, Team A 0.
      results: [{ group_id: 'g1', match_type: 'individual', winner: 'A', points_a: 0, points_b: 2, result_text: 'By 3 pts', final_hole: 18, confirmed_at: 'x' }],
    });
    const rows = computeForm(buildEventView(s)!, null);
    const pts = Object.fromEntries(rows.map((r) => [r.playerId, r.points]));
    expect(pts).toMatchObject({ b1: 2, a1: 0, a2: 0 });
  });
});
