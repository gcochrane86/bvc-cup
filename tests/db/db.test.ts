import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, makeDb, PENDING_ID, seed, STRANGER_ID, TRIP_ID, type Seed, type Who } from './harness';

let db: PGlite;
let s: Seed;

beforeEach(async () => {
  db = await makeDb();
  s = await seed(db);
});

const T1 = '2026-10-01T10:00:00Z';
const T0 = '2026-10-01T09:00:00Z';
const T2 = '2026-10-01T11:00:00Z';

async function upsert(who: Who, player: string, hole: number, gross: number | null, pickedUp = false, at = T1, ifAbsent = false) {
  return as(db, who, async () => {
    const r = await db.query<{ r: string }>(
      `select public.upsert_score($1::uuid, $2::uuid, $3::int, $4::int, $5::boolean, $6::timestamptz, $7::boolean) as r`,
      [s.roundId, player, hole, gross, pickedUp, at, ifAbsent],
    );
    return r.rows[0].r;
  });
}

async function readScore(player: string, hole: number) {
  const r = await db.query<{ gross: number | null; picked_up: boolean }>(
    `select gross, picked_up from public.scores where round_id = $1 and player_id = $2 and hole = $3`,
    [s.roundId, player, hole],
  );
  return r.rows[0] ?? null;
}

async function confirm(who: Who, type: string, finalHole: number) {
  return as(db, who, async () => {
    const r = await db.query<{ r: string }>(
      `select public.confirm_match($1::uuid, $2, 'A', 1, 0, '4&3', $3::int) as r`,
      [s.groupId, type, finalHole],
    );
    return r.rows[0].r;
  });
}

