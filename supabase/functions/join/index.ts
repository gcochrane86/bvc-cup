// POST { email, password } → { token_hash } for supabase.auth.verifyOtp({ type: 'magiclink', token_hash }).
// Checks the trip password (by signing in to the shared trip account), creates the person's own account
// on first use and adds them to the access list as 'pending'. Access to data is decided by the list
// (public.members), which only the admin can change — this function never approves anyone.
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TRIP_EMAIL = 'trip@example.com';
const RESERVED = new Set([TRIP_EMAIL, 'admin@example.com']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  let email = '';
  let password = '';
  try {
    const body = await req.json();
    email = String(body.email ?? '').trim().toLowerCase();
    password = String(body.password ?? '');
  } catch {
    return reply(400, { error: 'Bad request' });
  }
  if (!EMAIL.test(email) || email.length > 200) return reply(400, { error: 'Please enter a valid email address' });
  if (RESERVED.has(email)) return reply(400, { error: 'Please use your own email address' });

  // The trip password is checked against the shared trip account, so it isn't stored anywhere new.
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const check = await anon.auth.signInWithPassword({ email: TRIP_EMAIL, password });
  if (check.error) return reply(401, { error: 'Wrong password' });
  await anon.auth.signOut();

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Find or create this person's own account.
  let userId: string | null = null;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.data.user) {
    userId = created.data.user.id;
  } else {
    for (let page = 1; !userId && page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return reply(500, { error: 'Could not look up your account' });
      userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      if (data.users.length < 200) break;
    }
    if (!userId) return reply(500, { error: 'Could not create your account' });
  }

  // First time in: add to the access list as pending (an existing entry, e.g. removed, is left as is).
  const listed = await admin.from('members').upsert({ user_id: userId, email }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (listed.error) return reply(500, { error: 'Could not add you to the access list' });

  // Sign them in: a one-off login token (no email is sent).
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error || !link.data.properties?.hashed_token) return reply(500, { error: 'Could not sign you in' });
  return reply(200, { token_hash: link.data.properties.hashed_token });
});
