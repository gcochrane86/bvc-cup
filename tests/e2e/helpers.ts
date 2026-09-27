import { execSync } from 'node:child_process';
import { devices, expect, type Browser, type Page } from '@playwright/test';

export function reseed() {
  execSync('npm run seed -- --yes-wipe', { stdio: 'pipe' });
}

export async function newPhone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:5173' });
  return ctx.newPage();
}

export async function login(page: Page, password = process.env.TRIP_PASSWORD!) {
  await page.goto('/');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByTestId('tracker')).toBeVisible();
}

export async function openGroup1(page: Page) {
  await page.goto('/#/score');
  await page.getByTestId('score-pick').filter({ hasText: /^Match 1\b/ }).click();
  await expect(page.getByRole('heading', { name: /^Hole \d+$/ })).toBeVisible();
}

/** Set every player's gross on a hole (A players = a, B players = b) and save. */
export async function enterHole(page: Page, hole: number, a: number, b: number) {
  await page.getByRole('button', { name: `Hole ${hole}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `Hole ${hole}`, exact: true })).toBeVisible();
  for (const slot of ['A1', 'A2', 'B1', 'B2']) {
    const target = slot.startsWith('A') ? a : b;
    const row = page.getByTestId(`row-${slot}`);
    const value = row.getByTestId(`gross-${slot}`);
    let current = Number(await value.textContent());
    while (current < target) {
      await row.getByRole('button', { name: /^Increase/ }).click();
      current++;
    }
    while (current > target) {
      await row.getByRole('button', { name: /^Decrease/ }).click();
      current--;
    }
    await expect(value).toHaveText(String(target));
  }
  await page.getByRole('button', { name: `Save hole ${hole}` }).click();
}

export const group1Card = (page: Page) =>
  page.locator('[data-match-id$=":better_ball"]').filter({ hasText: /\bMatch 1\b/ });

export async function loginAdmin(page: Page) {
  await page.goto('/#/admin/login');
  await page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
}
