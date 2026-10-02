import { describe, expect, it } from 'vitest';
import { favouritesFirst } from './favourites';

describe('favouritesFirst', () => {
  const people = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  it('puts favourites first and keeps each group in its given order', () => {
    expect(favouritesFirst(people, ['d', 'b'])).toEqual({ favourites: [{ id: 'b' }, { id: 'd' }], others: [{ id: 'a' }, { id: 'c' }] });
  });
  it('with no favourites, everyone is in others', () => {
    expect(favouritesFirst(people, [])).toEqual({ favourites: [], others: people });
  });
});
