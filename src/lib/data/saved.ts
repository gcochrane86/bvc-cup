// The event as this phone last loaded it, kept in IndexedDB so the app still opens (and scores can still be
// entered) when it's started with no signal. One copy per way in: a sign-in or an event's share link.
import { createStore, del, get, set } from 'idb-keyval';
import type { GameRow } from '../games';
import type { GuidePhotoRow, Snapshot } from './types';

export type SavedMode = 'member' | 'watch';

export interface SavedEvent extends Snapshot {
  guidePhotos: GuidePhotoRow[];
  games: GameRow[];
  /** Player photo links (their tokens may have run out: the service worker serves its kept copies by file). */
  photoUrls: Record<string, string>;
  /** When it was saved (ms). */
  savedAt: number;
  /** Who it was saved for (a sign-in's user id, or the share link's token): never shown to anyone else. */
  owner: string;
}

const idb = createStore('golf-saved', 'events');

export async function saveEvent(mode: SavedMode, e: SavedEvent): Promise<void> {
  try {
    await set(mode, e, idb);
  } catch {
    /* private mode or storage full: the app just won't open offline */
  }
}

/** The saved copy, if it was saved for this owner. */
export async function readSavedEvent(mode: SavedMode, owner: string | null | undefined): Promise<SavedEvent | null> {
  if (!owner) return null;
  try {
    const e = await get<SavedEvent>(mode, idb);
    return e && e.owner === owner ? e : null;
  } catch {
    return null;
  }
}

/** On signing out (both copies), or when a share link is turned off (that copy). */
export async function forgetSavedEvents(modes: SavedMode[] = ['member', 'watch']): Promise<void> {
  try {
    await Promise.all(modes.map((m) => del(m, idb)));
  } catch {
    /* nothing saved */
  }
}
