// Downloads the event's course guides onto the phone once (only files it doesn't have yet), so the Courses
// tab works on every hole with no signal. Runs only when the service worker is in charge of the page (the
// live site, not dev), since that's what serves the saved copies.
import { guidePhotoUrls } from './guidePhotos';
import { guideFiles, guidePhotoKey, PHOTO_CACHE, SHELL_CACHE } from './guideOffline';
import type { Guide } from './guides';
import type { GuidePhotoRow } from './data/types';

export const guideSave = $state({ total: 0, done: 0, saving: false, complete: false });

let running = false;
let savedSig = '';

export async function saveGuidesOnPhone(guides: Guide[], photos: GuidePhotoRow[]) {
  if (running || typeof caches === 'undefined' || !navigator.serviceWorker?.controller) return;
  const { pages, photos: paths } = guideFiles(guides, photos);
  const sig = JSON.stringify([pages, paths]);
  if (sig === savedSig) return;
  running = true;
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const [shell, pics] = await Promise.all([caches.open(SHELL_CACHE), caches.open(PHOTO_CACHE)]);
    const pageUrls = pages.map((p) => new URL(p, location.href).href);
    const needPages = (await Promise.all(pageUrls.map(async (u) => ((await shell.match(u)) ? null : u)))).filter((u): u is string => !!u);
    const needPhotos = (await Promise.all(paths.map(async (p) => ((await pics.match(guidePhotoKey(supabaseUrl, p))) ? null : p)))).filter((p): p is string => !!p);
    const total = pages.length + paths.length;
    Object.assign(guideSave, { total, done: total - needPages.length - needPhotos.length });
    if (!needPages.length && !needPhotos.length) {
      savedSig = sig;
      guideSave.complete = true;
      return;
    }
    if (!navigator.onLine) return; // next time there's signal
    guideSave.saving = true;
    const signed = needPhotos.length ? await guidePhotoUrls(needPhotos) : {};
    const jobs: (() => Promise<void>)[] = [
      ...needPages.map((u) => async () => {
        const res = await fetch(u);
        if (!res.ok) throw new Error(`${res.status}`);
        await shell.put(u, res);
      }),
      ...needPhotos.map((p) => async () => {
        if (!signed[p]) throw new Error('not signed');
        const res = await fetch(signed[p], { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`${res.status}`);
        await pics.put(guidePhotoKey(supabaseUrl, p), res);
      }),
    ];
    let failed = false;
    // A few at a time, so the scores and leaderboard aren't held up on a weak signal.
    const worker = async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        try {
          await job();
          guideSave.done++;
        } catch {
          failed = true;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (!failed) {
      savedSig = sig;
      guideSave.complete = true;
    }
  } catch {
    /* no signal or storage full: try again on the next load */
  } finally {
    guideSave.saving = false;
    running = false;
  }
}
