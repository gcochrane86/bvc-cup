import { expect, test } from '@playwright/test';
import { enterHole, group1Card, login, loginAdmin, newPhone, openEvent, openGroup1, reseed, serviceDb, unfoldEvent } from './helpers';

test.beforeEach(() => reseed());

const activeEventId = async () => (await serviceDb().from('events').select('id').eq('is_active', true).single()).data!.id as string;

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
  await expect(page.getByRole('link', { name: /^Edit hole/ })).toHaveCount(0); // its holes no longer link to scoring

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

test('the admin uploads player photos in Admin → Players; there is no separate Players tab', async ({ page }) => {
  await loginAdmin(page);
  await expect(page.locator('nav a', { hasText: 'Admin' })).toBeVisible();
  await expect(page.locator('nav a', { hasText: 'Players' })).toHaveCount(0);
  await page.getByRole('link', { name: /^Players/ }).click();
  const row = page.getByTestId('admin-player').first();
  await row.getByRole('button').first().click(); // open the player to edit
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
  await openEvent(admin, await activeEventId()); // Reopen lives on the event's admin page
  await admin.getByText('More options').click();
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

test('non-admins only see the Leaderboard and Scores tabs (Courses only when the event has a guide)', async ({ page }) => {
  await login(page); // the seed course has no guide
  await expect(page.locator('nav a')).toHaveText(['Leaderboard', 'Scores']);
  await page.goto('/#/guide');
  await expect(page.getByText("No course guide for this event's courses yet.")).toBeVisible();
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
  await admin.getByRole('link', { name: /^Events/ }).click();
  await admin.getByTestId('swipe-row').first().getByRole('link').click();
  const reset = admin.getByTestId('reset-scores');
  await expect(reset).toBeHidden(); // tucked away under More options until opened
  await admin.getByText('More options').click();
  await reset.getByLabel('Which scores?').selectOption({ label: 'Day 1' });
  await reset.getByRole('button', { name: 'Reset Day 1' }).click();
  await expect(reset.getByText('Scores reset for Day 1.')).toBeVisible();

  await trip.goto('/#/');
  await expect(group1Card(trip).getByTestId('status')).toHaveText('Not started');
  await expect(trip.getByTestId('conf-a')).toHaveText('0');
});

test('on a tall screen (Home Screen app) the score bar still appears on a day with few matches', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 }); // no Safari bars: more of the page fits
  await login(page);
  const bar = page.getByTestId('score-bar');
  await page.getByRole('tab', { name: 'Day 1' }).click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(bar).toHaveAttribute('aria-hidden', 'false');
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
  trip.on('dialog', (d) => {
    console.log(`[reopen test] dialog: ${d.message()}`); // shows why a confirm didn't go through, if it fails
    void d.accept();
  });
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
  await openEvent(admin, await activeEventId()); // Reopen lives on the event's admin page
  await admin.getByText('More options').click();
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

/** Point the seeded days at the real trip courses (which have guides), as on BvC. */
async function useTripCourses() {
  const db = serviceDb();
  const make = async (name: string) => (await db.from('courses').insert({ name }).select().single()).data!.id as string;
  const ids = [await make('Dundonald Links'), await make('King Robert the Bruce'), await make('The Championship Ailsa')];
  const { data: rounds } = await db.from('rounds').select('id, round_no').order('round_no');
  for (const [i, id] of ids.entries()) await db.from('rounds').update({ course_id: id }).eq('id', rounds![i].id);
}

test('the course guide remembers the course and hole on this phone', async ({ page }) => {
  await useTripCourses();
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
  // Nothing loads from YouTube until play is tapped.
  await expect(page.getByTestId('guide-flyover').locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play hole 1 flyover' }).click();
  await expect(page.getByTestId('guide-flyover').locator('iframe')).toHaveAttribute('src', /s3jUc3RyotE\?start=3&end=37.*autoplay=1&mute=1/);
  await page.getByRole('button', { name: 'Guide hole 12', exact: true }).click();
  await expect(page.getByTestId('guide-flyover').locator('iframe')).toHaveCount(0); // a new hole starts un-loaded
  await page.getByRole('button', { name: 'Play hole 12 flyover' }).click();
  await expect(page.getByTestId('guide-flyover').locator('iframe')).toHaveAttribute('src', /start=371&end=401/); // 6:11 – 6:41
  await expect(page.getByTestId('guide-notes')).toContainText('shortest Par 4');
  await expect(page.getByTestId('guide-notes')).not.toContainText('Championship'); // no tee table
  const notesY = (await page.getByTestId('guide-notes').boundingBox())!.y;
  const imageY = (await page.getByTestId('guide-layout').boundingBox())!.y;
  expect(notesY).toBeLessThan(imageY); // pro tips above the aerial
  await expect.poll(() => page.getByTestId('guide-layout').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});

test('the Courses tab shows only the courses this event plays', async ({ page }) => {
  // Point the seeded days at the real trip courses, as on BvC.
  const db = serviceDb();
  const make = async (name: string) => (await db.from('courses').insert({ name }).select().single()).data!.id as string;
  const [d, k, a, g] = [await make('Dundonald Links'), await make('King Robert the Bruce'), await make('The Championship Ailsa'), await make('Glashedy Links (Gold)')];
  const { data: rounds } = await db.from('rounds').select('id, round_no').order('round_no');
  for (const [i, id] of [d, k, a].entries()) await db.from('rounds').update({ course_id: id }).eq('id', rounds![i].id);

  await login(page);
  await page.getByRole('link', { name: 'Courses' }).click();
  await expect(page.getByRole('tab')).toHaveText(['Dundonald', 'Robert the Bruce', 'Ailsa']);

  // A one-day event at Glashedy: just Glashedy, even if this phone last looked at Ailsa.
  await page.getByRole('tab', { name: 'Ailsa' }).click();
  await db.from('rounds').delete().in('id', [rounds![1].id, rounds![2].id]);
  await db.from('rounds').update({ course_id: g }).eq('id', rounds![0].id);
  await page.goto('/#/');
  await page.reload();
  await page.getByRole('link', { name: 'Courses' }).click();
  await expect(page.getByRole('tab')).toHaveText(['Glashedy']);
  await expect(page.getByTestId('guide-layout')).toHaveAttribute('src', 'guides/glashedy/hole-01-layout.webp');
  await expect.poll(() => page.getByTestId('guide-layout').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(900);
  await expect(page.getByText('Glashedy Links yardage book')).toBeVisible();
});

test('the admin can choose the singles line-up and it shows on the leaderboard', async ({ browser }) => {
  const admin = await newPhone(browser);
  admin.on('dialog', (d) => void d.accept());
  await loginAdmin(admin);
  await admin.getByRole('link', { name: /^Events/ }).click();
  await admin.getByTestId('swipe-row').first().getByRole('link').click();
  await unfoldEvent(admin);
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

test("a phone that missed a live update still ends up showing the other phone's real score", async ({ browser }) => {
  const me = await newPhone(browser);
  const mate = await newPhone(browser);
  // The mate stays connected but its score messages are dropped (as Realtime does under its rate limit).
  await mate.routeWebSocket(/realtime/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      if (typeof m === 'string' && m.includes('postgres_changes')) return;
      ws.send(m);
    });
  });
  await login(me);
  await login(mate);
  await openGroup1(me);
  await openGroup1(mate);

  await me.getByTestId('row-A1').getByRole('button', { name: /^Increase/ }).click();
  await me.getByRole('button', { name: 'Save hole 1' }).click();
  await expect.poll(async () => (await serviceDb().from('scores').select('gross').eq('hole', 1)).data?.[0]?.gross).toBe(5);

  // The mate saves hole 1 without touching my row: their par default is (rightly) refused by the server…
  await mate.getByRole('button', { name: 'Save hole 1' }).click();
  await expect(mate.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
  // …and their phone must not keep showing it: the catch-up check (every 15s) brings my 5 in.
  await mate.getByRole('button', { name: 'Hole 1', exact: true }).click();
  await expect(mate.getByTestId('gross-A1')).toHaveText('5', { timeout: 25_000 });
});

test("a real score typed offline and sent late still reaches a phone that missed the live update", async ({ browser }) => {
  const me = await newPhone(browser);
  const mate = await newPhone(browser);
  await mate.routeWebSocket(/realtime/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      if (typeof m === 'string' && m.includes('postgres_changes')) return; // score messages dropped
      ws.send(m);
    });
  });
  await login(me);
  await login(mate);
  await openGroup1(me);
  await openGroup1(mate);

  // I type a 5 with no signal: it waits in my phone's outbox.
  await me.context().setOffline(true);
  await me.getByTestId('row-A1').getByRole('button', { name: /^Increase/ }).click();
  await me.getByRole('button', { name: 'Save hole 1' }).click();
  // Later, my mate saves hole 1 untouched: their par defaults fill the empty cells.
  await mate.getByRole('button', { name: 'Save hole 1' }).click();
  await expect.poll(async () => (await serviceDb().from('scores').select('gross').eq('hole', 1)).data?.length).toBe(4);
  // Signal returns: my 5 (typed earlier) replaces the default on the server…
  await me.context().setOffline(false);
  await me.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await serviceDb().from('scores').select('gross').eq('hole', 1).eq('gross', 5)).data?.length, { timeout: 15_000 }).toBe(1);
  // …and my mate's phone, which missed the live update, catches up to it.
  await mate.getByRole('button', { name: 'Hole 1', exact: true }).click();
  await expect(mate.getByTestId('gross-A1')).toHaveText('5', { timeout: 25_000 });
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
  await admin.getByRole('button', { name: '+ New event' }).click();
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
  await expect(trip.locator('nav a')).toHaveText(['Leaderboard', 'Scores']);

  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await admin.getByRole('link', { name: /^Events/ }).click();
  await admin.getByTestId('swipe-row').first().getByRole('link').click();
  await admin.getByText('More options').click();
  await admin.getByLabel(/Show the Form tab to players/).check();
  await admin.getByRole('button', { name: 'Save settings' }).click();
  await expect(admin.getByText('Event saved')).toBeVisible();

  // Group 1's A players make birdie 3s on hole 1 (par 4); B players make 4s.
  await openGroup1(trip);
  await enterHole(trip, 1, 3, 4);
  await trip.goto('/#/');
  await expect(trip.locator('nav a')).toHaveText(['Leaderboard', 'Scores', 'Form'], { timeout: 20_000 });
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

test('back on the leaderboard, it opens on the day of the match being scored', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('tab', { name: 'Day 1' })).toHaveAttribute('aria-selected', 'true'); // today
  await page.getByRole('link', { name: 'Scores' }).click();
  await page.getByTestId('score-pick').filter({ hasText: /^Match 4\b/ }).click(); // a Day 2 match
  await expect(page.getByRole('heading', { name: /^Hole \d+$/ })).toBeVisible();
  await page.getByRole('link', { name: 'Leaderboard' }).click();
  await expect(page.getByRole('tab', { name: 'Day 2' })).toHaveAttribute('aria-selected', 'true');
});