describe('harness', () => {
  it('applies RLS to the authenticated role', async () => {
    await expect(
      as(db, 'trip', () => db.query(`insert into public.players(name, short_name) values ('X', 'X')`)),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('read access', () => {
  it('lets signed-in users read', async () => {
    const r = await as(db, 'trip', () => db.query(`select * from public.players`));
    expect(r.rows).toHaveLength(4);
  });
  it('gives anon nothing', async () => {
    await expect(as(db, 'anon', () => db.query(`select * from public.players`))).rejects.toThrow(/permission denied/);
  });
});

describe('self-signed-up accounts (no role)', () => {
  it('cannot read anything', async () => {
    const r = await as(db, 'stranger', () => db.query(`select * from public.players`));
    expect(r.rows).toHaveLength(0);
  });
  it('cannot write scores', async () => {
    await expect(upsert('stranger', s.players.a1, 1, 4)).rejects.toThrow(/not a trip member/);
    expect(await readScore(s.players.a1, 1)).toBeNull();
  });
  it('cannot insert scores directly', async () => {
    await expect(
      as(db, 'stranger', () =>
        db.query(`insert into public.scores(round_id, player_id, hole, gross, client_updated_at) values ($1, $2, 1, 4, now())`, [s.roundId, s.players.a1]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it('cannot confirm results', async () => {
    await expect(confirm('stranger', 'better_ball', 15)).rejects.toThrow(/not a trip member/);
  });
  it('cannot set photos', async () => {
    await expect(
      as(db, 'stranger', () => db.query(`select public.set_player_photo($1::uuid, $2)`, [s.players.a1, `${s.players.a1}/1.jpg`])),
    ).rejects.toThrow(/not a trip member/);
  });
});

describe('access list', () => {
  const readPlayers = (who: Who) => as(db, who, async () => (await db.query(`select id from public.players`)).rows.length);
  const setStatus = (id: string, status: string) => db.query(`update public.members set status = $2 where user_id = $1`, [id, status]);

  it('lets approved members in', async () => {
    expect(await readPlayers('trip')).toBe(4);
  });

  it('keeps pending people out of every table and write', async () => {
    expect(await readPlayers('pending')).toBe(0);
    await expect(upsert('pending', s.players.a1, 1, 4)).rejects.toThrow(/not a trip member/);
  });

  it('cuts removed people off immediately', async () => {
    await setStatus(TRIP_ID, 'removed');
    expect(await readPlayers('trip')).toBe(0);
  });

  it('no longer lets the shared trip login in on its own', async () => {
    await db.query(`delete from public.members where user_id = $1`, [TRIP_ID]);
    expect(await readPlayers('trip')).toBe(0); // app_metadata.role = 'trip' but not on the list
  });

  it('shows people only their own entry', async () => {
    const r = await as(db, 'pending', () => db.query<{ email: string; status: string }>(`select email, status from public.members`));
    expect(r.rows).toEqual([{ email: 'new@example.com', status: 'pending' }]);
  });

  it('does not let anyone approve themselves', async () => {
    await as(db, 'pending', () => db.query(`update public.members set status = 'approved' where user_id = $1`, [PENDING_ID]));
    expect(await readPlayers('pending')).toBe(0);
  });

  it('lets the admin see everyone, approve and remove', async () => {
    const all = await as(db, 'admin', () => db.query(`select email from public.members order by email`));
    expect(all.rows).toEqual([{ email: 'me@example.com' }, { email: 'new@example.com' }]);
    await as(db, 'admin', () => db.query(`update public.members set status = 'approved' where user_id = $1`, [PENDING_ID]));
    expect(await readPlayers('pending')).toBe(4);
    await as(db, 'admin', () => db.query(`update public.members set status = 'removed' where user_id = $1`, [PENDING_ID]));
    expect(await readPlayers('pending')).toBe(0);
  });

  it('rejects unknown statuses', async () => {
    await expect(setStatus(STRANGER_ID, 'maybe').then(() => setStatus(TRIP_ID, 'maybe'))).rejects.toThrow(/check constraint/);
  });
});

describe('setup tables', () => {
  it('lets the admin write', async () => {
    await as(db, 'admin', () => db.query(`insert into public.players(name, short_name) values ('New', 'New')`));
    const r = await db.query(`select 1 from public.players where name = 'New'`);
    expect(r.rows).toHaveLength(1);
  });
});

describe('upsert_score', () => {
  it('inserts and updates', async () => {
    expect(await upsert('trip', s.players.a1, 1, 4)).toBe('ok');
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 4, picked_up: false });
    expect(await upsert('trip', s.players.a1, 1, 5, false, T2)).toBe('ok');
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 5, picked_up: false });
  });

  it('ignores a stale write', async () => {
    await upsert('trip', s.players.a1, 1, 4, false, T1);
    expect(await upsert('trip', s.players.a1, 1, 7, false, T0)).toBe('stale');
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 4, picked_up: false });
  });

  it('an if-absent default fills an empty cell', async () => {
    expect(await upsert('trip', s.players.a1, 1, 4, false, T1, true)).toBe('ok');
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 4, picked_up: false });
  });

  it('an if-absent default never overwrites an existing score, even if newer', async () => {
    await upsert('trip', s.players.a1, 1, 5, false, T1);
    expect(await upsert('trip', s.players.a1, 1, 4, false, T2, true)).toBe('exists');
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 5, picked_up: false });
  });

  it('a real score entered earlier but arriving late (poor signal) still replaces a par default', async () => {
    expect(await upsert('trip', s.players.a1, 1, 4, false, T2, true)).toBe('ok'); // mate's default lands first
    expect(await upsert('trip', s.players.a1, 1, 5, false, T1)).toBe('ok'); // my 5, typed before theirs
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 5, picked_up: false });
  });

  it('clearing a score, entered earlier but arriving late, still removes a par default', async () => {
    await upsert('trip', s.players.a1, 1, 4, false, T2, true);
    expect(await upsert('trip', s.players.a1, 1, null, false, T1)).toBe('ok');
    expect(await readScore(s.players.a1, 1)).toBeNull();
  });

  it('stores a pick-up', async () => {
    expect(await upsert('trip', s.players.a1, 2, null, true)).toBe('ok');
    expect(await readScore(s.players.a1, 2)).toEqual({ gross: null, picked_up: true });
  });

  it('deletes when cleared', async () => {
    await upsert('trip', s.players.a1, 3, 4, false, T1);
    expect(await upsert('trip', s.players.a1, 3, null, false, T2)).toBe('ok');
    expect(await readScore(s.players.a1, 3)).toBeNull();
  });

  it('rejects an out-of-range gross score', async () => {
    await expect(upsert('trip', s.players.a1, 1, 16)).rejects.toThrow(/check constraint/);
  });

  it('rejects anon', async () => {
    await expect(upsert('anon', s.players.a1, 1, 4)).rejects.toThrow(/permission denied/);
  });
});

