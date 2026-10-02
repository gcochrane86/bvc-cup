import { expect, test } from '@playwright/test';
import { enterIndividualHole, login, loginAdmin, reseed, seedIndividual, serviceDb, unfoldEvent } from './helpers';

test.beforeEach(() => reseed());

const card = (page: import('@playwright/test').Page, groupId: string) => page.locator(`[data-match-id="${groupId}:individual"]`);

test('an individual day: a 2-ball plays Stableford match play, a 3-ball the six pointer', async ({ page }) => {
  const { twoBall, threeBall } = await seedIndividual();
  await login(page, undefined, undefined, { expectLeaderboard: false });
  await expect(page.getByRole('heading', { name: 'Saturday Swindle' })).toBeVisible();
  await expect(page.getByTestId('proj-a')).toHaveCount(0); // no team tracker
  await expect(page.getByTestId('match-card')).toHaveCount(2);
  await expect(card(page, twoBall)).toContainText('Stableford match play');
  await expect(card(page, threeBall)).toContainText('Six pointer (Stableford)');

  // The 2-ball: both off 10, off the low man → no shots. Adams par, Brown bogey on the 1st.
  await page.goto(`/#/score/${twoBall}`);
  await enterIndividualHole(page, 1, { P1: 4, P2: 5 });
  await page.goto('/#/');
  await expect(card(page, twoBall).getByTestId('status')).toHaveText('1 UP');

  // The 3-ball (full handicaps; the 1st is SI 7): Clark 6 → no shot, Davies 14 → a shot, Evans 3 → no shot.
  // All par 4: Clark 2 pts, Davies 3, Evans 2 → Davies 4, Clark and Evans tie for second → 1 each.
  await page.goto(`/#/score/${threeBall}`);
  await enterIndividualHole(page, 1, { P1: 4, P2: 4, P3: 4 });
  await page.goto('/#/');
  await expect(card(page, threeBall).getByTestId('status')).toHaveText('1 · 4 · 1');
});

test('confirming individual games: a flat match play 2-ball and a 2 v 1', async ({ page }) => {
  const { twoBall, threeBall, roundId } = await seedIndividual({ pairGame: 'flat_match', threeGame: 'two_v_one' });
  // 2 v 1 (full handicaps): Clark alone pars every hole; Davies and Evans make 7s → the single wins.
  const db = serviceDb();
  const three = ((await db.from('group_players').select('slot, player_id').eq('group_id', threeBall)).data ?? []) as { slot: string; player_id: string }[];
  const at = new Date().toISOString();
  await db.from('scores').insert(
    three.flatMap(({ slot, player_id }) =>
      Array.from({ length: 18 }, (_, i) => ({ round_id: roundId, player_id, hole: i + 1, gross: slot === 'P1' ? 4 : 7, picked_up: false, client_updated_at: at })),
    ),
  );

  await login(page, undefined, undefined, { expectLeaderboard: false });
  page.on('dialog', (d) => void d.accept());
  // Flat match play: Adams wins the first 10 holes → 10&8.
  await page.goto(`/#/score/${twoBall}`);
  for (let h = 1; h <= 10; h++) await enterIndividualHole(page, h, { P1: 4, P2: 5 });
  await page.goto(`/#/match/${twoBall}/individual`);
  await page.getByRole('button', { name: 'Confirm result' }).click();
  await expect(page.getByTestId('match-card')).toContainText('FINAL');
  await expect(page.getByTestId('match-card')).toContainText('10&8');

  await page.goto(`/#/match/${threeBall}/individual`);
  await expect(page.getByTestId('match-card')).toContainText('2 v 1 Stableford');
  await page.getByRole('button', { name: 'Confirm result' }).click();
  await expect(page.getByTestId('match-card')).toContainText('FINAL');

  const results = (await db.from('match_results').select('group_id, winner, player_points').in('group_id', [twoBall, threeBall])).data!;
  expect(results.find((r) => r.group_id === twoBall)?.winner).toBe('A');
  const solo = results.find((r) => r.group_id === threeBall)!;
  expect(solo.winner).toBe('A');
  expect(Object.keys(solo.player_points ?? {})).toHaveLength(3);
});

