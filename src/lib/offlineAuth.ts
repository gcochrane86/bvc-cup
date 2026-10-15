// Opening the app with no signal: the sign-in and the access-list answer this phone last had.
import type { Session } from '@supabase/supabase-js';
import type { Member } from './access';

type Access = { access: Member['status'] | 'none'; role: Member['role'] };

const ACCESS_KEY = 'golf.access';

/** The sign-in kept in storage (its hour-long token may have run out; it's renewed once there's signal). */
export function offlineSession(storageKey: string, storage: Pick<Storage, 'getItem'> = localStorage): Session | null {
  try {
    const s = JSON.parse(storage.getItem(storageKey) ?? 'null') as Session | null;
    return s?.access_token && s.refresh_token && s.user?.id ? s : null;
  } catch {
    return null;
  }
}

/** What the access list last said for this person on this phone (null: nothing, or someone else). */
export function readAccessMemory(uid: string, storage: Pick<Storage, 'getItem'> = localStorage): Access | null {
  try {
    const v = JSON.parse(storage.getItem(ACCESS_KEY) ?? 'null') as (Access & { uid: string }) | null;
    return v && v.uid === uid ? { access: v.access, role: v.role } : null;
  } catch {
    return null;
  }
}

/** null: forget (signing out). */
export function rememberAccess(uid: string | null, a?: Access, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage) {
  try {
    if (!uid || !a) storage.removeItem(ACCESS_KEY);
    else storage.setItem(ACCESS_KEY, JSON.stringify({ uid, ...a }));
  } catch {
    /* private mode */
  }
}
