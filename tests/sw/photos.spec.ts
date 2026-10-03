import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { login, reseed, serviceDb } from '../e2e/helpers';

test('a guide photo downloads once: the phone keeps it, so a fresh link next time downloads nothing', async ({ page }) => {
  reseed();
  const db = serviceDb();
  const path = `seed-links/1/sw-check-${Date.now()}.jpg`;
  await db.storage.from('course-guides').upload(path, readFileSync('public/icon-512.png'), { contentType: 'image/png' });
  await db.from('guide_photos').insert({ course_name: 'Seed Links', hole: 1, path });
  try {
    await login(page);
    // The service worker takes over the page after the first visit.
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.getByRole('link', { name: 'Courses' }).click();
    const photo = page.getByRole('img', { name: 'Hole 1 photo 1' });
    await expect.poll(() => photo.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    // Kept by file name, without the changing token.
    const kept = await page.evaluate(async () => (await (await caches.open('golf-photos-v1')).keys()).map((r) => r.url));
    expect(kept.some((u) => u.endsWith(path) && !u.includes('token'))).toBe(true);

    // Second visit, fresh link: downloads of photo files are blocked, so it can only come from the phone.
    let blocked = 0;
    await page.context().route('**/storage/v1/object/sign/course-guides/**', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      blocked++;
      return route.abort();
    });
    await page.reload();
    await page.getByRole('link', { name: 'Courses' }).click();
    await expect.poll(() => page.getByRole('img', { name: 'Hole 1 photo 1' }).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    expect(blocked).toBe(0); // nothing even tried to download it
  } finally {
    await db.from('guide_photos').delete().eq('path', path);
    await db.storage.from('course-guides').remove([path]);
  }
});
