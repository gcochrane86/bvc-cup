# Ballyliffen Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-day Ballyliffen event at Glashedy Links (dev only), with a Glashedy course guide, and make the Courses tab show only the active event's courses. With BvC active, the tab must look exactly as it does today.

**Architecture:**
- **`src/lib/guides.ts`:** gains a Glashedy guide, a per-guide `kind` and `credit` (so the page no longer hard-codes Dundonald vs Turnberry), and `eventGuides(rounds, courses)`. That function filters and orders the guides by the active event's rounds, and falls back to all guides.
- **`src/routes/Guide.svelte`:** lists `eventGuides(...)` instead of `GUIDES`.
- **Guide images:** the Glashedy pages are rendered from the user's yardage book by extending `scripts/make-guides.ts`.
- **Event data:** the event, courses, day and group are created by an idempotent script, `scripts/add-ballyliffen.ts`, run against dev.

**Tech Stack:** Svelte 5 + TypeScript, Vitest, Playwright (installed Chrome, `channel: 'chrome'`), Supabase JS (service role for the script), pdfjs-dist.

**Spec:** `docs/superpowers/specs/2026-09-29-ballyliffen-event-design.md`

## Global Constraints

- Dev only. Never run anything against `.env.prod` in this plan. Production waits for the user's explicit go-ahead.
- With BvC active (rounds on Dundonald Links, King Robert the Bruce, The Championship Ailsa), Courses lists exactly `Dundonald`, `Robert the Bruce`, `Ailsa`, in that order, with the same pages, notes and flyovers as today.
- Event name is exactly `Ballyliffen`; it is created with `is_active = false`.
- Glashedy courses, all par 72 with the same holes:
  - `Glashedy Links (Black)`: rating 77.4, slope 136.
  - `Glashedy Links (Gold)`: rating 73.6, slope 127.
  - `Glashedy Links (White)`: rating 71.3, slope 123.
- Pars: `4 4 4 5 3 4 3 4 4 4 4 4 5 3 4 4 5 4`. Stroke indexes: `10 2 8 18 16 14 12 6 4 17 7 3 11 15 1 5 9 13`.
- The day is `Day 1`, `round_no 1`, on Gold, better ball only (`singles_enabled false`). Group 1 has no players on prod.
- E2E tests wipe dev (`reseed`). Take `node .superpowers/devdata.mjs backup` after changing dev data and before any e2e run, and run `node .superpowers/devdata.mjs restore` after every e2e run.
- Tools: `export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"`.

## Review Focus

