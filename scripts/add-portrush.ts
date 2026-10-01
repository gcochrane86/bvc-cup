// Adds Royal Portrush's two courses, each with its men's tees (every men's tee shares the course's par and
// stroke index). Safe to run twice: tees are found by (name, tee) before creating.
// Usage: npm run add-portrush -- --env .env.local
//
// Sources (Oct 2026): golfify.io scorecards and ratings for both courses; the Dunluce pars and stroke indexes
// match the club's own hole-by-hole card (royalportrushgolfclub.com). The Valley's ladies' tee has its own
// pars and stroke indexes, so it is left out.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const at = process.argv.indexOf('--env');
const envFile = at >= 0 ? process.argv[at + 1] : undefined;
if (!envFile) {
  console.error('Usage: npm run add-portrush -- --env <.env file>');
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
const COURSES: { name: string; pars: number[]; si: number[]; tees: Tee[] }[] = [
  {
    name: 'Royal Portrush – Dunluce',
    pars: [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 5, 5, 3, 4, 4, 3, 4, 4],
    si: [7, 13, 17, 1, 15, 11, 5, 9, 3, 16, 8, 12, 18, 2, 10, 4, 14, 6],
    tees: [
      { tee: 'Championship', course_rating: 76.2, slope_rating: 140 },
      { tee: 'White', course_rating: 72.4, slope_rating: 131 },
      { tee: 'Society', course_rating: 70.7, slope_rating: 127 },
      { tee: 'Black', course_rating: 68.8, slope_rating: 123 },
    ],
  },
  {
    name: 'Royal Portrush – Valley',
    pars: [4, 4, 3, 5, 4, 4, 4, 5, 3, 4, 5, 4, 3, 4, 3, 5, 3, 4],
    si: [7, 3, 17, 11, 1, 5, 13, 9, 15, 2, 18, 4, 16, 12, 8, 14, 10, 6],
    tees: [
      { tee: 'Championship', course_rating: 70.3, slope_rating: 117 },
      { tee: 'Medal', course_rating: 69.4, slope_rating: 118 },
    ],
  },
];

for (const c of COURSES) {
  if (c.pars.length !== 18 || [...c.si].sort((a, b) => a - b).join() !== Array.from({ length: 18 }, (_, i) => i + 1).join())
    throw new Error(`${c.name}: needs 18 pars and stroke indexes 1–18 once each`);
  for (const t of c.tees) {
    const found = await run(db.from('courses').select('id').eq('name', c.name).eq('tee', t.tee));
    const id: string = found[0]?.id ?? (await run(db.from('courses').insert({ name: c.name, ...t }).select('id').single())).id;
    await run(db.from('courses').update({ course_rating: t.course_rating, slope_rating: t.slope_rating }).eq('id', id));
    // Replace the holes rather than upsert: stroke indexes are unique per course.
    await run(db.from('course_holes').delete().eq('course_id', id));
    await run(db.from('course_holes').insert(c.pars.map((par, i) => ({ course_id: id, hole: i + 1, par, stroke_index: c.si[i] }))));
    console.log(`${c.name} · ${t.tee} (par ${c.pars.reduce((a, b) => a + b)}, ${t.course_rating}/${t.slope_rating})`);
  }
}
