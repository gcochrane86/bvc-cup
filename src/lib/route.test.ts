import { describe, it, expect } from 'vitest';
import { parseRoute } from './route';

describe('parseRoute', () => {
  it.each([
    ['', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/match/g1/low_singles', { name: 'match', groupId: 'g1', matchType: 'low_singles' }],
    ['#/score', { name: 'score', groupId: null, hole: null }],
    ['#/score/g1', { name: 'score', groupId: 'g1', hole: null }],
    ['#/score/g1/7', { name: 'score', groupId: 'g1', hole: 7 }],
    ['#/score/g1/19', { name: 'not-found' }],
    ['#/guide', { name: 'guide' }],
    ['#/form', { name: 'form' }],
    ['#/scorecards', { name: 'scorecards' }],
    ['#/admin', { name: 'admin' }],
    ['#/admin/login', { name: 'admin-login' }],
    ['#/admin/players', { name: 'admin-players' }],
    ['#/admin/results', { name: 'not-found' }], // Reopen moved to each event's admin page
    ['#/admin/access', { name: 'admin-access' }],
    ['#/admin/courses', { name: 'admin-courses' }],
    ['#/admin/guide/c1', { name: 'admin-guide', courseId: 'c1' }],
    ['#/admin/courses/new', { name: 'admin-course', courseId: 'new', copyFrom: null }],
    ['#/admin/courses/new/c1', { name: 'admin-course', courseId: 'new', copyFrom: 'c1' }],
    ['#/admin/events', { name: 'admin-events' }],
    ['#/admin/events/e1', { name: 'admin-event', eventId: 'e1' }],
    ['#/admin/pairings/r1', { name: 'admin-pairings', roundId: 'r1' }],
    ['#/match/g1/bogus', { name: 'not-found' }],
    ['#/nope', { name: 'not-found' }],
    ['#/players', { name: 'not-found' }], // photos are added in Admin → Players
  ])('parses %s', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });
});
