import { describe, it, expect } from 'vitest';
import { offlineSession, readAccessMemory, rememberAccess } from './offlineAuth';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('opening with no signal', () => {
  it('keeps a stored sign-in even when its hour-long token has run out', () => {
    const s = mem();
    s.setItem('sb-x-auth-token', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u1' } }));
    expect(offlineSession('sb-x-auth-token', s)?.user.id).toBe('u1');
  });

  it('has no sign-in when nothing usable is stored', () => {
    const s = mem();
    expect(offlineSession('sb-x-auth-token', s)).toBeNull();
    s.setItem('sb-x-auth-token', '{not json');
    expect(offlineSession('sb-x-auth-token', s)).toBeNull();
    s.setItem('sb-x-auth-token', JSON.stringify({ access_token: 'a', user: { id: 'u1' } }));
    expect(offlineSession('sb-x-auth-token', s)).toBeNull();
  });

  it("remembers the access list's answer for that person only, and forgets it on signing out", () => {
    const s = mem();
    rememberAccess('u1', { access: 'approved', role: 'organiser' }, s);
    expect(readAccessMemory('u1', s)).toEqual({ access: 'approved', role: 'organiser' });
    expect(readAccessMemory('u2', s)).toBeNull();
    rememberAccess(null, undefined, s);
    expect(readAccessMemory('u1', s)).toBeNull();
  });
});
