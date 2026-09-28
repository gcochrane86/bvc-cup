// Offline-friendly service worker, tuned for poor signal on the course.
// - Built app files (/assets/, hashed names that never change): cache first — no network needed.
// - The page itself: network for at most PAGE_TIMEOUT_MS, else the saved copy (refreshed in the
//   background), so a weak signal never leaves the app hanging on open. A new release therefore
//   shows up on the next open after it has been fetched.
// - Everything else of ours (guide pages, icons, manifest): saved copy at once, refreshed in the background.
// Supabase data and YouTube are other origins and are not touched here (scores queue in the app's outbox).
const CACHE = 'golf-shell-v2';
const PAGE_TIMEOUT_MS = 2500;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/assets/')) event.respondWith(cacheFirst(req));
  else if (req.mode === 'navigate') event.respondWith(pageFast(req));
  else event.respondWith(staleWhileRevalidate(req, event));
});
