import { describe, it, expect } from 'vitest';
import { parseRoute } from './route';

describe('parseRoute', () => {
  it.each([
    ['', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/match/g1/low_singles', { name: 'match', groupId: 'g1', matchType: 'low_singles' }],
    ['#/score', { name: 'score', groupId: null }],
    ['#/score/g1', { name: 'score', groupId: 'g1' }],
    ['#/players', { name: 'players' }],
    ['#/guide', { name: 'guide' }],
    ['#/form', { name: 'form' }],
    ['#/admin', { name: 'admin' }],
    ['#/admin/login', { name: 'admin-login' }],
    ['#/admin/players', { name: 'admin-players' }],
    ['#/admin/results', { name: 'admin-results' }],
    ['#/admin/access', { name: 'admin-access' }],
    ['#/admin/courses', { name: 'admin-courses' }],
    ['#/admin/courses/new', { name: 'admin-course', courseId: 'new' }],
    ['#/admin/events', { name: 'admin-events' }],
    ['#/admin/events/e1', { name: 'admin-event', eventId: 'e1' }],
    ['#/admin/pairings/r1', { name: 'admin-pairings', roundId: 'r1' }],
    ['#/match/g1/bogus', { name: 'not-found' }],
    ['#/nope', { name: 'not-found' }],
  ])('parses %s', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });
});
