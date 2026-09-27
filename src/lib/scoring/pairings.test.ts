import { describe, it, expect } from 'vitest';
import { orderSlots, pairingErrors } from './pairings';

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
