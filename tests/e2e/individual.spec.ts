import { expect, test } from '@playwright/test';
import { enterIndividualHole, login, reseed, seedIndividual, serviceDb } from './helpers';

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
