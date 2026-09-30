import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, makeDb, seed, type Seed, type Who } from './harness';

// A per-event share link (#/watch/<token>): anyone with it can watch that event — read only, nothing else.
let db: PGlite;
let s: Seed;
const TOKEN = 'k7Qp2xVb9LmN4rTz8WcY1a';

beforeEach(async () => {
  db = await makeDb();
  s = await seed(db);
  await db.query(`insert into public.scores (round_id, player_id, hole, gross, client_updated_at) values ($1, $2, 1, 4, now())`, [s.roundId, s.players.a1]);
});

const share = (token: string | null) => db.query(`update public.events set watch_token = $1 where id = $2`, [token, s.eventId]);
type Watched = Record<string, unknown[]> & { event: Record<string, unknown> };
const watch = (who: Who, token: string | null) =>
  as(db, who, async () => (await db.query<{ w: Watched | null }>(`select public.watch_event($1) as w`, [token])).rows[0].w);

describe('watch links', () => {
  it('give nothing without a live link', async () => {
    expect(await watch('anon', TOKEN)).toBeNull();
    await share(TOKEN);
    expect(await watch('anon', 'wrong-token-wrong-token')).toBeNull();
    expect(await watch('anon', null)).toBeNull();
    expect(await watch('anon', '')).toBeNull();
  });

  it("return the event's data to anyone with the link (without the token itself)", async () => {
    await share(TOKEN);
    const w = (await watch('anon', TOKEN))!;
    expect(w.event.name).toBe('Test Cup');
    expect(w.event).not.toHaveProperty('watch_token');
    expect(w.players).toHaveLength(4);
    expect(w.eventPlayers).toHaveLength(4);
    expect(w.rounds).toHaveLength(1);
    expect(w.groups).toHaveLength(1);
    expect(w.groupPlayers).toHaveLength(4);
    expect(w.courses).toHaveLength(1);
    expect(w.courseHoles).toHaveLength(18);
    expect(w.scores).toHaveLength(1);
    expect(w.results).toEqual([]);
    expect(w.roundTees).toEqual([]);
    expect(w.guidePhotos).toEqual([]);
    expect(await watch('stranger', TOKEN)).not.toBeNull(); // signed in but not approved: the link still works
  });

  it("work for that event only — even when it isn't the active one", async () => {
    await share(TOKEN);
    await db.query(`update public.events set is_active = false`);
    const other = (await db.query<{ id: string }>(`insert into public.events (name, is_active) values ('Other Trip', true) returning id`)).rows[0].id;
    const otherPlayer = (await db.query<{ id: string }>(`insert into public.players (name, short_name, default_handicap) values ('Zed', 'Zed', 5) returning id`)).rows[0].id;
    await db.query(`insert into public.event_players (event_id, player_id, team, handicap) values ($1, $2, 'A', 5)`, [other, otherPlayer]);
    const otherCourse = (await db.query<{ id: string }>(`insert into public.courses (name) values ('Other Links') returning id`)).rows[0].id;
    await db.query(`insert into public.rounds (event_id, course_id, round_no, name) values ($1, $2, 1, 'Day 1')`, [other, otherCourse]);
    await db.query(`insert into public.guide_photos (course_name, hole, path) values ('Test Links', 1, 'test-links/1/a.jpg'), ('Other Links', 1, 'other-links/1/b.jpg')`);

    const w = (await watch('anon', TOKEN))!;
    expect(w.event.name).toBe('Test Cup');
    expect((w.players as { name: string }[]).map((p) => p.name)).not.toContain('Zed');
    expect(w.rounds).toHaveLength(1);
    expect((w.courses as { name: string }[]).map((c) => c.name)).toEqual(['Test Links']);
    expect((w.guidePhotos as { path: string }[]).map((p) => p.path)).toEqual(['test-links/1/a.jpg']);
  });

  it('stop working when turned off or replaced', async () => {
    await share(TOKEN);
    await share(null);
    expect(await watch('anon', TOKEN)).toBeNull();
    await share('aNewTokenaNewTokenaNew1');
    expect(await watch('anon', TOKEN)).toBeNull();
    expect(await watch('anon', 'aNewTokenaNewTokenaNew1')).not.toBeNull();
  });

  it("don't open the tables, scoring or the access list to viewers", async () => {
    await share(TOKEN);
    await expect(as(db, 'anon', () => db.query(`select * from public.scores`))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'anon', () => db.query(`select * from public.members`))).rejects.toThrow(/permission denied/);
    expect(await as(db, 'stranger', async () => (await db.query(`select * from public.scores`)).rows.length)).toBe(0);
    await expect(
      as(db, 'anon', () => db.query(`select public.upsert_score($1::uuid, $2::uuid, 2, 5, false, now(), false)`, [s.roundId, s.players.a1])),
    ).rejects.toThrow(/permission denied/);
  });

  it('can only be made or turned off by the admin', async () => {
    await as(db, 'trip', () => share(TOKEN));
    expect(await watch('anon', TOKEN)).toBeNull();
    await as(db, 'admin', () => share(TOKEN));
    expect(await watch('anon', TOKEN)).not.toBeNull();
  });

  it("let viewers open the shared event's photos, and only those", async () => {
    await db.query(`update public.players set photo_path = 'a1/face.jpg' where id = $1`, [s.players.a1]);
    await db.query(`insert into public.guide_photos (course_name, hole, path) values ('Test Links', 1, 'test-links/1/a.jpg'), ('Else Links', 1, 'else/1/b.jpg')`);
    const shared = (bucket: string, path: string) =>
      as(db, 'anon', async () => (await db.query<{ ok: boolean }>(`select public.watch_shared_object($1, $2) as ok`, [bucket, path])).rows[0].ok);
    expect(await shared('player-photos', 'a1/face.jpg')).toBe(false); // no live link yet
    await share(TOKEN);
    expect(await shared('player-photos', 'a1/face.jpg')).toBe(true);
    expect(await shared('course-guides', 'test-links/1/a.jpg')).toBe(true);
    expect(await shared('course-guides', 'else/1/b.jpg')).toBe(false);
    expect(await shared('player-photos', 'test-links/1/a.jpg')).toBe(false);
    await share(null);
    expect(await shared('course-guides', 'test-links/1/a.jpg')).toBe(false);
  });
});

