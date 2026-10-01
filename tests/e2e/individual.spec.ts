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

test("the admin creates an individual event, picks players and sets a day's games", async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/#/admin/events');
  await page.getByRole('button', { name: '+ New event' }).click();
  await page.getByLabel('New event name').fill('Winter Swindle');
  await page.getByLabel('Individual').check();
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/#\/admin\/events\/[0-9a-f-]{36}$/);
  const eventId = page.url().split('/events/')[1];

  await expect(page.getByLabel('Team A name')).toHaveCount(0); // no teams
  for (const n of ['Alex Adams', 'Ben Brown', 'Chris Clark']) await page.getByLabel(`${n} playing`).check();
  await page.getByRole('button', { name: 'Save players' }).click();
  await expect(page.getByText('Players saved')).toBeVisible();

  const form = page.locator('form.round');
  await form.getByLabel('Course').selectOption('Seed Links');
  await form.getByRole('button', { name: 'Add round' }).click();
  await expect(page.getByText('Round added')).toBeVisible();
  await unfoldEvent(page);
  const day1 = page.getByTestId('round').first();
  await expect(day1.getByLabel('Fourball game')).toHaveCount(0);
  await day1.getByLabel('2-player game').selectOption('flat_match');
  await day1.getByLabel('3-player game').selectOption('two_v_one');
  await day1.getByRole('button', { name: 'Save round' }).click();
  await expect(page.getByText('Day 1 saved')).toBeVisible();
  await expect(day1.locator('summary')).toContainText('Flat match play · 2 v 1 Stableford');

  const db = serviceDb();
  expect((await db.from('events').select('kind').eq('id', eventId).single()).data).toEqual({ kind: 'individual' });
  const eps = (await db.from('event_players').select('team').eq('event_id', eventId)).data!;
  expect(eps).toHaveLength(3);
  expect(eps.every((e) => e.team === null)).toBe(true);
  expect((await db.from('rounds').select('pair_game, three_game').eq('event_id', eventId).single()).data).toEqual({
    pair_game: 'flat_match',
    three_game: 'two_v_one',
  });
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
