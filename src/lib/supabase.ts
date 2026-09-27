import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY; // publishable key — safe in the browser; RLS protects data
if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_KEY must be set');

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const TRIP_EMAIL = import.meta.env.VITE_TRIP_EMAIL ?? 'trip@example.com';
export const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL ?? 'admin@example.com';

/** Await a Supabase query/RPC and return its data, throwing on error. */
export async function must<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
