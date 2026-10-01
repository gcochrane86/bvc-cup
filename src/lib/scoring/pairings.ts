import type { SlotPlayer, Team } from './types';

export function orderSlots(team: Team, players: { playerId: string; handicap: number }[]): SlotPlayer[] {
  return [...players]
    .sort((x, y) => x.handicap - y.handicap)
    .map((p, i) => ({ slot: `${team}${i + 1}` as SlotPlayer['slot'], playerId: p.playerId, handicap: p.handicap }));
}

/**
 * A two-v-two event has only one possible fourball, so it can be paired automatically: each team's pair,
 * lower handicap in slot 1 (as the Pairings page orders them). Null for any other line-up.
 */
export function autoFourball(members: { playerId: string; team: Team; handicap: number }[]): { slot: SlotPlayer['slot']; player_id: string }[] | null {
  const team = (t: Team) => members.filter((m) => m.team === t);
  if (team('A').length !== 2 || team('B').length !== 2 || members.length !== 4) return null;
  return (['A', 'B'] as Team[]).flatMap((t) => orderSlots(t, team(t)).map((s) => ({ slot: s.slot, player_id: s.playerId })));
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

/** Individual events: each group is 2 or 3 players (empty places are null), and nobody plays twice. */
export function individualPairingErrors(groups: (string | null)[][]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  groups.forEach((g, i) => {
    const ids = g.filter((id): id is string => !!id);
    if (ids.length < 2 || ids.length > 3) errors.push(`Group ${i + 1} needs 2 or 3 players`);
    for (const id of ids) {
      const first = seen.get(id);
      if (first !== undefined) errors.push(`A player is in more than one place (group ${first + 1} and group ${i + 1})`);
      else seen.set(id, i);
    }
  });
  return errors;
}