test("an event with 3 players becomes a 3-ball: no teams, its group made automatically, only the 3-player game", async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/#/admin/events');
  await page.getByRole('button', { name: '+ New event' }).click();
  await expect(page.getByLabel('Individual')).toHaveCount(0); // no team/individual choice
  await page.getByLabel('New event name').fill('Winter Swindle');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/#\/admin\/events\/[0-9a-f-]{36}$/);
  const eventId = page.url().split('/events/')[1];

  const form = page.locator('form.round');
  await form.getByLabel('Course').selectOption('Seed Links');
  // Holes 1 to N: set the day to finish on the 12th.
  await form.getByLabel('Holes 1 to…').check();
  await expect(form.getByTestId('holes-to')).toHaveText('13');
  await form.getByRole('button', { name: 'Fewer holes' }).click();
  await expect(form.getByText('12 holes')).toBeVisible();
  await form.getByRole('button', { name: /^Add Day/ }).click();
  await expect(page.getByText('Round added')).toBeVisible();
  expect((await serviceDb().from('rounds').select('holes').eq('event_id', page.url().split('/events/')[1]).single()).data?.holes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  await unfoldEvent(page);
  for (const n of ['Alex Adams', 'Ben Brown', 'Chris Clark']) await page.getByLabel(`${n} playing`).check();
  await page.getByRole('button', { name: 'Save players' }).click(); // 3 players: no team step
  await expect(page.getByText(/Players saved/)).toBeVisible();
  await expect(page.getByLabel('Team A name')).toHaveCount(0);

  await unfoldEvent(page);
  const day1 = page.getByTestId('round').first();
  await expect(day1.getByLabel('Fourball game')).toHaveCount(0);
  await expect(day1.getByLabel(/2-player game|groups of 2/)).toHaveCount(0);
  await expect(day1.locator('summary')).toContainText('1 group set');
  await expect(day1.getByLabel('3-player game')).toHaveValue('six_stableford'); // a normal 3-ball starts on the six pointer
  await day1.getByLabel('3-player game').selectOption('two_v_one');
  await day1.getByRole('button', { name: 'Save round' }).click();
  await expect(page.getByText('Day 1 saved')).toBeVisible();

  const db = serviceDb();
  expect((await db.from('events').select('kind').eq('id', eventId).single()).data).toEqual({ kind: 'individual' });
  const eps = (await db.from('event_players').select('team').eq('event_id', eventId)).data!;
  expect(eps).toHaveLength(3);
  expect(eps.every((e) => e.team === null)).toBe(true);
  const round = (await db.from('rounds').select('id, three_game').eq('event_id', eventId).single()).data!;
  expect(round.three_game).toBe('two_v_one');
  const groups = (await db.from('groups').select('group_players(slot)').eq('round_id', round.id)).data!;
  expect(groups).toHaveLength(1);
  expect((groups[0].group_players as { slot: string }[]).map((g) => g.slot).sort()).toEqual(['P1', 'P2', 'P3']);
});

