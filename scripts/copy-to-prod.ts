// Copies the trip SETUP from golf-dev to golf-prod: players (with photos), courses, the event, rounds
// and pairings. Prod's setup tables are replaced with an exact copy (same ids). Scores and results
// are never copied, and the script refuses to run if prod already has any — so it can't wipe a live trip.
//
// Usage:
//   node --import tsx scripts/copy-to-prod.ts --dry-run   # show what would be copied (reads dev only)
//   node --import tsx scripts/copy-to-prod.ts --yes       # do it
// Reads .env.local (dev) and .env.prod (prod); both need SUPABASE_SECRET_KEY.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const dryRun = process.argv.includes('--dry-run');
if (!dryRun && !process.argv.includes('--yes')) {
  console.error('Refusing to run without --yes (or use --dry-run). This REPLACES the setup data in golf-prod.');
  process.exit(1);
}

function env(file: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}
function client(file: string): SupabaseClient {
  const e = env(file);
  if (!e.VITE_SUPABASE_URL || !e.SUPABASE_SECRET_KEY || e.SUPABASE_SECRET_KEY.endsWith('xxx')) {
    throw new Error(`${file} needs VITE_SUPABASE_URL and a real SUPABASE_SECRET_KEY`);
  }
  return createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function run<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}
const NONE = '00000000-0000-0000-0000-000000000000';

// Parents before children.
const TABLES = ['players', 'courses', 'course_holes', 'events', 'event_players', 'rounds', 'groups', 'group_players'] as const;

const dev = client('.env.local');
const rows: Record<string, Record<string, unknown>[]> = {};
for (const t of TABLES) rows[t] = await run(dev.from(t).select('*'));
const photos = rows.players.map((p) => p.photo_path).filter((p): p is string => typeof p === 'string' && p.length > 0);

console.log('From golf-dev:');
for (const t of TABLES) console.log(`  ${t.padEnd(14)} ${rows[t].length}`);
console.log(`  photos         ${photos.length}`);
for (const e of rows.events) console.log(`  event: ${e.name}${e.is_active ? ' (active)' : ''}`);
if (dryRun) process.exit(0);

const prod = client('.env.prod');
const [scores, results] = await Promise.all([
  run(prod.from('scores').select('round_id', { count: 'exact', head: true }).then((r) => ({ ...r, data: r.count }))),
  run(prod.from('match_results').select('group_id', { count: 'exact', head: true }).then((r) => ({ ...r, data: r.count }))),
]);
if ((scores ?? 0) > 0 || (results ?? 0) > 0) {
  console.error(`golf-prod already has ${scores} scores and ${results} results — refusing to replace its setup.`);
  process.exit(1);
}

// Wipe prod setup (events cascade to rounds/groups/pairings; players and courses cascade the rest).
await run(prod.from('events').delete().neq('id', NONE));
await run(prod.from('players').delete().neq('id', NONE));
await run(prod.from('courses').delete().neq('id', NONE));

for (const t of TABLES) {
  if (rows[t].length) await run(prod.from(t).insert(rows[t]));
  console.log(`Copied ${t}`);
}

for (const path of photos) {
  const blob = await run(dev.storage.from('player-photos').download(path));
  await run(prod.storage.from('player-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true }));
}
console.log(`Copied ${photos.length} photos. golf-prod now matches golf-dev's setup (no scores or results).`);
