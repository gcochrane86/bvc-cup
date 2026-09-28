import { describe, it, expect } from 'vitest';
import { buildEventView, defaultRoundId, findGroup, firstIncompleteHole, matchLabel, matchesLabel, pairingLabel, resumeGroupId, scoringList } from './view';
import type { RoundRow, ScoreRow, Snapshot } from './data/types';
import type { Slot, Team } from './scoring';

const baseRound: RoundRow = {
  id: 'r1', event_id: 'e', course_id: 'c', round_no: 1, date: '2026-10-01', name: 'Day 1',
  allowance_pct: 90, better_ball_points: 1, singles_enabled: false, singles_points: 0.5, singles_allowance_pct: 90,
  singles_pairing: 'handicap',
};

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    event: { id: 'e', name: 'Cup', team_a_name: 'Blue', team_a_colour: '#00f', team_b_name: 'Red', team_b_colour: '#f00', is_active: true, show_form: false },
    players: [],
    courses: [{ id: 'c', name: 'Links', slope_rating: null, course_rating: null }],
    courseHoles: Array.from({ length: 18 }, (_, i) => ({ course_id: 'c', hole: i + 1, par: 4, stroke_index: i + 1 })),
    eventPlayers: ['a1', 'a2', 'b1', 'b2'].map((id) => ({ event_id: 'e', player_id: id, team: id[0].toUpperCase() as Team, handicap: 10 })),
    rounds: [baseRound],
    groups: [{ id: 'g1', round_id: 'r1', group_no: 1, tee_time: '09:00:00', singles_crossed: false }],
    groupPlayers: (['A1', 'A2', 'B1', 'B2'] as Slot[]).map((slot) => ({ group_id: 'g1', slot, player_id: slot.toLowerCase(), handicap: null })),
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
    expect(v.tracker.toWin).toBe(1.75); // ½-point singles can be halved: ¼ steps
  });

  it('totals 9 with no singles, 12 with ½-point singles on one day, and breaks it down per round', () => {
    const r = (id: string, n: number, singles: boolean) => ({ ...baseRound, id, round_no: n, singles_enabled: singles });
    const players = Array.from({ length: 12 }, (_, i) => ({ event_id: 'e', player_id: `p${i}`, team: (i < 6 ? 'A' : 'B') as Team, handicap: 10 }));
    const off = buildEventView(snapshot({ eventPlayers: players, rounds: [r('d1', 1, false), r('d2', 2, false), r('d3', 3, false)] }))!;
    expect(off.tracker).toMatchObject({ total: 9, toWin: 5 });
    const on = buildEventView(snapshot({ eventPlayers: players, rounds: [r('d1', 1, false), r('d2', 2, false), r('d3', 3, true)] }))!;
    expect(on.tracker).toMatchObject({ total: 12, toWin: 6.25 });
    expect(on.rounds.map((x) => x.pointsAvailable)).toEqual([3, 3, 6]);
  });

  it('survives an incomplete group', () => {
    const s = snapshot();
    const v = buildEventView({ ...s, groupPlayers: s.groupPlayers.slice(0, 3) })!;
    expect(v.rounds[0].groups[0].matches).toEqual([]);
    expect(v.tracker.total).toBe(1);
  });

  it('plays off frozen handicaps when a group has them, current ones otherwise', () => {
    const s = snapshot();
    // Current event handicaps: all 10. Group frozen at a1 4, a2 18, b1 9, b2 14.
    const frozen = { A1: 4, A2: 18, B1: 9, B2: 14 } as Record<string, number>;
    const v = buildEventView({ ...s, groupPlayers: s.groupPlayers.map((gp) => ({ ...gp, handicap: frozen[gp.slot] })) })!;
    expect(v.rounds[0].groups[0].matches[0].def.strokes).toEqual({ a1: 0, a2: 13, b1: 5, b2: 9 });
    const live = buildEventView(s)!;
    expect(live.rounds[0].groups[0].matches[0].def.strokes).toEqual({ a1: 0, a2: 0, b1: 0, b2: 0 });
  });

  it('converts each index to a course handicap with the round’s slope and rating', () => {
    const s = snapshot();
    const idx: Record<string, number> = { a1: 4, a2: 18, b1: 9, b2: 14 };
    const v = buildEventView({
      ...s,
      courses: [{ id: 'c', name: 'Links', slope_rating: 125, course_rating: 71.3 }],
      eventPlayers: s.eventPlayers.map((ep) => ({ ...ep, handicap: idx[ep.player_id] })),
    })!;
    const g = v.rounds[0].groups[0];
    // CH = index × 125/113 + (71.3 − 72): 3.72→4, 19.21→19, 9.26→9, 14.79→15
    expect(g.playingHcp).toEqual({ a1: 4, a2: 19, b1: 9, b2: 15 });
    // 90% of the gaps from 4: 13.5→14, 4.5→5, 9.9→10
    expect(g.matches[0].def.strokes).toEqual({ a1: 0, a2: 14, b1: 5, b2: 10 });
  });

  it('finds groups and the first incomplete hole', () => {
    const v = buildEventView(snapshot({ scores: hole1AWins }))!;
    const found = findGroup(v, 'g1')!;
    expect(found.round.round.id).toBe('r1');
    expect(firstIncompleteHole(found.group, found.round.holes)).toBe(2);
    expect(findGroup(v, 'nope')).toBeNull();
  });
});