test('4 or more players still pick teams, as today', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/#/admin/events');
  await page.getByRole('button', { name: '+ New event' }).click();
  await page.getByLabel('New event name').fill('Big Day');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/#\/admin\/events\/[0-9a-f-]{36}$/);
  await unfoldEvent(page);
  for (const n of ['Alex Adams', 'Ben Brown', 'Chris Clark', 'Dan Davies']) await page.getByLabel(`${n} playing`).check();
  await expect(page.getByRole('button', { name: 'Save players' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next: pick teams (4)' })).toBeVisible();
  await expect(page.getByLabel('Team A name')).toBeVisible();
});

test('the admin builds a 2-ball and a 2 v 1 3-ball for an individual day, choosing the single', async ({ page }) => {
  const { roundId } = await seedIndividual({ threeGame: 'two_v_one' });
  const db = serviceDb();
  await db.from('groups').delete().eq('round_id', roundId); // start with no groups
  await loginAdmin(page);
  await page.goto(`/#/admin/pairings/${roundId}`);
  await expect(page.getByRole('heading', { name: 'Day 1 groups' })).toBeVisible();
  await page.getByRole('button', { name: '+ Add group' }).click();
  await page.getByRole('button', { name: '+ Add group' }).click();
  await page.getByLabel('Group 1 player 1').selectOption({ label: 'Alex Adams (10)' });
  await page.getByLabel('Group 1 player 2').selectOption({ label: 'Ben Brown (10)' });
  await page.getByLabel('Group 2 player 1').selectOption({ label: 'Chris Clark (6)' });
  await page.getByLabel('Group 2 player 2').selectOption({ label: 'Dan Davies (14)' });
  await page.getByLabel('Group 2 player 3').selectOption({ label: 'Ed Evans (3)' });
  await page.getByLabel('Group 2: Dan Davies plays alone').check();
  await page.getByRole('button', { name: 'Save groups' }).click();
  await expect(page.getByText('Groups saved')).toBeVisible();

  const groups = (await db.from('groups').select('group_no, group_players(slot, player_id)').eq('round_id', roundId).order('group_no')).data!;
  const players = (await db.from('players').select('id, name')).data!;
  const nameOf = (id: string) => players.find((p) => p.id === id)!.name;
  expect(groups).toHaveLength(2);
  const g2 = Object.fromEntries((groups[1].group_players as { slot: string; player_id: string }[]).map((gp) => [gp.slot, nameOf(gp.player_id)]));
  expect(g2.P1).toBe('Dan Davies'); // the single is P1
  expect(new Set([g2.P2, g2.P3])).toEqual(new Set(['Chris Clark', 'Ed Evans']));

  // Removing a group drops it.
  await page.getByRole('button', { name: 'Remove group 1' }).click();
  await page.getByRole('button', { name: 'Save groups' }).click();
  await expect(page.getByText('Groups saved')).toBeVisible();
  await expect.poll(async () => (await db.from('groups').select('id').eq('round_id', roundId)).data?.length).toBe(1);
});

test("removing a group leaves a confirmed group, its players and its result alone", async ({ page }) => {
  const { roundId, twoBall, threeBall } = await seedIndividual();
  const db = serviceDb();
  // The 3-ball (group 2) is confirmed.
  await db.from('match_results').insert({ group_id: threeBall, match_type: 'individual', winner: 'P2', points_a: 0, points_b: 0, result_text: '40 pts', final_hole: 18 });
  const before = (await db.from('group_players').select('slot, player_id').eq('group_id', threeBall)).data!;
  await loginAdmin(page);
  await page.goto(`/#/admin/pairings/${roundId}`);
  await expect(page.getByLabel('Group 2 player 1')).toBeDisabled(); // confirmed: locked
  await expect(page.getByRole('button', { name: 'Remove group 2' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove group 1' }).click();
  await page.getByRole('button', { name: 'Save groups' }).click();
  await expect(page.getByText('Groups saved')).toBeVisible();

  await expect.poll(async () => (await db.from('groups').select('id').eq('id', twoBall)).data?.length).toBe(0);
  const after = (await db.from('group_players').select('slot, player_id').eq('group_id', threeBall)).data!;
  expect(after.sort((a, b) => a.slot.localeCompare(b.slot))).toEqual(before.sort((a, b) => a.slot.localeCompare(b.slot)));
  expect((await db.from('match_results').select('winner').eq('group_id', threeBall)).data).toEqual([{ winner: 'P2' }]);

  // The admin's confirmed results name the winner (Davies is the 3-ball's P2).
  const { data: ev } = await db.from('rounds').select('event_id').eq('id', roundId).single();
  await page.goto(`/#/admin/events/${ev!.event_id}`);
  await page.getByText('More options').click();
  await expect(page.getByTestId('reopen-row')).toContainText('Six pointer (Stableford)');
  await expect(page.getByTestId('reopen-row')).toContainText('Davies won · 40 pts');
});

test("with more players than one group, both games show until the day's groups are set", async ({ page }) => {
  const { eventId, roundId } = await seedIndividual(); // 5 players: a 2-ball and a 3-ball
  await loginAdmin(page);
  await page.goto(`/#/admin/events/${eventId}`);
  await unfoldEvent(page);
  const day1 = page.getByTestId('round').first();
  await expect(day1.getByLabel('Game for groups of 2')).toBeVisible(); // the day has a 2-ball and a 3-ball
  await expect(day1.getByLabel('Game for groups of 3')).toBeVisible();
  // With only the 3-ball left, only its game shows.
  const db = serviceDb();
  await db.from('groups').delete().eq('round_id', roundId).eq('group_no', 1);
  await page.reload();
  await unfoldEvent(page);
  await expect(page.getByTestId('round').first().getByLabel(/groups of 2|2-player game/)).toHaveCount(0);
  await expect(page.getByTestId('round').first().getByLabel(/groups of 3|3-player game/)).toBeVisible();
});

test('Admin → Games: a game switched off leaves the pickers; a changed default fills new days', async ({ page }) => {
  const { eventId } = await seedIndividual(); // a 2-ball and a 3-ball
  await loginAdmin(page);
  await page.getByRole('link', { name: /^Games/ }).click();
  await expect(page.getByRole('heading', { name: 'Games', exact: true })).toBeVisible();
  await page.getByLabel('Stableford total on', { exact: true }).uncheck();
  await expect(page.getByText('Stableford total off', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit 2-man scramble' }).click();
  await page.getByLabel('High handicap %').fill('35');
  await page.getByRole('button', { name: 'Save 2-man scramble' }).click();
  await expect(page.getByText('2-man scramble saved')).toBeVisible();

  // The 2-ball's picker no longer offers Stableford (Stableford match play is still there).
  await page.goto(`/#/admin/events/${eventId}`);
  await unfoldEvent(page);
  const twoPlayer = page.getByTestId('round').first().getByLabel(/2-player game|groups of 2/);
  await expect(twoPlayer.locator('option', { hasText: /^Stableford total$/ })).toHaveCount(0);
  await expect(twoPlayer.locator('option', { hasText: 'Stableford match play' })).toHaveCount(1);

  // A new day on the team event starts from the scramble default 35/35.
  const db = serviceDb();
  const { data: team } = await db.from('events').select('id').eq('name', 'Demo Cup').single();
  await page.goto(`/#/admin/events/${team!.id}`);
  await page.getByRole('button', { name: '+ Add round' }).click();
  const form = page.locator('form.round');
  await form.getByLabel('Course').selectOption('Seed Links');
  // Singles are set up in the form too: on, a random draw.
  await form.getByRole('switch', { name: 'Play singles' }).check();
  await expect(form.getByTestId('singles-game')).toHaveText('Singles play the same game: off the lower of the two, 90%.');
  await form.getByLabel('Random draw').check();
  await expect(form.getByText('Drawn for each fourball when the pairings are saved.')).toBeVisible();
  await form.getByRole('button', { name: /^Add Day/ }).click();
  await expect(page.getByText('Round added')).toBeVisible();
  const { data: rounds } = await db
    .from('rounds')
    .select('scramble_low_pct, scramble_high_pct, singles_enabled, singles_pairing, round_no')
    .eq('event_id', team!.id)
    .order('round_no');
  const added = rounds!.at(-1)!;
  expect([Number(added.scramble_low_pct), Number(added.scramble_high_pct)]).toEqual([35, 35]);
  expect([added.singles_enabled, added.singles_pairing]).toEqual([true, 'random']);
});

test('a day can play only some holes (winter: 1–9, 14 and 18); score entry skips the rest', async ({ page }) => {
  const { eventId, roundId, twoBall } = await seedIndividual();
  await loginAdmin(page);
  await page.goto(`/#/admin/events/${eventId}`);
  await unfoldEvent(page);
  const day1 = page.getByTestId('round').first();
  await expect(day1.getByLabel('All 18')).toBeChecked();
  await day1.getByLabel('Front 9').check();
  await day1.getByRole('button', { name: 'Save round' }).click();
  await expect(page.getByText('Day 1 saved')).toBeVisible();
  const db = serviceDb();
  await expect.poll(async () => (await db.from('rounds').select('holes').eq('id', roundId).single()).data?.holes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

  await unfoldEvent(page);
  await day1.getByLabel('Choose holes').check();
  for (const h of [14, 18]) await day1.getByLabel(`Play hole ${h}`, { exact: true }).check();
  await expect(day1.getByTestId('holes-count')).toHaveText('11 holes');
  await day1.getByRole('button', { name: 'Save round' }).click();
  await expect(page.getByText('Day 1 saved')).toBeVisible();
  await expect.poll(async () => (await db.from('rounds').select('holes').eq('id', roundId).single()).data?.holes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 18]);
  await expect(day1.locator('summary').first()).toContainText('11 holes');

  // Scoring: after the 9th comes the 14th.
  await page.goto(`/#/score/${twoBall}`);
  await page.getByRole('button', { name: 'Hole 9', exact: true }).click();
  await page.getByRole('button', { name: 'Save hole 9' }).click();
  await expect(page.getByRole('heading', { name: 'Hole 14', exact: true })).toBeVisible();

  // A link to a hole that isn't played lands on the next one that is; the match page doesn't link skipped holes.
  await page.goto(`/#/score/${twoBall}/12`);
  await expect(page.getByRole('heading', { name: 'Hole 14', exact: true })).toBeVisible();
  await page.goto(`/#/match/${twoBall}/individual`);
  await expect(page.getByRole('link', { name: 'Edit hole 9 scores' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit hole 12 scores' })).toHaveCount(0);

  // Choosing holes needs at least one.
  await page.goto(`/#/admin/events/${eventId}`);
  await unfoldEvent(page);
  for (const h of [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 18]) await day1.getByLabel(`Play hole ${h}`, { exact: true }).uncheck();
  await expect(day1.getByText('Pick at least one hole')).toBeVisible();
  await expect(day1.getByRole('button', { name: 'Save round' })).toBeDisabled();
});
