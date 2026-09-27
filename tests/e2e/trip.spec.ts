import { expect, test } from '@playwright/test';
import { enterHole, group1Card, login, loginAdmin, newPhone, openGroup1, reseed } from './helpers';

test.beforeEach(() => reseed());

test('wrong password is rejected', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByText('Wrong password')).toBeVisible();
});

test('a saved hole appears live on another phone', async ({ browser }) => {
  const viewer = await newPhone(browser);
  const scorer = await newPhone(browser);
  await login(viewer);
  await login(scorer);
  await expect(group1Card(viewer).getByTestId('status')).toHaveText('Not started');

  await openGroup1(scorer);
  await enterHole(scorer, 1, 4, 5);

  await expect(group1Card(viewer).getByTestId('status')).toHaveText('1 UP');
  await expect(group1Card(viewer)).toContainText('THRU 1');
  await expect(viewer.getByTestId('proj-a')).toHaveText('1');
});

test('an earlier hole can be corrected later', async ({ page }) => {
  await login(page);
  await openGroup1(page);
  await enterHole(page, 1, 4, 5);
  await enterHole(page, 2, 4, 5);
  await enterHole(page, 3, 4, 5);
  await enterHole(page, 1, 4, 3); // B now wins hole 1
  await page.goto('/#/');
  await expect(group1Card(page).getByTestId('status')).toHaveText('1 UP'); // A: -1 +1 +1
  await expect(group1Card(page)).toContainText('THRU 3');
});

test('confirming a decided match locks it and turns the points solid', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await login(page);
  await openGroup1(page);
  for (let h = 1; h <= 10; h++) await enterHole(page, h, 4, 5);

  await page.goto('/#/');
  await expect(group1Card(page).getByTestId('status')).toHaveText('10&8');
  await group1Card(page).click();
  const groupId = page.url().split('/match/')[1].split('/')[0];
  await page.getByRole('button', { name: 'Confirm result' }).click();
  await expect(page.getByTestId('match-card')).toContainText('FINAL');

  await page.goto('/#/');
  await expect(page.getByTestId('conf-a')).toHaveText('1');

  // A confirmed match drops off the Scores list...
  await page.goto('/#/score');
  await expect(page.getByTestId('score-pick').first()).toBeVisible();
  await expect(page.getByTestId('score-pick').filter({ hasText: /^Match 1\b/ })).toHaveCount(0);

  // ...and its holes are locked if opened directly.
  await page.goto(`/#/score/${groupId}`);
  await page.getByRole('button', { name: 'Hole 5', exact: true }).click();
  await expect(page.getByTestId('row-A1')).toContainText('Locked');
  await expect(page.getByTestId('row-A1').getByRole('button', { name: /^Increase/ })).toBeDisabled();
});

test('scores entered offline are sent when signal returns', async ({ browser }) => {
  const viewer = await newPhone(browser);
  const scorer = await newPhone(browser);
  await login(viewer);
  await login(scorer);
  await openGroup1(scorer);

  await scorer.context().setOffline(true);
  await enterHole(scorer, 1, 4, 5);
  await expect(scorer.getByTestId('pending')).toHaveText('4 waiting to send');
  await expect(group1Card(viewer).getByTestId('status')).toHaveText('Not started');

  await scorer.context().setOffline(false);
  await expect(scorer.getByTestId('pending')).toBeHidden({ timeout: 30_000 });
  await expect(group1Card(viewer).getByTestId('status')).toHaveText('1 UP', { timeout: 30_000 });
});

test('a player photo can be uploaded', async ({ page }) => {
  await login(page);
  await page.goto('/#/players');
  const row = page.getByTestId('player-row').first();
  await row.locator('input[type=file]').setInputFiles('public/icon-512.png');
  await expect(row.locator('img')).toBeVisible();
});

test('the admin can reopen a confirmed match for scoring', async ({ browser }) => {
  const trip = await newPhone(browser);
  trip.on('dialog', (d) => void d.accept());
  await login(trip);
  await openGroup1(trip);
  for (let h = 1; h <= 10; h++) await enterHole(trip, h, 4, 5);
  await trip.goto('/#/');
  await group1Card(trip).click();
  await trip.getByRole('button', { name: 'Confirm result' }).click();
  await expect(trip.getByTestId('match-card')).toContainText('FINAL');

  const admin = await newPhone(browser);
  admin.on('dialog', (d) => void d.accept());
  await loginAdmin(admin);
  await admin.goto('/#/admin/results');
  await admin.getByTestId('reopen-row').filter({ hasText: /^Match 1\b/ }).getByRole('button', { name: 'Reopen' }).click();
  await expect(admin.getByText('Match 1 reopened')).toBeVisible();

  // The scorer's phone still remembers Match 1, so Scores goes straight back into it...
  await trip.goto('/#/score');
  await expect(trip.getByText(/· Match 1$/)).toBeVisible();
  // ...and it is back on the list of matches to score.
  await trip.getByRole('link', { name: '← All matches' }).click();
  await expect(trip.getByTestId('score-pick').filter({ hasText: /^Match 1\b/ })).toHaveCount(1);
  await trip.goto('/#/');
  await expect(trip.getByTestId('conf-a')).toHaveText('0'); // points back to projected
});

test('non-admins only see the Leaderboard and Scores tabs', async ({ page }) => {
  await login(page);
  await expect(page.locator('nav a')).toHaveText(['Leaderboard', 'Scores']);
});

test('the Scores tab goes back to the match this phone is scoring', async ({ page }) => {
  await login(page);
  await page.goto('/#/score');
  await page.getByTestId('score-pick').filter({ hasText: /^Match 2\b/ }).click();
  await expect(page.getByText(/· Match 2$/)).toBeVisible();
  await page.getByRole('link', { name: 'Leaderboard' }).click();
  await page.getByRole('link', { name: 'Scores' }).click();
  await expect(page.getByText(/· Match 2$/)).toBeVisible();
  await page.getByRole('link', { name: '← All matches' }).click();
  await expect(page.getByTestId('score-pick')).not.toHaveCount(0);
});