describe('singles', () => {
  it('are labelled Singles 1 and Singles 2', () => {
    expect([matchLabel('better_ball'), matchLabel('low_singles'), matchLabel('high_singles')]).toEqual(['Fourball', 'Singles 1', 'Singles 2']);
  });

  it('follow the group’s crossed line-up', () => {
    const s = snapshot({ rounds: [{ ...baseRound, singles_enabled: true }] });
    const v = buildEventView({ ...s, groups: s.groups.map((g) => ({ ...g, singles_crossed: true })) })!;
    const [, s1, s2] = v.rounds[0].groups[0].matches;
    expect([s1.def.sideA, s1.def.sideB, s2.def.sideA, s2.def.sideB]).toEqual([['a1'], ['b2'], ['a2'], ['b1']]);
  });
});

describe('match numbers', () => {
  it('numbers matches across the whole event: day, then group, then fourball/low/high', () => {
    const players = Array.from({ length: 8 }, (_, i) => ({ event_id: 'e', player_id: `p${i}`, team: (i % 2 ? 'B' : 'A') as Team, handicap: 10 }));
    const gp = (g: string, ids: string[]) =>
      (['A1', 'B1', 'A2', 'B2'] as Slot[]).map((slot, i) => ({ group_id: g, slot, player_id: ids[i], handicap: null }));
    const v = buildEventView(
      snapshot({
        eventPlayers: players,
        rounds: [{ ...baseRound, id: 'r2', round_no: 2, singles_enabled: true }, baseRound],
        groups: [
          { id: 'g2', round_id: 'r1', group_no: 2, tee_time: null, singles_crossed: false },
          { id: 'g1', round_id: 'r1', group_no: 1, tee_time: null, singles_crossed: false },
          { id: 'g3', round_id: 'r2', group_no: 1, tee_time: null, singles_crossed: false },
        ],
        groupPlayers: [...gp('g1', ['p0', 'p1', 'p2', 'p3']), ...gp('g2', ['p4', 'p5', 'p6', 'p7']), ...gp('g3', ['p0', 'p1', 'p2', 'p3'])],
      }),
    )!;
    const numbers = v.rounds.map((r) => r.groups.map((g) => g.matches.map((m) => `${m.def.id}=${m.number}`)));
    expect(numbers).toEqual([[['g1:better_ball=1'], ['g2:better_ball=2']], [['g3:better_ball=3', 'g3:low_singles=4', 'g3:high_singles=5']]]);
  });
});

describe('scoring list', () => {
  const confirmedBB = { group_id: 'g1', match_type: 'better_ball' as const, winner: 'A' as const, points_a: 1, points_b: 0, result_text: '2&1', final_hole: 17, confirmed_at: 'x' };

  it('lists every group still to be finished, by day', () => {
    const v = buildEventView(snapshot())!;
    expect(scoringList(v).map((d) => [d.round.round.id, d.groups.map((g) => g.group.id)])).toEqual([['r1', ['g1']]]);
  });

  it('drops a group once all its matches are confirmed', () => {
    const v = buildEventView(snapshot({ results: [confirmedBB] }))!;
    expect(scoringList(v)).toEqual([]);
  });

  it('keeps a singles-day group until its last match is confirmed', () => {
    const v = buildEventView(snapshot({ rounds: [{ ...baseRound, singles_enabled: true }], results: [confirmedBB] }))!;
    expect(scoringList(v)[0].groups.map((g) => g.group.id)).toEqual(['g1']);
  });

  it('skips groups without full pairings', () => {
    const s = snapshot();
    expect(scoringList(buildEventView({ ...s, groupPlayers: s.groupPlayers.slice(0, 3) })!)).toEqual([]);
  });

  it('resumes the remembered match while it is still being played', () => {
    const v = buildEventView(snapshot())!;
    expect(resumeGroupId('g1', scoringList(v))).toBe('g1');
  });

  it('forgets the remembered match once it is confirmed (or gone)', () => {
    expect(resumeGroupId('g1', scoringList(buildEventView(snapshot({ results: [confirmedBB] }))!))).toBeNull();
    expect(resumeGroupId('deleted', scoringList(buildEventView(snapshot())!))).toBeNull();
    expect(resumeGroupId(null, scoringList(buildEventView(snapshot())!))).toBeNull();
  });

  it('shows the pairing as surnames, Coleraine pair first', () => {
    const short: Record<string, string> = { a1: 'Cochrane', a2: 'Trimble', b1: 'McCaughey', b2: 'Connaughty' };
    const g = buildEventView(snapshot())!.rounds[0].groups[0];
    expect(pairingLabel(g, (id) => short[id])).toBe('Cochrane/Trimble vs Connaughty/McCaughey');
  });

  it('alphabetises each pair regardless of handicap slot', () => {
    const short: Record<string, string> = { a1: 'Trimble', a2: 'cochrane', b1: 'Reid', b2: 'Holmes' };
    const g = buildEventView(snapshot())!.rounds[0].groups[0];
    expect(pairingLabel(g, (id) => short[id])).toBe('cochrane/Trimble vs Holmes/Reid');
  });

  it('labels a group by its match numbers', () => {
    const v = buildEventView(snapshot({ rounds: [{ ...baseRound, singles_enabled: true }] }))!;
    expect(matchesLabel(v.rounds[0].groups[0])).toBe('Matches 1–3');
    expect(matchesLabel(buildEventView(snapshot())!.rounds[0].groups[0])).toBe('Match 1');
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