1. **A phone that remembers a course not in the current event** (e.g. "ailsa" while Ballyliffen is active) must open the event's first course, not a hidden one. Tested in Task 3's unit tests via `initialGuide`.
2. **Two rounds on the same guide** (e.g. two days at Glashedy on different tees) must list the guide once. Tested in Task 1.
3. **An active event whose courses have no guide** (e2e seed "Seed Links", or a new event mid-setup) must still show a usable Courses tab. Tested in Task 1 (fallback to all guides).
4. **A Glashedy tee variant** (Black/White) chosen on the day must still show the Glashedy guide and its par and stroke index. Tested in Task 1 (`guideForCourse` for all three) and Task 3 (the `info` lookup uses the event's round course).
5. **Running the setup script twice** must not duplicate the courses or the event. Tested in Task 4 by running it twice and counting rows.

---

### Task 1: Glashedy guide and event-filtered guide list (`guides.ts`)

**Files:**
- Modify: `src/lib/guides.ts`
- Test: `src/lib/guides.test.ts`

**Interfaces:**
- Produces:
  - `Guide` gains `kind: 'aerial' | 'turnberry' | 'yardage'` and `credit: string`.
  - `GUIDES` gains `{ slug: 'glashedy', name: 'Glashedy Links', short: 'Glashedy', match: /glashedy/i, kind: 'yardage', credit: 'From the Glashedy Links yardage book (Gold tees).' }`.
  - `guidePages('glashedy', h)` returns `['guides/glashedy/hole-NN-layout.webp', 'guides/glashedy/hole-NN-green.webp']`.
  - `eventGuides(rounds: { round_no: number; course_id: string }[], courses: { id: string; name: string }[]): Guide[]`.
  - `initialGuide(list: Guide[], remembered: string | null): Guide`.

- [ ] **Step 1: Write the failing tests** (replace the first test and append the new ones in `src/lib/guides.test.ts`)

```ts
  it('has every guide: the three trip courses in playing order, then Glashedy', () => {
    expect(GUIDES.map((g) => g.slug)).toEqual(['dundonald', 'krtb', 'ailsa', 'glashedy']);
  });

  it('matches every Glashedy tee to the Glashedy guide', () => {
    for (const tee of ['Black', 'Gold', 'White']) expect(guideForCourse(`Glashedy Links (${tee})`)?.slug).toBe('glashedy');
  });

  it('gives Glashedy its hole page then its green page', () => {
    expect(guidePages('glashedy', 7)).toEqual(['guides/glashedy/hole-07-layout.webp', 'guides/glashedy/hole-07-green.webp']);
    expect(guideNotes('glashedy', 7)).toBeNull();
    expect(guideFlyover('glashedy', 7)).toBeNull();
  });
```

and a new `describe` block:

```ts
describe('eventGuides', () => {
  const courses = [
    { id: 'd', name: 'Dundonald Links' },
    { id: 'k', name: 'King Robert the Bruce' },
    { id: 'a', name: 'The Championship Ailsa' },
    { id: 'gg', name: 'Glashedy Links (Gold)' },
    { id: 'gw', name: 'Glashedy Links (White)' },
    { id: 's', name: 'Seed Links' },
  ];
  const r = (round_no: number, course_id: string) => ({ round_no, course_id });

  it('lists only the courses the event plays, in day order (BvC: unchanged)', () => {
    expect(eventGuides([r(2, 'k'), r(1, 'd'), r(3, 'a')], courses).map((g) => g.short)).toEqual(['Dundonald', 'Robert the Bruce', 'Ailsa']);
  });

  it('shows just Glashedy for Ballyliffen, whichever tees the day uses', () => {
    expect(eventGuides([r(1, 'gg')], courses).map((g) => g.slug)).toEqual(['glashedy']);
    expect(eventGuides([r(1, 'gw')], courses).map((g) => g.slug)).toEqual(['glashedy']);
  });

  it('lists a guide once when two days use it', () => {
    expect(eventGuides([r(1, 'gg'), r(2, 'gw')], courses).map((g) => g.slug)).toEqual(['glashedy']);
  });

  it('falls back to every guide when the event has none (e.g. mid-setup)', () => {
    expect(eventGuides([r(1, 's')], courses)).toEqual(GUIDES);
    expect(eventGuides([], courses)).toEqual(GUIDES);
  });

  it('opens the remembered course only if the event has it', () => {
    const bvc = eventGuides([r(1, 'd'), r(2, 'k'), r(3, 'a')], courses);
    expect(initialGuide(bvc, 'ailsa').slug).toBe('ailsa');
    expect(initialGuide(eventGuides([r(1, 'gg')], courses), 'ailsa').slug).toBe('glashedy');
    expect(initialGuide(bvc, null).slug).toBe('dundonald');
  });
});
```

Update the import line: `import { GUIDES, eventGuides, guideFlyover, guideForCourse, guideNotes, guidePages, initialGuide, readGuideMemory, rememberGuideHole } from './guides';`

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/guides.test.ts`
Expected: FAIL. `eventGuides`/`initialGuide` are not exported, and GUIDES has 3 entries.

- [ ] **Step 3: Implement in `src/lib/guides.ts`**

```ts
export interface Guide {
  slug: string;
  name: string;
  /** Button label on the Guide tab. */
  short: string;
  /** Matches the course name used in Admin → Courses. */
  match: RegExp;
  /** aerial: one photo + notes; turnberry: layout + approach pages; yardage: hole page + green page. */
  kind: 'aerial' | 'turnberry' | 'yardage';
  /** Where the pages come from (shown under the hole). */
  credit: string;
}

export const GUIDES: Guide[] = [
  { slug: 'dundonald', name: 'Dundonald Links', short: 'Dundonald', match: /dundonald/i, kind: 'aerial', credit: 'From the Dundonald Links hole-by-hole guide.' },
  { slug: 'krtb', name: 'King Robert the Bruce', short: 'Robert the Bruce', match: /robert\s+the\s+bruce/i, kind: 'turnberry', credit: 'From the Trump Turnberry course guide. Yardages are to the front of the green.' },
  { slug: 'ailsa', name: 'The Championship Ailsa', short: 'Ailsa', match: /ailsa/i, kind: 'turnberry', credit: 'From the Trump Turnberry course guide. Yardages are to the front of the green.' },
  { slug: 'glashedy', name: 'Glashedy Links', short: 'Glashedy', match: /glashedy/i, kind: 'yardage', credit: 'From the Glashedy Links yardage book (Gold tees).' },
];

/** The guides for the active event's courses, in day order, each once; every guide if none match. */
export function eventGuides(rounds: { round_no: number; course_id: string }[], courses: { id: string; name: string }[]): Guide[] {
  const out: Guide[] = [];
  for (const r of [...rounds].sort((a, b) => a.round_no - b.round_no)) {
    const course = courses.find((c) => c.id === r.course_id);
    const g = course ? guideForCourse(course.name) : null;
    if (g && !out.includes(g)) out.push(g);
  }
  return out.length ? out : GUIDES;
}

/** The course the Courses tab opens on: the remembered one if this event has it, else the first. */
export function initialGuide(list: Guide[], remembered: string | null): Guide {
  return list.find((g) => g.slug === remembered) ?? list[0];
}
```

In `guidePages`:

```ts
  if (slug === 'dundonald') return [`guides/dundonald/hole-${n}.webp`];
  if (slug === 'glashedy') return [`guides/glashedy/hole-${n}-layout.webp`, `guides/glashedy/hole-${n}-green.webp`];
```

Update the file's header comment: "Glashedy: hole and green pages rendered from the yardage book by scripts/make-guides.ts."

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/guides.test.ts && npm run check`
Expected: all guides tests PASS; svelte-check reports 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/guides.ts src/lib/guides.test.ts
git commit -m "feat: Glashedy guide and a guide list filtered to the active event"
```

---

### Task 2: Render the Glashedy guide pages

**Files:**
- Modify: `scripts/make-guides.ts` (add a `yardage` mode)
- Create: `public/guides/glashedy/hole-01..18-layout.webp`, `hole-01..18-green.webp`
- Source PDF: `.superpowers/glashedy.pdf` (copy of the user's upload; not committed)

**Interfaces:**
- Consumes: `guidePages('glashedy', h)` paths from Task 1.
- Produces: 36 WebP files at those paths.

- [ ] **Step 1: Confirm the page → hole mapping and the crop bands.**
  - Render pages 3, 11 and 20 with `node .superpowers/pdfpeek.mjs .superpowers/glashedy.pdf 3,11,20 700` and read them. Expected: the header badges read 1, 9 and 18; page 21 is not a hole.
  - On each page, note the fraction of height where the blank notes grid starts (about 0.222) and ends (about 0.357).
  - If the bands differ by more than 1% between those pages, use per-hole bands found by rendering every page.

- [ ] **Step 2: Add the yardage mode** to `scripts/make-guides.ts`. Usage becomes `make-guides.ts <pdf> <slug> [turnberry|yardage]`, defaulting to `turnberry`.
  - For `yardage`, hole N uses PDF page `N + 2`. Render it at `WIDTH` and crop two bands on the canvas:
    - **green:** from 0 to `GREEN_END` of the height;
    - **layout:** from `LAYOUT_START` to 1 of the height.
  - Write `hole-NN-green.webp` and `hole-NN-layout.webp`.

```ts
const mode = (process.argv[4] ?? 'turnberry') as 'turnberry' | 'yardage';
// Glashedy yardage book: one tall page per hole — green drawing on top, a blank notes grid, then the
// hole map and tee photo. The notes grid is cropped out.
const GREEN_END = 0.222;
const LAYOUT_START = 0.357;
```

  - Inside `page.evaluate`, for `yardage` render the one page, then draw each band onto its own canvas with `drawImage(src, 0, y0, w, h, 0, 0, w, h)` and return both as `toDataURL('image/webp', 0.8)`.
  - Keep the existing problems check, so a warning is still fatal.

- [ ] **Step 3: Generate**

Run: `node --import tsx scripts/make-guides.ts .superpowers/glashedy.pdf glashedy yardage`
Expected: prints `1 2 … 18` and writes 36 files; `ls public/guides/glashedy | wc -l` → 36.

- [ ] **Step 4: Check the output by eye.** Read `hole-01-layout.webp`, `hole-01-green.webp`, `hole-18-layout.webp` and `hole-18-green.webp`.
  - The green shows the full green drawing and none of the notes grid.
  - The layout starts at the fairway map and ends with the tee photo.
  - Sizes: `du -sh public/guides/glashedy` should be under about 12 MB. If bigger, lower the WebP quality to 0.7.

- [ ] **Step 5: Commit**

```bash
git add scripts/make-guides.ts public/guides/glashedy
git commit -m "feat: Glashedy guide pages from the yardage book"
```

---

### Task 3: Courses tab shows only the active event's courses

**Files:**
- Modify: `src/routes/Guide.svelte`
- Test: `tests/e2e/trip.spec.ts`

**Interfaces:**
- Consumes: `eventGuides`, `initialGuide`, `Guide.kind` and `Guide.credit` from Task 1.

- [ ] **Step 1: Write the failing e2e test** (add after the existing guide test)

```ts
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
```

Add `serviceDb` to the helpers import at the top of `trip.spec.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `node .superpowers/devdata.mjs backup && npx playwright test -g "only the courses this event plays"; node .superpowers/devdata.mjs restore`
Expected: FAIL. The tabs list all four guides.

- [ ] **Step 3: Implement in `src/routes/Guide.svelte`**

  - **Import:** `import { eventGuides, guideFlyover, guideNotes, guidePages, initialGuide, readGuideMemory, rememberGuideHole, type GuideMemory } from '../lib/guides';` and remove the `defaultRoundId, today` import.
  - **Guide list:** replace `initialCourse()` and the `slug`/`guide` state with:

```ts
  // Only the active event's courses (BvC: Dundonald, Robert the Bruce, Ailsa — as before).
  const list = $derived(eventGuides(db.rounds, db.courses));
  let slug = $state(untrack(() => initialGuide(eventGuides(db.rounds, db.courses), mem.course).slug));
  const guide = $derived(list.find((g) => g.slug === slug) ?? list[0]);
```

    `untrack` comes from `svelte`. Use `guide.slug` wherever `slug` fed `hole`, `pages`, `notes` or `flyover`:

```ts
  const hole = $derived(mem.holes[guide.slug] ?? 1);
  const pages = $derived(guidePages(guide.slug, hole));
  const notes = $derived(guideNotes(guide.slug, hole));
  const flyover = $derived(guideFlyover(guide.slug, hole));
```

  - **Par and stroke index:** prefer the course the event's round uses, so a Black/White tee choice still finds its holes:

```ts
  const info = $derived.by(() => {
    const course =
      db.rounds.map((r) => db.courses.find((c) => c.id === r.course_id)).find((c) => c && guide.match.test(c.name)) ??
      db.courses.find((c) => guide.match.test(c.name));
    return course ? db.courseHoles.find((h) => h.course_id === course.id && h.hole === hole) : undefined;
  });
```

  - **Markup:**
    - Tabs: `{#each list as g (g.slug)}` with `aria-selected={g.slug === guide.slug}` and `class:active={g.slug === guide.slug}`.
    - Hole strip and nav: `go(guide.slug, …)`.
    - Images: `class:pdf={guide.kind === 'turnberry'}` and `class:yardage={guide.kind === 'yardage'}`. The alt text comes from the kind:
      - turnberry: `Hole {hole} layout with yardages` / `Hole {hole} approach and description`;
      - yardage: `Hole {hole} map with yardages` / `Hole {hole} green`;
      - aerial: `Hole {hole} aerial view`.
    - Credit line: `<p class="muted small">{guide.credit} Pinch to zoom.</p>`.
  - **CSS:** add `.page.yardage { background: #fff; }`. The existing `.page:not(.pdf)` max-height rule must not squash the tall yardage page, so change it to `.page:not(.pdf):not(.yardage)`.

- [ ] **Step 4: Run the guide tests and the whole suite**

Run: `npm run check && npm test && node .superpowers/devdata.mjs backup && npx playwright test -g "course guide|only the courses"; node .superpowers/devdata.mjs restore`
Expected: check 0 errors. Unit tests all pass. Both e2e tests PASS: the existing "remembers the course and hole" test still passes, because the seed uses "Seed Links", so all guides are listed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/Guide.svelte tests/e2e/trip.spec.ts
git commit -m "feat: Courses tab lists only the active event's courses"
```

---

### Task 4: Ballyliffen setup script, run on dev

**Files:**
- Create: `scripts/add-ballyliffen.ts`
- Modify: `package.json` (script `"add-ballyliffen": "node --import tsx scripts/add-ballyliffen.ts"`)

**Interfaces:**
- Produces, on dev:
  - courses `Glashedy Links (Black|Gold|White)` with 18 holes each;
  - event `Ballyliffen` (inactive);
  - round `Day 1` on Gold;
  - group 1, empty.

- [ ] **Step 1: Write the script.** It is idempotent: it finds by name before inserting. It takes `--env <file>` and refuses to run without it.

```ts
// Adds the Ballyliffen one-day event at Glashedy Links (three tee variants) — safe to run twice.
// Usage: npm run add-ballyliffen -- --env .env.local
import { createClient } from '@supabase/supabase-js';

const envFile = process.argv[process.argv.indexOf('--env') + 1];
if (!process.argv.includes('--env') || !envFile) throw new Error('Pass --env <file>');
process.loadEnvFile(envFile);
const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
async function run<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}

