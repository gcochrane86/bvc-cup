import type { Session } from '@supabase/supabase-js';
import { ADMIN_EMAIL, TRIP_EMAIL, supabase } from './supabase';

export const auth = $state<{ ready: boolean; session: Session | null }>({ ready: false, session: null });

export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  auth.session = data.session;
  auth.ready = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    auth.session = session;
  });
}

export function isAdmin(): boolean {
  return auth.session?.user?.app_metadata?.role === 'admin';
}

export async function login(password: string, mode: 'trip' | 'admin'): Promise<string | null> {
  const email = mode === 'admin' ? ADMIN_EMAIL : TRIP_EMAIL;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? 'Wrong password' : null;
}

export async function logout() {
  await supabase.auth.signOut();
  location.hash = '#/';
}
