/** Split a list into the admin's favourites and everyone else, each keeping the list's order. */
export function favouritesFirst<T extends { id: string }>(list: T[], favourites: string[]): { favourites: T[]; others: T[] } {
  const fav = new Set(favourites);
  return { favourites: list.filter((p) => fav.has(p.id)), others: list.filter((p) => !fav.has(p.id)) };
}
