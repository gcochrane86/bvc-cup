import { describe, it, expect } from 'vitest';
import { groupMembers, normaliseEmail, validEmail, type Member } from './access';

describe('access list helpers', () => {
  it('tidies emails', () => {
    expect(normaliseEmail('  Gareth.Cochrane@Example.COM ')).toBe('gareth.cochrane@example.com');
  });
  it('checks emails look real', () => {
    expect(validEmail('me@example.com')).toBe(true);
    expect(validEmail('me@example')).toBe(false);
    expect(validEmail('not an email')).toBe(false);
  });
  it('groups people waiting first, newest first within each group', () => {
    const m = (email: string, status: Member['status'], created_at: string): Member => ({ user_id: email, email, status, role: 'member', created_at, decided_at: null });
    const g = groupMembers([
      m('a@x.com', 'approved', '2026-09-01T00:00:00Z'),
      m('b@x.com', 'pending', '2026-09-02T00:00:00Z'),
      m('c@x.com', 'pending', '2026-09-03T00:00:00Z'),
      m('d@x.com', 'removed', '2026-09-04T00:00:00Z'),
    ]);
    expect(g.waiting.map((x) => x.email)).toEqual(['c@x.com', 'b@x.com']);
    expect(g.approved.map((x) => x.email)).toEqual(['a@x.com']);
    expect(g.removed.map((x) => x.email)).toEqual(['d@x.com']);
  });
});
