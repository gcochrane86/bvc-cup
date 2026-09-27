// Creates/updates the two shared logins. Usage: npm run users  (reads .env.local)
// For production: node --env-file=.env.prod --import tsx scripts/create-users.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const tripPassword = process.env.TRIP_PASSWORD;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!url || !secret || !tripPassword || !adminPassword) {
  throw new Error('Set VITE_SUPABASE_URL, SUPABASE_SECRET_KEY, TRIP_PASSWORD and ADMIN_PASSWORD in the env file');
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureUser(email: string, password: string, role: 'trip' | 'admin') {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  const existing = data.users.find((u) => u.email === email);
  const attrs = { password, email_confirm: true, app_metadata: { role } };
  const res = existing
    ? await admin.auth.admin.updateUserById(existing.id, attrs)
    : await admin.auth.admin.createUser({ email, ...attrs });
  if (res.error) throw res.error;
  console.log(`${existing ? 'Updated' : 'Created'} ${email}`);
}

await ensureUser(process.env.VITE_TRIP_EMAIL ?? 'trip@example.com', tripPassword, 'trip');
await ensureUser(process.env.VITE_ADMIN_EMAIL ?? 'admin@example.com', adminPassword, 'admin');