// Official Glashedy scorecard (Oct 2025) and WHS tables (from 16 Sep 2025).
const PARS = [4, 4, 4, 5, 3, 4, 3, 4, 4, 4, 4, 4, 5, 3, 4, 4, 5, 4];
const SI = [10, 2, 8, 18, 16, 14, 12, 6, 4, 17, 7, 3, 11, 15, 1, 5, 9, 13];
const TEES = [
  { name: 'Glashedy Links (Black)', course_rating: 77.4, slope_rating: 136 },
  { name: 'Glashedy Links (Gold)', course_rating: 73.6, slope_rating: 127 },
  { name: 'Glashedy Links (White)', course_rating: 71.3, slope_rating: 123 },
];

const ids: Record<string, string> = {};
for (const t of TEES) {
  const found = await run(db.from('courses').select('id').eq('name', t.name));
  const id = found[0]?.id ?? (await run(db.from('courses').insert(t).select('id').single())).id;
  await run(db.from('courses').update({ course_rating: t.course_rating, slope_rating: t.slope_rating }).eq('id', id));
  await run(db.from('course_holes').upsert(PARS.map((par, i) => ({ course_id: id, hole: i + 1, par, stroke_index: SI[i] }))));
  ids[t.name] = id;
}

const ev = (await run(db.from('events').select('id').eq('name', 'Ballyliffen')))[0] ??
  (await run(db.from('events').insert({ name: 'Ballyliffen', is_active: false }).select('id').single()));
