// Offline-friendly service worker, tuned for poor signal on the course.
// - Built app files (/assets/, hashed names that never change): cache first — no network needed.
// - The page itself: network for at most PAGE_TIMEOUT_MS, else the saved copy (refreshed in the
//   background), so a weak signal never leaves the app hanging on open. A new release therefore
//   shows up on the next open after it has been fetched.
// - Everything else of ours (guide pages, icons, manifest): saved copy at once, refreshed in the background.
// - Guide and player photos (Supabase storage, private links that change every hour): kept on the phone by
//   file name, so each photo downloads once, not again every time someone looks. File names never change
//   (a new photo gets a new name), so a kept copy is never out of date.
// Other Supabase data and YouTube are not touched here (scores queue in the app's outbox).
const CACHE = 'golf-shell-v2';
const PAGE_TIMEOUT_MS = 2500;
const PHOTOS = 'golf-photos-v1';
const MAX_PHOTOS = 600; // oldest go first beyond this (a few course guides' worth)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE && key !== PHOTOS) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function pageFast(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const cached = await cache.match(req);
  if (!cached) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), PAGE_TIMEOUT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

/** A guide or player photo's file, without its changing link token (null: not one of ours). */
function photoKey(url) {
  return /\/storage\/v1\/object\/sign\/(course-guides|player-photos)\//.test(url.pathname) ? url.origin + url.pathname : null;
}

async function photoFirst(req, key) {
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(key);
  if (hit) return hit;
  let res;
  try {
    res = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); // readable, so it can be kept
  } catch {
    return fetch(req);
  }
  if (res.ok) {
    await cache.put(key, res.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_PHOTOS))) await cache.delete(old);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  const photo = photoKey(url);
  if (photo) return event.respondWith(photoFirst(req, photo));
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/assets/')) event.respondWith(cacheFirst(req));
  else if (req.mode === 'navigate') event.respondWith(pageFast(req));
  else event.respondWith(staleWhileRevalidate(req, event));
});