describe('confirmation and locking', () => {
  it('confirms once', async () => {
    expect(await confirm('trip', 'better_ball', 15)).toBe('ok');
    expect(await confirm('trip', 'better_ball', 15)).toBe('already_confirmed');
  });

  it('locks every better-ball player up to the final hole only', async () => {
    await confirm('trip', 'better_ball', 15);
    expect(await upsert('trip', s.players.b2, 15, 4)).toBe('locked');
    expect(await upsert('trip', s.players.a1, 16, 4)).toBe('ok');
  });

  it('locks only the singles players for a singles result', async () => {
    await confirm('trip', 'low_singles', 12);
    expect(await upsert('trip', s.players.b1, 10, 4)).toBe('locked');
    expect(await upsert('trip', s.players.a2, 10, 4)).toBe('ok');
  });

  it('locks the actual singles opponents when the singles are crossed', async () => {
    await db.query(`update public.groups set singles_crossed = true where id = $1`, [s.groupId]);
    await confirm('trip', 'low_singles', 12); // A1 v B2
    expect(await upsert('trip', s.players.b2, 10, 4)).toBe('locked');
    expect(await upsert('trip', s.players.a1, 10, 4)).toBe('locked');
    expect(await upsert('trip', s.players.b1, 10, 4)).toBe('ok');
  });

  it('defaults rounds to handicap singles pairings and groups to uncrossed', async () => {
    const r = await db.query<{ singles_pairing: string; singles_crossed: boolean }>(
      `select r.singles_pairing, g.singles_crossed from public.rounds r join public.groups g on g.round_id = r.id where g.id = $1`, [s.groupId],
    );
    expect(r.rows[0]).toEqual({ singles_pairing: 'handicap', singles_crossed: false });
    await expect(db.query(`update public.rounds set singles_pairing = 'coin'`)).rejects.toThrow(/check constraint/);
  });

  it('blocks direct writes to locked scores too', async () => {
    await upsert('trip', s.players.a1, 5, 4);
    await confirm('trip', 'better_ball', 15);
    await as(db, 'trip', () => db.query(`update public.scores set gross = 9 where hole = 5`));
    expect(await readScore(s.players.a1, 5)).toEqual({ gross: 4, picked_up: false });
  });

  it('lets only the admin unlock', async () => {
    await confirm('trip', 'better_ball', 15);
    await as(db, 'trip', () => db.query(`delete from public.match_results`));
    expect((await db.query(`select 1 from public.match_results`)).rows).toHaveLength(1);
    await as(db, 'admin', () => db.query(`delete from public.match_results`));
    expect((await db.query(`select 1 from public.match_results`)).rows).toHaveLength(0);
  });
});

