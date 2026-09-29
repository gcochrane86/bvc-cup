// Adds the Ballyliffen one-day event at Glashedy Links (three tee variants). Safe to run twice: it finds
// the courses, event, day and group by name/number before creating them. The event is left inactive and
// its group empty — pick the players, teams and pairing in Admin.
// Usage: npm run add-ballyliffen -- --env .env.local
import { createClient } from '@supabase/supabase-js';

const at = process.argv.indexOf('--env');
const envFile = at >= 0 ? process.argv[at + 1] : undefined;
if (!envFile) {
  console.error('Usage: npm run add-ballyliffen -- --env <.env file>');
  process.exit(1);
}
process.loadEnvFile(envFile);
const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

async function run<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}

// Official Glashedy scorecard (Oct 2025) and the club's WHS course handicap tables (from 16 Sep 2025).
const PARS = [4, 4, 4, 5, 3, 4, 3, 4, 4, 4, 4, 4, 5, 3, 4, 4, 5, 4];
const SI = [10, 2, 8, 18, 16, 14, 12, 6, 4, 17, 7, 3, 11, 15, 1, 5, 9, 13];
const TEES = [
  { name: 'Glashedy Links (Black)', course_rating: 77.4, slope_rating: 136 },
  { name: 'Glashedy Links (Gold)', course_rating: 73.6, slope_rating: 127 },
  { name: 'Glashedy Links (White)', course_rating: 71.3, slope_rating: 123 },
];

const courseIds: Record<string, string> = {};
for (const t of TEES) {
  const found = await run(db.from('courses').select('id').eq('name', t.name));
  const id: string = found[0]?.id ?? (await run(db.from('courses').insert(t).select('id').single())).id;
  await run(db.from('courses').update({ course_rating: t.course_rating, slope_rating: t.slope_rating }).eq('id', id));
  await run(db.from('course_holes').upsert(PARS.map((par, i) => ({ course_id: id, hole: i + 1, par, stroke_index: SI[i] }))));
  courseIds[t.name] = id;
}

const event =
  (await run(db.from('events').select('id').eq('name', 'Ballyliffen')))[0] ??
  (await run(db.from('events').insert({ name: 'Ballyliffen', is_active: false }).select('id').single()));
const round =
  (await run(db.from('rounds').select('id').eq('event_id', event.id).eq('round_no', 1)))[0] ??
  (await run(
    db
      .from('rounds')
      .insert({ event_id: event.id, round_no: 1, name: 'Day 1', course_id: courseIds['Glashedy Links (Gold)'], singles_enabled: false })
      .select('id')
      .single(),
  ));
const group =
  (await run(db.from('groups').select('id').eq('round_id', round.id).eq('group_no', 1)))[0] ??
  (await run(db.from('groups').insert({ round_id: round.id, group_no: 1 }).select('id').single()));

console.log('Ballyliffen ready:', { event: event.id, round: round.id, group: group.id, courses: courseIds });
