import { expect, test } from '@playwright/test';
import { login, loginAdmin, reseed, serviceDb, unfoldEvent } from './helpers';

test.beforeEach(() => reseed());

const ids = async () => {
  const { data } = await serviceDb().from('players').select('id, name');
  return (n: string) => (data as { id: string; name: string }[]).find((p) => p.name === n)!.id;
};

test('a season team event: points per format, golfers per day, 2 v 1 from the teams, same-team days blocked', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/#/admin/events');
  await page.getByRole('button', { name: '+ New event' }).click();
  await page.getByLabel('New event name').fill('Saturday League');
  await page.getByLabel('Season team event').check();
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/#\/admin\/events\/[0-9a-f-]{36}$/);
  const eventId = page.url().split('/events/')[1];

  // Points for each format, defaults showing; change the 1 v 1 win.
  await expect(page.getByLabel('Fourball win')).toHaveValue('2');
  await page.getByLabel('1 v 1 win').fill('1.5');
  await page.getByRole('button', { name: 'Save points' }).click();
  await expect(page.getByText('Points saved')).toBeVisible();

  // Teams as usual (even with 4 golfers, a season event always has teams).
  await unfoldEvent(page);
  for (const n of ['Alex Adams', 'Ben Brown', 'Chris Clark', 'Dan Davies']) await page.getByLabel(`${n} playing`).check();
  await page.getByRole('button', { name: 'Next: pick teams (4)' }).click();
  for (const [n, t] of [['Alex Adams', 'Team A'], ['Ben Brown', 'Team A'], ['Chris Clark', 'Team B'], ['Dan Davies', 'Team B']]) {
    await page.getByRole('button', { name: `${n}: ${t}` }).click();
  }
  await page.getByRole('button', { name: 'Save teams' }).click();
  await expect(page.getByText(/Teams saved/)).toBeVisible();

  // Day 1 (a new event opens straight on Add round): everyone (4) → fourballs.
  let form = page.locator('form.round');
  await form.getByLabel('Course').selectOption('Seed Links');
  await expect(form.getByLabel(/Everyone/)).toBeChecked();
  await expect(form.getByTestId('day-format')).toContainText('4 golfers · fourballs');
  // One fourball with teams set: its singles line-up can be picked right here.
  await form.getByRole('switch', { name: 'Play singles' }).check();
  await form.getByLabel("I'll choose").check();
  const lineups = form.getByRole('radio', { name: /^Fourball 1: / });
  await expect(lineups).toHaveCount(2);
  await expect(lineups.first()).toBeChecked();
  await lineups.nth(1).check();
  await form.getByRole('button', { name: /^Add Day/ }).click();
  await expect(page.getByText(/Round added/)).toBeVisible();
  const { data: d1 } = await serviceDb().from('rounds').select('id, events!inner(season)').eq('name', 'Day 1').eq('events.season', true).single();
  await expect.poll(async () => (await serviceDb().from('groups').select('singles_crossed').eq('round_id', d1!.id).single()).data?.singles_crossed).toBe(true);
  // Day 1's settings show the event's points: the fourball is worth 2, the singles 1 each (2 in total).
  await unfoldEvent(page);
  const day1 = page.getByTestId('round').first();
  await expect(day1.getByTestId('fourball-worth')).toHaveText("Fourball worth 2 (from the event's points)");
  await expect(day1.getByLabel('Fourball pts')).toHaveCount(0);
  await expect(day1.locator('.singles')).toContainText('2 in each fourball · 1 each, 2 in total');

  // Day 2: different golfers — two from Team A only is blocked; with Clark it's a 2 v 1, Clark alone.
  await page.getByRole('button', { name: '+ Add round' }).click();
  form = page.locator('form.round');
  await form.getByLabel('Course').selectOption('Seed Links');
  await expect(form.getByLabel('Same as Day 1')).toBeChecked();
  await form.getByLabel('Different golfers').check(); // starts from Day 1's golfers
  await expect(form.getByLabel('Dan Davies golfer')).toBeChecked();
  await form.getByLabel('Chris Clark golfer').uncheck();
  await form.getByLabel('Dan Davies golfer').uncheck();
  await expect(form.getByTestId('day-format')).toContainText('both on Team A');
  await expect(form.getByRole('button', { name: /^Add Day/ })).toBeDisabled();
  await form.getByLabel('Chris Clark golfer').check();
  await expect(form.getByTestId('day-format')).toContainText('3 golfers · 2 v 1 · Clark plays alone');
  // The game is chosen here: 2 v 1 games only, best individual first and picked.
  await expect(form.getByLabel('2 v 1 Stableford · better total')).toBeChecked();
  await expect(form.getByLabel('Six pointer (Stableford)')).toHaveCount(0);
  await expect(form.getByText('single wins 2')).toBeVisible();
  await form.getByRole('button', { name: 'Add Day 2 · 2 v 1 Stableford · better total' }).click();
  await expect(page.getByText(/Round added/)).toBeVisible();

  const db = serviceDb();
  const id = await ids();
  const { data: rounds } = await db.from('rounds').select('id, round_no').eq('event_id', eventId).order('round_no');
  const day2 = rounds![1].id;
  expect((await db.from('rounds').select('three_game').eq('id', day2).single()).data).toEqual({ three_game: 'two_v_one_best' });
  const rp = (await db.from('round_players').select('player_id').eq('round_id', day2)).data!.map((r) => r.player_id).sort();
  expect(rp).toEqual([id('Alex Adams'), id('Ben Brown'), id('Chris Clark')].sort());
  const g = (await db.from('groups').select('group_players(slot, player_id)').eq('round_id', day2)).data!;
  expect(g).toHaveLength(1);
  const p1 = (g[0].group_players as { slot: string; player_id: string }[]).find((x) => x.slot === 'P1')!;
  expect(p1.player_id).toBe(id('Chris Clark'));

  // The day shows its golfers and format, and only the 3-golfer games (no six pointer).
  await unfoldEvent(page);
  const tile = page.getByTestId('round').nth(1);
  await expect(tile.locator('summary').first()).toContainText('3 golfers');
  const picker = tile.getByLabel('3-player game');
  await expect(picker.locator('option', { hasText: 'Six pointer' })).toHaveCount(0);
  await expect(picker.locator('option', { hasText: '2 v 1 scratch match play' })).toHaveCount(1);
});

