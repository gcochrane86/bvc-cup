import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, makeDb, seed, type Seed, type Who } from './harness';

let db: PGlite;
let s: Seed;

beforeEach(async () => {
  db = await makeDb();
  s = await seed(db);
});

const T1 = '2026-10-01T10:00:00Z';
const T0 = '2026-10-01T09:00:00Z';
const T2 = '2026-10-01T11:00:00Z';

async function upsert(who: Who, player: string, hole: number, gross: number | null, pickedUp = false, at = T1) {
  return as(db, who, async () => {
    const r = await db.query<{ r: string }>(
      `select public.upsert_score($1::uuid, $2::uuid, $3::int, $4::int, $5::boolean, $6::timestamptz) as r`,
      [s.roundId, player, hole, gross, pickedUp, at],
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

describe('admin RPCs', () => {
  const holes = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: 18 - i })));

  it('saves a course for the admin', async () => {
    const id = await as(db, 'admin', async () =>
      (await db.query<{ id: string }>(`select public.save_course(null, 'New Course', $1::jsonb) as id`, [holes])).rows[0].id,
    );
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.course_holes where course_id = $1`, [id]);
    expect(r.rows[0].n).toBe(18);
  });

  it('refuses save_course for the trip user', async () => {
    await expect(
      as(db, 'trip', () => db.query(`select public.save_course(null, 'X', $1::jsonb)`, [holes])),
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
