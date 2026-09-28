// Which match (group) this phone is scoring — shared by the Scores page (to resume it) and the
// Leaderboard (to open on that match's day).
const KEY = 'golf.scoringGroup';

export function readScoringGroup(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // private mode
  }
}

export function rememberScoringGroup(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
