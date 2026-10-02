import { describe, it, expect } from 'vitest';
import { buildEventView, defaultRoundId, onlyGroupId, findGroup, firstIncompleteHole, leaderboardRoundId, matchLabel, matchesLabel, pairingLabel, resumeGroupId, scoringList } from './view';
import type { RoundRow, ScoreRow, Snapshot } from './data/types';
import type { GroupView } from './view';
import type { Slot, Team } from './scoring';

const baseRound: RoundRow = {
  id: 'r1', event_id: 'e', course_id: 'c', round_no: 1, date: '2026-10-01', name: 'Day 1',
  allowance_pct: 90, better_ball_points: 1, singles_enabled: false, singles_points: 0.5, singles_allowance_pct: 90,
  singles_pairing: 'handicap', fourball_format: 'matchplay', scramble_low_pct: 35, scramble_high_pct: 35,
  pair_game: 'stableford_match', three_game: 'six_stableford', stableford_pct: 100, match_pct: 85, match_off_low: true,
};

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    event: { id: 'e', name: 'Cup', team_a_name: 'Blue', team_a_colour: '#00f', team_b_name: 'Red', team_b_colour: '#f00', is_active: true, show_form: false, show_leaderboard: true, show_photos: true, watch_token: null, kind: 'team', season: false, points: { fourball: { win: 2, halve: 1 }, singles: { win: 1, halve: 0.5 }, one_v_one: { win: 1, halve: 0.5 }, two_v_one_single: { win: 2, halve: 1 }, two_v_one_pair: { win: 1, halve: 0.5 } } },
    players: [],
    courses: [{ id: 'c', name: 'Links', tee: null, slope_rating: null, course_rating: null }],
    courseHoles: Array.from({ length: 18 }, (_, i) => ({ course_id: 'c', hole: i + 1, par: 4, stroke_index: i + 1 })),
    eventPlayers: ['a1', 'a2', 'b1', 'b2'].map((id) => ({ event_id: 'e', player_id: id, team: id[0].toUpperCase() as Team, handicap: 10 })),
    rounds: [baseRound],
    groups: [{ id: 'g1', round_id: 'r1', group_no: 1, tee_time: '09:00:00', singles_crossed: false }],
    groupPlayers: (['A1', 'A2', 'B1', 'B2'] as Slot[]).map((slot) => ({ group_id: 'g1', slot, player_id: slot.toLowerCase(), handicap: null })),
    scores: [],
    results: [],
    roundTees: [],
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
      courses: [{ id: 'c', name: 'Links', tee: null, slope_rating: 125, course_rating: 71.3 }],
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

