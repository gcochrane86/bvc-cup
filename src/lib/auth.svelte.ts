import type { Session } from '@supabase/supabase-js';
import { ADMIN_EMAIL, supabase } from './supabase';
import { normaliseEmail, validEmail, type Member } from './access';

/** access: this person's place on the access list ('approved' for the admin; 'none' if not on it). */
export const auth = $state<{
  ready: boolean;
  session: Session | null;
  access: 'unknown' | Member['status'] | 'none';
  role: Member['role'];
}>({ ready: false, session: null, access: 'unknown', role: 'member' });

export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  auth.session = data.session;
  await refreshAccess();
  auth.ready = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    const changed = session?.user?.id !== auth.session?.user?.id;
    auth.session = session;
    if (changed) void refreshAccess();
  });
}

export function isAdmin(): boolean {
  return auth.session?.user?.app_metadata?.role === 'admin';
}

/** The admin, or an approved organiser: runs events, players and courses (not Access or Games). */
export function isOrganiser(): boolean {
  return isAdmin() || (auth.access === 'approved' && auth.role === 'organiser');
}

/** Admin pages only the admin opens (the database enforces this too). */
export const ADMIN_ONLY = ['admin-access', 'admin-games'];

/** Look up whether the signed-in person has been let in (the database enforces this too). */
export async function refreshAccess() {
  const uid = auth.session?.user?.id;
  if (!uid) return void (auth.access = 'unknown');
  if (isAdmin()) return void (auth.access = 'approved');
  const { data, error } = await supabase.from('members').select('status, role').eq('user_id', uid).maybeSingle();
  if (error) return; // offline: keep what we knew
  auth.access = (data?.status as Member['status'] | undefined) ?? 'none';
  auth.role = (data?.role as Member['role'] | undefined) ?? 'member';
}

const REMEMBER = 'golf.email';
export function rememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBER) ?? '';
  } catch {
    return '';
  }
}

/** Returns an error message, or null when signed in. */
export async function login(password: string, mode: 'trip' | 'admin', email = ''): Promise<string | null> {
  if (mode === 'admin') {
    const { error } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password });
    return error ? 'Wrong password' : null;
  }
  const address = normaliseEmail(email);
  if (!validEmail(address)) return 'Please enter a valid email address';
  // The join function checks the trip password, creates this person's account on first use and puts
  // them on the access list; it returns a one-off token to sign in with.
  const { data, error } = await supabase.functions.invoke('join', { body: { email: address, password } });
  if (error) {
    try {
      return ((await (error as { context: Response }).context.json()) as { error?: string }).error ?? 'Could not log in';
    } catch {
      return 'Could not log in — check your signal and try again';
    }
  }
  const signIn = await supabase.auth.verifyOtp({ token_hash: (data as { token_hash: string }).token_hash, type: 'magiclink' });
  if (signIn.error) return 'Could not log in — please try again';
  try {
    localStorage.setItem(REMEMBER, address);
  } catch {
    /* private mode */
  }
  auth.session = signIn.data.session;
  await refreshAccess();
  return null;
}

export async function logout() {
  await supabase.auth.signOut();
  auth.access = 'unknown';
  auth.role = 'member';
  location.hash = '#/';
}