const round = (await run(db.from('rounds').select('id').eq('event_id', ev.id).eq('round_no', 1)))[0] ??
  (await run(db.from('rounds').insert({ event_id: ev.id, round_no: 1, name: 'Day 1', course_id: ids['Glashedy Links (Gold)'], singles_enabled: false }).select('id').single()));
const group = (await run(db.from('groups').select('id').eq('round_id', round.id).eq('group_no', 1)))[0] ??
  (await run(db.from('groups').insert({ round_id: round.id, group_no: 1 }).select('id').single()));
console.log('Ballyliffen ready:', { event: ev.id, round: round.id, group: group.id, courses: ids });
```

Before writing, check the `course_holes` unique `(course_id, stroke_index)` constraint. The upsert above writes all 18 holes in one statement, which is fine for a new course and for a re-run with the same stroke indexes.

- [ ] **Step 2: Run it twice on dev and check it doesn't duplicate anything**

Run: `node .superpowers/devdata.mjs backup && npm run add-ballyliffen -- --env .env.local && npm run add-ballyliffen -- --env .env.local`
Then count via a node one-liner (service role on `.env.local`):
- courses named `Glashedy Links%` → 3;
- `course_holes` for them → 54;
- events named `Ballyliffen` → 1, inactive;
- rounds → 1, on Gold;
- groups → 1.
Also check that BvC is still the active event.

- [ ] **Step 3: Demo players on dev only (for screenshots).**
  - Add 4 existing dev players to Ballyliffen's `event_players`: 2 on team A and 2 on team B, using their `default_handicap`.
  - Add them to group 1's `group_players` as A1, A2, B1 and B2.
  - This is a dev-only one-off in `.superpowers/ballyliffen-demo.mjs` (not committed). Then run `node .superpowers/devdata.mjs backup`, so later e2e restores keep it.

- [ ] **Step 4: Commit**

```bash
git add scripts/add-ballyliffen.ts package.json
git commit -m "feat: script to add the Ballyliffen event at Glashedy Links"
```

---

### Task 5: Screenshots and final verification on dev

**Files:**
- Create: `.superpowers/ballyshots.mjs` (not committed); output PNGs go to the scratchpad.

- [ ] **Step 1: Full test run**

Run: `npm run check && npm test && npx playwright test; node .superpowers/devdata.mjs restore`
Expected: 0 errors; all unit tests pass; all e2e tests pass. Re-run any failure once and report it by name if it fails again.

- [ ] **Step 2: Ballyliffen screenshots.**
  - Make Ballyliffen active on dev. The admin UI does this; the script can set `is_active` false on BvC and true on Ballyliffen through the service role.
  - With Playwright (Pixel 7, `http://localhost:5173`, logged in as admin), capture:
    - the leaderboard;
    - Admin → the Ballyliffen event and its day (course picker showing the three tees);
    - Courses → Glashedy hole 1, top and scrolled;
    - Courses → Glashedy hole 18.

- [ ] **Step 3: Switch BvC back to active on dev and capture Courses.** Check:
  - the tabs are exactly Dundonald, Robert the Bruce and Ailsa;
  - Dundonald hole 1 shows the pro tips, the flyover button and the aerial;
  - Robert the Bruce hole 1 shows the layout and approach pages.

  Compare with production's Courses tab (look-only, same phone size): the tabs and page images must match.

- [ ] **Step 4: Send the screenshots to the user** (SendUserFile). Report the test results. Say that production is untouched and needs a go-ahead, which means:
  - deploy the code (merge to main);
  - `npm run add-ballyliffen -- --env .env.prod`;
  - no demo players on production.
