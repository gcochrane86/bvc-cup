// Course guides saved on the phone up front, so every hole can be looked at with no signal. Built-in guide
// pages go in the service worker's app cache; uploaded guide photos go in its photo cache, keyed the way
// public/sw.js keys them (file name, without the hourly link token). The cache names must match sw.js.
import { holePhotos, guidePages, type Guide } from './guides';

export const SHELL_CACHE = 'golf-shell-v2';
export const PHOTO_CACHE = 'golf-photos-v1';

/** What a set of guides needs on the phone: built-in pages (relative to the app) and uploaded photo paths. */
export function guideFiles<P extends { course_name: string; hole: number; path: string }>(
  guides: Guide[],
  photos: P[],
): { pages: string[]; photos: string[] } {
  const pages: string[] = [];
  const paths: string[] = [];
  for (const g of guides) {
    for (let hole = 1; hole <= 18; hole++) {
      const own = holePhotos(g, hole, photos);
      // A hole with uploaded photos shows those instead of its built-in pages.
      if (own.length) paths.push(...own.map((p) => p.path));
      else if (g.kind !== 'photos') pages.push(...guidePages(g.slug, hole));
    }
  }
  return { pages: [...new Set(pages)], photos: [...new Set(paths)] };
}

/** An uploaded guide photo's address without a link token: the service worker serves its kept copy. */
export function guidePhotoKey(supabaseUrl: string, path: string): string {
  const u = new URL(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/sign/course-guides/${path}`);
  return u.origin + u.pathname;
}
