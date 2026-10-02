// This admin's favourite players, saved per admin login (player_favourites).
import { must, supabase } from '../supabase';

/** This admin's favourite players (ids). */
export async function loadFavourites(): Promise<string[]> {
  const rows = (await must(supabase.from('player_favourites').select('player_id'))) as { player_id: string }[];
  return rows.map((r) => r.player_id);
}

/** Star (on) or unstar a player for this admin. */
export async function setFavourite(playerId: string, on: boolean): Promise<void> {
  if (on) await must(supabase.from('player_favourites').insert({ player_id: playerId }));
  else await must(supabase.from('player_favourites').delete().eq('player_id', playerId));
}
