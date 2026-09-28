import { expect, test } from '@playwright/test';
import { enterHole, group1Card, login, loginAdmin, newPhone, openGroup1, reseed } from './helpers';

test.beforeEach(() => reseed());

test('wrong password is rejected', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your email').fill('tester@example.com');
  await page.getByLabel('Trip password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByText('Wrong password')).toBeVisible();
});

test('a new email waits for approval, the admin approves it, and can remove it again', async ({ browser }) => {
  const email = `new-${Date.now()}@example.com`;
  const phone = await newPhone(browser);
  await phone.goto('/');
  await phone.getByLabel('Your email').fill(email);
  await phone.getByLabel('Trip password').fill(process.env.TRIP_PASSWORD!);
  await phone.getByRole('button', { name: 'Enter' }).click();
  await expect(phone.getByTestId('waiting')).toContainText('Waiting for approval');
  await expect(phone.getByTestId('waiting')).toContainText(email);

  const admin = await newPhone(browser);
  admin.on('dialog', (d) => void d.accept());
  await loginAdmin(admin);
  await admin.getByRole('link', { name: /Access/ }).click();
  const row = admin.getByTestId('access-row').filter({ hasText: email });
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByText(`${email} approved`)).toBeVisible();

  // The waiting phone opens up on its own.
  await expect(phone.getByTestId('tracker')).toBeVisible({ timeout: 20_000 });

  await admin.getByTestId('access-row').filter({ hasText: email }).getByRole('button', { name: 'Remove' }).click();
  await expect(admin.getByText(`${email} removed`)).toBeVisible();
  await phone.reload();
  await expect(phone.getByTestId('waiting')).toContainText('Access removed');
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

test('non-admins only see the Leaderboard, Scores and Courses tabs', async ({ page }) => {
  await login(page);
  await expect(page.locator('nav a')).toHaveText(['Leaderboard', 'Scores', 'Courses']);
});

test('the Scores tab goes back to the match this phone is scoring', async ({ page }) => {
  await login(page);
  await page.goto('/#/score');
  await expect(page.getByTestId('score-pick').filter({ hasText: /^Match 1\b/ })).toContainText('Adams/Brown vs Green/Hill');
  await page.getByTestId('score-pick').filter({ hasText: /^Match 2\b/ }).click();
  await expect(page.getByText(/· Match 2$/)).toBeVisible();
  await page.getByRole('link', { name: 'Leaderboard' }).click();
  await page.getByRole('link', { name: 'Scores' }).click();
  await expect(page.getByText(/· Match 2$/)).toBeVisible();
  await page.getByRole('link', { name: '← All matches' }).click();
  await expect(page.getByTestId('score-pick')).not.toHaveCount(0);
});

test('the admin can reset all scores back to the start', async ({ browser }) => {
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
  admin.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept('RESET') : d.accept()));
  await loginAdmin(admin);
  await admin.getByRole('link', { name: /Events, teams/ }).click();
  await admin.locator('a.card').first().click();
  const reset = admin.getByTestId('reset-scores');
  await reset.getByLabel('Which scores?').selectOption({ label: 'Day 1' });
  await reset.getByRole('button', { name: 'Reset Day 1' }).click();
  await expect(reset.getByText('Scores reset for Day 1.')).toBeVisible();

  await trip.goto('/#/');
  await expect(group1Card(trip).getByTestId('status')).toHaveText('Not started');
  await expect(trip.getByTestId('conf-a')).toHaveText('0');
});

test('the compact score bar slides in once the full tracker scrolls away', async ({ page }) => {
  await login(page);
  const bar = page.getByTestId('score-bar');
  const inView = async () => ((await bar.boundingBox())?.y ?? -999) >= -1;
  await page.getByRole('tab', { name: 'Day 3' }).click(); // 9 cards (singles day): long enough to scroll
  await expect(bar).toHaveAttribute('aria-hidden', 'true');
  await page.getByTestId('match-card').last().scrollIntoViewIfNeeded();
  await expect(bar).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(inView).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByTestId('tracker')).toBeInViewport();
});