describe('scoring through a watch link', () => {
  const save = (who: Who, token: string, round: string, gross: number, hole = 2) =>
    as(db, who, async () =>
      (await db.query<{ r: string }>(`select public.watch_upsert_score($1, $2::uuid, $3::uuid, $4::int, $5::int, false, now(), false) as r`, [
        token, round, s.players.a1, hole, gross,
      ])).rows[0].r,
    );
  const gross = async (hole: number) =>
    (await db.query<{ gross: number }>(`select gross from public.scores where round_id = $1 and player_id = $2 and hole = $3`, [s.roundId, s.players.a1, hole])).rows[0]?.gross;
  const confirm = (who: Who, token: string, group: string) =>
    as(db, who, async () =>
      (await db.query<{ r: string }>(`select public.watch_confirm_match($1, $2::uuid, 'better_ball', 'A', 1, 0, '3&2', 16) as r`, [token, group])).rows[0].r,
    );

  it("lets anyone with a live link save scores for that event, like a signed-in player", async () => {
    await share(TOKEN);
    expect(await save('anon', TOKEN, s.roundId, 5)).toBe('ok');
    expect(await gross(2)).toBe(5);
    expect(await save('anon', TOKEN, s.roundId, 6)).toBe('ok');
    expect(await gross(2)).toBe(6);
  });

  it('refuses a wrong, turned-off or replaced link', async () => {
    await expect(save('anon', TOKEN, s.roundId, 5)).rejects.toThrow(/share link/);
    await share(TOKEN);
    await expect(save('anon', 'wrong-token-wrong-token', s.roundId, 5)).rejects.toThrow(/share link/);
    await share('aNewTokenaNewTokenaNew1');
    await expect(save('anon', TOKEN, s.roundId, 5)).rejects.toThrow(/share link/);
    expect(await gross(2)).toBeUndefined();
  });

  it("can't touch another event's rounds", async () => {
    await share(TOKEN);
    const other = (await db.query<{ id: string }>(`insert into public.events (name) values ('Other Trip') returning id`)).rows[0].id;
    const otherRound = (await db.query<{ id: string }>(`insert into public.rounds (event_id, course_id, round_no, name) values ($1, $2, 1, 'Day 1') returning id`, [other, s.courseId])).rows[0].id;
    await expect(save('anon', TOKEN, otherRound, 5)).rejects.toThrow(/not this event/);
  });

  it('respects confirmed (locked) matches', async () => {
    await share(TOKEN);
    expect(await confirm('anon', TOKEN, s.groupId)).toBe('ok');
    expect(await save('anon', TOKEN, s.roundId, 5)).toBe('locked');
    expect(await confirm('anon', TOKEN, s.groupId)).toBe('already_confirmed');
  });

  it("confirms only that event's matches, and only with a live link", async () => {
    await expect(confirm('anon', TOKEN, s.groupId)).rejects.toThrow(/share link/);
    await share(TOKEN);
    const other = (await db.query<{ id: string }>(`insert into public.events (name) values ('Other Trip') returning id`)).rows[0].id;
    const otherRound = (await db.query<{ id: string }>(`insert into public.rounds (event_id, course_id, round_no, name) values ($1, $2, 1, 'Day 1') returning id`, [other, s.courseId])).rows[0].id;
    const otherGroup = (await db.query<{ id: string }>(`insert into public.groups (round_id, group_no) values ($1, 1) returning id`, [otherRound])).rows[0].id;
    await expect(confirm('anon', TOKEN, otherGroup)).rejects.toThrow(/not this event/);
  });

  it('leaves the normal scoring path members-only', async () => {
    await share(TOKEN);
    await expect(as(db, 'anon', () => db.query(`select public.save_score($1::uuid, $2::uuid, 2, 5, false, now(), false)`, [s.roundId, s.players.a1]))).rejects.toThrow(/permission denied/);
    await expect(
      as(db, 'stranger', () => db.query(`select public.upsert_score($1::uuid, $2::uuid, 2, 5, false, now(), false)`, [s.roundId, s.players.a1])),
    ).rejects.toThrow(/not a trip member/);
  });
});
