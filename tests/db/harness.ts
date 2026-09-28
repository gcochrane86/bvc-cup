import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';

export const TRIP_ID = '11111111-1111-1111-1111-111111111111';
export const STRANGER_ID = '33333333-3333-3333-3333-333333333333';
export const ADMIN_ID = '22222222-2222-2222-2222-222222222222';
export const PENDING_ID = '44444444-4444-4444-4444-444444444444';

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
`;

/** Fresh database with all migrations applied, except Supabase-only ones (storage, realtime). */
export async function makeDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  const dir = 'supabase/migrations';
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.includes('_supabase_')).sort();
  for (const f of files) await db.exec(readFileSync(`${dir}/${f}`, 'utf8'));
  return db;
}

/** stranger = authenticated but not on the access list. trip = an approved member. pending = on the list, not yet approved. */
export type Who = 'anon' | 'trip' | 'admin' | 'stranger' | 'pending';

/** Run fn as a Supabase API caller: the Postgres role plus JWT claims, exactly as PostgREST sets them. */
export async function as<T>(db: PGlite, who: Who, fn: () => Promise<T>): Promise<T> {
  const claims =
    who === 'anon'
      ? { role: 'anon' }
      : who === 'stranger'
        ? { sub: STRANGER_ID, role: 'authenticated', app_metadata: {} }
        : who === 'pending'
          ? { sub: PENDING_ID, role: 'authenticated', app_metadata: {} }
        : { sub: who === 'trip' ? TRIP_ID : ADMIN_ID, role: 'authenticated', app_metadata: { role: who } };
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

export interface Seed {
  courseId: string;
  eventId: string;
  roundId: string;
  groupId: string;
  players: Record<'a1' | 'a2' | 'b1' | 'b2', string>;
}

/** One course, event, round (singles enabled) and a full group of four. Runs as superuser. */
export async function seed(db: PGlite): Promise<Seed> {
  const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;
  const courseId = await one(`insert into public.courses(name) values ('Test Links') returning id`);
  await db.query(
    `insert into public.course_holes(course_id, hole, par, stroke_index) select $1::uuid, h, 4, h from generate_series(1, 18) h`,
    [courseId],
  );
  const eventId = await one(`insert into public.events(name, is_active) values ('Test Cup', true) returning id`);
  const players = {} as Seed['players'];
  const roster = [['a1', 'A', 4], ['a2', 'A', 18], ['b1', 'B', 9], ['b2', 'B', 14]] as const;
  for (const [key, team, hcp] of roster) {
    players[key] = await one(
      `insert into public.players(name, short_name, default_handicap) values ($1, $1, $2) returning id`,
      [key.toUpperCase(), hcp],
    );
    await db.query(`insert into public.event_players(event_id, player_id, team, handicap) values ($1, $2, $3, $4)`, [
      eventId, players[key], team, hcp,
    ]);
  }
  const roundId = await one(
    `insert into public.rounds(event_id, course_id, round_no, name, singles_enabled) values ($1, $2, 1, 'Day 1', true) returning id`,
    [eventId, courseId],
  );
  const groupId = await one(`insert into public.groups(round_id, group_no) values ($1, 1) returning id`, [roundId]);
  for (const [slot, key] of [['A1', 'a1'], ['A2', 'a2'], ['B1', 'b1'], ['B2', 'b2']] as const) {
    await db.query(`insert into public.group_players(group_id, slot, player_id) values ($1, $2, $3)`, [groupId, slot, players[key]]);
  }
  await db.query(`insert into public.members (user_id, email, status) values ($1, 'me@example.com', 'approved'), ($2, 'new@example.com', 'pending')`, [
    TRIP_ID, PENDING_ID,
  ]);
  return { courseId, eventId, roundId, groupId, players };
}