test('saving the first hole moves on to hole 2 (not 3)', async ({ page }) => {
  await login(page);
  await openGroup1(page); // opens on hole 1 without tapping a hole number
  await expect(page.getByRole('heading', { name: 'Hole 1', exact: true })).toBeVisible();
  await page.getByTestId('row-B1').getByRole('button', { name: /^Increase/ }).click(); // Ballymena drop one
  await page.getByRole('button', { name: 'Save hole 1' }).click();
  await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save hole 2' }).click();
  await expect(page.getByRole('heading', { name: 'Hole 3', exact: true })).toBeVisible();
});

test('after reopening, correcting an earlier hole changes the outcome and can be re-confirmed', async ({ browser }) => {
  const trip = await newPhone(browser);
  trip.on('dialog', (d) => void d.accept());
  await login(trip);
  await openGroup1(trip);
  for (let h = 1; h <= 10; h++) await enterHole(trip, h, 4, 5); // A wins 10 straight: 10&8
  await trip.goto('/#/');
  await group1Card(trip).click();
  const matchUrl = trip.url();
  const groupId = matchUrl.split('/match/')[1].split('/')[0];
  await trip.getByRole('button', { name: 'Confirm result' }).click();
  await expect(trip.getByTestId('match-card')).toContainText('FINAL');

  const admin = await newPhone(browser);
  admin.on('dialog', (d) => void d.accept());
  await loginAdmin(admin);
  await admin.goto('/#/admin/results');
  await admin.getByTestId('reopen-row').filter({ hasText: /^Match 1\b/ }).getByRole('button', { name: 'Reopen' }).click();
  await expect(admin.getByText('Match 1 reopened')).toBeVisible();

  // Correct hole 3: team B actually won it. A is now 8 up after 10 with 8 to play — dormie, not decided.
  await trip.goto(`/#/score/${groupId}`);
  await enterHole(trip, 3, 5, 4);
  await trip.goto('/#/');
  await expect(group1Card(trip).getByTestId('status')).toHaveText('8 UP');
  await expect(group1Card(trip)).toContainText('DORMIE');

  // Play on: A wins hole 11 -> decided 9&7, and it can be confirmed again.
  await trip.goto(`/#/score/${groupId}`);
  await enterHole(trip, 11, 4, 5);
  await trip.goto(matchUrl);
  await expect(trip.getByTestId('status')).toHaveText('9&7');
  await trip.getByRole('button', { name: 'Confirm result' }).click();
  await expect(trip.getByTestId('match-card')).toContainText('FINAL');
});