describe('handicap freezing', () => {
  const frozen = async () =>
    (
      await db.query<{ slot: string; handicap: string | null }>(
        `select slot, handicap::text from public.group_players where group_id = $1 order by slot`,
        [s.groupId],
      )
    ).rows.map((r) => [r.slot, r.handicap]);
  const setEventHandicap = (player: string, h: number) =>
    as(db, 'admin', () => db.query(`update public.event_players set handicap = $2 where player_id = $1`, [player, h]));

  it('is not frozen before any match is confirmed', async () => {
    expect(await frozen()).toEqual([['A1', null], ['A2', null], ['B1', null], ['B2', null]]);
  });

  it('confirming a match (even as the trip user) freezes the group’s handicaps', async () => {
    await confirm('trip', 'better_ball', 15);
    expect(await frozen()).toEqual([['A1', '4.0'], ['A2', '18.0'], ['B1', '9.0'], ['B2', '14.0']]);
  });

  it('later handicap changes do not touch a frozen group', async () => {
    await confirm('trip', 'better_ball', 15);
    await setEventHandicap(s.players.a2, 30);
    expect(await frozen()).toContainEqual(['A2', '18.0']);
  });

  it('unlocking the last result lifts the freeze', async () => {
    await confirm('trip', 'better_ball', 15);
    await as(db, 'admin', () => db.query(`delete from public.match_results`));
    expect(await frozen()).toEqual([['A1', null], ['A2', null], ['B1', null], ['B2', null]]);
  });

  it('keeps the freeze while another result in the group remains', async () => {
    await confirm('trip', 'better_ball', 15);
    await confirm('trip', 'low_singles', 16);
    await as(db, 'admin', () => db.query(`delete from public.match_results where match_type = 'low_singles'`));
    expect(await frozen()).toContainEqual(['A1', '4.0']);
  });

  it('re-saving the pairings of a confirmed group keeps it frozen at the played handicaps', async () => {
    await confirm('trip', 'better_ball', 15);
    await setEventHandicap(s.players.a2, 30);
    const slots = JSON.stringify([
      { slot: 'A1', player_id: s.players.a1 },
      { slot: 'A2', player_id: s.players.a2 },
      { slot: 'B1', player_id: s.players.b1 },
      { slot: 'B2', player_id: s.players.b2 },
    ]);
    await as(db, 'admin', () => db.query(`select public.save_group($1::uuid, 1, null, $2::jsonb)`, [s.roundId, slots]));
    expect(await frozen()).toContainEqual(['A2', '18.0']);
  });
});

describe('reset_event_scores', () => {
  it('lets the admin wipe every score and result for the event, unfreezing handicaps', async () => {
    await upsert('trip', s.players.a1, 1, 4);
    await upsert('trip', s.players.b1, 2, 5);
    await confirm('trip', 'better_ball', 15);
    await as(db, 'admin', () => db.query(`select public.reset_event_scores($1::uuid)`, [s.eventId]));
    const n = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n;
    expect(await n('scores')).toBe(0);
    expect(await n('match_results')).toBe(0);
    const frozen = await db.query(`select 1 from public.group_players where handicap is not null`);
    expect(frozen.rows).toHaveLength(0);
    expect(await n('players')).toBe(4); // setup untouched
  });

  it('leaves other events alone', async () => {
    await upsert('trip', s.players.a1, 1, 4);
    const other = (await db.query<{ id: string }>(`insert into public.events(name) values ('Other') returning id`)).rows[0].id;
    await as(db, 'admin', () => db.query(`select public.reset_event_scores($1::uuid)`, [other]));
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 4, picked_up: false });
  });

  it('refuses the trip user', async () => {
    await upsert('trip', s.players.a1, 1, 4);
    await expect(as(db, 'trip', () => db.query(`select public.reset_event_scores($1::uuid)`, [s.eventId]))).rejects.toThrow(/admin only/);
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 4, picked_up: false });
  });
});

