/** Signed photo URLs last 24h; re-sign after 12h so a phone left open across trip days keeps its photos. */
export const PHOTO_URL_TTL_S = 60 * 60 * 24;
export const PHOTO_URL_REFRESH_MS = 12 * 60 * 60 * 1000;

export interface SignedPhoto {
  url: string;
  signedAt: number;
}

/** Which cached URLs are still good for the current photo paths, and which paths need signing. */
export function planPhotoUrls(
  cache: Record<string, SignedPhoto>,
  paths: string[],
  now: number,
): { keep: Record<string, SignedPhoto>; sign: string[] } {
  const keep: Record<string, SignedPhoto> = {};
  const sign: string[] = [];
  for (const path of paths) {
    const hit = cache[path];
    if (hit && now - hit.signedAt <= PHOTO_URL_REFRESH_MS) keep[path] = hit;
    else sign.push(path);
  }
  return { keep, sign };
}