test('tapping a hole on any match opens its score entry, without changing the match this phone is scoring', async ({ page }) => {
  await login(page);
  await openGroup1(page); // this phone now scores Match 1
  const myMatch = page.url();
  await enterHole(page, 1, 4, 5);
  await enterHole(page, 2, 4, 5);

  await page.goto('/#/');
  await group1Card(page).click();
  await expect(page.getByText('Tap a hole to edit its scores.')).toBeVisible();
  await page.getByRole('link', { name: 'Edit hole 2 scores' }).click();
  await expect(page).toHaveURL(/#\/score\/[0-9a-f-]{36}\/2$/);
  await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
  await expect(page.getByTestId('gross-B1')).toHaveText('5'); // the saved score is loaded, ready to fix

  // Someone else's match links too...
  await page.goto('/#/');
  await page.locator('[data-match-id$=":better_ball"]').filter({ hasText: /\bMatch 2\b/ }).click();
  await page.getByRole('link', { name: 'Edit hole 3 scores' }).click();
  await expect(page).toHaveURL(/#\/score\/[0-9a-f-]{36}\/3$/);
  expect(page.url().split('/score/')[1].split('/')[0]).not.toBe(myMatch.split('/score/')[1]);
  await expect(page.getByRole('heading', { name: 'Hole 3', exact: true })).toBeVisible();

  // ...but Scores still goes back to this phone's own match.
  await page.getByRole('link', { name: 'Scores' }).click();
  await expect(page).toHaveURL(myMatch);
});

test('a day can be played as fourball Stableford: full handicaps, best points win the hole', async ({ browser }) => {
  const admin = await newPhone(browser);
  await loginAdmin(admin);
  const { data: ev } = await serviceDb().from('events').select('id').eq('is_active', true).single();
  await openEvent(admin, ev!.id);
  const game = admin.getByLabel('Fourball game').first();
  await expect(admin.getByLabel('Allowance %', { exact: true })).toHaveCount(3);
  await game.selectOption('stableford');
  await expect(admin.getByLabel('Allowance %', { exact: true })).toHaveCount(2); // hidden on Day 1 (Days 2 and 3 still match play)
  await admin.getByRole('button', { name: 'Save round' }).first().click();
  await expect(admin.getByText('Day 1 saved')).toBeVisible();

  const me = await newPhone(browser);
  await login(me);
  await openGroup1(me);
  // Par 4: A 7s and B 8s are 0 Stableford points either way — a halved hole (match play would give it to A).
  await enterHole(me, 1, 7, 8);
  await me.getByRole('button', { name: 'Hole 1', exact: true }).click();
  await expect(me.getByTestId('row-A1')).toContainText('0 pts');
  await me.goto('/#/');
  await expect(group1Card(me).getByTestId('status')).toHaveText('All Square');
});

test("the leaderboard shows each pair's better-ball net score off full handicaps", async ({ page }) => {
  await login(page);
  await openGroup1(page); // everyone off 10: a shot on holes 1 (SI 7) and 2 (SI 3), both par 4
  await enterHole(page, 1, 4, 5); // A net 3 (−1), B net 4 (E)
  await enterHole(page, 2, 4, 4); // both net 3 (−1)
  await page.goto('/#/');
  await expect(group1Card(page).getByTestId('net-a')).toHaveText('−2 net · thru 2');
  await expect(group1Card(page).getByTestId('net-b')).toHaveText('−1 net · thru 2');
  // Not on a match that hasn't started.
  await expect(page.locator('[data-match-id$=":better_ball"]').filter({ hasText: /\bMatch 2\b/ }).getByTestId('net-a')).toHaveCount(0);
});

test('a two-v-two event is paired automatically when the teams are saved', async ({ browser }) => {
  const db = serviceDb();
  const { data: seedRound } = await db.from('rounds').select('course_id').limit(1).single();
  await db.from('events').update({ is_active: false }).eq('is_active', true);
  const { data: ev } = await db.from('events').insert({ name: 'Two v Two', is_active: true }).select('id').single();
  await db.from('rounds').insert({ event_id: ev!.id, round_no: 1, name: 'Day 1', course_id: seedRound!.course_id });

  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await openEvent(admin, ev!.id);
  // Step 1: who's playing. Step 2: a one-tap team switch for each of them.
  const playing = (name: string) => admin.getByLabel(`${name} playing`).check();
  const team = (name: string, t: string) => admin.getByRole('button', { name: `${name}: ${t}` }).click();
  for (const n of ['Alex Adams', 'Ben Brown', 'Chris Clark', 'Dan Davies']) await playing(n);
  await admin.getByRole('button', { name: 'Next: pick teams (4)' }).click();
  await team('Alex Adams', 'Team A');
  await team('Ben Brown', 'Team A');
  await team('Chris Clark', 'Team B');
  await team('Dan Davies', 'Team B');
  await admin.getByRole('button', { name: 'Save teams' }).click();
  await expect(admin.getByText('Teams saved · pairings set for Day 1')).toBeVisible();
  await admin.goto('/#/');
  const card = admin.getByTestId('match-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Adams');
  await expect(card).toContainText('Davies');

  // Swap a player: the pairing follows.
  await openEvent(admin, ev!.id);
  await admin.getByRole('tab', { name: /Who's playing/ }).click();
  await admin.getByLabel('Dan Davies playing').uncheck();
  await playing('Ed Evans');
  await admin.getByRole('tab', { name: /Teams/ }).click();
  await team('Ed Evans', 'Team B');
  await admin.getByRole('button', { name: 'Save teams' }).click();
  await expect(admin.getByText('Teams saved · pairings set for Day 1')).toBeVisible();
  await admin.goto('/#/');
  await expect(card).toContainText('Evans');
  await expect(card).not.toContainText('Davies');
});

test('a day has a course and tees, and a player can play off a different tee', async ({ browser }) => {
  const db = serviceDb();
  // The seed course (par 72) gets a name for its tee, and a second, shorter tee rated 5 lower.
  const { data: round } = await db.from('rounds').select('id, course_id').eq('round_no', 1).single();
  const { data: main } = await db.from('courses').select('*').eq('id', round!.course_id).single();
  await db.from('courses').update({ tee: 'Blue', slope_rating: 113, course_rating: 72 }).eq('id', main!.id);
  const { data: holes } = await db.from('course_holes').select('*').eq('course_id', main!.id);
  const { data: red } = await db.from('courses').insert({ name: main!.name, tee: 'Red', slope_rating: 113, course_rating: 67 }).select('id').single();
  await db.from('course_holes').insert(holes!.map((h) => ({ ...h, course_id: red!.id })));

  const admin = await newPhone(browser);
  await loginAdmin(admin);
  const { data: ev } = await db.from('events').select('id').eq('is_active', true).single();
  await openEvent(admin, ev!.id);
  await expect(admin.getByLabel('Tees').first()).toHaveValue(main!.id);
  await admin.getByText('Players on different tees').first().click();
  await admin.getByLabel('Alex Adams tee on Day 1').selectOption(red!.id);
  await expect(admin.getByText('Alex Adams plays the Red tees on Day 1')).toBeVisible();

  await admin.goto('/#/');
  await expect(admin.getByRole('heading', { name: `${main!.name} · Blue tees` })).toBeVisible();

  const me = await newPhone(browser);
  await login(me);
  await openGroup1(me);
  const adams = me.getByTestId('row-A1');
  await expect(adams).toContainText('Adams');
  await expect(adams).toContainText('Red tees');
  // Blue: 10 × 113/113 + (72 − 72) = 10. Red: 10 + (67 − 72) = 5.
  await expect(adams).toContainText('(5)');

  // Moving Day 1 to another course drops tees from the old one.
  const { data: other } = await db.from('courses').insert({ name: 'Other Links' }).select('id').single();
  await db.from('course_holes').insert(holes!.map((h) => ({ ...h, course_id: other!.id })));
  await openEvent(admin, ev!.id);
  await admin.reload(); // pick up the course the test just added
  await unfoldEvent(admin);
  await admin.getByLabel('Course').first().selectOption('Other Links');
  await admin.getByRole('button', { name: 'Save round' }).first().click();
  await expect(admin.getByText('Day 1 saved')).toBeVisible();
  await expect.poll(async () => (await db.from('round_tees').select('player_id').eq('round_id', round!.id)).data?.length).toBe(0);
});

test("an untouched score defaults to the par of the player's own tee", async ({ browser }) => {
  const db = serviceDb();
  // A second tee of the seed course where hole 1 is a par 5; Alex Adams (A1 in Match 1) plays it on Day 1.
  const { data: round } = await db.from('rounds').select('id, course_id').eq('round_no', 1).single();
  const { data: main } = await db.from('courses').select('*').eq('id', round!.course_id).single();
  await db.from('courses').update({ tee: 'Blue' }).eq('id', main!.id);
  const { data: holes } = await db.from('course_holes').select('*').eq('course_id', main!.id);
  const { data: red } = await db.from('courses').insert({ name: main!.name, tee: 'Red' }).select('id').single();
  await db.from('course_holes').insert(holes!.map((h) => ({ ...h, course_id: red!.id, par: h.hole === 1 ? 5 : h.par })));
  const { data: adams } = await db.from('players').select('id').eq('name', 'Alex Adams').single();
  await db.from('round_tees').insert({ round_id: round!.id, player_id: adams!.id, course_id: red!.id });

  const me = await newPhone(browser);
  await login(me);
  await openGroup1(me);
  await me.getByRole('button', { name: 'Hole 1', exact: true }).click();
  await expect(me.getByTestId('gross-A1')).toHaveText('5'); // Red par 5
  await expect(me.getByTestId('gross-B1')).toHaveText('4'); // main tee par 4
  await me.getByRole('button', { name: 'Save hole 1' }).click();
  await expect
    .poll(async () => (await db.from('scores').select('gross').eq('player_id', adams!.id).eq('hole', 1)).data?.[0]?.gross)
    .toBe(5);
});

test('the admin can hide the Leaderboard tab from players; they land on Scores', async ({ browser }) => {
  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await openEvent(admin, await activeEventId());
  await admin.getByText('More options').click();
  await admin.getByLabel(/Show the Leaderboard tab to players/).uncheck();
  await admin.getByRole('button', { name: 'Save settings' }).click();
  await expect(admin.getByText('Event saved')).toBeVisible();
  await expect(admin.locator('nav a', { hasText: 'Leaderboard' })).toHaveCount(1); // the admin still sees it

  const trip = await newPhone(browser);
  await login(trip, 'tester@example.com', process.env.TRIP_PASSWORD!, { expectLeaderboard: false });
  await expect(trip.locator('nav a')).toHaveText(['Scores', 'Scorecard']); // Scorecard replaces the Leaderboard
  await expect(trip).toHaveURL(/#\/score$/);
  await trip.goto('/#/');
  await expect(trip).toHaveURL(/#\/score$/); // old links to the leaderboard go to Scores
  await expect(trip.getByTestId('tracker')).toHaveCount(0);
});

test('score entry hole buttons show who won each hole and the running score, like the match summary', async ({ page }) => {
  await login(page);
  await openGroup1(page);
  await enterHole(page, 1, 4, 5); // A wins hole 1
  const hole1 = page.getByRole('button', { name: 'Hole 1', exact: true });
  await expect(hole1).toContainText('1UP');
  await enterHole(page, 2, 5, 4); // B wins hole 2 → all square
  await expect(page.getByRole('button', { name: 'Hole 2', exact: true })).toContainText('AS');
  await expect(page.getByRole('button', { name: 'Hole 3', exact: true })).toContainText('–'); // not played
});

test('a day can be played as a flat fourball: no shots, lower best gross wins the hole', async ({ browser }) => {
  // Make Match 1's players different handicaps so shots would matter in normal match play.
  const db = serviceDb();
  const { data: ev } = await db.from('events').select('id').eq('is_active', true).single();
  const { data: adams } = await db.from('players').select('id').eq('name', 'Alex Adams').single();
  await db.from('event_players').update({ handicap: 30 }).eq('event_id', ev!.id).eq('player_id', adams!.id);

  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await openEvent(admin, ev!.id);
  await admin.getByLabel('Fourball game').first().selectOption('flat');
  await expect(admin.getByLabel('Allowance %', { exact: true })).toHaveCount(2); // hidden on Day 1
  await admin.getByRole('button', { name: 'Save round' }).first().click();
  await expect(admin.getByText('Day 1 saved')).toBeVisible();

  const me = await newPhone(browser);
  await login(me);
  await openGroup1(me);
  await expect(me.getByTestId('row-A1')).not.toContainText('shot'); // no shot chips on a flat day
  // Adams (off 30) scores 5, everyone else 5 except B's 4: B's lower gross wins — no shots for Adams.
  await enterHole(me, 1, 5, 4);
  await me.goto('/#/');
  await expect(group1Card(me).getByTestId('status')).toHaveText('1 UP');
  await expect(group1Card(me)).toHaveAttribute('data-match-id', /better_ball/);
  await expect(group1Card(me).getByTestId('status')).toHaveCSS('color', 'rgb(200, 16, 46)'); // team B's colour
});

test("with the Leaderboard hidden, players get a Scorecard tab with every match's scorecard (no standings)", async ({ browser }) => {
  const db = serviceDb();
  const { data: ev } = await db.from('events').select('id').eq('is_active', true).single();
  const me = await newPhone(browser);
  await login(me);
  await expect(me.locator('nav a', { hasText: 'Scorecard' })).toHaveCount(0); // not while the Leaderboard is shown
  await openGroup1(me);
  await enterHole(me, 1, 3, 5); // A players birdie the par-4 1st

  await db.from('events').update({ show_leaderboard: false }).eq('id', ev!.id);
  await me.reload();
  await expect(me.locator('nav a')).toHaveText(['Scores', 'Scorecard']);
  await me.getByRole('link', { name: 'Scorecard' }).click();
  await expect(me.getByRole('tab', { name: 'Day 1' })).toHaveAttribute('aria-selected', 'true');
  const card = me.getByTestId('scorecard-group').filter({ hasText: /^Match 1\b/ });
  await expect(card.locator('table .birdie').first()).toHaveText('3');
  await expect(me.getByTestId('scorecard-group')).toHaveCount(3); // every Day 1 match
  await expect(me.getByText('1 UP')).toHaveCount(0); // no standings
  await expect(me.getByTestId('tracker')).toHaveCount(0);

  await db.from('events').update({ show_leaderboard: true }).eq('id', ev!.id);
  await me.reload();
  await expect(me.locator('nav a', { hasText: 'Scorecard' })).toHaveCount(0);
});

test('with many days, the leaderboard opens scrolled to the latest day; earlier days scroll into view', async ({ page }) => {
  const db = serviceDb();
  const { data: ev } = await db.from('events').select('id').eq('is_active', true).single();
  const { data: r1 } = await db.from('rounds').select('course_id').eq('round_no', 1).single();
  const { data: g1 } = await db.from('groups').select('id, group_players(slot, player_id)').eq('group_no', 1).limit(1).single();
  // Ten more outings (Days 4–13); the latest has a match this phone will score.
  const { data: added } = await db
    .from('rounds')
    .insert(Array.from({ length: 10 }, (_, i) => ({ event_id: ev!.id, round_no: i + 4, name: `Day ${i + 4}`, course_id: r1!.course_id })))
    .select('id, round_no');
  const latest = added!.find((r) => r.round_no === 13)!;
  const { data: g } = await db.from('groups').insert({ round_id: latest.id, group_no: 1 }).select('id').single();
  await db.from('group_players').insert(g1!.group_players.map((gp) => ({ group_id: g!.id, slot: gp.slot, player_id: gp.player_id })));

  await login(page);
  await page.goto('/#/score');
  await page.getByTestId('score-pick').last().click(); // the Day 13 match
  await expect(page.getByRole('heading', { name: /^Hole \d+$/ })).toBeVisible();
  await page.getByRole('link', { name: 'Leaderboard' }).click();
  const day13 = page.getByRole('tab', { name: 'Day 13' });
  await expect(day13).toHaveAttribute('aria-selected', 'true');
  await expect(day13).toBeInViewport();
  await expect(page.getByRole('tab', { name: 'Day 1', exact: true })).not.toBeInViewport();
  await expect(page.getByTestId('breakdown')).toHaveText(/^13 days · \d+/);

  // Scroll back to an earlier day and pick it.
  await page.getByRole('tab', { name: 'Day 1', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Day 1', exact: true })).toBeInViewport();
  await expect(page.getByRole('tab', { name: 'Day 1', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('the Form tab can rank pairs as well as individuals', async ({ page }) => {
  const db = serviceDb();
  await db.from('events').update({ show_form: true }).eq('is_active', true);
  await login(page);
  await openGroup1(page); // everyone off 10: a shot on hole 1
  await enterHole(page, 1, 3, 5); // A pair: best net 2 (−2); B pair: best net 4 (E)
  await page.getByRole('link', { name: 'Form' }).click();
  await page.getByRole('tab', { name: 'Net' }).click();
  await page.getByRole('button', { name: 'Pairs' }).click();
  const first = page.getByTestId('form-row').first();
  await expect(first).toContainText('Adams & Brown');
  await expect(first.getByTestId('form-value')).toHaveText('-2');
  await expect(page.getByTestId('form-row').nth(1)).toContainText('Green & Hill');
  await page.getByRole('button', { name: 'Individuals' }).click();
  await expect(page.getByTestId('form-row').first()).not.toContainText('&');
});

test('with only one match to score, Scores opens it straight away', async ({ page }) => {
  const db = serviceDb();
  const { data: groups } = await db.from('groups').select('id, group_no, rounds(round_no)');
  const keep = groups!.find((g) => g.group_no === 1 && (g.rounds as unknown as { round_no: number }).round_no === 1)!;
  await db.from('groups').delete().in('id', groups!.filter((g) => g.id !== keep.id).map((g) => g.id));

  await login(page);
  // Watch for the match list ever appearing, even for a moment.
  await page.evaluate(() => {
    (window as unknown as { listShown: boolean }).listShown = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="score-pick"]')) (window as unknown as { listShown: boolean }).listShown = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole('link', { name: 'Scores' }).click();
  await expect(page).toHaveURL(new RegExp(`#/score/${keep.id}$`));
  expect(await page.evaluate(() => (window as unknown as { listShown: boolean }).listShown)).toBe(false); // no flash of the list
  await expect(page.getByRole('heading', { name: /^Hole \d+$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '← All matches' })).toHaveCount(0); // nothing else to pick
});

test('a day can be a 2-man scramble: one score per team, saved for both players', async ({ browser }) => {
  const db = serviceDb();
  const { data: ev } = await db.from('events').select('id').eq('is_active', true).single();
  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await openEvent(admin, ev!.id);
  await admin.getByLabel('Fourball game').first().selectOption('scramble');
  await expect(admin.getByLabel('Allowance %', { exact: true })).toHaveCount(2); // hidden on Day 1
  await admin.getByRole('button', { name: 'Save round' }).first().click();
  await expect(admin.getByText('Day 1 saved')).toBeVisible();

  const me = await newPhone(browser);
  await login(me);
  await openGroup1(me);
  await expect(me.locator('[data-testid^="row-"]')).toHaveCount(2); // one row per team
  const teamA = me.getByTestId('row-A1');
  const teamB = me.getByTestId('row-B1');
  await expect(teamA).toContainText('Adams & Brown');
  await teamB.getByRole('button', { name: /^Increase/ }).click(); // B: 5 on the par-4 1st; A: 4 (par)
  await me.getByRole('button', { name: 'Save hole 1' }).click();
  await expect(me.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();

  const { data: players } = await db.from('players').select('id, name');
  await expect
    .poll(async () => {
      const { data } = await db.from('scores').select('player_id, gross').eq('hole', 1);
      return Object.fromEntries(data!.map((s) => [players!.find((p) => p.id === s.player_id)!.name, s.gross]));
    })
    .toEqual({ 'Alex Adams': 4, 'Ben Brown': 4, 'Gus Green': 5, 'Harry Hill': 5 });
  await me.goto('/#/');
  await expect(group1Card(me).getByTestId('status')).toHaveText('1 UP');
});

test('adding a day to a new event picks the course, then its tees', async ({ browser }) => {
  const db = serviceDb();
  const { data: seedRound } = await db.from('rounds').select('course_id').limit(1).single();
  const { data: holes } = await db.from('course_holes').select('*').eq('course_id', seedRound!.course_id);
  const tees = [{ tee: 'White', course_rating: 70, slope_rating: 120 }, { tee: 'Gold', course_rating: 72, slope_rating: 128 }];
  const ids: Record<string, string> = {};
  for (const t of tees) {
    const { data: c } = await db.from('courses').insert({ name: 'Tee Links', ...t }).select('id').single();
    await db.from('course_holes').insert(holes!.map((h) => ({ ...h, course_id: c!.id })));
    ids[t.tee] = c!.id;
  }

  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await admin.goto('/#/admin/events');
  await admin.getByRole('button', { name: '+ New event' }).click();
  await admin.getByLabel('New event name').fill('Winter League');
  await admin.getByRole('button', { name: 'Create event' }).click();
  await expect(admin).toHaveURL(/#\/admin\/events\/[0-9a-f-]{36}$/);
  const eventId = admin.url().split('/events/')[1];

  const form = admin.locator('form.round');
  await expect(form.getByLabel('White tees')).toHaveCount(0); // no course chosen yet: no tees
  await form.getByLabel('Course').selectOption('Tee Links');
  await expect(form.getByLabel('White tees')).toBeChecked(); // White by default
  await form.getByLabel('Gold tees').check();
  await form.getByLabel('White tees').check();
  await form.getByRole('button', { name: /^Add Day/ }).click();
  await expect(admin.getByText('Round added')).toBeVisible();
  const { data: added } = await db.from('rounds').select('name, course_id').eq('event_id', eventId);
  expect(added).toEqual([{ name: 'Day 1', course_id: ids.White }]);
});

test('on an all-scramble event the Form tab opens on Pairs; Individuals explains why it is empty', async ({ page }) => {
  const db = serviceDb();
  await db.from('events').update({ show_form: true }).eq('is_active', true);
  await db.from('rounds').update({ fourball_format: 'scramble' }).neq('id', '00000000-0000-0000-0000-000000000000');
  await login(page);
  await page.getByRole('link', { name: 'Form' }).click();
  await expect(page.getByRole('button', { name: 'Pairs' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Individuals' }).click();
  await expect(page.getByText('Scramble days are team scores, so there are no individual rankings.')).toBeVisible();
  await expect(page.getByTestId('form-row')).toHaveCount(0);
});

test("the admin ticks who's playing (search, select all, clear), then puts them on teams", async ({ browser }) => {
  const db = serviceDb();
  await db.from('events').update({ is_active: false }).eq('is_active', true);
  const { data: ev } = await db.from('events').insert({ name: 'Winter League', is_active: true, team_a_name: 'Ballymena', team_b_name: 'Coleraine' }).select('id').single();
  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await openEvent(admin, ev!.id);
  await expect(admin.getByRole('tab', { name: /Who's playing/ })).toHaveAttribute('aria-selected', 'true'); // nobody yet
  await expect(admin.getByText('0 of 12 playing')).toBeVisible();

  // Search narrows the list; ticking still counts everyone.
  await admin.getByPlaceholder('Search players').fill('ha');
  await expect(admin.getByTestId('pick-row')).toHaveText([/Harry Hill/]);
  await admin.getByLabel('Harry Hill playing').check();
  await admin.getByPlaceholder('Search players').fill('');
  await admin.getByRole('button', { name: 'Select all' }).click();
  await expect(admin.getByText('12 of 12 playing')).toBeVisible();
  await admin.getByRole('button', { name: 'Clear' }).click();
  await expect(admin.getByText('0 of 12 playing')).toBeVisible();
  // 4 or more players play teams (2 or 3 would be a 2- or 3-ball individual game).
  for (const n of ['Alex Adams', 'Ben Brown', 'Chris Clark', 'Dan Davies']) await admin.getByLabel(`${n} playing`).check();
  await admin.getByRole('button', { name: 'Next: pick teams (4)' }).click();

  // Teams: one tap each; nobody can be left off a team when saving.
  await expect(admin.getByText('4 players not on a team yet')).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Save teams' })).toBeDisabled();
  // Rows stay put while teams are picked (no jumping as players are assigned).
  const order = () => admin.getByTestId('team-row').allTextContents();
  const before = (await order()).map((t) => t.slice(0, 8));
  for (const [n, t] of [['Alex Adams', 'Ballymena'], ['Ben Brown', 'Coleraine'], ['Chris Clark', 'Coleraine'], ['Dan Davies', 'Coleraine']]) {
    await admin.getByRole('button', { name: `${n}: ${t}` }).click();
    expect((await order()).map((x) => x.slice(0, 8))).toEqual(before);
  }
  expect(before[0]).toContain('Alex'); // alphabetical
  await expect(admin.getByTestId('team-count-A')).toContainText('1');
  await expect(admin.getByTestId('team-count-B')).toContainText('3');
  await admin.getByRole('button', { name: 'Save teams' }).click();
  await expect(admin.getByText('Teams saved')).toBeVisible();
  const { data: eps } = await db.from('event_players').select('team, players(name)').eq('event_id', ev!.id);
  expect(eps!.map((e) => `${(e.players as unknown as { name: string }).name}:${e.team}`).sort()).toEqual(['Alex Adams:A', 'Ben Brown:B', 'Chris Clark:B', 'Dan Davies:B']);
});

test('saving teams of more than four without pairings warns (but saves), and each day shows its pairing status', async ({ browser }) => {
  const db = serviceDb();
  const { data: seedRound } = await db.from('rounds').select('course_id').limit(1).single();
  await db.from('events').update({ is_active: false }).eq('is_active', true);
  const { data: ev } = await db.from('events').insert({ name: 'Club Night', is_active: true }).select('id').single();
  await db.from('rounds').insert({ event_id: ev!.id, round_no: 1, name: 'Day 1', course_id: seedRound!.course_id });

  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await openEvent(admin, ev!.id);
  await expect(admin.getByTestId('pairing-status')).toHaveText('Pairings not set yet');
  const names = ['Alex Adams', 'Ben Brown', 'Chris Clark', 'Dan Davies', 'Ed Evans', 'Finn Fox', 'Gus Green', 'Harry Hill'];
  for (const n of names) await admin.getByLabel(`${n} playing`).check();
  await admin.getByRole('button', { name: 'Next: pick teams (8)' }).click();
  for (const [i, n] of names.entries()) await admin.getByRole('button', { name: `${n}: ${i < 4 ? 'Team A' : 'Team B'}` }).click();
  await admin.getByRole('button', { name: 'Save teams' }).click();

  const popup = admin.getByRole('dialog');
  await expect(popup).toContainText("Scores and the leaderboard won't show these players until pairings are set.");
  const { count } = await db.from('event_players').select('player_id', { count: 'exact', head: true }).eq('event_id', ev!.id);
  expect(count).toBe(8); // saved anyway
  await popup.getByRole('link', { name: 'Set pairings for Day 1 →' }).click();
  await expect(admin).toHaveURL(/#\/admin\/pairings\/[0-9a-f-]{36}$/);
});

test("an event's Add round form stays tucked away until '+ Add round' is pressed", async ({ browser }) => {
  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await openEvent(admin, await activeEventId()); // the seed event already has days
  await expect(admin.getByRole('heading', { name: /^Add Day/ })).toHaveCount(0);
  await admin.getByRole('button', { name: '+ Add round' }).click();
  await expect(admin.getByRole('heading', { name: /^Add Day/ })).toBeVisible();
  await admin.getByRole('button', { name: 'Cancel' }).click();
  await expect(admin.getByRole('heading', { name: /^Add Day/ })).toHaveCount(0);
  await expect(admin.getByRole('button', { name: '+ Add round' })).toBeVisible();
});

test('the admin adds guide photos for a course; the Courses tab then shows them', async ({ browser }) => {
  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await admin.goto('/#/admin/courses');
  const seed = admin.getByTestId('course-group').filter({ hasText: 'Seed Links' });
  await expect(seed).toContainText('No guide yet');
  await seed.getByRole('link', { name: 'Add guide photos →' }).click();
  await expect(admin.getByRole('heading', { name: 'Seed Links guide' })).toBeVisible();
  await admin.getByLabel('Add photos for hole 1', { exact: true }).setInputFiles('public/guides/glashedy/hole-01-green.webp');
  await expect(admin.getByRole('img', { name: 'Hole 1 photo 1' })).toBeVisible({ timeout: 20_000 });
  await admin.goto('/#/admin/courses');
  await expect(admin.getByTestId('course-group').filter({ hasText: 'Seed Links' })).toContainText('Photo guide · 1 of 18 holes');

  const me = await newPhone(browser);
  await login(me);
  await me.getByRole('link', { name: 'Courses' }).click();
  await expect(me.getByRole('tab', { name: 'Seed Links' })).toBeVisible();
  const photo = me.getByRole('img', { name: 'Hole 1 photo 1' });
  await expect.poll(() => photo.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);

  // Removing the only photo takes the guide (and the tab) away again.
  admin.on('dialog', (d) => void d.accept());
  await admin.goto('/#/admin/courses');
  await admin.getByTestId('course-group').filter({ hasText: 'Seed Links' }).getByRole('link', { name: 'Edit guide photos →' }).click();
  await admin.getByRole('button', { name: 'Remove hole 1 photo 1' }).click();
  await expect(admin.getByRole('img', { name: 'Hole 1 photo 1' })).toHaveCount(0);
  await me.reload();
  await expect(me.locator('nav a', { hasText: 'Courses' })).toHaveCount(0);
});

test("photos for a hole of a built-in guide replace that hole's pages; other holes keep the built-in guide", async ({ browser }) => {
  await useTripCourses();
  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await admin.goto('/#/admin/courses');
  const dundonald = admin.getByTestId('course-group').filter({ hasText: 'Dundonald Links' });
  await expect(dundonald).toContainText('Guide ✓');
  await dundonald.getByRole('link', { name: 'Add guide photos →' }).click();
  await expect(admin.getByTestId('builtin-note')).toBeVisible();
  await admin.getByLabel('Add photos for hole 2', { exact: true }).setInputFiles('public/guides/glashedy/hole-01-green.webp');
  await expect(admin.getByRole('img', { name: 'Hole 2 photo 1' })).toBeVisible({ timeout: 20_000 });
  await admin.goto('/#/admin/courses');
  await expect(admin.getByTestId('course-group').filter({ hasText: 'Dundonald Links' })).toContainText('Guide ✓ · your photos on 1 hole');

  const me = await newPhone(browser);
  await login(me);
  await me.getByRole('link', { name: 'Courses' }).click();
  await me.getByRole('tab', { name: 'Dundonald' }).click();
  await me.getByRole('button', { name: 'Guide hole 2', exact: true }).click();
  const photo = me.getByRole('img', { name: 'Hole 2 photo 1' });
  await expect.poll(() => photo.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(me.getByTestId('guide-layout')).toHaveCount(0);
  await expect(me.getByText('Uploaded guide photos.')).toBeVisible();

  await me.getByRole('button', { name: 'Guide hole 3', exact: true }).click();
  await expect(me.getByTestId('guide-layout')).toHaveAttribute('src', 'guides/dundonald/hole-03.webp');
  await expect(me.getByRole('img', { name: /photo/ })).toHaveCount(0);

  // Removing the photo gives hole 2 back to the built-in guide.
  admin.on('dialog', (d) => void d.accept());
  await admin.getByTestId('course-group').filter({ hasText: 'Dundonald Links' }).getByRole('link', { name: 'Edit guide photos →' }).click();
  await admin.getByRole('button', { name: 'Remove hole 2 photo 1' }).click();
  await expect(admin.getByRole('img', { name: 'Hole 2 photo 1' })).toHaveCount(0);
  await me.reload();
  await me.getByRole('button', { name: 'Guide hole 2', exact: true }).click();
  await expect(me.getByTestId('guide-layout')).toHaveAttribute('src', 'guides/dundonald/hole-02.webp');
});

test("Admin → Events lists the active event first with a summary, and the new-event form waits for '+ New event'", async ({ page }) => {
  const db = serviceDb();
  await db.from('events').insert({ name: 'Zzz Later Trip' });
  await loginAdmin(page);
  await page.goto('/#/admin/events');
  const tiles = page.getByTestId('swipe-row');
  await expect(tiles.first()).toContainText('Active');
  await expect(tiles.first()).toContainText(/\d+ days? · .+ · \d+ players?/);
  await expect(tiles.filter({ hasText: 'Zzz Later Trip' })).toContainText('No days yet · 0 players');
  await expect(page.getByLabel('New event name')).toHaveCount(0);
  await page.getByRole('button', { name: '+ New event' }).click();
  await expect(page.getByLabel('New event name')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('New event name')).toHaveCount(0);
});

test('Admin → Courses shows each tee as a chip that opens it, and + Tee adds one', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/#/admin/courses');
  const seed = page.getByTestId('course-group').filter({ hasText: 'Seed Links' });
  await seed.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/#\/admin\/courses\/[0-9a-f-]{36}$/);
  await page.goBack();
  await page.getByTestId('course-group').filter({ hasText: 'Seed Links' }).getByRole('link', { name: '+ Add a tee' }).click();
  await expect(page).toHaveURL(/#\/admin\/courses\/new\/[0-9a-f-]{36}$/);
});

test("an event's share link lets anyone follow and score without signing in, until it's turned off", async ({ browser }) => {
  const admin = await newPhone(browser);
  admin.on('dialog', (d) => void d.accept());
  await loginAdmin(admin);
  await openEvent(admin, await activeEventId());
  const card = admin.getByTestId('share-link');
  await card.getByRole('button', { name: 'Create share link' }).click();
  const url = (await card.getByTestId('share-url').textContent())!.trim();
  expect(url).toMatch(/#\/watch\/[A-Za-z0-9_-]{22}$/);

  // A phone that has never signed in opens the link: straight in, no sign-in.
  const guest = await newPhone(browser);
  await guest.goto(url);
  await expect(guest.getByTestId('watching')).toContainText('via share link');
  await expect(guest.getByLabel('Your email')).toHaveCount(0);
  await expect(guest.locator('nav a', { hasText: 'Admin' })).toHaveCount(0);

  // It scores like a signed-in player, and a signed-in viewer sees it.
  const viewer = await newPhone(browser);
  await login(viewer);
  await openGroup1(guest);
  await enterHole(guest, 1, 4, 5);
  await expect(guest.getByTestId('pending')).toBeHidden({ timeout: 30_000 });
  await expect(group1Card(viewer).getByTestId('status')).toHaveText('1 UP', { timeout: 30_000 });

  // Scores entered elsewhere reach the link's phone too (it refreshes every few seconds).
  await openGroup1(viewer);
  await enterHole(viewer, 2, 4, 5);
  await guest.goto('/#/');
  await expect(group1Card(guest).getByTestId('status')).toHaveText('2 UP', { timeout: 30_000 });

  // Reopening the saved app (no link in the address) still opens the event.
  await guest.goto('/');
  await expect(guest.getByTestId('watching')).toBeVisible();

  // Turned off: the link's phone is asked to sign in, and told why.
  await admin.getByTestId('share-link').getByRole('button', { name: 'Turn off' }).click();
  await expect(admin.getByTestId('share-link').getByRole('button', { name: 'Create share link' })).toBeVisible();
  await guest.reload();
  await expect(guest.getByTestId('link-ended')).toBeVisible({ timeout: 20_000 });
  await expect(guest.getByLabel('Your email')).toBeVisible();
});

test('Admin → Players is a compact list: search, filter to the event, tap a player to edit', async ({ page }) => {
  const db = serviceDb();
  await db.from('players').insert({ name: 'Zara Outsider', short_name: 'Outsider', default_handicap: 3.1 });
  await loginAdmin(page);
  await page.goto('/#/admin/players');
  const rows = page.getByTestId('admin-player');
  const total = await rows.count();
  await expect(page.getByLabel('Full name')).toHaveCount(0); // nothing open, no add form

  // Filter to the active event: the player who isn't in it drops out.
  await page.getByRole('button', { name: /^All · / }).waitFor();
  await page.getByRole('group', { name: 'Show' }).getByRole('button').nth(1).click();
  await expect(rows.filter({ hasText: 'Zara Outsider' })).toHaveCount(0);
  await page.getByRole('button', { name: /^All · / }).click();
  await expect(rows).toHaveCount(total);

  // Search.
  await page.getByPlaceholder(/^Search \d+ players$/).fill('outsid');
  await expect(rows).toHaveCount(1);
  const zara = rows.filter({ hasText: 'Zara Outsider' });
  await expect(zara).toContainText('3.1');

  // Tap to edit, save a new handicap; the row shows it.
  await zara.getByRole('button', { name: /Zara Outsider/ }).click();
  await zara.getByLabel('Handicap index').fill('4.5');
  await zara.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved Zara Outsider')).toBeVisible();
  await expect(zara.getByRole('button', { name: /Zara Outsider/ })).toContainText('4.5');
  await zara.getByRole('button', { name: /Zara Outsider/ }).click();
  await expect(zara.getByLabel('Handicap index')).toHaveCount(0);

  // Add player opens the form only when pressed.
  await page.getByRole('button', { name: '+ Add player' }).click();
  await expect(page.getByRole('heading', { name: 'Add player' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Add player' })).toHaveCount(0);
});

test('the admin can switch player photos off for an event; everyone then shows initials', async ({ browser }) => {
  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await admin.goto('/#/admin/players');
  const adams = admin.getByTestId('admin-player').filter({ hasText: 'Alex Adams' });
  await adams.getByRole('button').first().click();
  await adams.locator('input[type=file]').setInputFiles('public/icon-512.png');
  await expect(adams.locator('img')).toBeVisible();

  const me = await newPhone(browser);
  await login(me);
  await expect(group1Card(me).getByRole('img', { name: 'Alex Adams' })).toBeVisible({ timeout: 20_000 });

  await openEvent(admin, await activeEventId());
  await admin.getByText('More options').click();
  await expect(admin.getByText('1 of 12 players have one')).toBeVisible();
  await admin.getByLabel('Show player photos').uncheck();
  await admin.getByRole('button', { name: 'Save settings' }).click();
  await expect(admin.getByText('Event saved')).toBeVisible();

  await me.reload();
  await expect(group1Card(me)).toContainText('Adams');
  await expect(group1Card(me).getByRole('img')).toHaveCount(0);
  // Admin → Players still shows it, so photos can be managed.
  await admin.goto('/#/admin/players');
  await expect(admin.getByTestId('admin-player').filter({ hasText: 'Alex Adams' }).locator('img')).toBeVisible();
});

test('a scramble day can take a different % of the low and the high handicap', async ({ browser }) => {
  const admin = await newPhone(browser);
  await loginAdmin(admin);
  await openEvent(admin, await activeEventId());
  const day1 = admin.getByTestId('round').first();
  await day1.getByLabel('Fourball game').selectOption('scramble');
  await expect(day1.getByLabel('Low handicap %')).toHaveValue('35'); // new rounds start at 35% / 15%
  await expect(day1.getByLabel('High handicap %')).toHaveValue('15');
  await expect(day1.getByTestId('scramble-example')).toContainText('team plays off 6'); // 2.8 + 3 = 5.8
  await day1.getByLabel('High handicap %').fill('35');
  await expect(day1.getByTestId('scramble-example')).toContainText('team plays off 10'); // 2.8 + 7 = 9.8
  await day1.getByLabel('High handicap %').fill('15');
  await day1.getByRole('button', { name: 'Save round' }).click();
  await expect(admin.getByText('Day 1 saved')).toBeVisible();
  await expect(day1.locator('summary')).toContainText('2-man scramble 35/15');

  // Adams & Brown are both 10: 3.5 + 1.5 = 5 (35% each would be 7).
  const me = await newPhone(browser);
  await login(me);
  await openGroup1(me);
  await expect(me.getByTestId('row-A1')).toContainText('(5)');
});

test("a round's course guide can be previewed from the event page, as players see it", async ({ browser }) => {
  const db = serviceDb();
  const admin = await newPhone(browser);
  await loginAdmin(admin);
  const eventId = await activeEventId();
  await openEvent(admin, eventId);
  const day1 = admin.getByTestId('round').first();
  await expect(day1).toContainText('No course guide yet'); // Seed Links has no guide…
  // …until it has photos. The seed doesn't wipe guide photos, so the row goes again at the end.
  const path = 'Seed Links/1/e2e.webp';
  await db.from('guide_photos').insert({ course_name: 'Seed Links', hole: 1, path });
  try {
    await previewSeedGuide(admin, eventId);
  } finally {
    await db.from('guide_photos').delete().eq('path', path);
  }
});

async function previewSeedGuide(admin: import('@playwright/test').Page, eventId: string) {
  await admin.reload();
  await expect(admin.getByRole('heading', { name: 'Rounds' })).toBeVisible();
  await admin.getByTestId('round').first().locator('summary').click();
  await admin.getByRole('link', { name: 'View course guide →' }).first().click();

  await expect(admin.getByTestId('guide-preview')).toContainText('Preview · as players see it');
  await expect(admin.getByRole('tab', { name: 'Seed Links' })).toBeVisible();
  await expect(admin.getByTestId('guide-title')).toContainText('Hole 1 · Par 4');
  await admin.getByRole('link', { name: '← Back to event' }).click();
  await expect(admin).toHaveURL(new RegExp(`#/admin/events/${eventId}$`));
}
