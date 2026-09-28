// Per-person access list (public.members): who has logged in, and whether the admin has let them in.
export interface Member {
  user_id: string;
  email: string;
  status: 'pending' | 'approved' | 'removed';
  created_at: string;
  decided_at: string | null;
}

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/** For the admin's Access tab: people waiting first; newest first within each group. */
export function groupMembers(members: Member[]): { waiting: Member[]; approved: Member[]; removed: Member[] } {
  const newest = (a: Member, b: Member) => Date.parse(b.created_at) - Date.parse(a.created_at);
  const by = (s: Member['status']) => members.filter((m) => m.status === s).sort(newest);
  return { waiting: by('pending'), approved: by('approved'), removed: by('removed') };
}