describe('leaderboardRoundId', () => {
  // Day 1 (g1) dated 1 Oct, Day 2 (g2) dated 2 Oct.
  const twoDays = () =>
    snapshot({
      rounds: [baseRound, { ...baseRound, id: 'r2', round_no: 2, name: 'Day 2', date: '2026-10-02' }],
      groups: [
        { id: 'g1', round_id: 'r1', group_no: 1, tee_time: null, singles_crossed: false },
        { id: 'g2', round_id: 'r2', group_no: 1, tee_time: null, singles_crossed: false },
      ],
      groupPlayers: ['g1', 'g2'].flatMap((g) =>
        (['A1', 'A2', 'B1', 'B2'] as Slot[]).map((slot) => ({ group_id: g, slot, player_id: slot.toLowerCase(), handicap: null })),
      ),
    });

  const confirmed = (group_id: string) => ({ group_id, match_type: 'better_ball' as const, winner: 'A' as const, points_a: 1, points_b: 0, result_text: '2&1', final_hole: 17, confirmed_at: 'x' });

  it('opens on the day of the match this phone is scoring', () => {
    expect(leaderboardRoundId(buildEventView(twoDays())!, 'g2')).toBe('r2');
  });

  it("otherwise opens on Day 1 until all of Day 1's matches are confirmed", () => {
    expect(leaderboardRoundId(buildEventView(twoDays())!, null)).toBe('r1');
  });

  it('then moves on to the next day with a match still to confirm', () => {
    expect(leaderboardRoundId(buildEventView({ ...twoDays(), results: [confirmed('g1')] })!, null)).toBe('r2');
  });

  it('falls back the same way once the scored match is confirmed', () => {
    expect(leaderboardRoundId(buildEventView({ ...twoDays(), results: [confirmed('g1')] })!, 'g1')).toBe('r2');
  });

  it('stays on the last day once every match is confirmed', () => {
    expect(leaderboardRoundId(buildEventView({ ...twoDays(), results: [confirmed('g1'), confirmed('g2')] })!, null)).toBe('r2');
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

describe('tees', () => {
  // c2: a second tee of the same course — slope 113, rating 74, par 5 on hole 1 (SI 18), par 73 in all.
  const withTee = () => {
    const s = snapshot();
    const c2Holes = s.courseHoles.map((h) => ({ ...h, course_id: 'c2', ...(h.hole === 1 ? { par: 5, stroke_index: 18 } : {}) }));
    c2Holes.find((h) => h.hole === 18)!.stroke_index = 1; // hole 1 took SI 18
    return {
      ...s,
      courses: [...s.courses, { id: 'c2', name: 'Links', tee: 'White', slope_rating: 113, course_rating: 74 }],
      courseHoles: [...s.courseHoles, ...c2Holes],
      roundTees: [{ round_id: 'r1', player_id: 'a1', course_id: 'c2' }],
    };
  };
  it("gives a player on another tee that tee's holes, and a course handicap off it", () => {
    const g = buildEventView(withTee())!.rounds[0].groups[0];
    expect(g.teeOf.a1.id).toBe('c2');
    expect(g.teeHoles.a1.find((h) => h.hole === 1)).toMatchObject({ par: 5, strokeIndex: 18 });
    // index 10 × 113/113 + (74 − 73) = 11; everyone else plays the main tee off 10
    expect(g.playingHcp).toEqual({ a1: 11, a2: 10, b1: 10, b2: 10 });
    expect(g.matches[0].def.teeHoles?.a1).toBe(g.teeHoles.a1);
  });
  it('with nobody on another tee, matches carry no tee holes (results as before)', () => {
    const g = buildEventView(snapshot())!.rounds[0].groups[0];
    expect(g.teeOf).toEqual({});
    expect(g.matches[0].def.teeHoles).toBeUndefined();
  });
  it("ignores a player's tee from a different course (left over after the day's course changed)", () => {
    const s = withTee();
    const v = buildEventView({ ...s, courses: s.courses.map((c) => (c.id === 'c2' ? { ...c, name: 'Old Links' } : c)) })!;
    const g = v.rounds[0].groups[0];
    expect(g.teeOf).toEqual({});
    expect(g.playingHcp.a1).toBe(10);
  });
  it('ignores a tee row for a player who is not in the group', () => {
    const s = withTee();
    const v = buildEventView({ ...s, roundTees: [...s.roundTees, { round_id: 'r1', player_id: 'nobody', course_id: 'c2' }] })!;
    expect(Object.keys(v.rounds[0].groups[0].teeOf)).toEqual(['a1']);
  });
});

describe('onlyGroupId', () => {
  const g = (id: string) => ({ group: { id } }) as unknown as GroupView;
  it('is the single match left to score, so Scores can open it directly', () => {
    expect(onlyGroupId([{ groups: [g('x')] }])).toBe('x');
  });
  it('is null when there is a choice to make, or nothing to score', () => {
    expect(onlyGroupId([{ groups: [g('x')] }, { groups: [g('y')] }])).toBeNull();
    expect(onlyGroupId([{ groups: [g('x'), g('y')] }])).toBeNull();
    expect(onlyGroupId([])).toBeNull();
  });
});

describe('scramble days', () => {
  // Everyone off 10: a team handicap of 3.5 + 3.5 = 7 → no shot on hole 9 (SI 9), where full handicaps give one.
  const hole9 = ['a1', 'a2', 'b1', 'b2'].map((p) => ({
    round_id: 'r1', player_id: p, hole: 9, gross: 4, picked_up: false, client_updated_at: '2026-10-01T09:10:00Z',
  }));
  it("uses the team's scramble handicap for the pair net line", () => {
    const scramble = buildEventView(snapshot({ rounds: [{ ...baseRound, fourball_format: 'scramble' }], scores: hole9 }))!;
    expect(scramble.rounds[0].groups[0].matches[0].net?.a).toEqual({ toPar: 0, thru: 1 });
    const matchplay = buildEventView(snapshot({ scores: hole9 }))!;
    expect(matchplay.rounds[0].groups[0].matches[0].net?.a).toEqual({ toPar: -1, thru: 1 });
  });
});

describe('individual events', () => {
  const ind = (slots: [Slot, string][], round: Partial<RoundRow> = {}, scores: ScoreRow[] = []) =>
    snapshot({
      event: { ...snapshot().event!, kind: 'individual' },
      eventPlayers: ['a1', 'a2', 'b1'].map((id) => ({ event_id: 'e', player_id: id, team: null, handicap: 10 })),
      rounds: [{ ...baseRound, ...round }],
      groupPlayers: slots.map(([slot, player_id]) => ({ group_id: 'g1', slot, player_id, handicap: null })),
      scores,
    });

  it("a 2-player group plays the round's 2-player game as one individual game, with no team points", () => {
    const view = buildEventView(ind([['P1', 'a1'], ['P2', 'a2']]))!;
    const g = view.rounds[0].groups[0];
    expect(g.matches).toHaveLength(1);
    expect(g.matches[0].def.type).toBe('individual');
    expect(g.matches[0].def.game).toBe('stableford_match');
    expect(view.rounds[0].pointsAvailable).toBe(0);
  });

  it("a 3-player group plays the round's 3-player game, scored as a six pointer", () => {
    const scores: ScoreRow[] = (['a1', 'a2', 'b1'] as const).map((p, i) => ({
      round_id: 'r1', player_id: p, hole: 1, gross: 3 + i, picked_up: false, client_updated_at: '2026-10-01T09:10:00Z',
    }));
    const view = buildEventView(ind([['P1', 'a1'], ['P2', 'a2'], ['P3', 'b1']], {}, scores))!;
    const m = view.rounds[0].groups[0].matches[0];
    expect(m.def.game).toBe('six_stableford');
    expect(m.state.statusText).toBe('4 · 2 · 0');
  });

  it('labels individual groups by their players', () => {
    const short = (id: string) => id.toUpperCase();
    const solo = buildEventView(ind([['P1', 'a1'], ['P2', 'a2'], ['P3', 'b1']], { three_game: 'two_v_one' }))!;
    expect(solo.rounds[0].groups[0].matches[0].def.game).toBe('two_v_one');
    expect(pairingLabel(solo.rounds[0].groups[0], short)).toBe('A1 v A2/B1');
    const six = buildEventView(ind([['P1', 'a1'], ['P2', 'a2'], ['P3', 'b1']]))!;
    expect(pairingLabel(six.rounds[0].groups[0], short)).toBe('A1 v A2 v B1');
    const pair = buildEventView(ind([['P1', 'a1'], ['P2', 'a2']]))!;
    expect(pairingLabel(pair.rounds[0].groups[0], short)).toBe('A1 v A2');
  });
});

describe('season team events', () => {
  const POINTS = {
    fourball: { win: 2, halve: 1 }, singles: { win: 1, halve: 0.5 }, one_v_one: { win: 1, halve: 0.5 },
    two_v_one_single: { win: 2, halve: 1 }, two_v_one_pair: { win: 1, halve: 0.5 },
  };
  // Teams: a1, a2 on A; b1, b2 on B. Group g1 is a 3-ball (a1, a2, b1); group g2 a 2-ball (a1? no: a2 v b2 in round 2).
  const season = (over: Partial<Snapshot> = {}, teams: Record<string, Team> = { a1: 'A', a2: 'A', b1: 'B', b2: 'B' }) =>
    snapshot({
      event: { ...snapshot().event!, season: true, points: POINTS },
      eventPlayers: Object.entries(teams).map(([id, team]) => ({ event_id: 'e', player_id: id, team, handicap: 10 })),
      groups: [
        { id: 'g1', round_id: 'r1', group_no: 1, tee_time: null, singles_crossed: false },
        { id: 'g2', round_id: 'r1', group_no: 2, tee_time: null, singles_crossed: false },
      ],
      groupPlayers: [
        { group_id: 'g1', slot: 'P1', player_id: 'a1', handicap: null },
        { group_id: 'g1', slot: 'P2', player_id: 'a2', handicap: null },
        { group_id: 'g1', slot: 'P3', player_id: 'b1', handicap: null },
        { group_id: 'g2', slot: 'P1', player_id: 'a2', handicap: null },
        { group_id: 'g2', slot: 'P2', player_id: 'b2', handicap: null },
      ],
      ...over,
    });

  it('a 3-ball is a 2 v 1 with the golfer on their own team playing alone (never a six pointer)', () => {
    const v = buildEventView(season())!;
    const m = v.rounds[0].groups[0].matches[0];
    expect(m.def.game).toBe('two_v_one'); // the round's three_game is six_stableford, not allowed in season events
    expect(m.def.sideA).toEqual(['b1']);
    expect(m.def.sideB).toEqual(['a1', 'a2']);
  });

  it("points available: each group at its winning side's value", () => {
    const v = buildEventView(season())!;
    expect(v.rounds[0].pointsAvailable).toBe(3); // 2 v 1: 2, 1 v 1: 1
    expect(v.tracker.total).toBe(3);
  });

  it("a live game projects the leader's points to their team", () => {
    const at = '2026-10-01T09:10:00Z';
    const scores: ScoreRow[] = [
      { round_id: 'r1', player_id: 'b1', hole: 1, gross: 3, picked_up: false, client_updated_at: at },
      { round_id: 'r1', player_id: 'a1', hole: 1, gross: 5, picked_up: false, client_updated_at: at },
      { round_id: 'r1', player_id: 'a2', hole: 1, gross: 5, picked_up: false, client_updated_at: at },
    ];
    const v = buildEventView(season({ scores }))!;
    expect(v.tracker.projectedB).toBe(2); // the single (Team B) leads the 2 v 1
    expect(v.tracker.projectedA).toBe(0);
  });

  it('confirmed points stay with the team they were earned for, even after a player switches team', () => {
    const results = [{ group_id: 'g1', match_type: 'individual' as const, winner: 'A' as const, points_a: 0, points_b: 2, result_text: 'By 3 pts', final_hole: 18, confirmed_at: '2026-10-01T15:00:00Z' }];
    expect(buildEventView(season({ results }))!.tracker.confirmedB).toBe(2);
    const switched = buildEventView(season({ results }, { a1: 'A', a2: 'A', b1: 'A', b2: 'B' }))!;
    expect(switched.tracker.confirmedB).toBe(2);
    expect(switched.tracker.confirmedA).toBe(0);
  });

  it("fourballs use the event's points, halves included", () => {
    const v = buildEventView(
      snapshot({ event: { ...snapshot().event!, season: true, points: { ...POINTS, fourball: { win: 2, halve: 0.5 } } } }),
    )!;
    const fb = v.rounds[0].groups[0].matches[0];
    expect(fb.def.points).toBe(2);
    expect(fb.def.halvePoints).toBe(0.5);
    expect(v.rounds[0].pointsAvailable).toBe(2);
  });
});

describe('season team events: after a team switch', () => {
  const POINTS = {
    fourball: { win: 2, halve: 1 }, singles: { win: 1, halve: 0.5 }, one_v_one: { win: 1, halve: 0.5 },
    two_v_one_single: { win: 2, halve: 1 }, two_v_one_pair: { win: 1, halve: 0.5 },
  };
  it('a confirmed 2 v 1 keeps the line-up it was played with', () => {
    const s = snapshot({
      event: { ...snapshot().event!, season: true, points: POINTS },
      // a2 has since moved from A to B (so b1 is no longer the only Team B golfer).
      eventPlayers: [['a1', 'A'], ['a2', 'B'], ['b1', 'B']].map(([id, team]) => ({ event_id: 'e', player_id: id, team: team as Team, handicap: 10 })),
      groupPlayers: [
        { group_id: 'g1', slot: 'P1', player_id: 'b1', handicap: 10 },
        { group_id: 'g1', slot: 'P2', player_id: 'a1', handicap: 10 },
        { group_id: 'g1', slot: 'P3', player_id: 'a2', handicap: 10 },
      ],
      results: [{ group_id: 'g1', match_type: 'individual', winner: 'A', points_a: 0, points_b: 2, result_text: 'By 3 pts', final_hole: 18, confirmed_at: 'x' }],
    });
    const m = buildEventView(s)!.rounds[0].groups[0].matches[0];
    expect(m.def.sideA).toEqual(['b1']);
  });
  it("the points needed to win step by the event's win values too", () => {
    const whole = { win: 1, halve: 1 };
    const s = snapshot({ event: { ...snapshot().event!, season: true, points: { fourball: { win: 1.5, halve: 1 }, singles: whole, one_v_one: whole, two_v_one_single: whole, two_v_one_pair: whole } } });
    const v = buildEventView(s)!;
    expect(v.tracker.total).toBe(1.5);
    expect(v.tracker.toWin).toBe(1.25); // half of 1.5, plus the 0.5 step (not the 1 a halve-only step would give)
  });
});

describe('a day playing only some holes', () => {
  const winter = [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 18];
  it('uses just those holes, ranked for shots by their stroke index', () => {
    const v = buildEventView(snapshot({ rounds: [{ ...baseRound, holes: winter }] }))!;
    const holes = v.rounds[0].holes;
    expect(holes.map((h) => h.hole)).toEqual(winter);
    expect(holes.every((h) => h.of === 11)).toBe(true);
    // SI = hole number on this course, so the ranks follow the hole order; the card SI is kept for display.
    expect(holes.map((h) => h.strokeIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(holes.find((h) => h.hole === 14)?.cardSi).toBe(14);
  });
  it('scales handicaps to the holes played (10 over 11 holes → 6)', () => {
    const v = buildEventView(snapshot({ rounds: [{ ...baseRound, holes: winter }] }))!;
    expect(v.rounds[0].groups[0].playingHcp.a1).toBe(6);
  });
  it('all 18 holes when none are picked', () => {
    const v = buildEventView(snapshot())!;
    expect(v.rounds[0].holes).toHaveLength(18);
    expect(v.rounds[0].groups[0].playingHcp.a1).toBe(10);
  });
});

describe('holes played: repeated holes', () => {
  it('count each hole once when scaling handicaps', () => {
    const v = buildEventView(snapshot({ rounds: [{ ...baseRound, holes: [1, 1, 2, 3, 4, 5, 6, 7, 8, 9] }] }))!;
    expect(v.rounds[0].holes).toHaveLength(9);
    expect(v.rounds[0].groups[0].playingHcp.a1).toBe(5); // 10 × 9/18
  });
});