test('a confirmed 2 v 1 adds its points to the single\'s team; a player added later is there for new days only', async ({ browser }) => {
  const db = serviceDb();
  const id = await ids();
  const { data: course } = await db.from('courses').select('id').eq('name', 'Seed Links').single();
  await db.from('events').update({ is_active: false }).eq('is_active', true);
  const { data: ev } = await db.from('events').insert({ name: 'Saturday League', season: true, is_active: true, team_a_name: 'Blue', team_b_name: 'Red' }).select('id').single();
  const teams: [string, 'A' | 'B'][] = [['Alex Adams', 'A'], ['Ben Brown', 'A'], ['Chris Clark', 'B'], ['Dan Davies', 'B']];
  await db.from('event_players').insert(teams.map(([n, team]) => ({ event_id: ev!.id, player_id: id(n), team, handicap: 10 })));
  const { data: round } = await db.from('rounds').insert({ event_id: ev!.id, round_no: 1, name: 'Day 1', course_id: course!.id, three_game: 'two_v_one' }).select('id').single();
  await db.from('round_players').insert(['Alex Adams', 'Ben Brown', 'Chris Clark'].map((n) => ({ round_id: round!.id, player_id: id(n) })));
  const { data: group } = await db.from('groups').insert({ round_id: round!.id, group_no: 1 }).select('id').single();
  await db.from('group_players').insert([['P1', 'Chris Clark'], ['P2', 'Alex Adams'], ['P3', 'Ben Brown']].map(([slot, n]) => ({ group_id: group!.id, slot, player_id: id(n) })));
  // Clark (alone, Red) pars every hole; Adams and Brown make 7s → the single wins: Red +2.
  const at = new Date().toISOString();
  await db.from('scores').insert(
    ['Chris Clark', 'Alex Adams', 'Ben Brown'].flatMap((n) =>
      Array.from({ length: 18 }, (_, i) => ({ round_id: round!.id, player_id: id(n), hole: i + 1, gross: n === 'Chris Clark' ? 4 : 7, picked_up: false, client_updated_at: at })),
    ),
  );

  const page = await browser.newPage();
  page.on('dialog', (d) => void d.accept());
  await login(page);
  await expect(page.getByTestId('proj-b')).toHaveText('2'); // projected while unconfirmed
  await page.goto(`/#/match/${group!.id}/individual`);
  await page.getByRole('button', { name: 'Confirm result' }).click();
  await expect(page.getByTestId('match-card')).toContainText('FINAL');
  const { data: res } = await db.from('match_results').select('points_a, points_b').eq('group_id', group!.id).single();
  expect([Number(res!.points_a), Number(res!.points_b)]).toEqual([0, 2]);

  // Day 2: an unconfirmed 1 v 1 (Adams v Davies).
  const { data: r2 } = await db.from('rounds').insert({ event_id: ev!.id, round_no: 2, name: 'Day 2', course_id: course!.id }).select('id').single();
  await db.from('round_players').insert(['Alex Adams', 'Dan Davies'].map((n) => ({ round_id: r2!.id, player_id: id(n) })));
  const { data: g2 } = await db.from('groups').insert({ round_id: r2!.id, group_no: 1 }).select('id').single();
  await db.from('group_players').insert([['P1', 'Alex Adams'], ['P2', 'Dan Davies']].map(([slot, n]) => ({ group_id: g2!.id, slot, player_id: id(n) })));

  // Re-saving the teams (2 v 2) must not turn the 1 v 1 day into a fourball.
  const admin = await browser.newPage();
  await loginAdmin(admin);
  await admin.goto(`/#/admin/events/${ev!.id}`);
  await unfoldEvent(admin);
  await admin.getByRole('button', { name: 'Save teams' }).click();
  await expect(admin.getByText(/Teams saved/)).toBeVisible();
  const day2Players = (await db.from('group_players').select('slot').eq('group_id', g2!.id)).data!.map((x) => x.slot).sort();
  expect(day2Players).toEqual(['P1', 'P2']);

  // A new player joins Blue. Ticked but not saved yet, he isn't offered for a day.
  await unfoldEvent(admin);
  await admin.getByRole('tab', { name: /Who's playing/ }).click();
  await admin.getByLabel('Ed Evans playing').check();
  await admin.getByRole('button', { name: '+ Add round' }).click();
  await admin.locator('form.round').getByLabel('Course').selectOption('Seed Links');
  await admin.locator('form.round').getByLabel('Different golfers').check();
  await expect(admin.locator('form.round').getByLabel('Ed Evans golfer')).toHaveCount(0);
  await expect(admin.locator('form.round').getByText('1 player picked but not saved yet — tap Save teams above to include them.')).toBeVisible();
  await admin.locator('form.round').getByRole('button', { name: 'Cancel' }).click();
  await admin.getByRole('button', { name: 'Next: pick teams (5)' }).click();
  await admin.getByRole('button', { name: 'Ed Evans: Blue' }).click();
  await admin.getByRole('button', { name: 'Save teams' }).click();
  await expect(admin.getByText(/Teams saved/)).toBeVisible();
  await admin.getByRole('button', { name: '+ Add round' }).click();
  const form = admin.locator('form.round');
  await form.getByLabel('Course').selectOption('Seed Links');
  await form.getByLabel('Different golfers').check();
  await expect(form.getByLabel('Ed Evans golfer')).toBeVisible();
  const day1 = (await db.from('round_players').select('player_id').eq('round_id', round!.id)).data!;
  expect(day1).toHaveLength(3);
  await admin.locator('form.round').getByRole('button', { name: 'Cancel' }).click();

  // Day 2 changed to 5 golfers: too many for one group, so its old 1 v 1 group goes (pair it on the pairings page).
  await unfoldEvent(admin);
  const day2 = admin.getByTestId('round').nth(1);
  await day2.getByText('Golfers (2)').click();
  await day2.getByRole('button', { name: 'Change golfers' }).click();
  for (const n of ['Ben Brown', 'Chris Clark', 'Ed Evans']) await day2.getByLabel(`${n} golfer`).check();
  await expect(day2.getByTestId('day-format')).toContainText('5 golfers · fourballs');
  await day2.getByRole('button', { name: 'Save golfers' }).click();
  await expect(admin.getByText('Day 2 golfers saved')).toBeVisible();
  // The day stays open (its game may need choosing for the new golfer count); only the golfers list folds.
  await expect(day2.getByText('Day 2 golfers saved')).toBeVisible();
  await expect(day2.getByRole('button', { name: 'Save round' })).toBeVisible();
  await expect(day2.getByRole('button', { name: 'Change golfers' })).toBeHidden();
  await expect.poll(async () => (await db.from('groups').select('id').eq('round_id', r2!.id)).data?.length).toBe(0);
  await expect.poll(async () => (await db.from('round_players').select('player_id').eq('round_id', r2!.id)).data?.length).toBe(5);
});
