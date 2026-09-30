import { expect, test } from '@playwright/test';
import { enterHole, group1Card, login, loginAdmin, newPhone, openGroup1, reseed, serviceDb } from './helpers';

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
  await admin.goto(`/#/admin/events/${await activeEventId()}`); // Reopen lives on the event's admin page
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
  await admin.goto(`/#/admin/events/${await activeEventId()}`); // Reopen lives on the event's admin page
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
  await admin.getByText('More options').click();
  await admin.getByLabel(/Show the Form tab to players/).check();
  await admin.getByRole('button', { name: 'Save tab settings' }).click();
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
  await admin.goto(`/#/admin/events/${ev!.id}`);
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
  await admin.goto(`/#/admin/events/${ev!.id}`);
  const team = (name: string, t: string) => admin.getByLabel(`${name} team`).selectOption(t);
  await team('Alex Adams', 'A');
  await team('Ben Brown', 'A');
  await team('Chris Clark', 'B');
  await team('Dan Davies', 'B');
  await admin.getByRole('button', { name: 'Save teams' }).click();
  await expect(admin.getByText('Teams saved · pairings set for Day 1')).toBeVisible();
  await admin.goto('/#/');
  const card = admin.getByTestId('match-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Adams');
  await expect(card).toContainText('Davies');

  // Swap a player: the pairing follows.
  await admin.goto(`/#/admin/events/${ev!.id}`);
  await team('Dan Davies', '');
  await team('Ed Evans', 'B');
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
  await admin.goto(`/#/admin/events/${ev!.id}`);
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
  await admin.goto(`/#/admin/events/${ev!.id}`);
  await admin.reload(); // pick up the course the test just added
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
  await admin.goto(`/#/admin/events/${await activeEventId()}`);
  await admin.getByText('More options').click();
  await admin.getByLabel(/Show the Leaderboard tab to players/).uncheck();
  await admin.getByRole('button', { name: 'Save tab settings' }).click();
  await expect(admin.getByText('Event saved')).toBeVisible();
  await expect(admin.locator('nav a', { hasText: 'Leaderboard' })).toHaveCount(1); // the admin still sees it

  const trip = await newPhone(browser);
  await login(trip, 'tester@example.com', process.env.TRIP_PASSWORD!, { expectLeaderboard: false });
  await expect(trip.locator('nav a')).toHaveText(['Scores', 'Scorecard', 'Courses']); // Scorecard replaces the Leaderboard
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
  await admin.goto(`/#/admin/events/${ev!.id}`);
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
  await expect(me.locator('nav a')).toHaveText(['Scores', 'Scorecard', 'Courses']);
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
