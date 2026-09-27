// DEV/TEST ONLY — wipes ALL data, then seeds a demo event. Never run against production.
// Usage: npm run seed -- --yes-wipe
import { createClient } from '@supabase/supabase-js';

if (!process.argv.includes('--yes-wipe')) {
  console.error('Refusing to run without --yes-wipe (this deletes every event, player, course and score).');
  process.exit(1);
}
const url = process.env.VITE_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error('Set VITE_SUPABASE_URL and SUPABASE_SECRET_KEY');
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function run<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}
const NONE = '00000000-0000-0000-0000-000000000000';

await run(db.from('events').delete().neq('id', NONE)); // cascades rounds, groups, scores, results
await run(db.from('players').delete().neq('id', NONE));
await run(db.from('courses').delete().neq('id', NONE));

const names = [
  'Alex Adams', 'Ben Brown', 'Chris Clark', 'Dan Davies', 'Ed Evans', 'Finn Fox',
  'Gus Green', 'Harry Hill', 'Ian Irwin', 'Jack Jones', 'Kyle King', 'Liam Lee',
];
// Group 1 players all play off 10 so e2e tests get no strokes there.
const handicaps = [10, 10, 6, 14, 3, 22, 10, 10, 8, 12, 5, 18];
const players = await run(
  db
    .from('players')
    .insert(names.map((name, i) => ({ name, short_name: name.split(' ')[1], default_handicap: handicaps[i] })))
    .select(),
);
const byName = (n: string) => players.find((p: { name: string }) => p.name === n).id as string;

const course = await run(db.from('courses').insert({ name: 'Seed Links' }).select().single());
const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const sis = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 16, 2, 12, 6, 10, 18, 4, 14];
await run(
  db.from('course_holes').insert(pars.map((par, i) => ({ course_id: course.id, hole: i + 1, par, stroke_index: sis[i] }))),
);

const event = await run(
  db.from('events').insert({ name: 'Demo Cup', team_a_name: 'Team Blue', team_b_name: 'Team Red', is_active: true }).select().single(),
);
const teamA = names.slice(0, 6);
const teamB = names.slice(6);
await run(
  db.from('event_players').insert(
    names.map((n, i) => ({ event_id: event.id, player_id: byName(n), team: i < 6 ? 'A' : 'B', handicap: handicaps[i] })),
  ),
);

const today = new Date().toLocaleDateString('en-CA');
const rounds = await run(
  db
    .from('rounds')
    .insert([
      { event_id: event.id, course_id: course.id, round_no: 1, name: 'Day 1', date: today },
      { event_id: event.id, course_id: course.id, round_no: 2, name: 'Day 2' },
      { event_id: event.id, course_id: course.id, round_no: 3, name: 'Day 3', singles_enabled: true },
    ])
    .select(),
);

for (const round of rounds) {
  for (let g = 0; g < 3; g++) {
    const group = await run(
      db.from('groups').insert({ round_id: round.id, group_no: g + 1, tee_time: `09:${String(g * 10).padStart(2, '0')}` }).select().single(),
    );
    const [a1, a2] = teamA.slice(g * 2, g * 2 + 2).sort((x, y) => handicaps[names.indexOf(x)] - handicaps[names.indexOf(y)]);
    const [b1, b2] = teamB.slice(g * 2, g * 2 + 2).sort((x, y) => handicaps[names.indexOf(x)] - handicaps[names.indexOf(y)]);
    await run(
      db.from('group_players').insert([
        { group_id: group.id, slot: 'A1', player_id: byName(a1) },
        { group_id: group.id, slot: 'A2', player_id: byName(a2) },
        { group_id: group.id, slot: 'B1', player_id: byName(b1) },
        { group_id: group.id, slot: 'B2', player_id: byName(b2) },
      ]),
    );
  }
}
console.log('Seeded Demo Cup: 12 players, 3 rounds, 9 groups.');
