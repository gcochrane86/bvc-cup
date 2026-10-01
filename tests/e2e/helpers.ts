import { execSync } from 'node:child_process';
import { devices, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

export function reseed() {
  execSync('npm run seed -- --yes-wipe', { stdio: 'pipe' });
}

export async function newPhone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:5173' });
  return ctx.newPage();
}

/** Service-role client for test setup only (e.g. approving a tester, as the admin would in Access). */
export const serviceDb = () =>
  createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

/** Log in with an email + the trip password; approve the tester if they land on the waiting screen. */
/** expectLeaderboard: false when the event hides the Leaderboard tab (players then land on Scores). */
export async function login(
  page: Page,
  email = 'tester@example.com',
  password = process.env.TRIP_PASSWORD!,
  { expectLeaderboard = true }: { expectLeaderboard?: boolean } = {},
) {
  const landed = () => (expectLeaderboard ? page.getByTestId('tracker') : page.locator('nav'));
  await page.goto('/');
  await page.getByLabel('Your email').fill(email);
  await page.getByLabel('Trip password').fill(password);
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(landed().or(page.getByTestId('waiting'))).toBeVisible();
  if (await page.getByTestId('waiting').isVisible()) {
    await serviceDb().from('members').update({ status: 'approved' }).eq('email', email);
    // The waiting screen re-checks by itself; only tap "Check again" if it's still showing.
    await expect(async () => {
      const again = page.getByRole('button', { name: 'Check again' });
      if (await again.isVisible()) await again.click();
      await expect(landed()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }
  await expect(landed()).toBeVisible();
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

/** Open an event's admin page with every round tile and the Players section unfolded (as if each were tapped). */
export async function openEvent(page: Page, eventId: string) {
  await page.goto(`/#/admin/events/${eventId}`);
  await unfoldEvent(page);
}
export async function unfoldEvent(page: Page) {
  await expect(page.getByRole('heading', { name: 'Rounds' })).toBeVisible();
  await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>('details.round, details.fold').forEach((d) => (d.open = true)));
}

/**
 * Make an individual event the active one (after reseed): Day 1 on Seed Links with a 2-ball (Adams v Brown,
 * both off 10) and a 3-ball (Clark 6, Davies 14, Evans 3; in a 2 v 1 Clark plays alone). Returns the ids.
 */
export async function seedIndividual(opts: { pairGame?: string; threeGame?: string } = {}) {
  const db = serviceDb();
  const one = async <T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  };
  const players = (await one(db.from('players').select('id, name'))) as { id: string; name: string }[];
  const id = (name: string) => players.find((p) => p.name === name)!.id;
  const course = (await one(db.from('courses').select('id').eq('name', 'Seed Links').single())) as { id: string };
  await one(db.from('events').update({ is_active: false }).eq('is_active', true));
  const event = (await one(
    db.from('events').insert({ name: 'Saturday Swindle', kind: 'individual', is_active: true }).select('id').single(),
  )) as { id: string };
  const hcp: Record<string, number> = { 'Alex Adams': 10, 'Ben Brown': 10, 'Chris Clark': 6, 'Dan Davies': 14, 'Ed Evans': 3 };
  await one(db.from('event_players').insert(Object.entries(hcp).map(([n, h]) => ({ event_id: event.id, player_id: id(n), team: null, handicap: h }))));
  const round = (await one(
    db
      .from('rounds')
      .insert({
        event_id: event.id, round_no: 1, name: 'Day 1', course_id: course.id, date: new Date().toLocaleDateString('en-CA'),
        ...(opts.pairGame ? { pair_game: opts.pairGame } : {}),
        ...(opts.threeGame ? { three_game: opts.threeGame } : {}),
      })
      .select('id')
      .single(),
  )) as { id: string };
  const group = async (no: number, names: string[]) => {
    const g = (await one(db.from('groups').insert({ round_id: round.id, group_no: no }).select('id').single())) as { id: string };
    await one(db.from('group_players').insert(names.map((n, i) => ({ group_id: g.id, slot: `P${i + 1}`, player_id: id(n) }))));
    return g.id;
  };
  const twoBall = await group(1, ['Alex Adams', 'Ben Brown']);
  const threeBall = await group(2, ['Chris Clark', 'Dan Davies', 'Ed Evans']);
  return { eventId: event.id, roundId: round.id, twoBall, threeBall };
}

/** Set each row's gross on a hole of an individual group (rows by position, e.g. { P1: 4, P2: 5 }) and save. */
export async function enterIndividualHole(page: Page, hole: number, gross: Record<string, number>) {
  await page.getByRole('button', { name: `Hole ${hole}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `Hole ${hole}`, exact: true })).toBeVisible();
  for (const [slot, target] of Object.entries(gross)) {
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
