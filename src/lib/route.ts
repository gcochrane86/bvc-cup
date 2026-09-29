import type { MatchType } from './scoring';

export type Route =
  | { name: 'home' }
  | { name: 'match'; groupId: string; matchType: MatchType }
  | { name: 'score'; groupId: string | null; hole: number | null }
  | { name: 'players' }
  | { name: 'guide' }
  | { name: 'form' }
  | { name: 'admin-login' }
  | { name: 'admin' }
  | { name: 'admin-players' }
  | { name: 'admin-access' }
  | { name: 'admin-courses' }
  | { name: 'admin-course'; courseId: string; copyFrom: string | null }
  | { name: 'admin-events' }
  | { name: 'admin-event'; eventId: string }
  | { name: 'admin-pairings'; roundId: string }
  | { name: 'not-found' };

const MATCH_TYPES: MatchType[] = ['better_ball', 'low_singles', 'high_singles'];

export function parseRoute(hash: string): Route {
  const p = hash.replace(/^#/, '').split('/').filter(Boolean);
  const [a, b, c] = p;
  if (p.length === 0) return { name: 'home' };
  if (a === 'match' && p.length === 3 && MATCH_TYPES.includes(c as MatchType))
    return { name: 'match', groupId: b, matchType: c as MatchType };
  if (a === 'score' && p.length <= 2) return { name: 'score', groupId: b ?? null, hole: null };
  if (a === 'score' && p.length === 3 && /^([1-9]|1[0-8])$/.test(c)) return { name: 'score', groupId: b, hole: Number(c) };
  if (a === 'players' && p.length === 1) return { name: 'players' };
  if (a === 'guide' && p.length === 1) return { name: 'guide' };
  if (a === 'form' && p.length === 1) return { name: 'form' };
  if (a === 'admin') {
    if (p.length === 1) return { name: 'admin' };
    if (p.length === 2 && b === 'login') return { name: 'admin-login' };
    if (p.length === 2 && b === 'players') return { name: 'admin-players' };
    if (p.length === 2 && b === 'access') return { name: 'admin-access' };
    if (p.length === 2 && b === 'courses') return { name: 'admin-courses' };
    if (p.length === 3 && b === 'courses') return { name: 'admin-course', courseId: c, copyFrom: null };
    // A new tee for an existing course, copied from one of its tees (name, par and SI).
    if (p.length === 4 && b === 'courses' && c === 'new') return { name: 'admin-course', courseId: 'new', copyFrom: p[3] };
    if (p.length === 2 && b === 'events') return { name: 'admin-events' };
    if (p.length === 3 && b === 'events') return { name: 'admin-event', eventId: c };
    if (p.length === 3 && b === 'pairings') return { name: 'admin-pairings', roundId: c };
  }
  return { name: 'not-found' };
}
