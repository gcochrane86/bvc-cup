import { expect, test } from '@playwright/test';
import { enterHole, group1Card, login, openGroup1, reseed } from '../e2e/helpers';

test('the app opens with no signal from the copy saved on the phone, and scores entered then send later', async ({ page }) => {
  reseed();
  await login(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(group1Card(page)).toBeVisible();

  // Closed and reopened with no signal, an hour later (its sign-in token has run out).
  await page.context().setOffline(true);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))!;
    const s = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) - 60 }));
  });
  await page.reload();
  await expect(group1Card(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('offline')).toContainText('No signal');

  await openGroup1(page);
  await enterHole(page, 1, 4, 5);
  await expect(page.getByTestId('pending')).toHaveText('4 waiting to send');

  await page.context().setOffline(false);
  await expect(page.getByTestId('pending')).toBeHidden({ timeout: 45_000 });
  await expect(page.getByTestId('offline')).toBeHidden({ timeout: 30_000 });
});
