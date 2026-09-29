// Adds the other tees for the BvC trip courses (current WHS men's ratings), and names each course's existing
// tee "White". New tees copy the existing tee's par and stroke index (every men's tee shares them — per the
// club scorecards and yardage guides). Safe to run twice: tees are found by (name, tee) before creating.
// Usage: npm run add-trip-tees -- --env .env.local
//
// Sources (Sept 2026): mygolfdays.com WHS tables for Dundonald Links and Trump Turnberry; BlueGolf / GolfPass.
// King Robert the Bruce's Black tees are par 74 with unknown hole pars, so they are left out.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const at = process.argv.indexOf('--env');
const envFile = at >= 0 ? process.argv[at + 1] : undefined;
if (!envFile) {
  console.error('Usage: npm run add-trip-tees -- --env <.env file>');
  process.exit(1);
}
const env = parseEnv(readFileSync(envFile, 'utf8'));
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error(`${envFile} must set VITE_SUPABASE_URL and SUPABASE_SECRET_KEY`);
console.log(`Writing to ${env.VITE_SUPABASE_URL} (from ${envFile})`);
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function run<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}

type Tee = { tee: string; course_rating: number; slope_rating: number };
const COURSES: { name: string; tees: Tee[] }[] = [
  {
    name: 'Dundonald Links',
    tees: [
      { tee: 'Black', course_rating: 76.0, slope_rating: 139 },
      { tee: 'Blue', course_rating: 74.0, slope_rating: 135 },
      { tee: 'White', course_rating: 72.2, slope_rating: 130 },
    ],
  },
  {
    name: 'King Robert the Bruce',
    tees: [
      { tee: 'White', course_rating: 72.6, slope_rating: 131 },
      { tee: 'Yellow', course_rating: 71.0, slope_rating: 130 },
      { tee: 'Red', course_rating: 68.7, slope_rating: 125 },
    ],
  },
  {
    name: 'The Championship Ailsa',
    tees: [
      { tee: 'Black', course_rating: 77.3, slope_rating: 147 },
      { tee: 'White', course_rating: 73.0, slope_rating: 140 }, // was 72.0 / 130 (2017 yardage guide)
      { tee: 'Blue', course_rating: 72.7, slope_rating: 139 },
      { tee: 'Yellow', course_rating: 70.6, slope_rating: 136 },
      { tee: 'Red', course_rating: 68.7, slope_rating: 131 },
    ],
  },
];

for (const c of COURSES) {
  const records = await run(db.from('courses').select('id, tee').eq('name', c.name));
  // The tee the app already has (unnamed) becomes White; its holes are the template for the others.
  const unnamed = records.find((r: { tee: string | null }) => r.tee === null);
  if (unnamed && !records.some((r: { tee: string | null }) => r.tee === 'White')) {
    await run(db.from('courses').update({ tee: 'White' }).eq('id', unnamed.id));
  }
  const white = (await run(db.from('courses').select('id').eq('name', c.name).eq('tee', 'White')))[0];
  if (!white) throw new Error(`${c.name}: no existing tee to copy holes from`);
  const holes = await run(db.from('course_holes').select('hole, par, stroke_index').eq('course_id', white.id));
  if (holes.length !== 18) throw new Error(`${c.name}: expected 18 holes, found ${holes.length}`);
  for (const t of c.tees) {
    const found = (await run(db.from('courses').select('id').eq('name', c.name).eq('tee', t.tee)))[0];
    const id: string = found?.id ?? (await run(db.from('courses').insert({ name: c.name, ...t }).select('id').single())).id;
    await run(db.from('courses').update({ course_rating: t.course_rating, slope_rating: t.slope_rating }).eq('id', id));
    if (id !== white.id) {
      await run(db.from('course_holes').delete().eq('course_id', id));
      await run(db.from('course_holes').insert(holes.map((h: object) => ({ ...h, course_id: id }))));
    }
  }
  console.log(`${c.name}: ${c.tees.map((t) => `${t.tee} ${t.course_rating}/${t.slope_rating}`).join(' · ')}`);
}
