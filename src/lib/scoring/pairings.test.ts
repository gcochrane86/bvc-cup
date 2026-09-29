import { describe, it, expect } from 'vitest';
import { autoFourball, orderSlots, pairingErrors } from './pairings';

describe('orderSlots', () => {
  it('puts the lower handicap in slot 1', () => {
    expect(orderSlots('B', [{ playerId: 'x', handicap: 20 }, { playerId: 'y', handicap: 7 }])).toEqual([
      { slot: 'B1', playerId: 'y', handicap: 7 },
      { slot: 'B2', playerId: 'x', handicap: 20 },
    ]);
  });
  it('keeps the given order on a tie', () => {
    expect(orderSlots('A', [{ playerId: 'x', handicap: 9 }, { playerId: 'y', handicap: 9 }]).map((p) => p.playerId)).toEqual(['x', 'y']);
  });
});

describe('pairingErrors', () => {
  it('accepts complete, distinct groups', () => {
    expect(pairingErrors([{ a: ['1', '2'], b: ['3', '4'] }, { a: ['5', '6'], b: ['7', '8'] }])).toEqual([]);
  });
  it('reports incomplete groups', () => {
    expect(pairingErrors([{ a: ['1', null], b: ['3', '4'] }])).toEqual(['Group 1 needs 4 players']);
  });
  it('reports a player used twice', () => {
    expect(pairingErrors([{ a: ['1', '2'], b: ['3', '4'] }, { a: ['1', '6'], b: ['7', '8'] }])).toEqual([
      'A player is in more than one place (group 1 and group 2)',
    ]);
  });
});

describe('autoFourball', () => {
  const m = (playerId: string, team: 'A' | 'B', handicap: number) => ({ playerId, team, handicap });

  it('pairs a two-v-two event by team, lower handicap in slot 1', () => {
    expect(autoFourball([m('a-high', 'A', 20), m('b1', 'B', 8), m('a-low', 'A', 5), m('b2', 'B', 12)])).toEqual([
      { slot: 'A1', player_id: 'a-low' },
      { slot: 'A2', player_id: 'a-high' },
      { slot: 'B1', player_id: 'b1' },
      { slot: 'B2', player_id: 'b2' },
    ]);
  });

  it('leaves bigger (or incomplete) events to be paired by hand', () => {
    expect(autoFourball([m('a1', 'A', 5), m('a2', 'A', 6), m('a3', 'A', 7), m('b1', 'B', 8), m('b2', 'B', 9), m('b3', 'B', 1)])).toBeNull();
    expect(autoFourball([m('a1', 'A', 5), m('a2', 'A', 6), m('b1', 'B', 8)])).toBeNull();
  });
});
