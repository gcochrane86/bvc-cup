import type { SlotPlayer, Team } from './types';

export function orderSlots(team: Team, players: { playerId: string; handicap: number }[]): SlotPlayer[] {
  return [...players]
    .sort((x, y) => x.handicap - y.handicap)
    .map((p, i) => ({ slot: `${team}${i + 1}` as SlotPlayer['slot'], playerId: p.playerId, handicap: p.handicap }));
}

export interface PairingDraft {
  a: (string | null)[];
  b: (string | null)[];
}

export function pairingErrors(groups: PairingDraft[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  groups.forEach((g, i) => {
    const ids = [...g.a, ...g.b];
    if (ids.length !== 4 || ids.some((id) => !id)) errors.push(`Group ${i + 1} needs 4 players`);
    for (const id of ids) {
      if (!id) continue;
      const first = seen.get(id);
      if (first !== undefined) errors.push(`A player is in more than one place (group ${first + 1} and group ${i + 1})`);
      else seen.set(id, i);
    }
  });
  return errors;
}