test('the course guide remembers the course and hole on this phone', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Courses' }).click();
  await page.getByRole('tab', { name: 'Robert the Bruce' }).click();
  await page.getByRole('button', { name: 'Guide hole 3', exact: true }).click();
  await expect(page.getByTestId('guide-title')).toContainText('Hole 3');
  await expect(page.getByTestId('guide-layout')).toHaveAttribute('src', 'guides/krtb/hole-03-layout.webp');
  await expect.poll(() => page.getByTestId('guide-layout').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(900);

  await page.getByRole('link', { name: 'Scores' }).click();
  await page.getByRole('link', { name: 'Courses' }).click();
  await expect(page.getByTestId('guide-title')).toContainText('Hole 3');
  await expect(page.getByRole('tab', { name: 'Robert the Bruce' })).toHaveAttribute('aria-selected', 'true');

  // Each course keeps its own hole.
  await page.getByRole('tab', { name: 'Ailsa' }).click();
  await page.getByRole('button', { name: 'Hole 2 →' }).click();
  await expect(page.getByTestId('guide-title')).toContainText('Hole 2');
  await page.getByRole('tab', { name: 'Robert the Bruce' }).click();
  await expect(page.getByTestId('guide-title')).toContainText('Hole 3');

  // Dundonald shows the aerial plus pro tips and tee yardages.
  await page.getByRole('tab', { name: 'Dundonald' }).click();
  await page.getByRole('button', { name: 'Guide hole 1', exact: true }).click();
  await expect(page.getByTestId('guide-flyover').locator('iframe')).toHaveAttribute('src', /s3jUc3RyotE\?start=3&end=37/);
  await page.getByRole('button', { name: 'Guide hole 12', exact: true }).click();
  await expect(page.getByTestId('guide-flyover').locator('iframe')).toHaveAttribute('src', /start=371&end=401/); // 6:11 – 6:41
  await expect(page.getByTestId('guide-notes')).toContainText('shortest Par 4');
  await expect(page.getByTestId('guide-notes')).not.toContainText('Championship'); // no tee table
  const notesY = (await page.getByTestId('guide-notes').boundingBox())!.y;
  const imageY = (await page.getByTestId('guide-layout').boundingBox())!.y;
  expect(notesY).toBeLessThan(imageY); // pro tips above the aerial
  await expect.poll(() => page.getByTestId('guide-layout').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});

test('the admin can choose the singles line-up and it shows on the leaderboard', async ({ browser }) => {
  const admin = await newPhone(browser);
  admin.on('dialog', (d) => void d.accept());
  await loginAdmin(admin);
  await admin.getByRole('link', { name: /Events, teams/ }).click();
  await admin.locator('a.card').first().click();
  const day3 = admin.locator('.round').nth(2);
  await day3.getByLabel('Singles pairings').selectOption('selected');
  await day3.getByRole('button', { name: 'Save round' }).click();
  await expect(admin.getByText('Day 3 saved')).toBeVisible();
  await day3.getByRole('link', { name: 'Pairings →' }).click();
  // Seed group 1: Adams/Brown v Green/Hill. Swap: Adams v Hill, Brown v Green.
  await admin.getByTestId('singles-1').getByLabel(/Singles 1: Adams v Hill/).check();
  await admin.getByRole('button', { name: 'Save pairings' }).click();
  await expect(admin.getByText('Pairings saved')).toBeVisible();

  const trip = await newPhone(browser);
  await login(trip);
  await trip.getByRole('tab', { name: 'Day 3' }).click();
  const card = (label: string) => trip.getByTestId('match-card').filter({ hasText: label }).first();
  await expect(card('Singles 1')).toContainText('Adams');
  await expect(card('Singles 1')).toContainText('Hill');
  await expect(card('Singles 2')).toContainText('Brown');
  await expect(card('Singles 2')).toContainText('Green');
});

test('two phones scoring the same hole: an untouched par default never overwrites a real score', async ({ browser }) => {
  const me = await newPhone(browser);
  const mate = await newPhone(browser);
  await login(me);
  await login(mate);
  await openGroup1(me);
  await openGroup1(mate); // both on hole 1, all rows showing the par default

  // I put myself (A1) down for a 5 and save.
  await me.getByTestId('row-A1').getByRole('button', { name: /^Increase/ }).click();
  await me.getByRole('button', { name: 'Save hole 1' }).click();
  await expect(me.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();

  // My mate saves hole 1 on their phone without touching my row.
  await mate.getByRole('button', { name: 'Save hole 1' }).click();
  await expect(mate.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();

  // My 5 must survive on both phones.
  for (const p of [me, mate]) {
    await p.getByRole('button', { name: 'Hole 1', exact: true }).click();
    await expect(p.getByTestId('gross-A1')).toHaveText('5', { timeout: 20_000 });
  }
});

test('the admin can swipe an event left to delete it', async ({ browser }) => {
  const admin = await newPhone(browser);
  const dialogs: string[] = [];
  admin.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  await loginAdmin(admin);
  await admin.goto('/#/admin/events');
  await admin.getByLabel('New event name').fill('Old Trip');
  await admin.getByRole('button', { name: 'Create event' }).click();
  await expect(admin).toHaveURL(/#\/admin\/events\/[0-9a-f-]{36}$/); // created and opened
  await admin.goto('/#/admin/events');

  const row = admin.getByTestId('swipe-row').filter({ hasText: 'Old Trip' });
  const del = row.getByRole('button', { name: 'Delete Old Trip', includeHidden: true });
  await expect(del).toHaveAttribute('aria-hidden', 'true');

  // Swipe left with the pointer.
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  await admin.mouse.move(box.x + box.width - 20, y);
  await admin.mouse.down();
  for (let i = 1; i <= 8; i++) await admin.mouse.move(box.x + box.width - 20 - i * 20, y);
  await admin.mouse.up();

  await expect(admin).toHaveURL(/#\/admin\/events$/); // the swipe didn't open the event
  await expect(del).toHaveAttribute('aria-hidden', 'false');
  await del.click();
  await expect(admin.getByText('Deleted "Old Trip"')).toBeVisible();
  expect(dialogs[0]).toMatch(/permanently deletes its rounds, pairings, scores and results/);
  await expect(admin.getByTestId('swipe-row').filter({ hasText: 'Old Trip' })).toHaveCount(0);
  await expect(admin.getByTestId('swipe-row').filter({ hasText: 'ACTIVE' })).toHaveCount(1); // the real event is untouched
});

test('the Form tab is off until the admin switches it on, then ranks players', async ({ browser }) => {
  const trip = await newPhone(browser);
  await login(trip);
  await expect(trip.locator('nav a')).toHaveText(['Leaderboard', 'Scores', 'Courses']);

  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await admin.getByRole('link', { name: /Events, teams/ }).click();
  await admin.locator('a.card').first().click();
  await admin.getByLabel(/Show the Form tab to players/).check();
  await admin.getByRole('button', { name: 'Save event' }).click();
  await expect(admin.getByText('Event saved')).toBeVisible();

  // Group 1's A players make birdie 3s on hole 1 (par 4); B players make 4s.
  await openGroup1(trip);
  await enterHole(trip, 1, 3, 4);
  await trip.goto('/#/');
  await expect(trip.locator('nav a')).toHaveText(['Leaderboard', 'Scores', 'Courses', 'Form'], { timeout: 20_000 });
  await trip.getByRole('link', { name: 'Form' }).click();
  await trip.getByRole('tab', { name: 'Birdies' }).click();
  const rows = trip.getByTestId('form-row');
  await expect(rows.nth(0).getByTestId('form-value')).toHaveText('1');
  await expect(rows.nth(1).getByTestId('form-value')).toHaveText('1');
  await expect(rows.nth(2).getByTestId('form-value')).toHaveText('0');
  await trip.getByRole('tab', { name: 'Gross' }).click();
  await expect(rows.nth(0).getByTestId('form-value')).toHaveText('-1');
  // Stableford: gross 3 with a shot on hole 1 (SI 7, handicap 10) = net 2 = 4 points.
  await trip.getByRole('tab', { name: 'Stableford' }).click();
  await expect(rows.nth(0).getByTestId('form-value')).toHaveText('4');
  // Stableford: gross 3 with a shot on hole 1 (SI 7, handicap 10) = net 2 = 4 points.
  await trip.getByRole('tab', { name: 'Stableford' }).click();
  await expect(rows.nth(0).getByTestId('form-value')).toHaveText('4');
});

test('the match scorecard shows gross birdies in red', async ({ page }) => {
  await login(page);
  await openGroup1(page);
  await enterHole(page, 1, 3, 5); // A players birdie the par-4 1st; B players bogey
  await page.goto('/#/');
  await group1Card(page).click();
  const red = page.locator('table .birdie');
  await expect(red).toHaveCount(2);
  await expect(red.first()).toHaveText('3');
  await expect(red.first()).toHaveCSS('color', 'rgb(208, 2, 27)');
});