describe('reset_round_scores', () => {
  async function secondRound() {
    const r2 = (await db.query<{ id: string }>(
      `insert into public.rounds(event_id, course_id, round_no, name) values ($1, $2, 2, 'Day 2') returning id`, [s.eventId, s.courseId],
    )).rows[0].id;
    await db.query(`insert into public.scores(round_id, player_id, hole, gross, client_updated_at) values ($1, $2, 1, 6, now())`, [r2, s.players.a1]);
    return r2;
  }
  const count = async (sql: string, params: unknown[] = []) => (await db.query<{ n: number }>(sql, params)).rows[0].n;

  it('clears one day only: its scores, results and frozen handicaps', async () => {
    const r2 = await secondRound();
    await upsert('trip', s.players.a1, 1, 4);
    await confirm('trip', 'better_ball', 15);
    await as(db, 'admin', () => db.query(`select public.reset_round_scores($1::uuid)`, [s.roundId]));
    expect(await count(`select count(*)::int as n from public.scores where round_id = $1`, [s.roundId])).toBe(0);
    expect(await count(`select count(*)::int as n from public.match_results`)).toBe(0);
    expect(await count(`select count(*)::int as n from public.group_players where handicap is not null`)).toBe(0);
    expect(await count(`select count(*)::int as n from public.scores where round_id = $1`, [r2])).toBe(1); // Day 2 untouched
  });

  it('refuses the trip user', async () => {
    await upsert('trip', s.players.a1, 1, 4);
    await expect(as(db, 'trip', () => db.query(`select public.reset_round_scores($1::uuid)`, [s.roundId]))).rejects.toThrow(/admin only/);
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 4, picked_up: false });
  });
});

describe('admin RPCs', () => {
  const holes = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: 18 - i })));

  it('saves a course for the admin', async () => {
    const id = await as(db, 'admin', async () =>
      (await db.query<{ id: string }>(`select public.save_course(null, 'New Course', $1::jsonb, 125, 71.3) as id`, [holes])).rows[0].id,
    );
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.course_holes where course_id = $1`, [id]);
    expect(r.rows[0].n).toBe(18);
  });

  it('stores slope and course rating', async () => {
    const id = await as(db, 'admin', async () =>
      (await db.query<{ id: string }>(`select public.save_course(null, 'Rated', $1::jsonb, 125, 71.3) as id`, [holes])).rows[0].id,
    );
    const r = await db.query<{ slope_rating: number; course_rating: string }>(
      `select slope_rating, course_rating::text from public.courses where id = $1`, [id],
    );
    expect(r.rows[0]).toEqual({ slope_rating: 125, course_rating: '71.3' });
  });

  it('rejects an impossible slope', async () => {
    await expect(
      as(db, 'admin', () => db.query(`select public.save_course(null, 'Bad', $1::jsonb, 200, 71)`, [holes])),
    ).rejects.toThrow(/check constraint/);
  });

  it('refuses save_course for the trip user', async () => {
    await expect(
      as(db, 'trip', () => db.query(`select public.save_course(null, 'X', $1::jsonb, null, null)`, [holes])),
    ).rejects.toThrow(/admin only/);
  });

  it('replaces a group’s players with save_group', async () => {
    const slots = JSON.stringify([
      { slot: 'A1', player_id: s.players.a2 },
      { slot: 'A2', player_id: s.players.a1 },
      { slot: 'B1', player_id: s.players.b1 },
      { slot: 'B2', player_id: s.players.b2 },
    ]);
    const id = await as(db, 'admin', async () =>
      (await db.query<{ id: string }>(`select public.save_group($1::uuid, 1, '09:10'::time, $2::jsonb) as id`, [s.roundId, slots])).rows[0].id,
    );
    expect(id).toBe(s.groupId);
    const r = await db.query<{ player_id: string }>(`select player_id from public.group_players where group_id = $1 and slot = 'A1'`, [id]);
    expect(r.rows[0].player_id).toBe(s.players.a2);
  });

  it('only accepts well-formed photo paths', async () => {
    await expect(
      as(db, 'trip', () => db.query(`select public.set_player_photo($1::uuid, 'evil/../x.jpg')`, [s.players.a1])),
    ).rejects.toThrow(/invalid photo path/);
    await as(db, 'trip', () => db.query(`select public.set_player_photo($1::uuid, $2)`, [s.players.a1, `${s.players.a1}/123.jpg`]));
    const r = await db.query<{ photo_path: string }>(`select photo_path from public.players where id = $1`, [s.players.a1]);
    expect(r.rows[0].photo_path).toBe(`${s.players.a1}/123.jpg`);
  });
});
