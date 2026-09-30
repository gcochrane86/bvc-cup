// An event's share link (#/watch/<token>): this phone remembers it, so the saved app keeps opening the
// event (follow and score, no sign-in) until the admin turns the link off or replaces it.
const KEY = 'golf.watch';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** ended: the link this phone had was turned off (the sign-in page says so). */
export const watch = $state<{ token: string | null; ended: boolean }>({ token: read(), ended: false });

export function startWatching(token: string) {
  watch.token = token;
  watch.ended = false;
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* private mode: the link works until the page is closed */
  }
}

export function endWatching() {
  watch.token = null;
  watch.ended = true;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

/** A new random share token (22 URL-safe characters). */
export function newWatchToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The link to share, for this site. */
export const watchLink = (token: string) => `${location.origin}${location.pathname}#/watch/${token}`;
