# Golf Trip Ryder Cup — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, mobile-first, password-gated website for tracking a 12-player Ryder Cup–style golf trip. It has live matchplay scoring, a team tracker, per-match confirmation, player photos and an admin area.

**Architecture:** A static Svelte 5 single-page app on GitHub Pages talks directly to Supabase (Postgres with row-level security, Realtime, Storage).

- All golf logic lives in one pure TypeScript scoring module. Match states are derived from raw gross scores on every device and are never stored. The only stored results are the confirmed-result snapshots.
- Score writes go through an IndexedDB outbox, so entries survive poor signal.

**Tech Stack:** Node 22 LTS, Vite, Svelte 5 (runes), TypeScript (strict), Vitest, PGlite (in-process Postgres for database tests), Playwright, `@supabase/supabase-js`, `idb-keyval`, the Supabase MCP connector (projects, migrations, advisors), GitHub Actions and GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-27-golf-ryder-cup-design.md`

**Scope:** Phase 1 only (spec §1–§7, §9, §10). Phase 2 push notifications (spec §8) get their own plan once this ships.

## Global Constraints

- Running cost: £0. Only the Supabase free tier and GitHub Pages. No paid services.
- Mobile-first: design for 375px width, with a minimum tap target of 44px.
- Access: two shared passwords (trip and admin), implemented as two Supabase Auth users. **Public sign-ups must be disabled** in Supabase.
- Handicaps:
  - Better-ball strokes = `round_half_up((own − lowest_in_group) × allowance_pct / 100)`, with `allowance_pct` defaulting to 90.
  - Singles strokes = `round_half_up((higher − lower) × singles_allowance_pct / 100)`, defaulting to 90.
  - Strokes are allocated by stroke index. Above 18 strokes, a player gets 2 on holes with SI ≤ n − 18.
- Points default: better-ball 1, singles ½. Both are configurable per round.
- A gross score is 1–15, or "picked up".
- Match states are never stored. `match_results` holds only confirmed snapshots, and points for confirmed matches always come from the snapshot.
- Svelte 5 runes syntax only (`$state`, `$derived`, `$effect`, `$props`, `onclick=`). No Svelte 4 stores or `on:click`.
- TypeScript strict mode. With `verbatimModuleSyntax` on, type-only imports must use `import type` or inline `type`.
- Secrets (`SUPABASE_SECRET_KEY`, passwords) live only in `.env.local` / `.env.prod`, both gitignored. Never commit them.

## Review Focus

1. **Holes entered out of order or a hole skipped.** A match's "thru" stops at the first hole where any player in that match has no entry. The hole strip shows the gap, so the scorer can see it and fix it. *Pinned in Task 3 ("stops at the first incomplete hole").*
2. **Confirming a match while its scores are still queued offline.** Confirming first flushes the outbox. It refuses, with a message, if any score for that match's players is still pending, so queued scores are never rejected as locked. *Pinned in Task 7 (`hasPendingFor` tests) and used in Task 10.*
3. **A stale queued write arriving after a newer correction** (for example, a phone comes back online hours later). The server ignores writes with an older `client_updated_at`, and the client never lets an older row replace a newer pending edit. *Pinned in Task 5 ("stale write ignored") and Task 7 (`applyPending`).*
4. **The admin changes handicaps or the allowance after a match is confirmed.** Unconfirmed matches recalculate, but confirmed points never change. *Pinned in Task 8 ("confirmed result wins over current scores").*
5. **Incomplete setup**: a group with fewer than 4 players, a round with no pairings, or a course with no holes. Pages render without crashing, and total points still count every group. *Pinned in Task 3 ("no holes") and Task 8 ("incomplete group").*

---

## File Structure

```
package.json, vite.config.ts, svelte.config.js, tsconfig.json, index.html, playwright.config.ts
.gitignore, .env.example, README.md
.github/workflows/deploy.yml
public/  manifest.webmanifest, icon.svg, icon-180.png, icon-192.png, icon-512.png, sw.js
scripts/ create-users.ts, seed.ts, make-icons.ts
supabase/migrations/
  20260927000001_schema.sql
  20260927000002_security.sql
  20260927000003_functions.sql
  20260927000004_supabase_storage_realtime.sql   # Supabase-only; skipped by PGlite tests
src/
  main.ts, app.css, App.svelte, vite-env.d.ts
  lib/
    scoring/        # pure, no I/O — the heart of the app
      types.ts  strokes.ts  matches.ts  matchState.ts  tracker.ts
      locks.ts  pairings.ts  courses.ts  format.ts  index.ts   (+ *.test.ts)
    data/
      types.ts          # DB row types
      outbox.ts         # IndexedDB-agnostic offline queue (+ test)
      merge.ts          # pure score-row merge helpers (+ test)
      store.svelte.ts   # reactive snapshot, loading, realtime, outbox wiring
    view.ts             # snapshot -> EventView (+ test)
    route.ts            # hash -> Route (+ test)
    router.svelte.ts    # reactive current route
    supabase.ts         # client + must()
    auth.svelte.ts      # session state, login/logout
    photos.ts           # resize + upload
  components/ Nav, Avatar, TeamTracker, MatchCard, HoleGrid, Scorecard, PhotoUpload (.svelte)
  routes/ Login, Leaderboard, Match, ScoreEntry, Players (.svelte)
  routes/admin/ AdminHome, AdminPlayers, AdminCourses, AdminCourse, AdminEvents, AdminEvent, AdminPairings (.svelte)
tests/
  db/ harness.ts, db.test.ts
  e2e/ helpers.ts, trip.spec.ts
```

---

### Task 0: Toolchain and accounts

**Files:** none (environment only). Creates `.env.local` in Task 1.

This machine has no Node, Homebrew or Docker. We install Node without sudo, and deliberately avoid Docker: database tests use PGlite, and development runs against a hosted Supabase "dev" project, managed through the Supabase MCP connector.

- [ ] **Step 1: Install Node 22 LTS into `~/.local/node`**

```bash
ARCH=$(uname -m | sed 's/x86_64/x64/')
VER=$(curl -fsSL https://nodejs.org/dist/index.json | python3 -c "import json,sys; print(next(r['version'] for r in json.load(sys.stdin) if r['lts'] and r['version'].startswith('v22')))")
mkdir -p ~/.local/node
curl -fsSL "https://nodejs.org/dist/$VER/node-$VER-darwin-$ARCH.tar.gz" | tar -xz -C ~/.local/node --strip-components=1
grep -q '.local/node/bin' ~/.zshrc || echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> ~/.zshrc
export PATH="$HOME/.local/node/bin:$PATH"
node -v && npm -v
```

Expected: `v22.x.x` and an npm version. **Every later shell command in this plan assumes `export PATH="$HOME/.local/node/bin:$PATH"` has been run in that shell.**

- [ ] **Step 2: Create the Supabase projects via the Supabase MCP connector**

The user's Supabase account is connected through the Supabase MCP server (organization `gcochrane86`, id `tobysrmzxgxxxthpkuxl`, no projects yet).
1. Call `get_cost` / `confirm_cost` as `create_project` requires (both projects are on the free plan, so the cost should be $0). **Show the user the cost confirmation and get their OK before creating anything.**
2. Call `create_project` twice: `golf-dev` (development and automated tests) and `golf-prod` (the trip). Use the region nearest the user (for the UK, `eu-west-2`).
3. For `golf-dev`, call `get_project_url` and `get_publishable_keys`, and record the URL, the publishable key and the project ref for `.env.local` (Task 1).

- [ ] **Step 3: USER ACTION — dashboard-only settings and the secret key**

These can't be done through MCP. Ask the user to do the following in **each** project:
1. Authentication → Sign In / Providers → turn **off** "Allow new users to sign up". Leave Email enabled. *Without this, anyone holding the public key could create their own login.*
2. From `golf-dev` only for now: Project Settings → API Keys → copy the **secret** key (`sb_secret_…`). It's needed by the user-creation and seed scripts, and must never go into frontend code or git.
3. Choose a dev trip password and a dev admin password (at least 6 characters). The production passwords are chosen in Task 17.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `svelte.config.js`, `tsconfig.json`, `index.html`, `src/main.ts`, `src/vite-env.d.ts`, `src/App.svelte`, `src/app.css`, `.gitignore`, `.env.example`, `.env.local`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `check`, `test`, `e2e`, `users`, `seed`, `icons`. CSS tokens `--bg --surface --text --muted --line --accent --shot --shot-strong --shot-text --danger --team-a --team-b --radius`, and the global classes `.card .muted .center .error .field .row .small`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "golf-ryder-cup",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "users": "node --env-file=.env.local --import tsx scripts/create-users.ts",
    "seed": "node --env-file=.env.local --import tsx scripts/seed.ts",
    "icons": "node --import tsx scripts/make-icons.ts"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/garethcochrane/golfwebsite
npm i --save-exact @supabase/supabase-js idb-keyval
npm i -D --save-exact vite svelte @sveltejs/vite-plugin-svelte typescript svelte-check @tsconfig/svelte vitest @electric-sql/pglite @playwright/test tsx @types/node
```

Expected: installs without errors. Versions are pinned exactly and `package-lock.json` is committed (Supabase supply-chain guidance). If npm reports an `ERESOLVE` peer conflict between `vite` and `@sveltejs/vite-plugin-svelte`, install the `vite` major version that the plugin's `peerDependencies` asks for (`npm view @sveltejs/vite-plugin-svelte peerDependencies`).

- [ ] **Step 3: Write the config files**

`vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  test: {
    include: ['src/**/*.test.ts', 'tests/db/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

`svelte.config.js`:
```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default { preprocess: vitePreprocess() };
```

`tsconfig.json`:
```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "tests/**/*.ts", "scripts/**/*.ts", "vite.config.ts", "playwright.config.ts"]
}
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0b3d2e" />
    <title>Golf Trip Cup</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/vite-env.d.ts`:
```ts
/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_KEY: string;
  readonly VITE_TRIP_EMAIL?: string;
  readonly VITE_ADMIN_EMAIL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`src/main.ts`:
```ts
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
```

`src/App.svelte` (placeholder, replaced in Task 6):
```svelte
<main><h1>Golf Trip Cup</h1></main>
```

`src/app.css`:
```css
:root {
  --bg: #f4f6f3;
  --surface: #ffffff;
  --text: #14201a;
  --muted: #5d6b63;
  --line: #dfe5e0;
  --accent: #0b3d2e;
  --shot: #d8f5d0;
  --shot-strong: #9fe38e;
  --shot-text: #155d27;
  --danger: #b3261e;
  --team-a: #1f4e9c;
  --team-b: #c8102e;
  --radius: 14px;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--text);
  background: var(--bg);
  -webkit-text-size-adjust: 100%;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); min-height: 100dvh; }
main { max-width: 560px; margin: 0 auto; padding: 16px 16px 96px; }
h1, h2, h3 { margin: 0 0 12px; line-height: 1.15; }
a { color: var(--accent); }
button, input, select { font: inherit; }
button {
  cursor: pointer; border: 0; border-radius: 10px; padding: 12px 16px; min-height: 44px;
  background: var(--accent); color: #fff; font-weight: 600;
}
button.secondary { background: var(--surface); color: var(--text); border: 1px solid var(--line); }
button:disabled { opacity: 0.45; cursor: default; }
input, select {
  width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--line);
  border-radius: 10px; background: var(--surface); color: var(--text);
}
input[type='checkbox'] { width: auto; min-height: 0; }
.card {
  display: block; background: var(--surface); border-radius: var(--radius); padding: 14px;
  margin-bottom: 12px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.06); color: inherit; text-decoration: none;
}
.muted { color: var(--muted); }
.small { font-size: 0.85rem; }
.center { text-align: center; padding: 48px 16px; }
.error { color: var(--danger); }
.field { margin-bottom: 12px; }
.field label, label.lbl { display: block; font-size: 0.9rem; color: var(--muted); margin-bottom: 4px; }
.row { display: flex; gap: 8px; align-items: center; }
.notice {
  display: block; width: 100%; border-radius: 0; background: #fff4e5; color: #6b3d00;
  font-weight: 500; text-align: left; margin: 0; padding: 12px 16px;
}
```

`.gitignore`:
```
node_modules
dist
.env.local
.env.prod
test-results
playwright-report
supabase/.temp
supabase/.branches
.DS_Store
```

`.env.example`:
```
# Copy to .env.local (dev project) and .env.prod (prod project). Never commit the copies.
VITE_SUPABASE_URL=https://YOURREF.supabase.co
VITE_SUPABASE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=sb_secret_xxx
TRIP_PASSWORD=change-me
ADMIN_PASSWORD=change-me-too
```

- [ ] **Step 4: Create `.env.local`** by copying `.env.example` and filling in the `golf-dev` values and passwords from Task 0.

- [ ] **Step 5: Verify that the scaffold builds**

Run: `npm run build && npm run check && npm test`
Expected: the build writes `dist/`; svelte-check reports `0 errors`; vitest reports "No test files found" and exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + Svelte 5 + TypeScript project"
```

---

### Task 2: Scoring — strokes and match definitions

**Files:**
- Create: `src/lib/scoring/types.ts`, `src/lib/scoring/strokes.ts`, `src/lib/scoring/matches.ts`, `src/lib/scoring/index.ts`
- Test: `src/lib/scoring/strokes.test.ts`, `src/lib/scoring/matches.test.ts`

**Interfaces:**
- Produces (all exported from `src/lib/scoring/index.ts`):
  - types `Team`, `Slot`, `MatchType`, `Outcome`, `HoleInfo`, `RoundSettings`, `SlotPlayer`, `ScoreEntry`, `MatchDef`, `MatchState`, `ConfirmedResult`
  - `roundHalfUp(x: number): number`
  - `playingStrokes(diff: number, pct: number): number`
  - `strokesOnHole(total: number, strokeIndex: number): number`
  - `buildMatches(groupId: string, players: SlotPlayer[], s: RoundSettings): MatchDef[]` (empty unless all 4 slots are filled; order is better_ball, low_singles, high_singles)

- [ ] **Step 1: Write `types.ts`**

```ts
export type Team = 'A' | 'B';
export type Slot = 'A1' | 'A2' | 'B1' | 'B2';
export type MatchType = 'better_ball' | 'low_singles' | 'high_singles';
export type Outcome = Team | 'halved';

export interface HoleInfo {
  hole: number;
  par: number;
  strokeIndex: number;
}

export interface RoundSettings {
  allowancePct: number;
  betterBallPoints: number;
  singlesEnabled: boolean;
  singlesPoints: number;
  singlesAllowancePct: number;
}

export interface SlotPlayer {
  slot: Slot;
  playerId: string;
  handicap: number;
}

/** One player's entry on one hole. gross is null when picked up. */
export interface ScoreEntry {
  playerId: string;
  hole: number;
  gross: number | null;
  pickedUp: boolean;
}

export interface MatchDef {
  id: string; // `${groupId}:${type}`
  groupId: string;
  type: MatchType;
  sideA: string[];
  sideB: string[];
  points: number;
  /** Total strokes received in this match, per player id. */
  strokes: Record<string, number>;
}

export interface MatchState {
  started: boolean;
  thru: number;
  /** Positive = team A up, negative = team B up. */
  lead: number;
  /** Index 0 = hole 1. null = not yet counted. */
  holeWinners: (Outcome | null)[];
  /** Running lead after each hole. Index 0 = hole 1. */
  running: (number | null)[];
  decided: boolean;
  dormie: boolean;
  winner: Outcome | null;
  finalHole: number | null;
  /** '4&3', '2 UP', 'Halved' — only when decided. */
  resultText: string | null;
  /** 'Not started', 'All Square', '2 UP', or resultText. */
  statusText: string;
  projectedA: number;
  projectedB: number;
}

export interface ConfirmedResult {
  groupId: string;
  matchType: MatchType;
  winner: Outcome;
  pointsA: number;
  pointsB: number;
  resultText: string;
  finalHole: number;
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/scoring/strokes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { roundHalfUp, playingStrokes, strokesOnHole } from './strokes';

describe('roundHalfUp', () => {
  it('rounds .5 up', () => {
    expect(roundHalfUp(4.5)).toBe(5);
    expect(roundHalfUp(13.5)).toBe(14);
  });
  it('rounds below .5 down', () => {
    expect(roundHalfUp(4.4)).toBe(4);
    expect(roundHalfUp(0)).toBe(0);
  });
});

describe('playingStrokes', () => {
  it('applies a 90% allowance to the difference', () => {
    expect(playingStrokes(10, 90)).toBe(9);
    expect(playingStrokes(5, 90)).toBe(5); // 4.5 -> 5
    expect(playingStrokes(4, 90)).toBe(4); // 3.6 -> 4
    expect(playingStrokes(1, 90)).toBe(1); // 0.9 -> 1
    expect(playingStrokes(0, 90)).toBe(0);
  });
  it('handles decimal handicap differences', () => {
    expect(playingStrokes(12.4 - 3.1, 90)).toBe(8); // 8.37 -> 8
  });
  it('uses 100% when asked', () => {
    expect(playingStrokes(7, 100)).toBe(7);
  });
});

describe('strokesOnHole', () => {
  it('gives nothing when the total is 0', () => {
    expect(strokesOnHole(0, 1)).toBe(0);
  });
  it('gives one stroke on holes with SI <= total', () => {
    expect(strokesOnHole(5, 5)).toBe(1);
    expect(strokesOnHole(5, 6)).toBe(0);
  });
  it('gives one on every hole at 18', () => {
    expect(strokesOnHole(18, 1)).toBe(1);
    expect(strokesOnHole(18, 18)).toBe(1);
  });
  it('gives two on the hardest holes above 18', () => {
    expect(strokesOnHole(20, 1)).toBe(2);
    expect(strokesOnHole(20, 2)).toBe(2);
    expect(strokesOnHole(20, 3)).toBe(1);
  });
});
```

`src/lib/scoring/matches.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildMatches } from './matches';
import type { RoundSettings, SlotPlayer } from './types';

const settings: RoundSettings = {
  allowancePct: 90,
  betterBallPoints: 1,
  singlesEnabled: false,
  singlesPoints: 0.5,
  singlesAllowancePct: 90,
};
const players: SlotPlayer[] = [
  { slot: 'A1', playerId: 'a1', handicap: 4 },
  { slot: 'A2', playerId: 'a2', handicap: 18 },
  { slot: 'B1', playerId: 'b1', handicap: 9 },
  { slot: 'B2', playerId: 'b2', handicap: 14 },
];

describe('buildMatches', () => {
  it('builds one better-ball match with strokes off the lowest handicap', () => {
    const ms = buildMatches('g1', players, settings);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({
      id: 'g1:better_ball',
      groupId: 'g1',
      type: 'better_ball',
      sideA: ['a1', 'a2'],
      sideB: ['b1', 'b2'],
      points: 1,
    });
    // 14*.9=12.6->13, 5*.9=4.5->5, 10*.9=9
    expect(ms[0].strokes).toEqual({ a1: 0, a2: 13, b1: 5, b2: 9 });
  });

  it('adds low and high singles when enabled', () => {
    const ms = buildMatches('g1', players, { ...settings, singlesEnabled: true });
    expect(ms.map((m) => m.type)).toEqual(['better_ball', 'low_singles', 'high_singles']);
    expect(ms[1]).toMatchObject({ id: 'g1:low_singles', sideA: ['a1'], sideB: ['b1'], points: 0.5 });
    expect(ms[1].strokes).toEqual({ a1: 0, b1: 5 }); // 5*.9=4.5->5
    expect(ms[2]).toMatchObject({ id: 'g1:high_singles', sideA: ['a2'], sideB: ['b2'], points: 0.5 });
    expect(ms[2].strokes).toEqual({ a2: 4, b2: 0 }); // 4*.9=3.6->4
  });

  it('uses the singles allowance for singles only', () => {
    const ms = buildMatches('g1', players, { ...settings, singlesEnabled: true, singlesAllowancePct: 100 });
    expect(ms[0].strokes).toEqual({ a1: 0, a2: 13, b1: 5, b2: 9 });
    expect(ms[1].strokes).toEqual({ a1: 0, b1: 5 });
    expect(ms[2].strokes).toEqual({ a2: 4, b2: 0 });
  });

  it('returns no matches for an incomplete group', () => {
    expect(buildMatches('g1', players.slice(0, 3), settings)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run src/lib/scoring`
Expected: FAIL, "Failed to resolve import './strokes'".

- [ ] **Step 4: Implement**

`src/lib/scoring/strokes.ts`:
```ts
/** Round to the nearest whole number, halves up. Epsilon absorbs float noise (e.g. 4.4999999). */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

/** Strokes received for a handicap difference at an allowance percentage. */
export function playingStrokes(diff: number, pct: number): number {
  return roundHalfUp((diff * pct) / 100);
}

/** Strokes received on a hole of the given stroke index, from a total allocation. */
export function strokesOnHole(total: number, strokeIndex: number): number {
  if (total <= 0) return 0;
  const base = Math.floor(total / 18);
  return base + (strokeIndex <= total % 18 ? 1 : 0);
}
```

`src/lib/scoring/matches.ts`:
```ts
import { playingStrokes } from './strokes';
import type { MatchDef, MatchType, RoundSettings, SlotPlayer } from './types';

export function buildMatches(groupId: string, players: SlotPlayer[], s: RoundSettings): MatchDef[] {
  const by = new Map(players.map((p) => [p.slot, p]));
  const a1 = by.get('A1');
  const a2 = by.get('A2');
  const b1 = by.get('B1');
  const b2 = by.get('B2');
  if (!a1 || !a2 || !b1 || !b2) return [];

  const four = [a1, a2, b1, b2];
  const lowest = Math.min(...four.map((p) => p.handicap));
  const matches: MatchDef[] = [
    {
      id: `${groupId}:better_ball`,
      groupId,
      type: 'better_ball',
      sideA: [a1.playerId, a2.playerId],
      sideB: [b1.playerId, b2.playerId],
      points: s.betterBallPoints,
      strokes: Object.fromEntries(
        four.map((p) => [p.playerId, playingStrokes(p.handicap - lowest, s.allowancePct)]),
      ),
    },
  ];
  if (s.singlesEnabled) {
    matches.push(singles(groupId, 'low_singles', a1, b1, s), singles(groupId, 'high_singles', a2, b2, s));
  }
  return matches;
}

function singles(groupId: string, type: MatchType, a: SlotPlayer, b: SlotPlayer, s: RoundSettings): MatchDef {
  const lowest = Math.min(a.handicap, b.handicap);
  return {
    id: `${groupId}:${type}`,
    groupId,
    type,
    sideA: [a.playerId],
    sideB: [b.playerId],
    points: s.singlesPoints,
    strokes: {
      [a.playerId]: playingStrokes(a.handicap - lowest, s.singlesAllowancePct),
      [b.playerId]: playingStrokes(b.handicap - lowest, s.singlesAllowancePct),
    },
  };
}
```

`src/lib/scoring/index.ts`:
```ts
export * from './types';
export * from './strokes';
export * from './matches';
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run src/lib/scoring`
Expected: PASS (all 12 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/scoring
git commit -m "feat(scoring): stroke allocation and match definitions"
```

---

### Task 3: Scoring — hole results and match state

**Files:**
- Create: `src/lib/scoring/matchState.ts`
- Modify: `src/lib/scoring/index.ts` (add export)
- Test: `src/lib/scoring/matchState.test.ts`

**Interfaces:**
- Consumes: `MatchDef`, `HoleInfo`, `ScoreEntry`, `MatchState`, `Outcome`, `strokesOnHole` from Task 2.
- Produces:
  - `type ScoreIndex = Map<string, ScoreEntry>`
  - `scoreKey(playerId: string, hole: number): string` (returns `${playerId}:${hole}`)
  - `indexScores(scores: ScoreEntry[]): ScoreIndex`
  - `holeOutcome(match: MatchDef, hole: HoleInfo, idx: ScoreIndex): Outcome | null`
  - `computeMatchState(match: MatchDef, holes: HoleInfo[], idx: ScoreIndex): MatchState`

Rules (spec §3.3):
- A hole counts only once every player in the match has an entry.
- Holes are processed in order, stopping at the first incomplete hole, so "thru" is contiguous.
- Processing stops at the hole where the match is decided.

- [ ] **Step 1: Write the failing tests**

`src/lib/scoring/matchState.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeMatchState, holeOutcome, indexScores } from './matchState';
import type { HoleInfo, MatchDef } from './types';

const holes: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));
const bb: MatchDef = {
  id: 'g:better_ball',
  groupId: 'g',
  type: 'better_ball',
  sideA: ['a1', 'a2'],
  sideB: ['b1', 'b2'],
  points: 1,
  strokes: { a1: 0, a2: 0, b1: 0, b2: 0 },
};

type Cell = [player: string, hole: number, gross: number | 'P'];
const idx = (cells: Cell[]) =>
  indexScores(cells.map(([playerId, hole, g]) => ({ playerId, hole, gross: g === 'P' ? null : g, pickedUp: g === 'P' })));

/** A result per hole: 'A' = A players 4 / B players 5, 'B' = the reverse, 'H' = all 4. */
function play(results: string): Cell[] {
  const cells: Cell[] = [];
  [...results].forEach((r, i) => {
    const hole = i + 1;
    const [a, b] = r === 'A' ? [4, 5] : r === 'B' ? [5, 4] : [4, 4];
    cells.push(['a1', hole, a], ['a2', hole, a], ['b1', hole, b], ['b2', hole, b]);
  });
  return cells;
}

describe('holeOutcome', () => {
  const h1 = holes[0];
  it('compares the best net score per side', () => {
    expect(holeOutcome(bb, h1, idx([['a1', 1, 4], ['a2', 1, 6], ['b1', 1, 5], ['b2', 1, 5]]))).toBe('A');
  });
  it('applies strokes on the hole', () => {
    const m = { ...bb, strokes: { ...bb.strokes, b1: 1 } }; // SI 1 -> b1 gets 1
    expect(holeOutcome(m, h1, idx([['a1', 1, 4], ['a2', 1, 6], ['b1', 1, 5], ['b2', 1, 6]]))).toBe('halved');
  });
  it('ignores a picked-up player and uses the partner', () => {
    expect(holeOutcome(bb, h1, idx([['a1', 1, 'P'], ['a2', 1, 6], ['b1', 1, 5], ['b2', 1, 7]]))).toBe('B');
  });
  it('gives the hole to the other side when one side has no score', () => {
    expect(holeOutcome(bb, h1, idx([['a1', 1, 'P'], ['a2', 1, 'P'], ['b1', 1, 9], ['b2', 1, 'P']]))).toBe('B');
  });
  it('halves the hole when nobody has a score', () => {
    expect(holeOutcome(bb, h1, idx([['a1', 1, 'P'], ['a2', 1, 'P'], ['b1', 1, 'P'], ['b2', 1, 'P']]))).toBe('halved');
  });
  it('returns null until every player has an entry', () => {
    expect(holeOutcome(bb, h1, idx([['a1', 1, 4], ['a2', 1, 4], ['b1', 1, 5]]))).toBeNull();
  });
});

describe('computeMatchState', () => {
  it('reports not started', () => {
    const s = computeMatchState(bb, holes, idx([]));
    expect(s).toMatchObject({ started: false, thru: 0, lead: 0, statusText: 'Not started', projectedA: 0, projectedB: 0, decided: false });
  });

  it('tracks the lead and projects the points to the leader', () => {
    const s = computeMatchState(bb, holes, idx(play('AHA')));
    expect(s).toMatchObject({ started: true, thru: 3, lead: 2, statusText: '2 UP', projectedA: 1, projectedB: 0 });
    expect(s.holeWinners.slice(0, 4)).toEqual(['A', 'halved', 'A', null]);
    expect(s.running.slice(0, 4)).toEqual([1, 1, 2, null]);
  });

  it('shows a B lead as a negative lead', () => {
    const s = computeMatchState(bb, holes, idx(play('B')));
    expect(s).toMatchObject({ lead: -1, statusText: '1 UP', projectedA: 0, projectedB: 1 });
  });

  it('projects half each when all square', () => {
    const s = computeMatchState(bb, holes, idx(play('AB')));
    expect(s).toMatchObject({ statusText: 'All Square', projectedA: 0.5, projectedB: 0.5 });
  });

  it('stops at the first incomplete hole', () => {
    const cells = play('AA').concat(play('AAAA').filter(([, h]) => h === 4));
    const s = computeMatchState(bb, holes, idx(cells));
    expect(s.thru).toBe(2);
    expect(s.holeWinners[3]).toBeNull();
  });

  it('flags dormie', () => {
    const s = computeMatchState(bb, holes, idx(play('AAAA' + 'H'.repeat(10)))); // thru 14, 4 up, 4 to play
    expect(s).toMatchObject({ thru: 14, lead: 4, dormie: true, decided: false, statusText: '4 UP' });
  });

  it('decides early and ignores later holes', () => {
    const s = computeMatchState(bb, holes, idx(play('AAAA' + 'H'.repeat(11) + 'B'))); // decided at 15
    expect(s).toMatchObject({ decided: true, finalHole: 15, thru: 15, winner: 'A', resultText: '4&3', statusText: '4&3' });
    expect(s.holeWinners[15]).toBeNull();
  });

  it('decides after 18 with a 1 UP win', () => {
    const s = computeMatchState(bb, holes, idx(play('A' + 'H'.repeat(17))));
    expect(s).toMatchObject({ decided: true, finalHole: 18, winner: 'A', resultText: '1 UP', projectedA: 1 });
  });

  it('halves after 18', () => {
    const s = computeMatchState(bb, holes, idx(play('AB' + 'H'.repeat(16))));
    expect(s).toMatchObject({ decided: true, winner: 'halved', resultText: 'Halved', projectedA: 0.5, projectedB: 0.5 });
  });

  it('handles a course with no holes', () => {
    expect(computeMatchState(bb, [], idx(play('A')))).toMatchObject({ started: false, thru: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/lib/scoring/matchState.test.ts`
Expected: FAIL, "Failed to resolve import './matchState'".

- [ ] **Step 3: Implement `src/lib/scoring/matchState.ts`**

```ts
import { strokesOnHole } from './strokes';
import type { HoleInfo, MatchDef, MatchState, Outcome, ScoreEntry } from './types';

export type ScoreIndex = Map<string, ScoreEntry>;

export const scoreKey = (playerId: string, hole: number) => `${playerId}:${hole}`;

export function indexScores(scores: ScoreEntry[]): ScoreIndex {
  return new Map(scores.map((s) => [scoreKey(s.playerId, s.hole), s]));
}

function sideBest(ids: string[], hole: HoleInfo, match: MatchDef, idx: ScoreIndex): number | null {
  let best: number | null = null;
  for (const id of ids) {
    const e = idx.get(scoreKey(id, hole.hole));
    if (!e || e.pickedUp || e.gross === null) continue;
    const net = e.gross - strokesOnHole(match.strokes[id] ?? 0, hole.strokeIndex);
    if (best === null || net < best) best = net;
  }
  return best;
}

export function holeOutcome(match: MatchDef, hole: HoleInfo, idx: ScoreIndex): Outcome | null {
  const everyone = [...match.sideA, ...match.sideB];
  if (!everyone.every((id) => idx.has(scoreKey(id, hole.hole)))) return null;
  const a = sideBest(match.sideA, hole, match, idx);
  const b = sideBest(match.sideB, hole, match, idx);
  if (a === null && b === null) return 'halved';
  if (a === null) return 'B';
  if (b === null) return 'A';
  return a < b ? 'A' : b < a ? 'B' : 'halved';
}

export function computeMatchState(match: MatchDef, holes: HoleInfo[], idx: ScoreIndex): MatchState {
  const sorted = [...holes].sort((x, y) => x.hole - y.hole);
  const holeWinners: (Outcome | null)[] = Array(18).fill(null);
  const running: (number | null)[] = Array(18).fill(null);
  let lead = 0;
  let thru = 0;
  let decided = false;
  let finalHole: number | null = null;

  for (const h of sorted) {
    const o = holeOutcome(match, h, idx);
    if (o === null) break;
    if (o === 'A') lead++;
    else if (o === 'B') lead--;
    holeWinners[h.hole - 1] = o;
    running[h.hole - 1] = lead;
    thru = h.hole;
    const remaining = 18 - h.hole;
    if (Math.abs(lead) > remaining || remaining === 0) {
      decided = true;
      finalHole = h.hole;
      break;
    }
  }

  const remaining = 18 - thru;
  const started = thru > 0;
  const winner: Outcome | null = decided ? (lead > 0 ? 'A' : lead < 0 ? 'B' : 'halved') : null;
  let resultText: string | null = null;
  if (decided) {
    resultText = lead === 0 ? 'Halved' : remaining === 0 ? `${Math.abs(lead)} UP` : `${Math.abs(lead)}&${remaining}`;
  }
  const statusText =
    resultText ?? (!started ? 'Not started' : lead === 0 ? 'All Square' : `${Math.abs(lead)} UP`);
  const dormie = !decided && started && lead !== 0 && Math.abs(lead) === remaining;
  const [projectedA, projectedB] = !started
    ? [0, 0]
    : lead > 0
      ? [match.points, 0]
      : lead < 0
        ? [0, match.points]
        : [match.points / 2, match.points / 2];

  return { started, thru, lead, holeWinners, running, decided, dormie, winner, finalHole, resultText, statusText, projectedA, projectedB };
}
```

Add `export * from './matchState';` to `src/lib/scoring/index.ts`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run src/lib/scoring`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring
git commit -m "feat(scoring): hole outcomes and matchplay state"
```

---

### Task 4: Scoring — tracker, locks, pairings, course validation, formatting

**Files:**
- Create: `src/lib/scoring/tracker.ts`, `locks.ts`, `pairings.ts`, `courses.ts`, `format.ts`
- Modify: `src/lib/scoring/index.ts`
- Test: `src/lib/scoring/tracker.test.ts`, `locks.test.ts`, `pairings.test.ts`, `courses.test.ts`, `format.test.ts`

**Interfaces:**
- Produces:
  - `interface Tracker { confirmedA: number; confirmedB: number; projectedA: number; projectedB: number; total: number; toWin: number }`
  - `interface TrackedMatch { state: MatchState; result: ConfirmedResult | null }`
  - `computeTracker(matches: TrackedMatch[], total: number): Tracker`
  - `roundPointsAvailable(s: RoundSettings, groupCount: number): number`
  - `resultFromState(def: MatchDef, state: MatchState): ConfirmedResult | null`
  - `isScoreLocked(playerId: string, hole: number, matches: { def: MatchDef; result: ConfirmedResult | null }[]): boolean`
  - `orderSlots(team: Team, players: { playerId: string; handicap: number }[]): SlotPlayer[]`
  - `interface PairingDraft { a: (string | null)[]; b: (string | null)[] }`
  - `pairingErrors(groups: PairingDraft[]): string[]`
  - `validateHoles(holes: HoleInfo[]): string[]`
  - `formatPoints(n: number): string` (`6.5` → `'6½'`, `0.25` → `'¼'`, `0` → `'0'`)
  - `shotLabel(bb: number, singles: number | null): string | null`

- [ ] **Step 1: Write the failing tests**

`src/lib/scoring/tracker.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeTracker, resultFromState, roundPointsAvailable } from './tracker';
import type { ConfirmedResult, MatchDef, MatchState } from './types';

const state = (over: Partial<MatchState>): MatchState => ({
  started: false, thru: 0, lead: 0, holeWinners: [], running: [], decided: false, dormie: false,
  winner: null, finalHole: null, resultText: null, statusText: 'Not started', projectedA: 0, projectedB: 0, ...over,
});
const def: MatchDef = { id: 'g:better_ball', groupId: 'g', type: 'better_ball', sideA: ['a1', 'a2'], sideB: ['b1', 'b2'], points: 1, strokes: {} };
const confirmed = (over: Partial<ConfirmedResult>): ConfirmedResult => ({
  groupId: 'g', matchType: 'better_ball', winner: 'A', pointsA: 1, pointsB: 0, resultText: '2&1', finalHole: 17, ...over,
});

describe('computeTracker', () => {
  it('adds live projections on top of confirmed points', () => {
    const t = computeTracker(
      [
        { state: state({ projectedA: 1 }), result: confirmed({}) }, // confirmed A 1 (projection ignored)
        { state: state({ projectedA: 0.5, projectedB: 0.5 }), result: null },
        { state: state({ projectedB: 1 }), result: null },
        { state: state({}), result: null }, // not started
      ],
      12,
    );
    expect(t).toEqual({ confirmedA: 1, confirmedB: 0, projectedA: 1.5, projectedB: 1.5, total: 12, toWin: 6.5 });
  });
});

describe('roundPointsAvailable', () => {
  it('counts better-ball only', () => {
    expect(roundPointsAvailable({ allowancePct: 90, betterBallPoints: 1, singlesEnabled: false, singlesPoints: 0.5, singlesAllowancePct: 90 }, 3)).toBe(3);
  });
  it('adds two singles per group when enabled', () => {
    expect(roundPointsAvailable({ allowancePct: 90, betterBallPoints: 1, singlesEnabled: true, singlesPoints: 0.5, singlesAllowancePct: 90 }, 3)).toBe(6);
  });
});

describe('resultFromState', () => {
  it('is null until decided', () => {
    expect(resultFromState(def, state({ started: true, thru: 5, lead: 2 }))).toBeNull();
  });
  it('gives the points to the winner', () => {
    const r = resultFromState(def, state({ decided: true, winner: 'B', finalHole: 16, resultText: '3&2' }));
    expect(r).toEqual({ groupId: 'g', matchType: 'better_ball', winner: 'B', pointsA: 0, pointsB: 1, resultText: '3&2', finalHole: 16 });
  });
  it('splits a halved half-point singles into quarters', () => {
    const r = resultFromState({ ...def, type: 'low_singles', points: 0.5 }, state({ decided: true, winner: 'halved', finalHole: 18, resultText: 'Halved' }));
    expect(r).toMatchObject({ pointsA: 0.25, pointsB: 0.25 });
  });
});
```

`src/lib/scoring/locks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isScoreLocked } from './locks';
import type { ConfirmedResult, MatchDef } from './types';

const bb: MatchDef = { id: 'g:better_ball', groupId: 'g', type: 'better_ball', sideA: ['a1', 'a2'], sideB: ['b1', 'b2'], points: 1, strokes: {} };
const low: MatchDef = { id: 'g:low_singles', groupId: 'g', type: 'low_singles', sideA: ['a1'], sideB: ['b1'], points: 0.5, strokes: {} };
const res = (over: Partial<ConfirmedResult>): ConfirmedResult => ({
  groupId: 'g', matchType: 'better_ball', winner: 'A', pointsA: 1, pointsB: 0, resultText: '4&3', finalHole: 15, ...over,
});

describe('isScoreLocked', () => {
  it('locks holes up to the final hole of a confirmed match', () => {
    const ms = [{ def: bb, result: res({}) }];
    expect(isScoreLocked('a1', 15, ms)).toBe(true);
    expect(isScoreLocked('b2', 1, ms)).toBe(true);
    expect(isScoreLocked('a1', 16, ms)).toBe(false);
  });
  it('only locks the players in the confirmed match', () => {
    const ms = [{ def: bb, result: null }, { def: low, result: res({ matchType: 'low_singles', finalHole: 12 }) }];
    expect(isScoreLocked('b1', 10, ms)).toBe(true);
    expect(isScoreLocked('a2', 10, ms)).toBe(false);
  });
  it('does not lock anything without results', () => {
    expect(isScoreLocked('a1', 1, [{ def: bb, result: null }])).toBe(false);
  });
});
```

`src/lib/scoring/pairings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { orderSlots, pairingErrors } from './pairings';

describe('orderSlots', () => {
  it('puts the lower handicap in slot 1', () => {
    expect(orderSlots('B', [{ playerId: 'x', handicap: 20 }, { playerId: 'y', handicap: 7 }])).toEqual([
      { slot: 'B1', playerId: 'y', handicap: 7 },
      { slot: 'B2', playerId: 'x', handicap: 20 },
    ]);
  });
  it('keeps the given order on a tie', () => {
    expect(orderSlots('A', [{ playerId: 'x', handicap: 9 }, { playerId: 'y', handicap: 9 }]).map((p) => p.playerId)).toEqual(['x', 'y']);
  });
});

describe('pairingErrors', () => {
  it('accepts complete, distinct groups', () => {
    expect(pairingErrors([{ a: ['1', '2'], b: ['3', '4'] }, { a: ['5', '6'], b: ['7', '8'] }])).toEqual([]);
  });
  it('reports incomplete groups', () => {
    expect(pairingErrors([{ a: ['1', null], b: ['3', '4'] }])).toEqual(['Group 1 needs 4 players']);
  });
  it('reports a player used twice', () => {
    expect(pairingErrors([{ a: ['1', '2'], b: ['3', '4'] }, { a: ['1', '6'], b: ['7', '8'] }])).toEqual([
      'A player is in more than one place (group 1 and group 2)',
    ]);
  });
});
```

`src/lib/scoring/courses.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateHoles } from './courses';
import type { HoleInfo } from './types';

const good: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));

describe('validateHoles', () => {
  it('accepts a valid course', () => {
    expect(validateHoles(good)).toEqual([]);
  });
  it('rejects bad par and SI values', () => {
    const bad = good.map((h) => (h.hole === 3 ? { ...h, par: 7 } : h.hole === 4 ? { ...h, strokeIndex: 19 } : h));
    expect(validateHoles(bad)).toEqual(['Hole 3: par must be 3–6', 'Hole 4: SI must be 1–18']);
  });
  it('rejects duplicate SI', () => {
    const dup = good.map((h) => (h.hole === 2 ? { ...h, strokeIndex: 1 } : h));
    expect(validateHoles(dup)).toEqual(['SI 1 is used more than once']);
  });
  it('requires 18 holes', () => {
    expect(validateHoles(good.slice(0, 9))).toContain('A course needs 18 holes');
  });
});
```

`src/lib/scoring/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatPoints, shotLabel } from './format';

describe('formatPoints', () => {
  it('formats whole and fractional points', () => {
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(6)).toBe('6');
    expect(formatPoints(6.5)).toBe('6½');
    expect(formatPoints(0.5)).toBe('½');
    expect(formatPoints(0.25)).toBe('¼');
    expect(formatPoints(3.75)).toBe('3¾');
  });
});

describe('shotLabel', () => {
  it('is null with no shots', () => {
    expect(shotLabel(0, null)).toBeNull();
    expect(shotLabel(0, 0)).toBeNull();
  });
  it('labels one or two shots', () => {
    expect(shotLabel(1, null)).toBe('1 shot');
    expect(shotLabel(2, 2)).toBe('2 shots');
  });
  it('shows both counts when better-ball and singles differ', () => {
    expect(shotLabel(1, 0)).toBe('BB 1 · Singles 0');
    expect(shotLabel(0, 1)).toBe('BB 0 · Singles 1');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/lib/scoring`
Expected: FAIL, unresolved imports for `./tracker`, `./locks`, `./pairings`, `./courses` and `./format`.

- [ ] **Step 3: Implement**

`src/lib/scoring/tracker.ts`:
```ts
import type { ConfirmedResult, MatchDef, MatchState, RoundSettings } from './types';

export interface Tracker {
  confirmedA: number;
  confirmedB: number;
  projectedA: number;
  projectedB: number;
  total: number;
  toWin: number;
}

export interface TrackedMatch {
  state: MatchState;
  result: ConfirmedResult | null;
}

export function computeTracker(matches: TrackedMatch[], total: number): Tracker {
  let confirmedA = 0;
  let confirmedB = 0;
  let liveA = 0;
  let liveB = 0;
  for (const m of matches) {
    if (m.result) {
      confirmedA += m.result.pointsA;
      confirmedB += m.result.pointsB;
    } else {
      liveA += m.state.projectedA;
      liveB += m.state.projectedB;
    }
  }
  return {
    confirmedA,
    confirmedB,
    projectedA: confirmedA + liveA,
    projectedB: confirmedB + liveB,
    total,
    toWin: total / 2 + 0.5,
  };
}

export function roundPointsAvailable(s: RoundSettings, groupCount: number): number {
  return groupCount * (s.betterBallPoints + (s.singlesEnabled ? 2 * s.singlesPoints : 0));
}

export function resultFromState(def: MatchDef, state: MatchState): ConfirmedResult | null {
  if (!state.decided || !state.winner || state.finalHole === null || !state.resultText) return null;
  const [pointsA, pointsB] =
    state.winner === 'A' ? [def.points, 0] : state.winner === 'B' ? [0, def.points] : [def.points / 2, def.points / 2];
  return {
    groupId: def.groupId,
    matchType: def.type,
    winner: state.winner,
    pointsA,
    pointsB,
    resultText: state.resultText,
    finalHole: state.finalHole,
  };
}
```

`src/lib/scoring/locks.ts`:
```ts
import type { ConfirmedResult, MatchDef } from './types';

/** Mirrors the database's score_locked(): a confirmed match locks its players' holes up to its final hole. */
export function isScoreLocked(
  playerId: string,
  hole: number,
  matches: { def: MatchDef; result: ConfirmedResult | null }[],
): boolean {
  return matches.some(
    (m) =>
      m.result !== null &&
      hole <= m.result.finalHole &&
      (m.def.sideA.includes(playerId) || m.def.sideB.includes(playerId)),
  );
}
```

`src/lib/scoring/pairings.ts`:
```ts
import type { SlotPlayer, Team } from './types';

export function orderSlots(team: Team, players: { playerId: string; handicap: number }[]): SlotPlayer[] {
  return [...players]
    .sort((x, y) => x.handicap - y.handicap)
    .map((p, i) => ({ slot: `${team}${i + 1}` as SlotPlayer['slot'], playerId: p.playerId, handicap: p.handicap }));
}

export interface PairingDraft {
  a: (string | null)[];
  b: (string | null)[];
}

export function pairingErrors(groups: PairingDraft[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  groups.forEach((g, i) => {
    const ids = [...g.a, ...g.b];
    if (ids.length !== 4 || ids.some((id) => !id)) errors.push(`Group ${i + 1} needs 4 players`);
    for (const id of ids) {
      if (!id) continue;
      const first = seen.get(id);
      if (first !== undefined) errors.push(`A player is in more than one place (group ${first + 1} and group ${i + 1})`);
      else seen.set(id, i);
    }
  });
  return errors;
}
```

`src/lib/scoring/courses.ts`:
```ts
import type { HoleInfo } from './types';

export function validateHoles(holes: HoleInfo[]): string[] {
  const errors: string[] = [];
  if (holes.length !== 18) errors.push('A course needs 18 holes');
  for (const h of holes) {
    if (!Number.isInteger(h.par) || h.par < 3 || h.par > 6) errors.push(`Hole ${h.hole}: par must be 3–6`);
    if (!Number.isInteger(h.strokeIndex) || h.strokeIndex < 1 || h.strokeIndex > 18)
      errors.push(`Hole ${h.hole}: SI must be 1–18`);
  }
  const si = holes.map((h) => h.strokeIndex);
  const dupes = [...new Set(si.filter((v, i) => si.indexOf(v) !== i))];
  for (const d of dupes) errors.push(`SI ${d} is used more than once`);
  return errors;
}
```

`src/lib/scoring/format.ts`:
```ts
const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' };

export function formatPoints(n: number): string {
  const whole = Math.floor(n);
  const frac = FRACTIONS[String(Math.round((n - whole) * 100) / 100)] ?? '';
  if (!frac) return String(whole);
  return `${whole === 0 ? '' : whole}${frac}`;
}

/** Label for a player's shots on a hole: better-ball count, plus singles when it differs. */
export function shotLabel(bb: number, singles: number | null): string | null {
  if (singles !== null && singles !== bb) return `BB ${bb} · Singles ${singles}`;
  if (bb === 0) return null;
  return bb === 1 ? '1 shot' : `${bb} shots`;
}
```

Replace `src/lib/scoring/index.ts` with:
```ts
export * from './types';
export * from './strokes';
export * from './matches';
export * from './matchState';
export * from './tracker';
export * from './locks';
export * from './pairings';
export * from './courses';
export * from './format';
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run src/lib/scoring`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring
git commit -m "feat(scoring): tracker, locks, pairings, course validation, formatting"
```

---
### Task 5: Database — schema, security, functions and tests

**Files:**
- Create: `supabase/migrations/20260927000001_schema.sql`, `20260927000002_security.sql`, `20260927000003_functions.sql`, `20260927000004_supabase_storage_realtime.sql`
- Test: `tests/db/harness.ts`, `tests/db/db.test.ts`

**Interfaces:**
- Produces tables per spec §4. Point columns are `numeric(4,2)` so that a halved ½-point singles (0.25 each) is stored exactly.
- Produces RPCs (called from supabase-js as `supabase.rpc(name, args)`):
  - `upsert_score(p_round_id uuid, p_player_id uuid, p_hole int, p_gross int, p_picked_up boolean, p_client_updated_at timestamptz) returns text`, returning `'ok' | 'stale' | 'locked'`. Passing `p_gross = null` and `p_picked_up = false` deletes the score.
  - `confirm_match(p_group_id uuid, p_match_type text, p_winner text, p_points_a numeric, p_points_b numeric, p_result_text text, p_final_hole int) returns text`, returning `'ok' | 'already_confirmed'`
  - `set_player_photo(p_player_id uuid, p_path text) returns void`. The path must be `<player_id>/<digits>.jpg`.
  - `save_course(p_course_id uuid, p_name text, p_holes jsonb) returns uuid`. `p_holes` is `[{hole, par, stroke_index}]`; admin only.
  - `save_group(p_round_id uuid, p_group_no int, p_tee_time time, p_slots jsonb) returns uuid`. `p_slots` is `[{slot, player_id}]`; admin only.
- Storage bucket `player-photos` (private).

**Security model** (from the Supabase security checklist):
- RLS is on for every table, with explicit grants to `authenticated` and none to `anon`.
- Policies use `(select public.is_admin())`, which reads **`app_metadata`**, never `user_metadata`.
- Functions run as `SECURITY INVOKER`, so RLS applies. The score lock is enforced **in the `scores` RLS policies**, so it holds even for direct table writes.
- The only `SECURITY DEFINER` function is `set_player_photo`, because a trip user must set one column without being able to update players generally. It checks `auth.uid()`, validates its input, uses `set search_path = ''`, and has execute revoked from `public` and `anon`.
- Every function sets `search_path = ''` and schema-qualifies its references.

- [ ] **Step 1: Write the PGlite harness**

PGlite runs real Postgres in-process, so no Docker is needed. The harness fakes the small part of Supabase that the migrations depend on: the `anon`/`authenticated` roles and `auth.jwt()`/`auth.uid()`, which read `request.jwt.claims` just as Supabase does.

`tests/db/harness.ts`:
```ts
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';

export const TRIP_ID = '11111111-1111-1111-1111-111111111111';
export const ADMIN_ID = '22222222-2222-2222-2222-222222222222';

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
`;

/** Fresh database with all migrations applied, except Supabase-only ones (storage, realtime). */
export async function makeDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  const dir = 'supabase/migrations';
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.includes('_supabase_')).sort();
  for (const f of files) await db.exec(readFileSync(`${dir}/${f}`, 'utf8'));
  return db;
}

export type Who = 'anon' | 'trip' | 'admin';

/** Run fn as a Supabase API caller: the Postgres role plus JWT claims, exactly as PostgREST sets them. */
export async function as<T>(db: PGlite, who: Who, fn: () => Promise<T>): Promise<T> {
  const claims =
    who === 'anon'
      ? { role: 'anon' }
      : { sub: who === 'trip' ? TRIP_ID : ADMIN_ID, role: 'authenticated', app_metadata: who === 'admin' ? { role: 'admin' } : {} };
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

export interface Seed {
  courseId: string;
  eventId: string;
  roundId: string;
  groupId: string;
  players: Record<'a1' | 'a2' | 'b1' | 'b2', string>;
}

/** One course, event, round (singles enabled) and a full group of four. Runs as superuser. */
export async function seed(db: PGlite): Promise<Seed> {
  const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;
  const courseId = await one(`insert into public.courses(name) values ('Test Links') returning id`);
  await db.query(
    `insert into public.course_holes(course_id, hole, par, stroke_index) select $1::uuid, h, 4, h from generate_series(1, 18) h`,
    [courseId],
  );
  const eventId = await one(`insert into public.events(name, is_active) values ('Test Cup', true) returning id`);
  const players = {} as Seed['players'];
  const roster = [['a1', 'A', 4], ['a2', 'A', 18], ['b1', 'B', 9], ['b2', 'B', 14]] as const;
  for (const [key, team, hcp] of roster) {
    players[key] = await one(
      `insert into public.players(name, short_name, default_handicap) values ($1, $1, $2) returning id`,
      [key.toUpperCase(), hcp],
    );
    await db.query(`insert into public.event_players(event_id, player_id, team, handicap) values ($1, $2, $3, $4)`, [
      eventId, players[key], team, hcp,
    ]);
  }
  const roundId = await one(
    `insert into public.rounds(event_id, course_id, round_no, name, singles_enabled) values ($1, $2, 1, 'Day 1', true) returning id`,
    [eventId, courseId],
  );
  const groupId = await one(`insert into public.groups(round_id, group_no) values ($1, 1) returning id`, [roundId]);
  for (const [slot, key] of [['A1', 'a1'], ['A2', 'a2'], ['B1', 'b1'], ['B2', 'b2']] as const) {
    await db.query(`insert into public.group_players(group_id, slot, player_id) values ($1, $2, $3)`, [groupId, slot, players[key]]);
  }
  return { courseId, eventId, roundId, groupId, players };
}
```

- [ ] **Step 2: Write the failing database tests**

`tests/db/db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, makeDb, seed, type Seed, type Who } from './harness';

let db: PGlite;
let s: Seed;

beforeEach(async () => {
  db = await makeDb();
  s = await seed(db);
});

const T1 = '2026-10-01T10:00:00Z';
const T0 = '2026-10-01T09:00:00Z';
const T2 = '2026-10-01T11:00:00Z';

async function upsert(who: Who, player: string, hole: number, gross: number | null, pickedUp = false, at = T1) {
  return as(db, who, async () => {
    const r = await db.query<{ r: string }>(
      `select public.upsert_score($1::uuid, $2::uuid, $3::int, $4::int, $5::boolean, $6::timestamptz) as r`,
      [s.roundId, player, hole, gross, pickedUp, at],
    );
    return r.rows[0].r;
  });
}

async function readScore(player: string, hole: number) {
  const r = await db.query<{ gross: number | null; picked_up: boolean }>(
    `select gross, picked_up from public.scores where round_id = $1 and player_id = $2 and hole = $3`,
    [s.roundId, player, hole],
  );
  return r.rows[0] ?? null;
}

async function confirm(who: Who, type: string, finalHole: number) {
  return as(db, who, async () => {
    const r = await db.query<{ r: string }>(
      `select public.confirm_match($1::uuid, $2, 'A', 1, 0, '4&3', $3::int) as r`,
      [s.groupId, type, finalHole],
    );
    return r.rows[0].r;
  });
}

describe('harness', () => {
  it('applies RLS to the authenticated role', async () => {
    await expect(
      as(db, 'trip', () => db.query(`insert into public.players(name, short_name) values ('X', 'X')`)),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('read access', () => {
  it('lets signed-in users read', async () => {
    const r = await as(db, 'trip', () => db.query(`select * from public.players`));
    expect(r.rows).toHaveLength(4);
  });
  it('gives anon nothing', async () => {
    await expect(as(db, 'anon', () => db.query(`select * from public.players`))).rejects.toThrow(/permission denied/);
  });
});

describe('setup tables', () => {
  it('lets the admin write', async () => {
    await as(db, 'admin', () => db.query(`insert into public.players(name, short_name) values ('New', 'New')`));
    const r = await db.query(`select 1 from public.players where name = 'New'`);
    expect(r.rows).toHaveLength(1);
  });
});

describe('upsert_score', () => {
  it('inserts and updates', async () => {
    expect(await upsert('trip', s.players.a1, 1, 4)).toBe('ok');
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 4, picked_up: false });
    expect(await upsert('trip', s.players.a1, 1, 5, false, T2)).toBe('ok');
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 5, picked_up: false });
  });

  it('ignores a stale write', async () => {
    await upsert('trip', s.players.a1, 1, 4, false, T1);
    expect(await upsert('trip', s.players.a1, 1, 7, false, T0)).toBe('stale');
    expect(await readScore(s.players.a1, 1)).toEqual({ gross: 4, picked_up: false });
  });

  it('stores a pick-up', async () => {
    expect(await upsert('trip', s.players.a1, 2, null, true)).toBe('ok');
    expect(await readScore(s.players.a1, 2)).toEqual({ gross: null, picked_up: true });
  });

  it('deletes when cleared', async () => {
    await upsert('trip', s.players.a1, 3, 4, false, T1);
    expect(await upsert('trip', s.players.a1, 3, null, false, T2)).toBe('ok');
    expect(await readScore(s.players.a1, 3)).toBeNull();
  });

  it('rejects an out-of-range gross score', async () => {
    await expect(upsert('trip', s.players.a1, 1, 16)).rejects.toThrow(/check constraint/);
  });

  it('rejects anon', async () => {
    await expect(upsert('anon', s.players.a1, 1, 4)).rejects.toThrow(/permission denied/);
  });
});

describe('confirmation and locking', () => {
  it('confirms once', async () => {
    expect(await confirm('trip', 'better_ball', 15)).toBe('ok');
    expect(await confirm('trip', 'better_ball', 15)).toBe('already_confirmed');
  });

  it('locks every better-ball player up to the final hole only', async () => {
    await confirm('trip', 'better_ball', 15);
    expect(await upsert('trip', s.players.b2, 15, 4)).toBe('locked');
    expect(await upsert('trip', s.players.a1, 16, 4)).toBe('ok');
  });

  it('locks only the singles players for a singles result', async () => {
    await confirm('trip', 'low_singles', 12);
    expect(await upsert('trip', s.players.b1, 10, 4)).toBe('locked');
    expect(await upsert('trip', s.players.a2, 10, 4)).toBe('ok');
  });

  it('blocks direct writes to locked scores too', async () => {
    await upsert('trip', s.players.a1, 5, 4);
    await confirm('trip', 'better_ball', 15);
    await as(db, 'trip', () => db.query(`update public.scores set gross = 9 where hole = 5`));
    expect(await readScore(s.players.a1, 5)).toEqual({ gross: 4, picked_up: false });
  });

  it('lets only the admin unlock', async () => {
    await confirm('trip', 'better_ball', 15);
    await as(db, 'trip', () => db.query(`delete from public.match_results`));
    expect((await db.query(`select 1 from public.match_results`)).rows).toHaveLength(1);
    await as(db, 'admin', () => db.query(`delete from public.match_results`));
    expect((await db.query(`select 1 from public.match_results`)).rows).toHaveLength(0);
  });
});

describe('admin RPCs', () => {
  const holes = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: 18 - i })));

  it('saves a course for the admin', async () => {
    const id = await as(db, 'admin', async () =>
      (await db.query<{ id: string }>(`select public.save_course(null, 'New Course', $1::jsonb) as id`, [holes])).rows[0].id,
    );
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.course_holes where course_id = $1`, [id]);
    expect(r.rows[0].n).toBe(18);
  });

  it('refuses save_course for the trip user', async () => {
    await expect(
      as(db, 'trip', () => db.query(`select public.save_course(null, 'X', $1::jsonb)`, [holes])),
    ).rejects.toThrow(/admin only/);
  });

  it('replaces a group’s players with save_group', async () => {
    const slots = JSON.stringify([
      { slot: 'A1', player_id: s.players.a2 },
      { slot: 'A2', player_id: s.players.a1 },
      { slot: 'B1', player_id: s.players.b1 },
      { slot: 'B2', player_id: s.players.b2 },
    ]);
    const id = await as(db, 'admin', async () =>
      (await db.query<{ id: string }>(`select public.save_group($1::uuid, 1, '09:10'::time, $2::jsonb) as id`, [s.roundId, slots])).rows[0].id,
    );
    expect(id).toBe(s.groupId);
    const r = await db.query<{ player_id: string }>(`select player_id from public.group_players where group_id = $1 and slot = 'A1'`, [id]);
    expect(r.rows[0].player_id).toBe(s.players.a2);
  });

  it('only accepts well-formed photo paths', async () => {
    await expect(
      as(db, 'trip', () => db.query(`select public.set_player_photo($1::uuid, 'evil/../x.jpg')`, [s.players.a1])),
    ).rejects.toThrow(/invalid photo path/);
    await as(db, 'trip', () => db.query(`select public.set_player_photo($1::uuid, $2)`, [s.players.a1, `${s.players.a1}/123.jpg`]));
    const r = await db.query<{ photo_path: string }>(`select photo_path from public.players where id = $1`, [s.players.a1]);
    expect(r.rows[0].photo_path).toBe(`${s.players.a1}/123.jpg`);
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run tests/db`
Expected: FAIL. `readdirSync` throws ENOENT for `supabase/migrations`, or the tables don't exist.

- [ ] **Step 4: Write the schema migration**

`supabase/migrations/20260927000001_schema.sql`:
```sql
create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  short_name text not null,
  default_handicap numeric(4,1) not null default 0,
  photo_path text,
  created_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.course_holes (
  course_id uuid not null references public.courses(id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  par smallint not null check (par between 3 and 6),
  stroke_index smallint not null check (stroke_index between 1 and 18),
  primary key (course_id, hole),
  unique (course_id, stroke_index)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_a_name text not null default 'Team A',
  team_a_colour text not null default '#1f4e9c',
  team_b_name text not null default 'Team B',
  team_b_colour text not null default '#c8102e',
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index events_one_active on public.events (is_active) where is_active;

create table public.event_players (
  event_id uuid not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team text not null check (team in ('A', 'B')),
  handicap numeric(4,1) not null,
  primary key (event_id, player_id)
);
create index event_players_player_idx on public.event_players (player_id);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  round_no smallint not null,
  date date,
  name text not null,
  allowance_pct numeric(5,2) not null default 90 check (allowance_pct between 0 and 100),
  better_ball_points numeric(4,2) not null default 1,
  singles_enabled boolean not null default false,
  singles_points numeric(4,2) not null default 0.5,
  singles_allowance_pct numeric(5,2) not null default 90 check (singles_allowance_pct between 0 and 100),
  unique (event_id, round_no)
);
create index rounds_course_idx on public.rounds (course_id);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  group_no smallint not null,
  tee_time time,
  unique (round_id, group_no)
);

create table public.group_players (
  group_id uuid not null references public.groups(id) on delete cascade,
  slot text not null check (slot in ('A1', 'A2', 'B1', 'B2')),
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (group_id, slot),
  unique (group_id, player_id)
);
create index group_players_player_idx on public.group_players (player_id);

create table public.scores (
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  gross smallint check (gross between 1 and 15),
  picked_up boolean not null default false,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (round_id, player_id, hole),
  check ((gross is null) = picked_up)
);
create index scores_player_idx on public.scores (player_id);

create table public.match_results (
  group_id uuid not null references public.groups(id) on delete cascade,
  match_type text not null check (match_type in ('better_ball', 'low_singles', 'high_singles')),
  winner text not null check (winner in ('A', 'B', 'halved')),
  points_a numeric(4,2) not null,
  points_b numeric(4,2) not null,
  result_text text not null,
  final_hole smallint not null check (final_hole between 1 and 18),
  confirmed_at timestamptz not null default now(),
  primary key (group_id, match_type)
);
```

- [ ] **Step 5: Write the security migration**

`supabase/migrations/20260927000002_security.sql`:
```sql
-- Admin = the admin Supabase Auth user, marked via app_metadata (server-controlled; never user_metadata).
create function public.is_admin() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

-- True when a confirmed match includes this player and covers this hole (spec §3.5).
create function public.score_locked(p_round_id uuid, p_player_id uuid, p_hole int) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.match_results mr
    join public.groups g on g.id = mr.group_id
    join public.group_players gp on gp.group_id = g.id and gp.player_id = p_player_id
    where g.round_id = p_round_id
      and p_hole <= mr.final_hole
      and (
        mr.match_type = 'better_ball'
        or (mr.match_type = 'low_singles' and gp.slot in ('A1', 'B1'))
        or (mr.match_type = 'high_singles' and gp.slot in ('A2', 'B2'))
      )
  )
$$;

-- Explicit Data API grants: signed-in users only. RLS below decides which rows.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array['players', 'courses', 'course_holes', 'events', 'event_players', 'rounds', 'groups', 'group_players', 'scores', 'match_results'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "signed-in read %1$s" on public.%1$I for select to authenticated using (true)', t);
  end loop;
  foreach t in array array['players', 'courses', 'course_holes', 'events', 'event_players', 'rounds', 'groups', 'group_players'] loop
    execute format(
      'create policy "admin write %1$s" on public.%1$I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t
    );
  end loop;
end $$;

-- Scores: any signed-in user may write, except on holes locked by a confirmed match.
create policy "write unlocked scores" on public.scores for insert to authenticated
  with check (not public.score_locked(round_id, player_id, hole));
create policy "update unlocked scores" on public.scores for update to authenticated
  using (not public.score_locked(round_id, player_id, hole))
  with check (not public.score_locked(round_id, player_id, hole));
create policy "delete unlocked scores" on public.scores for delete to authenticated
  using (not public.score_locked(round_id, player_id, hole));

-- Results: any signed-in user may confirm; only the admin may unlock (delete).
create policy "confirm results" on public.match_results for insert to authenticated with check (true);
create policy "admin unlocks results" on public.match_results for delete to authenticated
  using ((select public.is_admin()));
```

- [ ] **Step 6: Write the functions migration**

`supabase/migrations/20260927000003_functions.sql`:
```sql
-- All functions are SECURITY INVOKER (RLS applies) except set_player_photo.

create function public.upsert_score(
  p_round_id uuid, p_player_id uuid, p_hole int, p_gross int, p_picked_up boolean, p_client_updated_at timestamptz
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.score_locked(p_round_id, p_player_id, p_hole) then
    return 'locked';
  end if;

  if p_gross is null and not p_picked_up then
    delete from public.scores
    where round_id = p_round_id and player_id = p_player_id and hole = p_hole
      and client_updated_at <= p_client_updated_at;
    if found or not exists (
      select 1 from public.scores where round_id = p_round_id and player_id = p_player_id and hole = p_hole
    ) then
      return 'ok';
    end if;
    return 'stale';
  end if;

  insert into public.scores (round_id, player_id, hole, gross, picked_up, client_updated_at)
  values (p_round_id, p_player_id, p_hole, p_gross, p_picked_up, p_client_updated_at)
  on conflict (round_id, player_id, hole) do update
    set gross = excluded.gross,
        picked_up = excluded.picked_up,
        client_updated_at = excluded.client_updated_at,
        updated_at = now()
    where public.scores.client_updated_at <= excluded.client_updated_at;
  if found then
    return 'ok';
  end if;
  return 'stale';
end;
$$;

create function public.confirm_match(
  p_group_id uuid, p_match_type text, p_winner text, p_points_a numeric, p_points_b numeric, p_result_text text, p_final_hole int
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.match_results (group_id, match_type, winner, points_a, points_b, result_text, final_hole)
  values (p_group_id, p_match_type, p_winner, p_points_a, p_points_b, p_result_text, p_final_hole)
  on conflict (group_id, match_type) do nothing;
  if found then
    return 'ok';
  end if;
  return 'already_confirmed';
end;
$$;

create function public.save_course(p_course_id uuid, p_name text, p_holes jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_course_id is null then
    insert into public.courses (name) values (p_name) returning id into v_id;
  else
    update public.courses set name = p_name where id = p_course_id;
    v_id := p_course_id;
  end if;
  delete from public.course_holes where course_id = v_id;
  insert into public.course_holes (course_id, hole, par, stroke_index)
  select v_id, h.hole, h.par, h.stroke_index
  from jsonb_to_recordset(p_holes) as h(hole int, par int, stroke_index int);
  return v_id;
end;
$$;

create function public.save_group(p_round_id uuid, p_group_no int, p_tee_time time, p_slots jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  insert into public.groups (round_id, group_no, tee_time)
  values (p_round_id, p_group_no, p_tee_time)
  on conflict (round_id, group_no) do update set tee_time = excluded.tee_time
  returning id into v_id;
  delete from public.group_players where group_id = v_id;
  insert into public.group_players (group_id, slot, player_id)
  select v_id, s.slot, s.player_id
  from jsonb_to_recordset(p_slots) as s(slot text, player_id uuid);
  return v_id;
end;
$$;

-- SECURITY DEFINER: lets the trip user set exactly one column (photo_path) without broader update rights.
create function public.set_player_photo(p_player_id uuid, p_path text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_path !~ ('^' || p_player_id::text || '/[0-9]+\.jpg$') then
    raise exception 'invalid photo path';
  end if;
  update public.players set photo_path = p_path where id = p_player_id;
end;
$$;

revoke execute on function public.upsert_score(uuid, uuid, int, int, boolean, timestamptz) from public, anon;
revoke execute on function public.confirm_match(uuid, text, text, numeric, numeric, text, int) from public, anon;
revoke execute on function public.save_course(uuid, text, jsonb) from public, anon;
revoke execute on function public.save_group(uuid, int, time, jsonb) from public, anon;
revoke execute on function public.set_player_photo(uuid, text) from public, anon;
grant execute on function public.upsert_score(uuid, uuid, int, int, boolean, timestamptz) to authenticated;
grant execute on function public.confirm_match(uuid, text, text, numeric, numeric, text, int) to authenticated;
grant execute on function public.save_course(uuid, text, jsonb) to authenticated;
grant execute on function public.save_group(uuid, int, time, jsonb) to authenticated;
grant execute on function public.set_player_photo(uuid, text) to authenticated;
```

`supabase/migrations/20260927000004_supabase_storage_realtime.sql` (Supabase-only; the PGlite harness skips it):
```sql
-- Private bucket for player photos: signed-in users read, upload and replace.
insert into storage.buckets (id, name, public)
values ('player-photos', 'player-photos', false)
on conflict (id) do nothing;

create policy "photos read" on storage.objects for select to authenticated
  using (bucket_id = 'player-photos');
create policy "photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'player-photos');
create policy "photos update" on storage.objects for update to authenticated
  using (bucket_id = 'player-photos') with check (bucket_id = 'player-photos');

-- Live updates for everything the app displays.
alter publication supabase_realtime add table
  public.scores, public.match_results, public.players, public.courses, public.course_holes,
  public.events, public.event_players, public.rounds, public.groups, public.group_players;
```

- [ ] **Step 7: Run the tests to confirm they pass**

Run: `npx vitest run tests/db`
Expected: PASS (19 tests).

If the `anon` tests fail because the error text differs, print the actual error and match on it. The requirement is that anon **cannot** read or call the functions; the exact wording is not.

- [ ] **Step 8: Check the Supabase changelog, then apply the migrations to `golf-dev` via MCP**

1. Fetch `https://supabase.com/changelog.md` and scan it for `breaking-change` entries touching RLS, storage policies, Realtime publications, the Data API grants or publishable keys. Adjust the migrations if anything applies.
2. For each of the four files, in order, call the Supabase MCP `apply_migration` on the `golf-dev` project ref. Use the filename without its timestamp and extension as `name` (for example `schema`) and the file contents as `query`.
3. Call `list_tables` for `public` and confirm all 10 tables exist with RLS enabled.
4. Call `get_advisors` with type `security`. Expected: no errors. The only acceptable warning is "security definer function" for `set_player_photo`, which is intentional (see the comment in the migration). Fix anything else, re-run the Step 7 tests, and re-apply the fix as a **new** migration file.

- [ ] **Step 9: Commit**

```bash
git add supabase tests/db
git commit -m "feat(db): schema, RLS, score locking and RPCs with PGlite tests"
```

---

### Task 6: Supabase client, auth, dev scripts, router, login and app shell

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/auth.svelte.ts`, `src/lib/route.ts`, `src/lib/router.svelte.ts`, `src/routes/Login.svelte`, `src/components/Nav.svelte`, `scripts/create-users.ts`, `scripts/seed.ts`
- Modify: `src/App.svelte` (replace)
- Test: `src/lib/route.test.ts`

**Interfaces:**
- Produces:
  - `supabase` (client), `TRIP_EMAIL`, `ADMIN_EMAIL`, and `must<T>(query): Promise<T>`, which throws `Error(message)` when there's an error.
  - `auth` (`$state` of `{ ready: boolean; session: Session | null }`), `initAuth()`, `isAdmin(): boolean`, `login(password, mode: 'trip' | 'admin'): Promise<string | null>` (returns an error message or null), and `logout()`.
  - `type Route`, `parseRoute(hash: string): Route`, and `router` (`$state` of `{ route: Route }`).
  - `npm run users` creates or updates the two auth users. `npm run seed -- --yes-wipe` wipes all data and seeds a demo event.

- [ ] **Step 1: Write the failing route test**

`src/lib/route.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseRoute } from './route';

describe('parseRoute', () => {
  it.each([
    ['', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/match/g1/low_singles', { name: 'match', groupId: 'g1', matchType: 'low_singles' }],
    ['#/score', { name: 'score', groupId: null }],
    ['#/score/g1', { name: 'score', groupId: 'g1' }],
    ['#/players', { name: 'players' }],
    ['#/admin', { name: 'admin' }],
    ['#/admin/login', { name: 'admin-login' }],
    ['#/admin/players', { name: 'admin-players' }],
    ['#/admin/courses', { name: 'admin-courses' }],
    ['#/admin/courses/new', { name: 'admin-course', courseId: 'new' }],
    ['#/admin/events', { name: 'admin-events' }],
    ['#/admin/events/e1', { name: 'admin-event', eventId: 'e1' }],
    ['#/admin/pairings/r1', { name: 'admin-pairings', roundId: 'r1' }],
    ['#/match/g1/bogus', { name: 'not-found' }],
    ['#/nope', { name: 'not-found' }],
  ])('parses %s', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/lib/route.test.ts`
Expected: FAIL, "Failed to resolve import './route'".

- [ ] **Step 3: Implement routing**

`src/lib/route.ts`:
```ts
import type { MatchType } from './scoring';

export type Route =
  | { name: 'home' }
  | { name: 'match'; groupId: string; matchType: MatchType }
  | { name: 'score'; groupId: string | null }
  | { name: 'players' }
  | { name: 'admin-login' }
  | { name: 'admin' }
  | { name: 'admin-players' }
  | { name: 'admin-courses' }
  | { name: 'admin-course'; courseId: string }
  | { name: 'admin-events' }
  | { name: 'admin-event'; eventId: string }
  | { name: 'admin-pairings'; roundId: string }
  | { name: 'not-found' };

const MATCH_TYPES: MatchType[] = ['better_ball', 'low_singles', 'high_singles'];

export function parseRoute(hash: string): Route {
  const p = hash.replace(/^#/, '').split('/').filter(Boolean);
  const [a, b, c] = p;
  if (p.length === 0) return { name: 'home' };
  if (a === 'match' && p.length === 3 && MATCH_TYPES.includes(c as MatchType))
    return { name: 'match', groupId: b, matchType: c as MatchType };
  if (a === 'score' && p.length <= 2) return { name: 'score', groupId: b ?? null };
  if (a === 'players' && p.length === 1) return { name: 'players' };
  if (a === 'admin') {
    if (p.length === 1) return { name: 'admin' };
    if (p.length === 2 && b === 'login') return { name: 'admin-login' };
    if (p.length === 2 && b === 'players') return { name: 'admin-players' };
    if (p.length === 2 && b === 'courses') return { name: 'admin-courses' };
    if (p.length === 3 && b === 'courses') return { name: 'admin-course', courseId: c };
    if (p.length === 2 && b === 'events') return { name: 'admin-events' };
    if (p.length === 3 && b === 'events') return { name: 'admin-event', eventId: c };
    if (p.length === 3 && b === 'pairings') return { name: 'admin-pairings', roundId: c };
  }
  return { name: 'not-found' };
}
```

`src/lib/router.svelte.ts`:
```ts
import { parseRoute, type Route } from './route';

export const router = $state<{ route: Route }>({ route: parseRoute(location.hash) });

window.addEventListener('hashchange', () => {
  router.route = parseRoute(location.hash);
  window.scrollTo(0, 0);
});
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/route.test.ts`
Expected: PASS (16 cases).

- [ ] **Step 5: Write the client, auth, login, nav and app shell**

`src/lib/supabase.ts`:
```ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY; // publishable key — safe in the browser; RLS protects data
if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_KEY must be set');

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const TRIP_EMAIL = import.meta.env.VITE_TRIP_EMAIL ?? 'trip@example.com';
export const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL ?? 'admin@example.com';

/** Await a Supabase query/RPC and return its data, throwing on error. */
export async function must<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
```

`src/lib/auth.svelte.ts`:
```ts
import type { Session } from '@supabase/supabase-js';
import { ADMIN_EMAIL, TRIP_EMAIL, supabase } from './supabase';

export const auth = $state<{ ready: boolean; session: Session | null }>({ ready: false, session: null });

export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  auth.session = data.session;
  auth.ready = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    auth.session = session;
  });
}

export function isAdmin(): boolean {
  return auth.session?.user?.app_metadata?.role === 'admin';
}

export async function login(password: string, mode: 'trip' | 'admin'): Promise<string | null> {
  const email = mode === 'admin' ? ADMIN_EMAIL : TRIP_EMAIL;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? 'Wrong password' : null;
}

export async function logout() {
  await supabase.auth.signOut();
  location.hash = '#/';
}
```

`src/routes/Login.svelte`:
```svelte
<script lang="ts">
  import { login } from '../lib/auth.svelte';

  let { mode }: { mode: 'trip' | 'admin' } = $props();
  let password = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = await login(password, mode);
    busy = false;
    if (!error && mode === 'admin') location.hash = '#/admin';
  }
</script>

<main class="login">
  <h1>⛳ {mode === 'admin' ? 'Admin login' : 'Golf Trip Cup'}</h1>
  <form class="card" onsubmit={submit}>
    <div class="field">
      <label for="pw">Password</label>
      <input id="pw" type="password" autocomplete="current-password" bind:value={password} required />
    </div>
    {#if error}<p class="error">{error}</p>{/if}
    <button type="submit" disabled={busy}>Enter</button>
  </form>
  {#if mode === 'trip'}
    <p class="muted small"><a href="#/admin/login">Admin login</a></p>
  {:else}
    <p class="muted small"><a href="#/">Back</a></p>
  {/if}
</main>

<style>
  .login { padding-top: 15vh; }
  h1 { text-align: center; margin-bottom: 24px; }
  button { width: 100%; }
  p { text-align: center; }
</style>
```

`src/components/Nav.svelte`:
```svelte
<script lang="ts">
  import { router } from '../lib/router.svelte';
  import { isAdmin } from '../lib/auth.svelte';

  const items = $derived([
    { href: '#/', label: 'Leaderboard', active: ['home', 'match'].includes(router.route.name) },
    { href: '#/score', label: 'Scores', active: router.route.name === 'score' },
    { href: '#/players', label: 'Players', active: router.route.name === 'players' },
    ...(isAdmin() ? [{ href: '#/admin', label: 'Admin', active: router.route.name.startsWith('admin') }] : []),
  ]);
</script>

<nav>
  {#each items as item (item.href)}
    <a href={item.href} class:active={item.active}>{item.label}</a>
  {/each}
</nav>

<style>
  nav {
    position: fixed; bottom: 0; left: 0; right: 0; display: flex;
    background: var(--surface); border-top: 1px solid var(--line);
    padding-bottom: env(safe-area-inset-bottom);
  }
  a {
    flex: 1; text-align: center; padding: 14px 4px; min-height: 48px;
    color: var(--muted); text-decoration: none; font-weight: 600; font-size: 0.9rem;
  }
  a.active { color: var(--accent); }
</style>
```

`src/App.svelte` (interim shell; Task 9 replaces it):
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, initAuth, isAdmin, logout } from './lib/auth.svelte';
  import { router } from './lib/router.svelte';
  import Login from './routes/Login.svelte';
  import Nav from './components/Nav.svelte';

  onMount(initAuth);
  const route = $derived(router.route);
  const signedIn = $derived(!!auth.session);
  const needsAdmin = $derived(route.name.startsWith('admin') && route.name !== 'admin-login');
</script>

{#if !auth.ready}
  <p class="center muted">Loading…</p>
{:else if route.name === 'admin-login' || (signedIn && needsAdmin && !isAdmin())}
  <Login mode="admin" />
{:else if !signedIn}
  <Login mode="trip" />
{:else}
  <main>
    <h1>Signed in{isAdmin() ? ' (admin)' : ''}</h1>
    <button class="secondary" onclick={logout}>Sign out</button>
  </main>
  <Nav />
{/if}
```

- [ ] **Step 6: Write the dev scripts**

`scripts/create-users.ts`:
```ts
// Creates/updates the two shared logins. Usage: npm run users  (reads .env.local)
// For production: node --env-file=.env.prod --import tsx scripts/create-users.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const tripPassword = process.env.TRIP_PASSWORD;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!url || !secret || !tripPassword || !adminPassword) {
  throw new Error('Set VITE_SUPABASE_URL, SUPABASE_SECRET_KEY, TRIP_PASSWORD and ADMIN_PASSWORD in the env file');
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureUser(email: string, password: string, role: 'admin' | null) {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  const existing = data.users.find((u) => u.email === email);
  const attrs = { password, email_confirm: true, app_metadata: { role } };
  const res = existing
    ? await admin.auth.admin.updateUserById(existing.id, attrs)
    : await admin.auth.admin.createUser({ email, ...attrs });
  if (res.error) throw res.error;
  console.log(`${existing ? 'Updated' : 'Created'} ${email}`);
}

await ensureUser(process.env.VITE_TRIP_EMAIL ?? 'trip@example.com', tripPassword, null);
await ensureUser(process.env.VITE_ADMIN_EMAIL ?? 'admin@example.com', adminPassword, 'admin');
```

`scripts/seed.ts`:
```ts
// DEV/TEST ONLY — wipes ALL data, then seeds a demo event. Never run against production.
// Usage: npm run seed -- --yes-wipe
import { createClient } from '@supabase/supabase-js';

if (!process.argv.includes('--yes-wipe')) {
  console.error('Refusing to run without --yes-wipe (this deletes every event, player, course and score).');
  process.exit(1);
}
const url = process.env.VITE_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error('Set VITE_SUPABASE_URL and SUPABASE_SECRET_KEY');
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function run<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}
const NONE = '00000000-0000-0000-0000-000000000000';

await run(db.from('events').delete().neq('id', NONE)); // cascades rounds, groups, scores, results
await run(db.from('players').delete().neq('id', NONE));
await run(db.from('courses').delete().neq('id', NONE));

const names = [
  'Alex Adams', 'Ben Brown', 'Chris Clark', 'Dan Davies', 'Ed Evans', 'Finn Fox',
  'Gus Green', 'Harry Hill', 'Ian Irwin', 'Jack Jones', 'Kyle King', 'Liam Lee',
];
// Group 1 players all play off 10 so e2e tests get no strokes there.
const handicaps = [10, 10, 6, 14, 3, 22, 10, 10, 8, 12, 5, 18];
const players = await run(
  db
    .from('players')
    .insert(names.map((name, i) => ({ name, short_name: name.split(' ')[1], default_handicap: handicaps[i] })))
    .select(),
);
const byName = (n: string) => players.find((p: { name: string }) => p.name === n).id as string;

const course = await run(db.from('courses').insert({ name: 'Seed Links' }).select().single());
const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const sis = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 16, 2, 12, 6, 10, 18, 4, 14];
await run(
  db.from('course_holes').insert(pars.map((par, i) => ({ course_id: course.id, hole: i + 1, par, stroke_index: sis[i] }))),
);

const event = await run(
  db.from('events').insert({ name: 'Demo Cup', team_a_name: 'Team Blue', team_b_name: 'Team Red', is_active: true }).select().single(),
);
const teamA = names.slice(0, 6);
const teamB = names.slice(6);
await run(
  db.from('event_players').insert(
    names.map((n, i) => ({ event_id: event.id, player_id: byName(n), team: i < 6 ? 'A' : 'B', handicap: handicaps[i] })),
  ),
);

const today = new Date().toLocaleDateString('en-CA');
const rounds = await run(
  db
    .from('rounds')
    .insert([
      { event_id: event.id, course_id: course.id, round_no: 1, name: 'Day 1', date: today },
      { event_id: event.id, course_id: course.id, round_no: 2, name: 'Day 2' },
      { event_id: event.id, course_id: course.id, round_no: 3, name: 'Day 3', singles_enabled: true },
    ])
    .select(),
);

for (const round of rounds) {
  for (let g = 0; g < 3; g++) {
    const group = await run(
      db.from('groups').insert({ round_id: round.id, group_no: g + 1, tee_time: `09:${String(g * 10).padStart(2, '0')}` }).select().single(),
    );
    const [a1, a2] = teamA.slice(g * 2, g * 2 + 2).sort((x, y) => handicaps[names.indexOf(x)] - handicaps[names.indexOf(y)]);
    const [b1, b2] = teamB.slice(g * 2, g * 2 + 2).sort((x, y) => handicaps[names.indexOf(x)] - handicaps[names.indexOf(y)]);
    await run(
      db.from('group_players').insert([
        { group_id: group.id, slot: 'A1', player_id: byName(a1) },
        { group_id: group.id, slot: 'A2', player_id: byName(a2) },
        { group_id: group.id, slot: 'B1', player_id: byName(b1) },
        { group_id: group.id, slot: 'B2', player_id: byName(b2) },
      ]),
    );
  }
}
console.log('Seeded Demo Cup: 12 players, 3 rounds, 9 groups.');
```

- [ ] **Step 7: Create the dev users, seed, and try logging in**

Run: `npm run users && npm run seed -- --yes-wipe`
Expected: "Created trip@example.com", "Created admin@example.com", "Seeded Demo Cup…".

Run: `npm run dev`. Open http://localhost:5173 at 390px width (or use the `run` skill).
- A wrong password shows "Wrong password".
- The trip password shows "Signed in".
- "Sign out", then Admin login with the admin password, shows "Signed in (admin)" and an Admin tab.

- [ ] **Step 8: Check types and build**

Run: `npm run check && npm test && npm run build`
Expected: 0 errors; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: supabase client, password login, hash router, dev scripts"
```

---

### Task 7: Offline outbox and score merging

**Files:**
- Create: `src/lib/data/types.ts`, `src/lib/data/outbox.ts`, `src/lib/data/merge.ts`
- Test: `src/lib/data/outbox.test.ts`, `src/lib/data/merge.test.ts`

**Interfaces:**
- Produces:
  - DB row types `PlayerRow`, `CourseRow`, `CourseHoleRow`, `EventRow`, `EventPlayerRow`, `RoundRow`, `GroupRow`, `GroupPlayerRow`, `ScoreRow`, `MatchResultRow`, and `Snapshot`.
  - `interface PendingScore { roundId; playerId; hole; gross: number | null; pickedUp: boolean; clientUpdatedAt: string }`
  - `type SendResult = 'ok' | 'stale' | 'locked'`
  - `interface OutboxStorage { getAll; get; put; remove }`
  - `pendingKey(p): string`
  - `createOutbox({ storage, send, onChange?, onLocked? })`, returning `{ enqueue(p): Promise<void>; flush(): Promise<'done' | 'busy' | 'failed'>; pending(): Promise<PendingScore[]> }`
  - `rowKey(row)`, `upsertScoreRow(rows, row)`, `removeScoreRow(rows, key)`, `applyPending(rows, pending)`, `hasPendingFor(pending, roundId, playerIds): boolean`

- [ ] **Step 1: Write the row types**

`src/lib/data/types.ts`:
```ts
import type { MatchType, Outcome, Slot, Team } from '../scoring';

export interface PlayerRow { id: string; name: string; short_name: string; default_handicap: number; photo_path: string | null }
export interface CourseRow { id: string; name: string }
export interface CourseHoleRow { course_id: string; hole: number; par: number; stroke_index: number }
export interface EventRow {
  id: string; name: string;
  team_a_name: string; team_a_colour: string;
  team_b_name: string; team_b_colour: string;
  is_active: boolean;
}
export interface EventPlayerRow { event_id: string; player_id: string; team: Team; handicap: number }
export interface RoundRow {
  id: string; event_id: string; course_id: string; round_no: number; date: string | null; name: string;
  allowance_pct: number; better_ball_points: number;
  singles_enabled: boolean; singles_points: number; singles_allowance_pct: number;
}
export interface GroupRow { id: string; round_id: string; group_no: number; tee_time: string | null }
export interface GroupPlayerRow { group_id: string; slot: Slot; player_id: string }
export interface ScoreRow {
  round_id: string; player_id: string; hole: number;
  gross: number | null; picked_up: boolean; client_updated_at: string;
}
export interface MatchResultRow {
  group_id: string; match_type: MatchType; winner: Outcome;
  points_a: number; points_b: number; result_text: string; final_hole: number; confirmed_at: string;
}

/** Everything the app displays for the active event. */
export interface Snapshot {
  event: EventRow | null;
  players: PlayerRow[];
  courses: CourseRow[];
  courseHoles: CourseHoleRow[];
  eventPlayers: EventPlayerRow[];
  rounds: RoundRow[];
  groups: GroupRow[];
  groupPlayers: GroupPlayerRow[];
  scores: ScoreRow[];
  results: MatchResultRow[];
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/data/outbox.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createOutbox, pendingKey, type OutboxStorage, type PendingScore, type SendResult } from './outbox';

function memoryStorage(): OutboxStorage & { map: Map<string, PendingScore> } {
  const map = new Map<string, PendingScore>();
  return {
    map,
    getAll: async () => [...map.values()],
    get: async (k) => map.get(k),
    put: async (p) => { map.set(pendingKey(p), p); },
    remove: async (k) => { map.delete(k); },
  };
}
const p = (hole: number, at: string, gross: number | null = 4): PendingScore => ({
  roundId: 'r', playerId: 'x', hole, gross, pickedUp: false, clientUpdatedAt: at,
});

describe('outbox', () => {
  it('sends queued scores oldest first and empties', async () => {
    const storage = memoryStorage();
    const sent: number[] = [];
    const ob = createOutbox({ storage, send: async (x) => { sent.push(x.hole); return 'ok'; } });
    await ob.enqueue(p(2, '2026-10-01T10:00:02Z'));
    await ob.enqueue(p(1, '2026-10-01T10:00:01Z'));
    expect(await ob.flush()).toBe('done');
    expect(sent).toEqual([1, 2]);
    expect(storage.map.size).toBe(0);
  });

  it('keeps items and reports failure when sending throws', async () => {
    const storage = memoryStorage();
    const ob = createOutbox({ storage, send: async () => { throw new Error('offline'); } });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z'));
    expect(await ob.flush()).toBe('failed');
    expect(storage.map.size).toBe(1);
  });

  it('replaces an older pending entry for the same cell', async () => {
    const storage = memoryStorage();
    const ob = createOutbox({ storage, send: async () => 'ok' });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z', 4));
    await ob.enqueue(p(1, '2026-10-01T10:00:05Z', 6));
    expect((await ob.pending()).map((x) => x.gross)).toEqual([6]);
  });

  it('sends a newer entry queued while an older one was in flight', async () => {
    const storage = memoryStorage();
    const sent: (number | null)[] = [];
    let ob!: ReturnType<typeof createOutbox>;
    const send = async (x: PendingScore): Promise<SendResult> => {
      sent.push(x.gross);
      if (x.gross === 4) await ob.enqueue(p(1, '2026-10-01T10:00:09Z', 5));
      return 'ok';
    };
    ob = createOutbox({ storage, send });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z', 4));
    expect(await ob.flush()).toBe('done');
    expect(sent).toEqual([4, 5]);
    expect(storage.map.size).toBe(0);
  });

  it('drops locked scores and reports them', async () => {
    const storage = memoryStorage();
    const onLocked = vi.fn();
    const ob = createOutbox({ storage, send: async () => 'locked', onLocked });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z'));
    expect(await ob.flush()).toBe('done');
    expect(onLocked).toHaveBeenCalledOnce();
    expect(storage.map.size).toBe(0);
  });

  it('refuses overlapping flushes', async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ob = createOutbox({ storage, send: async () => { await gate; return 'ok'; } });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z'));
    const first = ob.flush();
    expect(await ob.flush()).toBe('busy');
    release();
    expect(await first).toBe('done');
  });

  it('reports the pending list on change', async () => {
    const onChange = vi.fn();
    const ob = createOutbox({ storage: memoryStorage(), send: async () => 'ok', onChange });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z'));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ hole: 1 })]);
    await ob.flush();
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
```

`src/lib/data/merge.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { applyPending, hasPendingFor, removeScoreRow, upsertScoreRow } from './merge';
import type { PendingScore } from './outbox';
import type { ScoreRow } from './types';

const row = (hole: number, gross: number | null, at: string): ScoreRow => ({
  round_id: 'r', player_id: 'x', hole, gross, picked_up: gross === null, client_updated_at: at,
});
const pend = (hole: number, gross: number | null, at: string, pickedUp = false): PendingScore => ({
  roundId: 'r', playerId: 'x', hole, gross, pickedUp, clientUpdatedAt: at,
});

describe('score merging', () => {
  it('upserts by round/player/hole', () => {
    const rows = upsertScoreRow([row(1, 4, '2026-10-01T10:00:00Z')], row(1, 5, '2026-10-01T10:01:00Z'));
    expect(rows).toEqual([row(1, 5, '2026-10-01T10:01:00Z')]);
  });

  it('removes by key', () => {
    expect(removeScoreRow([row(1, 4, 'x'), row(2, 4, 'x')], { round_id: 'r', player_id: 'x', hole: 1 })).toEqual([row(2, 4, 'x')]);
  });

  it('lays newer pending entries over server rows', () => {
    const rows = applyPending([row(1, 4, '2026-10-01T10:00:00+00:00')], [pend(1, 6, '2026-10-01T10:05:00.000Z')]);
    expect(rows[0].gross).toBe(6);
  });

  it('never lets an older pending entry replace a newer server row', () => {
    const rows = applyPending([row(1, 4, '2026-10-01T10:05:00+00:00')], [pend(1, 6, '2026-10-01T10:00:00.000Z')]);
    expect(rows[0].gross).toBe(4);
  });

  it('applies a pending clear as a removal', () => {
    expect(applyPending([row(1, 4, '2026-10-01T10:00:00Z')], [pend(1, null, '2026-10-01T10:05:00Z')])).toEqual([]);
  });

  it('applies a pending pick-up', () => {
    const rows = applyPending([], [pend(3, null, '2026-10-01T10:05:00Z', true)]);
    expect(rows).toEqual([{ round_id: 'r', player_id: 'x', hole: 3, gross: null, picked_up: true, client_updated_at: '2026-10-01T10:05:00Z' }]);
  });

  it('detects pending scores for a match’s players', () => {
    const pending = [pend(1, 4, 'x')];
    expect(hasPendingFor(pending, 'r', ['x', 'y'])).toBe(true);
    expect(hasPendingFor(pending, 'r', ['y'])).toBe(false);
    expect(hasPendingFor(pending, 'other', ['x'])).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run src/lib/data`
Expected: FAIL, unresolved `./outbox` and `./merge`.

- [ ] **Step 4: Implement**

`src/lib/data/outbox.ts`:
```ts
export interface PendingScore {
  roundId: string;
  playerId: string;
  hole: number;
  gross: number | null;
  pickedUp: boolean;
  clientUpdatedAt: string;
}

export type SendResult = 'ok' | 'stale' | 'locked';

export interface OutboxStorage {
  getAll(): Promise<PendingScore[]>;
  get(key: string): Promise<PendingScore | undefined>;
  put(p: PendingScore): Promise<void>;
  remove(key: string): Promise<void>;
}

export const pendingKey = (p: Pick<PendingScore, 'roundId' | 'playerId' | 'hole'>) => `${p.roundId}:${p.playerId}:${p.hole}`;

const byTime = (a: PendingScore, b: PendingScore) => Date.parse(a.clientUpdatedAt) - Date.parse(b.clientUpdatedAt);

export function createOutbox(opts: {
  storage: OutboxStorage;
  send: (p: PendingScore) => Promise<SendResult>;
  onChange?: (pending: PendingScore[]) => void;
  onLocked?: (p: PendingScore) => void;
}) {
  const { storage, send, onChange, onLocked } = opts;
  let flushing = false;

  const pending = async () => (await storage.getAll()).sort(byTime);
  const notify = async () => onChange?.(await pending());

  async function enqueue(p: PendingScore) {
    await storage.put(p); // same key -> the newer entry replaces the older one
    await notify();
  }

  async function flush(): Promise<'done' | 'busy' | 'failed'> {
    if (flushing) return 'busy';
    flushing = true;
    try {
      for (;;) {
        const items = await pending();
        if (items.length === 0) return 'done';
        for (const p of items) {
          let result: SendResult;
          try {
            result = await send(p);
          } catch {
            return 'failed';
          }
          // Only remove if nothing newer was queued for this cell while we were sending.
          const current = await storage.get(pendingKey(p));
          if (current && current.clientUpdatedAt === p.clientUpdatedAt) await storage.remove(pendingKey(p));
          if (result === 'locked') onLocked?.(p);
        }
      }
    } finally {
      flushing = false;
      await notify();
    }
  }

  return { enqueue, flush, pending };
}
```

`src/lib/data/merge.ts`:
```ts
import type { PendingScore } from './outbox';
import type { ScoreRow } from './types';

type Key = Pick<ScoreRow, 'round_id' | 'player_id' | 'hole'>;

export const rowKey = (r: Key) => `${r.round_id}:${r.player_id}:${r.hole}`;

export function upsertScoreRow(rows: ScoreRow[], row: ScoreRow): ScoreRow[] {
  const k = rowKey(row);
  return [...rows.filter((r) => rowKey(r) !== k), row];
}

export function removeScoreRow(rows: ScoreRow[], key: Key): ScoreRow[] {
  const k = rowKey(key);
  return rows.filter((r) => rowKey(r) !== k);
}

/** Overlay not-yet-sent local edits, unless the server already has something newer. */
export function applyPending(rows: ScoreRow[], pending: PendingScore[]): ScoreRow[] {
  let out = rows;
  for (const p of pending) {
    const row: ScoreRow = {
      round_id: p.roundId,
      player_id: p.playerId,
      hole: p.hole,
      gross: p.gross,
      picked_up: p.pickedUp,
      client_updated_at: p.clientUpdatedAt,
    };
    const existing = out.find((r) => rowKey(r) === rowKey(row));
    if (existing && Date.parse(existing.client_updated_at) >= Date.parse(p.clientUpdatedAt)) continue;
    out = p.gross === null && !p.pickedUp ? removeScoreRow(out, row) : upsertScoreRow(out, row);
  }
  return out;
}

export function hasPendingFor(pending: PendingScore[], roundId: string, playerIds: string[]): boolean {
  return pending.some((p) => p.roundId === roundId && playerIds.includes(p.playerId));
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run src/lib/data`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data
git commit -m "feat(data): offline score outbox and merge helpers"
```

---

### Task 8: Event view builder

**Files:**
- Create: `src/lib/view.ts`
- Test: `src/lib/view.test.ts`

**Interfaces:**
- Consumes: the scoring module (Tasks 2–4) and `Snapshot` and the row types (Task 7).
- Produces:
  - `interface MatchView { def: MatchDef; state: MatchState; result: ConfirmedResult | null }`
  - `interface GroupView { group: GroupRow; slots: Partial<Record<Slot, string>>; matches: MatchView[]; scores: ScoreIndex }`
  - `interface RoundView { round: RoundRow; settings: RoundSettings; holes: HoleInfo[]; groups: GroupView[]; completed: number; totalMatches: number }`
  - `interface EventView { event: EventRow; rounds: RoundView[]; tracker: Tracker; teamOf: Record<string, Team>; handicapOf: Record<string, number> }`
  - `buildEventView(s: Snapshot): EventView | null`
  - `settingsOf(r: RoundRow): RoundSettings`
  - `defaultRoundId(rounds: RoundRow[], today: string): string | null`
  - `findGroup(view: EventView, groupId: string): { round: RoundView; group: GroupView } | null`
  - `firstIncompleteHole(group: GroupView, holes: HoleInfo[]): number`
  - `matchLabel(type: MatchType): string`
  - `today(): string` (local `YYYY-MM-DD`)

- [ ] **Step 1: Write the failing tests**

`src/lib/view.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildEventView, defaultRoundId, findGroup, firstIncompleteHole } from './view';
import type { RoundRow, ScoreRow, Snapshot } from './data/types';
import type { Slot, Team } from './scoring';

const baseRound: RoundRow = {
  id: 'r1', event_id: 'e', course_id: 'c', round_no: 1, date: '2026-10-01', name: 'Day 1',
  allowance_pct: 90, better_ball_points: 1, singles_enabled: false, singles_points: 0.5, singles_allowance_pct: 90,
};

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    event: { id: 'e', name: 'Cup', team_a_name: 'Blue', team_a_colour: '#00f', team_b_name: 'Red', team_b_colour: '#f00', is_active: true },
    players: [],
    courses: [{ id: 'c', name: 'Links' }],
    courseHoles: Array.from({ length: 18 }, (_, i) => ({ course_id: 'c', hole: i + 1, par: 4, stroke_index: i + 1 })),
    eventPlayers: ['a1', 'a2', 'b1', 'b2'].map((id) => ({ event_id: 'e', player_id: id, team: id[0].toUpperCase() as Team, handicap: 10 })),
    rounds: [baseRound],
    groups: [{ id: 'g1', round_id: 'r1', group_no: 1, tee_time: '09:00:00' }],
    groupPlayers: (['A1', 'A2', 'B1', 'B2'] as Slot[]).map((slot) => ({ group_id: 'g1', slot, player_id: slot.toLowerCase() })),
    scores: [],
    results: [],
    ...over,
  };
}

const hole1AWins: ScoreRow[] = ['a1', 'a2', 'b1', 'b2'].map((p) => ({
  round_id: 'r1', player_id: p, hole: 1, gross: p.startsWith('a') ? 4 : 5, picked_up: false, client_updated_at: '2026-10-01T09:10:00Z',
}));

describe('buildEventView', () => {
  it('is null without an active event', () => {
    expect(buildEventView(snapshot({ event: null }))).toBeNull();
  });

  it('derives match state and the tracker', () => {
    const v = buildEventView(snapshot({ scores: hole1AWins }))!;
    const m = v.rounds[0].groups[0].matches[0];
    expect(m.state).toMatchObject({ statusText: '1 UP', thru: 1 });
    expect(v.tracker).toMatchObject({ confirmedA: 0, projectedA: 1, projectedB: 0, total: 1, toWin: 1 });
    expect(v.teamOf).toMatchObject({ a1: 'A', b2: 'B' });
  });

  it('uses the confirmed result over current scores', () => {
    const v = buildEventView(
      snapshot({
        scores: hole1AWins,
        results: [{ group_id: 'g1', match_type: 'better_ball', winner: 'B', points_a: 0, points_b: 1, result_text: '2&1', final_hole: 17, confirmed_at: 'x' }],
      }),
    )!;
    expect(v.tracker).toMatchObject({ confirmedB: 1, projectedB: 1, projectedA: 0 });
    expect(v.rounds[0].completed).toBe(1);
    expect(v.rounds[0].groups[0].matches[0].result).toMatchObject({ winner: 'B', pointsB: 1, finalHole: 17 });
  });

  it('counts singles points in the total available', () => {
    const v = buildEventView(snapshot({ rounds: [baseRound, { ...baseRound, id: 'r2', round_no: 2, singles_enabled: true }] }))!;
    expect(v.tracker.total).toBe(3);
    expect(v.tracker.toWin).toBe(2);
  });

  it('survives an incomplete group', () => {
    const s = snapshot();
    const v = buildEventView({ ...s, groupPlayers: s.groupPlayers.slice(0, 3) })!;
    expect(v.rounds[0].groups[0].matches).toEqual([]);
    expect(v.tracker.total).toBe(1);
  });

  it('finds groups and the first incomplete hole', () => {
    const v = buildEventView(snapshot({ scores: hole1AWins }))!;
    const found = findGroup(v, 'g1')!;
    expect(found.round.round.id).toBe('r1');
    expect(firstIncompleteHole(found.group, found.round.holes)).toBe(2);
    expect(findGroup(v, 'nope')).toBeNull();
  });
});

describe('defaultRoundId', () => {
  const r = (id: string, date: string | null, round_no: number): RoundRow => ({ ...baseRound, id, date, round_no });
  const rounds = [r('d1', '2026-10-01', 1), r('d2', '2026-10-02', 2), r('d3', '2026-10-03', 3)];
  it('picks today’s round', () => expect(defaultRoundId(rounds, '2026-10-02')).toBe('d2'));
  it('picks the next round before the trip', () => expect(defaultRoundId(rounds, '2026-09-27')).toBe('d1'));
  it('picks the last round after the trip', () => expect(defaultRoundId(rounds, '2026-11-01')).toBe('d3'));
  it('is null with no rounds', () => expect(defaultRoundId([], '2026-10-01')).toBeNull());
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/lib/view.test.ts`
Expected: FAIL, unresolved `./view`.

- [ ] **Step 3: Implement `src/lib/view.ts`**

```ts
import {
  buildMatches,
  computeMatchState,
  computeTracker,
  indexScores,
  roundPointsAvailable,
  scoreKey,
  type ConfirmedResult,
  type HoleInfo,
  type MatchDef,
  type MatchState,
  type MatchType,
  type RoundSettings,
  type ScoreIndex,
  type Slot,
  type Team,
  type Tracker,
} from './scoring';
import type { EventRow, GroupRow, RoundRow, Snapshot } from './data/types';

export interface MatchView { def: MatchDef; state: MatchState; result: ConfirmedResult | null }
export interface GroupView { group: GroupRow; slots: Partial<Record<Slot, string>>; matches: MatchView[]; scores: ScoreIndex }
export interface RoundView {
  round: RoundRow; settings: RoundSettings; holes: HoleInfo[]; groups: GroupView[]; completed: number; totalMatches: number;
}
export interface EventView {
  event: EventRow; rounds: RoundView[]; tracker: Tracker; teamOf: Record<string, Team>; handicapOf: Record<string, number>;
}

// Postgres numeric columns can arrive as strings; Number() normalises them.
export function settingsOf(r: RoundRow): RoundSettings {
  return {
    allowancePct: Number(r.allowance_pct),
    betterBallPoints: Number(r.better_ball_points),
    singlesEnabled: r.singles_enabled,
    singlesPoints: Number(r.singles_points),
    singlesAllowancePct: Number(r.singles_allowance_pct),
  };
}

export function buildEventView(s: Snapshot): EventView | null {
  if (!s.event) return null;
  const handicapOf = Object.fromEntries(s.eventPlayers.map((p) => [p.player_id, Number(p.handicap)]));
  const teamOf = Object.fromEntries(s.eventPlayers.map((p) => [p.player_id, p.team])) as Record<string, Team>;
  const groupCount = Math.floor(s.eventPlayers.length / 4);
  const everyMatch: MatchView[] = [];
  let total = 0;

  const rounds = [...s.rounds]
    .sort((a, b) => a.round_no - b.round_no)
    .map((round): RoundView => {
      const settings = settingsOf(round);
      total += roundPointsAvailable(settings, groupCount);
      const holes = s.courseHoles
        .filter((h) => h.course_id === round.course_id)
        .map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index }))
        .sort((a, b) => a.hole - b.hole);
      const scores = indexScores(
        s.scores
          .filter((x) => x.round_id === round.id)
          .map((x) => ({ playerId: x.player_id, hole: x.hole, gross: x.gross, pickedUp: x.picked_up })),
      );
      const groups = s.groups
        .filter((g) => g.round_id === round.id)
        .sort((a, b) => a.group_no - b.group_no)
        .map((group): GroupView => {
          const members = s.groupPlayers.filter((gp) => gp.group_id === group.id);
          const slots = Object.fromEntries(members.map((gp) => [gp.slot, gp.player_id])) as Partial<Record<Slot, string>>;
          const defs = buildMatches(
            group.id,
            members.map((gp) => ({ slot: gp.slot, playerId: gp.player_id, handicap: handicapOf[gp.player_id] ?? 0 })),
            settings,
          );
          const matches = defs.map((def): MatchView => {
            const row = s.results.find((r) => r.group_id === group.id && r.match_type === def.type);
            const result: ConfirmedResult | null = row
              ? {
                  groupId: row.group_id,
                  matchType: row.match_type,
                  winner: row.winner,
                  pointsA: Number(row.points_a),
                  pointsB: Number(row.points_b),
                  resultText: row.result_text,
                  finalHole: row.final_hole,
                }
              : null;
            return { def, state: computeMatchState(def, holes, scores), result };
          });
          everyMatch.push(...matches);
          return { group, slots, matches, scores };
        });
      const ms = groups.flatMap((g) => g.matches);
      return { round, settings, holes, groups, completed: ms.filter((m) => m.result).length, totalMatches: ms.length };
    });

  return { event: s.event, rounds, tracker: computeTracker(everyMatch, total), teamOf, handicapOf };
}

export function defaultRoundId(rounds: RoundRow[], todayIso: string): string | null {
  if (rounds.length === 0) return null;
  const sorted = [...rounds].sort((a, b) => a.round_no - b.round_no);
  return (
    sorted.find((r) => r.date === todayIso)?.id ??
    sorted.find((r) => r.date !== null && r.date > todayIso)?.id ??
    sorted[sorted.length - 1].id
  );
}

export function findGroup(view: EventView, groupId: string): { round: RoundView; group: GroupView } | null {
  for (const round of view.rounds) {
    const group = round.groups.find((g) => g.group.id === groupId);
    if (group) return { round, group };
  }
  return null;
}

export function firstIncompleteHole(group: GroupView, holes: HoleInfo[]): number {
  const ids = Object.values(group.slots).filter((x): x is string => !!x);
  for (const h of holes) {
    if (!ids.every((id) => group.scores.has(scoreKey(id, h.hole)))) return h.hole;
  }
  return holes[holes.length - 1]?.hole ?? 1;
}

const LABELS: Record<MatchType, string> = {
  better_ball: 'Fourball',
  low_singles: 'Low singles',
  high_singles: 'High singles',
};
export const matchLabel = (type: MatchType) => LABELS[type];

export const today = () => new Date().toLocaleDateString('en-CA');
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run src/lib/view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/view.ts src/lib/view.test.ts
git commit -m "feat: event view builder deriving matches, states and tracker"
```

---
### Task 9: Live data store and the leaderboard

**Files:**
- Create: `src/lib/data/store.svelte.ts`, `src/components/Avatar.svelte`, `src/components/TeamTracker.svelte`, `src/components/MatchCard.svelte`, `src/routes/Leaderboard.svelte`
- Modify: `src/App.svelte` (replace)

**Interfaces:**
- Consumes: `supabase` and `must` (Task 6); outbox and merge (Task 7); `buildEventView`, `defaultRoundId`, `today` and `matchLabel` (Task 8); `formatPoints` (Task 4).
- Produces from `store.svelte.ts`:
  - `db`: a `$state` holding `Snapshot & { loaded; error; notice; pending: PendingScore[]; photoUrls: Record<path, url> }`
  - `loadAll(): Promise<void>`
  - `startData()` and `stopData()`
  - `enterScore(p: PendingScore): Promise<void>`
  - `flushOutbox(): Promise<boolean>` (true when the outbox is empty)
  - `photoUrl(playerId): string | null`, `playerName(id): string`, `playerShort(id): string`
- Produces components:
  - `<Avatar name url colour size />`
  - `<TeamTracker tracker event />`
  - `<MatchCard mv groupNo teeTime? link? />`
  - The `data-testid`s used by the e2e tests: `tracker`, `proj-a`, `proj-b`, `conf-a`, `conf-b`, `match-card` and `status`.

- [ ] **Step 1: Write the store**

`src/lib/data/store.svelte.ts`:
```ts
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createStore, del, get, set, values } from 'idb-keyval';
import { must, supabase } from '../supabase';
import { applyPending, removeScoreRow, upsertScoreRow } from './merge';
import { createOutbox, pendingKey, type OutboxStorage, type PendingScore, type SendResult } from './outbox';
import type {
  CourseHoleRow, CourseRow, EventPlayerRow, EventRow, GroupPlayerRow, GroupRow,
  MatchResultRow, PlayerRow, RoundRow, ScoreRow, Snapshot,
} from './types';

const empty = (): Snapshot => ({
  event: null, players: [], courses: [], courseHoles: [], eventPlayers: [],
  rounds: [], groups: [], groupPlayers: [], scores: [], results: [],
});

export const db = $state({
  ...empty(),
  loaded: false,
  error: null as string | null,
  notice: null as string | null,
  pending: [] as PendingScore[],
  photoUrls: {} as Record<string, string>,
});

// ---- offline outbox (IndexedDB) ----
const idb = createStore('golf-outbox', 'pending');
const storage: OutboxStorage = {
  getAll: () => values<PendingScore>(idb),
  get: (k) => get<PendingScore>(k, idb),
  put: (p) => set(pendingKey(p), p, idb),
  remove: (k) => del(k, idb),
};

async function send(p: PendingScore): Promise<SendResult> {
  return must(
    supabase.rpc('upsert_score', {
      p_round_id: p.roundId,
      p_player_id: p.playerId,
      p_hole: p.hole,
      p_gross: p.gross,
      p_picked_up: p.pickedUp,
      p_client_updated_at: p.clientUpdatedAt,
    }),
  ) as Promise<SendResult>;
}

const outbox = createOutbox({
  storage,
  send,
  onChange: (pending) => {
    db.pending = pending;
  },
  onLocked: (p) => {
    db.notice = `Hole ${p.hole} is locked because its match was confirmed, so that change wasn't saved.`;
    void loadAll();
  },
});

let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 2000;

export async function flushOutbox(): Promise<boolean> {
  clearTimeout(retryTimer);
  const result = await outbox.flush();
  if (result === 'done') retryDelay = 2000;
  if (result === 'failed') {
    retryTimer = setTimeout(() => void flushOutbox(), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  }
  return db.pending.length === 0;
}

export async function enterScore(p: PendingScore) {
  db.pending = [...db.pending.filter((x) => pendingKey(x) !== pendingKey(p)), p];
  db.scores = applyPending(db.scores, [p]);
  await outbox.enqueue(p);
  void flushOutbox();
}

// ---- loading ----
let loading: Promise<void> | null = null;

export function loadAll(): Promise<void> {
  loading ??= doLoad().finally(() => (loading = null));
  return loading;
}

async function doLoad() {
  try {
    const [events, players, courses, courseHoles] = await Promise.all([
      must(supabase.from('events').select('*').eq('is_active', true).limit(1)) as Promise<EventRow[]>,
      must(supabase.from('players').select('*').order('name')) as Promise<PlayerRow[]>,
      must(supabase.from('courses').select('*').order('name')) as Promise<CourseRow[]>,
      must(supabase.from('course_holes').select('*')) as Promise<CourseHoleRow[]>,
    ]);
    const event = events[0] ?? null;
    let eventPlayers: EventPlayerRow[] = [];
    let rounds: RoundRow[] = [];
    let groups: GroupRow[] = [];
    let groupPlayers: GroupPlayerRow[] = [];
    let scores: ScoreRow[] = [];
    let results: MatchResultRow[] = [];
    if (event) {
      [eventPlayers, rounds] = await Promise.all([
        must(supabase.from('event_players').select('*').eq('event_id', event.id)) as Promise<EventPlayerRow[]>,
        must(supabase.from('rounds').select('*').eq('event_id', event.id)) as Promise<RoundRow[]>,
      ]);
      const roundIds = rounds.map((r) => r.id);
      if (roundIds.length) {
        // 3 rounds x 12 players x 18 holes = 648 score rows, under the API's 1000-row default.
        [groups, scores] = await Promise.all([
          must(supabase.from('groups').select('*').in('round_id', roundIds)) as Promise<GroupRow[]>,
          must(supabase.from('scores').select('*').in('round_id', roundIds)) as Promise<ScoreRow[]>,
        ]);
        const groupIds = groups.map((g) => g.id);
        if (groupIds.length) {
          [groupPlayers, results] = await Promise.all([
            must(supabase.from('group_players').select('*').in('group_id', groupIds)) as Promise<GroupPlayerRow[]>,
            must(supabase.from('match_results').select('*').in('group_id', groupIds)) as Promise<MatchResultRow[]>,
          ]);
        }
      }
    }
    const pending = await outbox.pending();
    Object.assign(db, {
      event, players, courses, courseHoles, eventPlayers, rounds, groups, groupPlayers, results,
      scores: applyPending(scores, pending),
      pending,
      loaded: true,
      error: null,
    });
    await refreshPhotoUrls();
  } catch (e) {
    db.error = e instanceof Error ? e.message : String(e);
  }
}

async function refreshPhotoUrls() {
  const paths = db.players.map((p) => p.photo_path).filter((p): p is string => !!p);
  const kept = Object.fromEntries(Object.entries(db.photoUrls).filter(([path]) => paths.includes(path)));
  const missing = paths.filter((p) => !kept[p]);
  if (missing.length) {
    const signed = await must(supabase.storage.from('player-photos').createSignedUrls(missing, 60 * 60 * 24));
    for (const s of signed) if (s.path && s.signedUrl) kept[s.path] = s.signedUrl;
  }
  db.photoUrls = kept;
}

export function photoUrl(playerId: string): string | null {
  const path = db.players.find((p) => p.id === playerId)?.photo_path;
  return path ? (db.photoUrls[path] ?? null) : null;
}
export const playerName = (id: string) => db.players.find((p) => p.id === id)?.name ?? '?';
export const playerShort = (id: string) => db.players.find((p) => p.id === id)?.short_name ?? '?';

// ---- realtime ----
const SETUP_TABLES = ['players', 'courses', 'course_holes', 'events', 'event_players', 'rounds', 'groups', 'group_players'];
let channel: RealtimeChannel | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void loadAll(), 300);
}

function onScore(payload: { eventType: string; new: unknown; old: unknown }) {
  if (payload.eventType === 'DELETE') {
    db.scores = applyPending(removeScoreRow(db.scores, payload.old as ScoreRow), db.pending);
    return;
  }
  const row = payload.new as ScoreRow;
  if (!db.rounds.some((r) => r.id === row.round_id)) return;
  db.scores = applyPending(upsertScoreRow(db.scores, row), db.pending);
}

function onResult(payload: { eventType: string; new: unknown; old: unknown }) {
  const key = (payload.eventType === 'DELETE' ? payload.old : payload.new) as MatchResultRow;
  const others = db.results.filter((r) => !(r.group_id === key.group_id && r.match_type === key.match_type));
  if (payload.eventType === 'DELETE') db.results = others;
  else if (db.groups.some((g) => g.id === key.group_id)) db.results = [...others, key];
}

function onVisible() {
  if (document.visibilityState === 'visible') {
    void loadAll();
    void flushOutbox();
  }
}
function onOnline() {
  void loadAll();
  void flushOutbox();
}

export function startData() {
  void loadAll().then(() => flushOutbox());
  channel = supabase
    .channel('golf-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, onScore)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_results' }, onResult);
  for (const table of SETUP_TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload);
  }
  // Every (re)subscription catches up on anything missed while disconnected.
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') void loadAll();
  });
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  pollTimer = setInterval(() => {
    if (db.pending.length) void flushOutbox();
  }, 15_000);
}

export function stopData() {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', onOnline);
  clearInterval(pollTimer);
  clearTimeout(retryTimer);
  Object.assign(db, empty(), { loaded: false, error: null });
}
```

- [ ] **Step 2: Write the components**

`src/components/Avatar.svelte`:
```svelte
<script lang="ts">
  let { name, url = null, colour, size = 48 }: { name: string; url?: string | null; colour: string; size?: number } = $props();
  const initials = $derived(
    name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
  );
</script>

<span class="avatar" style="--c:{colour};--s:{size}px">
  {#if url}
    <img src={url} alt={name} />
  {:else}
    <span class="initials">{initials}</span>
  {/if}
</span>

<style>
  .avatar {
    width: var(--s); height: var(--s); flex: none; border-radius: 50%;
    border: 3px solid var(--c); background: var(--c); overflow: hidden;
    display: inline-grid; place-items: center; box-sizing: border-box;
  }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .initials { color: #fff; font-weight: 700; font-size: calc(var(--s) * 0.36); }
</style>
```

`src/components/TeamTracker.svelte`:
```svelte
<script lang="ts">
  import { formatPoints, type Tracker } from '../lib/scoring';
  import type { EventRow } from '../lib/data/types';

  let { tracker, event }: { tracker: Tracker; event: EventRow } = $props();
  const pct = (n: number) => (tracker.total ? (n / tracker.total) * 100 : 0);
</script>

<section class="tracker card" data-testid="tracker">
  <div class="bar" aria-hidden="true">
    <div class="seg solid a" style="left:0;width:{pct(tracker.confirmedA)}%"></div>
    <div class="seg hatch a" style="left:{pct(tracker.confirmedA)}%;width:{pct(tracker.projectedA - tracker.confirmedA)}%"></div>
    <div class="seg solid b" style="right:0;width:{pct(tracker.confirmedB)}%"></div>
    <div class="seg hatch b" style="right:{pct(tracker.confirmedB)}%;width:{pct(tracker.projectedB - tracker.confirmedB)}%"></div>
    <div class="mid"></div>
  </div>
  <div class="teams">
    <div>
      <strong class="name" style="color:var(--team-a)">{event.team_a_name}</strong>
      <div class="big" style="color:var(--team-a)"><span data-testid="proj-a">{formatPoints(tracker.projectedA)}</span> <small>projected</small></div>
      <div class="muted small"><span data-testid="conf-a">{formatPoints(tracker.confirmedA)}</span> confirmed</div>
    </div>
    <div class="right">
      <strong class="name" style="color:var(--team-b)">{event.team_b_name}</strong>
      <div class="big" style="color:var(--team-b)"><span data-testid="proj-b">{formatPoints(tracker.projectedB)}</span> <small>projected</small></div>
      <div class="muted small"><span data-testid="conf-b">{formatPoints(tracker.confirmedB)}</span> confirmed</div>
    </div>
  </div>
  <p class="towin muted small">{formatPoints(tracker.toWin)} to win · {formatPoints(tracker.total)} points available</p>
</section>

<style>
  .bar { position: relative; height: 22px; border-radius: 11px; background: var(--line); overflow: hidden; margin-bottom: 12px; }
  .seg { position: absolute; top: 0; bottom: 0; transition: width 0.4s, left 0.4s, right 0.4s; }
  .solid.a { background: var(--team-a); }
  .solid.b { background: var(--team-b); }
  .hatch.a { background: repeating-linear-gradient(135deg, var(--team-a) 0 6px, color-mix(in srgb, var(--team-a) 30%, white) 6px 12px); }
  .hatch.b { background: repeating-linear-gradient(135deg, var(--team-b) 0 6px, color-mix(in srgb, var(--team-b) 30%, white) 6px 12px); }
  .mid { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 3px; margin-left: -1.5px; background: var(--text); }
  .teams { display: flex; justify-content: space-between; gap: 12px; }
  .right { text-align: right; }
  .name { text-transform: uppercase; letter-spacing: 0.02em; }
  .big { font-size: 1.6rem; font-weight: 800; }
  .big small { font-size: 0.8rem; font-weight: 600; }
  .towin { text-align: center; margin: 10px 0 0; }
</style>
```

`src/components/MatchCard.svelte`:
```svelte
<script lang="ts">
  import Avatar from './Avatar.svelte';
  import { photoUrl, playerShort } from '../lib/data/store.svelte';
  import { matchLabel, type MatchView } from '../lib/view';

  let { mv, groupNo, teeTime = null, link = true }: { mv: MatchView; groupNo: number; teeTime?: string | null; link?: boolean } = $props();

  const s = $derived(mv.state);
  const lead = $derived(mv.result ? (mv.result.winner === 'A' ? 1 : mv.result.winner === 'B' ? -1 : 0) : s.lead);
  const colour = $derived(lead > 0 ? 'var(--team-a)' : lead < 0 ? 'var(--team-b)' : 'var(--muted)');
  const status = $derived(mv.result ? mv.result.resultText : s.statusText);
  const sub = $derived(
    mv.result ? '' : s.decided ? 'Awaiting confirmation' : s.started ? `THRU ${s.thru}${s.dormie ? ' · DORMIE' : ''}` : teeTime ? `Tee ${teeTime.slice(0, 5)}` : '',
  );
  const badge = $derived(mv.result ? 'FINAL' : s.decided ? 'CONFIRM' : s.started && s.lead !== 0 ? 'LEADS' : null);
</script>

<svelte:element
  this={link ? 'a' : 'div'}
  class="card match"
  href={link ? `#/match/${mv.def.groupId}/${mv.def.type}` : undefined}
  data-testid="match-card"
  data-match-id={mv.def.id}
>
  <header>
    <span class="muted small">{matchLabel(mv.def.type)} · Group {groupNo}</span>
    {#if badge}<span class="badge" style="background:{colour}">{badge}</span>{/if}
  </header>
  <div class="body">
    <div class="side">
      <div class="faces">
        {#each mv.def.sideA as id (id)}<Avatar name={playerShort(id)} url={photoUrl(id)} colour="var(--team-a)" size={44} />{/each}
      </div>
      {#each mv.def.sideA as id (id)}<div class="name">{playerShort(id)}</div>{/each}
    </div>
    <div class="status" style="color:{colour}">
      <strong data-testid="status">{status}</strong>
      {#if sub}<small class="muted">{sub}</small>{/if}
    </div>
    <div class="side right">
      <div class="faces">
        {#each mv.def.sideB as id (id)}<Avatar name={playerShort(id)} url={photoUrl(id)} colour="var(--team-b)" size={44} />{/each}
      </div>
      {#each mv.def.sideB as id (id)}<div class="name">{playerShort(id)}</div>{/each}
    </div>
  </div>
</svelte:element>

<style>
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; min-height: 24px; }
  .badge { color: #fff; font-weight: 800; font-size: 0.75rem; padding: 4px 10px; border-radius: 999px; letter-spacing: 0.04em; }
  .body { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .side { min-width: 0; }
  .right { text-align: right; }
  .faces { display: flex; margin-bottom: 6px; }
  .right .faces { justify-content: flex-end; }
  .faces :global(.avatar + .avatar) { margin-left: -12px; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status { text-align: center; display: flex; flex-direction: column; min-width: 92px; }
  .status strong { font-size: 1.4rem; font-weight: 800; }
  .status small { font-size: 0.75rem; font-weight: 600; }
</style>
```

`src/routes/Leaderboard.svelte`:
```svelte
<script lang="ts">
  import { db } from '../lib/data/store.svelte';
  import { buildEventView, defaultRoundId, today } from '../lib/view';
  import { isAdmin } from '../lib/auth.svelte';
  import TeamTracker from '../components/TeamTracker.svelte';
  import MatchCard from '../components/MatchCard.svelte';

  const view = $derived(buildEventView(db));
  let chosen = $state<string | null>(null);
  const roundId = $derived(chosen ?? (view ? defaultRoundId(view.rounds.map((r) => r.round), today()) : null));
  const rv = $derived(view?.rounds.find((r) => r.round.id === roundId) ?? null);
</script>

{#if !view}
  <p class="center">
    No active event yet.
    {#if isAdmin()}<a href="#/admin/events">Set one up</a>{:else}Ask the organiser to set one up.{/if}
  </p>
{:else}
  <h1>{view.event.name}</h1>
  <TeamTracker tracker={view.tracker} event={view.event} />
  <div class="tabs" role="tablist">
    {#each view.rounds as r (r.round.id)}
      <button role="tab" aria-selected={r.round.id === roundId} class:active={r.round.id === roundId} onclick={() => (chosen = r.round.id)}>
        {r.round.name}
      </button>
    {/each}
  </div>
  {#if rv}
    <p class="muted small">{rv.completed} of {rv.totalMatches} matches completed</p>
    {#each rv.groups as g (g.group.id)}
      {#each g.matches as mv (mv.def.id)}
        <MatchCard {mv} groupNo={g.group.group_no} teeTime={g.group.tee_time} />
      {/each}
    {:else}
      <p class="muted">Pairings haven't been set for this round yet.</p>
    {/each}
  {/if}
{/if}

<style>
  .tabs { display: flex; gap: 8px; overflow-x: auto; margin: 4px 0 8px; }
  .tabs button { background: var(--surface); color: var(--text); border: 1px solid var(--line); flex: none; }
  .tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
</style>
```

- [ ] **Step 3: Replace `src/App.svelte`** with the data-aware shell. Later tasks add route branches where marked.

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, initAuth, isAdmin } from './lib/auth.svelte';
  import { router } from './lib/router.svelte';
  import { db, startData, stopData } from './lib/data/store.svelte';
  import Login from './routes/Login.svelte';
  import Leaderboard from './routes/Leaderboard.svelte';
  import Nav from './components/Nav.svelte';

  onMount(initAuth);
  const route = $derived(router.route);
  const signedIn = $derived(!!auth.session);
  const needsAdmin = $derived(route.name.startsWith('admin') && route.name !== 'admin-login');

  $effect(() => {
    if (signedIn) {
      startData();
      return stopData;
    }
  });
</script>

{#if !auth.ready}
  <p class="center muted">Loading…</p>
{:else if route.name === 'admin-login' || (signedIn && needsAdmin && !isAdmin())}
  <Login mode="admin" />
{:else if !signedIn}
  <Login mode="trip" />
{:else}
  <div class="app" style="--team-a:{db.event?.team_a_colour ?? '#1f4e9c'};--team-b:{db.event?.team_b_colour ?? '#c8102e'}">
    {#if db.notice}
      <button class="notice" onclick={() => (db.notice = null)}>{db.notice} (tap to dismiss)</button>
    {/if}
    {#if db.error}<p class="notice error">Connection problem: {db.error}</p>{/if}
    <main>
      {#if !db.loaded}
        <p class="center muted">Loading…</p>
      {:else if route.name === 'home'}
        <Leaderboard />
      <!-- ROUTES: add new {:else if} branches above this line -->
      {:else}
        <p class="center">Page not found. <a href="#/">Back to the leaderboard</a></p>
      {/if}
    </main>
    <Nav />
  </div>
{/if}
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run check && npm run build`. Expected: 0 errors.

Then run `npm run dev` and open http://localhost:5173 at 390px width. Log in with the dev trip password. Expected:
- The "Demo Cup" title, and a tracker showing 0 projected and 0 confirmed for both teams, with **"6½ to win · 12 points available"**. That's Days 1 and 2 at 3 points each, plus Day 3 at 3 × (1 + ½ + ½) = 6. If the total isn't 12, `roundPointsAvailable` or `groupCount` is wrong; stop and fix it.
- Day tabs, with Day 1 selected, show 3 fourball cards reading "Not started / Tee 09:00".
- The Day 3 tab shows 9 cards (a fourball, low singles and high singles per group).

In a second browser tab, sign in to the Supabase dashboard for `golf-dev` → Table editor → `scores`. Insert rows for Day 1 group 1 hole 1, with the A players on 4 and the B players on 5, and `client_updated_at` set to now(). The leaderboard should update to "1 UP / THRU 1" within about 2 seconds, without a refresh. (If you prefer, use MCP `execute_sql` to insert the four rows.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: live data store with realtime, team tracker and leaderboard"
```

---

### Task 10: Match summary page (hole grid, scorecard, confirm and unlock)

**Files:**
- Create: `src/components/HoleGrid.svelte`, `src/components/Scorecard.svelte`, `src/routes/Match.svelte`
- Modify: `src/App.svelte` (add a route)

**Interfaces:**
- Consumes: `MatchCard` (Task 9); `resultFromState` and `strokesOnHole` (Task 4); `hasPendingFor` (Task 7); `flushOutbox` and `loadAll` (Task 9).
- Produces: the route `#/match/:groupId/:matchType`, and the buttons "Confirm result" and "Unlock result" used by the e2e tests.

- [ ] **Step 1: Write the components**

`src/components/HoleGrid.svelte`:
```svelte
<script lang="ts">
  import type { MatchState, Outcome } from '../lib/scoring';

  let { state }: { state: MatchState } = $props();
  const nines = [[1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15, 16, 17, 18]];
  const winnerColour = (o: Outcome) => (o === 'A' ? 'var(--team-a)' : o === 'B' ? 'var(--team-b)' : '#8a948f');
  const chip = (lead: number | null) => (lead === null ? '–' : lead === 0 ? 'AS' : `${Math.abs(lead)}UP`);
</script>

<div class="card grid" aria-label="Hole by hole">
  {#each nines as nine, i (i)}
    <div class="nine">
      {#each nine as h (h)}
        {@const o = state.holeWinners[h - 1]}
        {@const lead = state.running[h - 1]}
        <div class="cell" class:current={!state.decided && h === state.thru + 1}>
          <span class="num" style={o ? `background:${winnerColour(o)};color:#fff;border-color:transparent` : ''}>{h}</span>
          <span class="chip" style={lead ? `background:${lead > 0 ? 'var(--team-a)' : 'var(--team-b)'};color:#fff` : ''}>{chip(lead)}</span>
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .nine { display: grid; grid-template-columns: repeat(9, 1fr); gap: 2px; }
  .nine + .nine { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 4px 0; border-radius: 8px; }
  .cell.current { background: var(--text); }
  .cell.current .num { color: #fff; border-color: #fff; }
  .num {
    width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--line);
    display: grid; place-items: center; font-weight: 700; font-size: 0.8rem;
  }
  .chip { font-size: 0.7rem; font-weight: 800; padding: 3px 4px; border-radius: 6px; min-width: 30px; text-align: center; }
  .cell.current .chip { color: #fff; }
</style>
```

`src/components/Scorecard.svelte`:
```svelte
<script lang="ts">
  import { scoreKey, strokesOnHole, type HoleInfo, type MatchDef, type ScoreIndex, type Team } from '../lib/scoring';
  import { playerShort } from '../lib/data/store.svelte';

  let { def, holes, scores, teamOf }: { def: MatchDef; holes: HoleInfo[]; scores: ScoreIndex; teamOf: Record<string, Team> } = $props();

  const nines = $derived([holes.slice(0, 9), holes.slice(9, 18)]);
  const players = $derived([...def.sideA, ...def.sideB]);

  function cell(pid: string, h: HoleInfo): string {
    const e = scores.get(scoreKey(pid, h.hole));
    if (!e) return '';
    return e.pickedUp ? 'P' : String(e.gross);
  }
  function total(pid: string, nine: HoleInfo[]): string {
    let sum = 0;
    let any = false;
    for (const h of nine) {
      const e = scores.get(scoreKey(pid, h.hole));
      if (e && !e.pickedUp && e.gross !== null) {
        sum += e.gross;
        any = true;
      }
    }
    return any ? String(sum) : '';
  }
</script>

{#each nines as nine, i (i)}
  <div class="card wrap">
    <table>
      <thead>
        <tr><th>{i === 0 ? 'Out' : 'In'}</th>{#each nine as h (h.hole)}<th>{h.hole}</th>{/each}<th>Tot</th></tr>
      </thead>
      <tbody>
        <tr class="muted"><td>Par</td>{#each nine as h (h.hole)}<td>{h.par}</td>{/each}<td>{nine.reduce((s, h) => s + h.par, 0)}</td></tr>
        <tr class="muted"><td>SI</td>{#each nine as h (h.hole)}<td>{h.strokeIndex}</td>{/each}<td></td></tr>
        {#each players as pid (pid)}
          <tr>
            <td class="pname" style="color:var(--team-{teamOf[pid] === 'A' ? 'a' : 'b'})">{playerShort(pid)}</td>
            {#each nine as h (h.hole)}
              {@const shots = strokesOnHole(def.strokes[pid] ?? 0, h.strokeIndex)}
              <td class:shot={shots > 0}>{cell(pid, h)}{#if shots}<sup>{'•'.repeat(shots)}</sup>{/if}</td>
            {/each}
            <td><strong>{total(pid, nine)}</strong></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/each}

<style>
  .wrap { overflow-x: auto; padding: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: center; }
  th, td { padding: 6px 2px; border-bottom: 1px solid var(--line); }
  th:first-child, td:first-child { text-align: left; }
  .pname { font-weight: 700; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.shot { background: var(--shot); }
  sup { color: var(--shot-text); font-size: 0.7em; }
</style>
```

`src/routes/Match.svelte`:
```svelte
<script lang="ts">
  import { db, flushOutbox, loadAll } from '../lib/data/store.svelte';
  import { hasPendingFor } from '../lib/data/merge';
  import { must, supabase } from '../lib/supabase';
  import { isAdmin } from '../lib/auth.svelte';
  import { buildEventView, findGroup, matchLabel } from '../lib/view';
  import { resultFromState, type MatchType } from '../lib/scoring';
  import MatchCard from '../components/MatchCard.svelte';
  import HoleGrid from '../components/HoleGrid.svelte';
  import Scorecard from '../components/Scorecard.svelte';

  let { groupId, matchType }: { groupId: string; matchType: MatchType } = $props();

  const view = $derived(buildEventView(db));
  const found = $derived(view ? findGroup(view, groupId) : null);
  const mv = $derived(found?.group.matches.find((m) => m.def.type === matchType) ?? null);
  let busy = $state(false);

  async function confirmResult() {
    if (!mv || !found) return;
    const preview = resultFromState(mv.def, mv.state);
    if (!preview) return;
    if (!confirm(`Confirm ${matchLabel(mv.def.type)}: ${preview.resultText}? This locks the scores for this match.`)) return;
    busy = true;
    try {
      // Queued scores must reach the server first, or the lock would reject them.
      await flushOutbox();
      if (hasPendingFor(db.pending, found.round.round.id, [...mv.def.sideA, ...mv.def.sideB])) {
        alert("Some scores for this match are still waiting to send. Try again when you've got signal.");
        return;
      }
      const snap = resultFromState(mv.def, mv.state); // recompute with anything that just synced
      if (!snap) {
        alert('The result changed while syncing — please check the scores.');
        return;
      }
      const r = await must(
        supabase.rpc('confirm_match', {
          p_group_id: snap.groupId,
          p_match_type: snap.matchType,
          p_winner: snap.winner,
          p_points_a: snap.pointsA,
          p_points_b: snap.pointsB,
          p_result_text: snap.resultText,
          p_final_hole: snap.finalHole,
        }),
      );
      if (r === 'already_confirmed') alert('This match had already been confirmed.');
      await loadAll();
    } catch (e) {
      alert(`Could not confirm: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }

  async function unlock() {
    if (!confirm('Unlock this result? Its points go back to projected and its scores can be edited again.')) return;
    busy = true;
    try {
      await must(supabase.from('match_results').delete().eq('group_id', groupId).eq('match_type', matchType));
      await loadAll();
    } catch (e) {
      alert(`Could not unlock: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }
</script>

<p><a href="#/">← Leaderboard</a></p>
{#if !found || !mv || !view}
  <p class="center">Match not found.</p>
{:else}
  <h2>{found.round.round.name}</h2>
  <MatchCard {mv} groupNo={found.group.group.group_no} teeTime={found.group.group.tee_time} link={false} />
  {#if mv.state.decided && !mv.result}
    <button class="wide" disabled={busy} onclick={confirmResult}>Confirm result</button>
  {/if}
  {#if mv.result && isAdmin()}
    <button class="wide secondary" disabled={busy} onclick={unlock}>Unlock result</button>
  {/if}
  <h3>Match summary</h3>
  <HoleGrid state={mv.state} />
  <h3>Scorecard</h3>
  <Scorecard def={mv.def} holes={found.round.holes} scores={found.group.scores} teamOf={view.teamOf} />
  <p class="muted small">• = shot received on that hole in this match. P = picked up.</p>
{/if}

<style>
  .wide { width: 100%; margin-bottom: 16px; }
  h3 { margin-top: 20px; }
</style>
```

- [ ] **Step 2: Add the route in `src/App.svelte`**

Add the import after the `Leaderboard` import:
```svelte
  import Match from './routes/Match.svelte';
```
Add the branch directly above the `<!-- ROUTES: … -->` comment:
```svelte
      {:else if route.name === 'match'}
        {#key route.groupId + route.matchType}
          <Match groupId={route.groupId} matchType={route.matchType} />
        {/key}
```

- [ ] **Step 3: Verify**

Run: `npm run check && npm run build`. Expected: 0 errors.

In the browser, tap the Day 1 group 1 card (with the hole 1 rows from Task 9). Expected:
- The hole grid shows hole 1 in blue with a "1UP" chip, and hole 2 highlighted as current.
- The scorecard shows 4 and 5 in the Out table.

Use MCP `execute_sql` on `golf-dev` to insert holes 2–10 with A on 4 and B on 5 for the same group:
```sql
insert into public.scores (round_id, player_id, hole, gross, picked_up, client_updated_at)
select g.round_id, gp.player_id, h, case when gp.slot like 'A%' then 4 else 5 end, false, now()
from public.groups g join public.group_players gp on gp.group_id = g.id
join public.rounds r on r.id = g.round_id and r.round_no = 1
cross join generate_series(2, 10) h
where g.group_no = 1
on conflict do nothing;
```
Expected: the card shows "10&8" with a CONFIRM badge, and a "Confirm result" button appears. Tap it and accept. The badge becomes FINAL, and the tracker's solid bar shows 1 confirmed.

Then sign in as admin, open the match and press "Unlock result". The result goes back to projected. Re-seed afterwards with `npm run seed -- --yes-wipe`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: match summary with hole grid, scorecard, confirm and unlock"
```

---

### Task 11: Score entry page

**Files:**
- Create: `src/routes/ScoreEntry.svelte`
- Modify: `src/App.svelte` (add a route)

**Interfaces:**
- Consumes: `enterScore`, `photoUrl` and `playerName` (Task 9); `findGroup`, `firstIncompleteHole`, `defaultRoundId`, `today` and `matchLabel` (Task 8); `isScoreLocked`, `shotLabel`, `strokesOnHole` and `scoreKey` (Tasks 2–4).
- Produces: the route `#/score` (group picker) and `#/score/:groupId`. The remembered group is stored in the localStorage key `golf.scoringGroup`.
- Accessible names and test ids used by the e2e tests:
  - hole buttons `Hole N`
  - rows `row-A1` … `row-B2`
  - `Decrease <name>` / `Increase <name>`
  - `gross-<slot>`
  - `Save hole N`
  - `pending`
  - picker buttons whose text starts `Group N`

Shot highlighting (spec §5.4):
- A row is **green** when the player receives 1 better-ball shot on this hole, and **strong green** for 2 or more.
- The chip text comes from `shotLabel(bb, singles)`, so it shows "BB 1 · Singles 0" on day 3 when the two differ.

- [ ] **Step 1: Write `src/routes/ScoreEntry.svelte`**

```svelte
<script lang="ts">
  import { untrack } from 'svelte';
  import { db, enterScore, photoUrl, playerName } from '../lib/data/store.svelte';
  import { buildEventView, defaultRoundId, findGroup, firstIncompleteHole, matchLabel, today } from '../lib/view';
  import { isScoreLocked, scoreKey, shotLabel, strokesOnHole, type Slot } from '../lib/scoring';
  import Avatar from '../components/Avatar.svelte';

  let { groupId }: { groupId: string | null } = $props();

  const REMEMBER = 'golf.scoringGroup';
  const SLOTS: Slot[] = ['A1', 'A2', 'B1', 'B2'];

  function readRemembered(): string | null {
    try {
      return localStorage.getItem(REMEMBER);
    } catch {
      return null;
    }
  }
  let remembered = $state(readRemembered());

  function choose(id: string) {
    try {
      localStorage.setItem(REMEMBER, id);
    } catch {
      /* private mode — fine, the URL still carries the group */
    }
    remembered = id;
    location.hash = `#/score/${id}`;
  }
  function changeGroup() {
    try {
      localStorage.removeItem(REMEMBER);
    } catch {
      /* ignore */
    }
    remembered = null;
    location.hash = '#/score';
  }

  const view = $derived(buildEventView(db));
  const gid = $derived(groupId ?? remembered);
  const found = $derived(view && gid ? findGroup(view, gid) : null);
  const pickerRoundId = $derived(view ? defaultRoundId(view.rounds.map((r) => r.round), today()) : null);

  let pickedHole = $state<number | null>(null);
  const hole = $derived(found ? (pickedHole ?? firstIncompleteHole(found.group, found.round.holes)) : 1);
  const info = $derived(found?.round.holes.find((h) => h.hole === hole) ?? null);

  type Draft = { gross: number; pickedUp: boolean; touched: boolean };
  let draft = $state<Record<string, Draft>>({});

  // Rebuild the draft only when the group or hole changes — not on every live update.
  const draftKey = $derived(`${found?.group.group.id ?? ''}:${hole}:${info ? 'ready' : 'none'}`);
  $effect(() => {
    void draftKey;
    untrack(() => {
      draft = buildDraft();
    });
  });

  function buildDraft(): Record<string, Draft> {
    const out: Record<string, Draft> = {};
    if (!found || !info) return out;
    for (const slot of SLOTS) {
      const pid = found.group.slots[slot];
      if (!pid) continue;
      const e = found.group.scores.get(scoreKey(pid, hole));
      out[pid] = e
        ? { gross: e.gross ?? info.par, pickedUp: e.pickedUp, touched: true }
        : { gross: info.par, pickedUp: false, touched: false };
    }
    return out;
  }

  function shots(pid: string) {
    if (!found || !info) return { bb: 0, label: null as string | null };
    const bbMatch = found.group.matches.find((m) => m.def.type === 'better_ball');
    const singles = found.group.matches.find(
      (m) => m.def.type !== 'better_ball' && [...m.def.sideA, ...m.def.sideB].includes(pid),
    );
    const bb = bbMatch ? strokesOnHole(bbMatch.def.strokes[pid] ?? 0, info.strokeIndex) : 0;
    const sg = singles ? strokesOnHole(singles.def.strokes[pid] ?? 0, info.strokeIndex) : null;
    return { bb, label: shotLabel(bb, sg) };
  }

  const locked = (pid: string, h: number) => (found ? isScoreLocked(pid, h, found.group.matches) : false);

  function holeState(h: number): string {
    if (!found) return '';
    const ids = SLOTS.map((s) => found.group.slots[s]).filter((x): x is string => !!x);
    if (ids.length && ids.every((id) => locked(id, h))) return 'locked';
    const entered = ids.filter((id) => found.group.scores.has(scoreKey(id, h))).length;
    return entered === ids.length && ids.length > 0 ? 'done' : entered > 0 ? 'partial' : '';
  }

  function bump(pid: string, delta: number) {
    const d = draft[pid];
    d.gross = Math.min(15, Math.max(1, d.gross + delta));
    d.pickedUp = false;
    d.touched = true;
  }

  const allLocked = $derived(
    !!found && SLOTS.every((s) => {
      const pid = found.group.slots[s];
      return !pid || locked(pid, hole);
    }),
  );

  async function save() {
    if (!found) return;
    const at = new Date().toISOString();
    for (const slot of SLOTS) {
      const pid = found.group.slots[slot];
      if (!pid || locked(pid, hole) || !draft[pid]) continue;
      const d = draft[pid];
      await enterScore({
        roundId: found.round.round.id,
        playerId: pid,
        hole,
        gross: d.pickedUp ? null : d.gross,
        pickedUp: d.pickedUp,
        clientUpdatedAt: at,
      });
    }
    pickedHole = Math.min(18, hole + 1);
  }
</script>

{#if !view}
  <p class="center">No active event yet.</p>
{:else if !found}
  <h1>Which group are you scoring?</h1>
  {#each view.rounds.filter((r) => r.round.id === pickerRoundId) as rv (rv.round.id)}
    <p class="muted">{rv.round.name}</p>
    {#each rv.groups as g (g.group.id)}
      <button class="group-pick secondary" onclick={() => choose(g.group.id)}>
        <strong>Group {g.group.group_no}</strong>
        <span class="muted small">
          {SLOTS.map((s) => g.slots[s]).filter((x): x is string => !!x).map(playerName).join(', ')}
        </span>
      </button>
    {:else}
      <p class="muted">No pairings yet for this round.</p>
    {/each}
  {/each}
{:else if !info}
  <p class="center">This round's course has no holes set up yet.</p>
{:else}
  <header class="head">
    <div>
      <h1>Hole {hole}</h1>
      <p class="muted">Par {info.par} · SI {info.strokeIndex} · {found.round.round.name} · Group {found.group.group.group_no}</p>
    </div>
    {#if db.pending.length}
      <span class="pending" data-testid="pending">{db.pending.length} waiting to send</span>
    {/if}
  </header>

  <div class="strip">
    {#each found.round.holes as h (h.hole)}
      <button class="hole {holeState(h.hole)}" class:current={h.hole === hole} aria-label="Hole {h.hole}" onclick={() => (pickedHole = h.hole)}>
        {h.hole}
      </button>
    {/each}
  </div>

  <div class="statuses">
    {#each found.group.matches as m (m.def.id)}
      {@const lead = m.result ? (m.result.winner === 'A' ? 1 : m.result.winner === 'B' ? -1 : 0) : m.state.lead}
      <span>
        <small class="muted">{matchLabel(m.def.type)}</small>
        <strong style="color:{lead > 0 ? 'var(--team-a)' : lead < 0 ? 'var(--team-b)' : 'var(--muted)'}">
          {m.result?.resultText ?? m.state.statusText}
        </strong>
      </span>
    {/each}
  </div>

  {#each SLOTS as slot (slot)}
    {@const pid = found.group.slots[slot]}
    {#if pid && draft[pid]}
      {@const sh = shots(pid)}
      {@const isLocked = locked(pid, hole)}
      <div class="prow card" class:shot={sh.bb === 1} class:shot2={sh.bb >= 2} data-testid="row-{slot}">
        <Avatar name={playerName(pid)} url={photoUrl(pid)} colour={slot.startsWith('A') ? 'var(--team-a)' : 'var(--team-b)'} size={44} />
        <div class="who">
          <strong>{playerName(pid)}</strong>
          <div class="chips">
            {#if sh.label}<span class="chip shotchip">{sh.label}</span>{/if}
            {#if isLocked}<span class="chip lock">Locked</span>{/if}
          </div>
        </div>
        <div class="stepper">
          <button class="secondary" aria-label="Decrease {playerName(pid)}" disabled={isLocked || draft[pid].pickedUp} onclick={() => bump(pid, -1)}>−</button>
          <span class="val" class:untouched={!draft[pid].touched} data-testid="gross-{slot}">{draft[pid].pickedUp ? 'P' : draft[pid].gross}</span>
          <button class="secondary" aria-label="Increase {playerName(pid)}" disabled={isLocked || draft[pid].pickedUp} onclick={() => bump(pid, 1)}>+</button>
        </div>
        <label class="pu">
          <input type="checkbox" bind:checked={draft[pid].pickedUp} disabled={isLocked} onchange={() => (draft[pid].touched = true)} />
          Picked up
        </label>
      </div>
    {/if}
  {/each}

  <button class="save" onclick={save} disabled={allLocked}>Save hole {hole}</button>
  <p class="muted small">Scoring for a different group? <button class="linklike" onclick={changeGroup}>Change group</button></p>
{/if}

<style>
  .group-pick { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; margin-bottom: 10px; text-align: left; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .head h1 { margin-bottom: 2px; }
  .head p { margin: 0 0 10px; }
  .pending { background: #fff4e5; color: #6b3d00; font-weight: 700; font-size: 0.8rem; padding: 6px 10px; border-radius: 999px; white-space: nowrap; }
  .strip { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; margin-bottom: 12px; }
  .hole { min-height: 36px; padding: 0; border-radius: 8px; background: var(--surface); color: var(--text); border: 1px solid var(--line); font-size: 0.85rem; }
  .hole.done { background: #e7efe9; }
  .hole.partial { background: #fff4e5; }
  .hole.locked { background: #eee; color: var(--muted); }
  .hole.current { background: var(--accent); color: #fff; border-color: var(--accent); }
  .statuses { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .statuses span { display: flex; flex-direction: column; }
  .prow { display: grid; grid-template-columns: auto 1fr auto; grid-template-areas: 'av who step' 'av pu step'; gap: 4px 10px; align-items: center; border: 2px solid transparent; }
  .prow :global(.avatar) { grid-area: av; }
  .prow.shot { background: var(--shot); border-color: var(--shot-strong); }
  .prow.shot2 { background: var(--shot-strong); border-color: var(--shot-text); }
  .who { grid-area: who; min-width: 0; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
  .chip { font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 999px; }
  .shotchip { background: var(--shot-text); color: #fff; }
  .lock { background: #ddd; color: #333; }
  .stepper { grid-area: step; display: flex; align-items: center; gap: 6px; }
  .stepper button { width: 48px; height: 48px; padding: 0; font-size: 1.5rem; }
  .val { width: 36px; text-align: center; font-size: 1.6rem; font-weight: 800; }
  .val.untouched { color: var(--muted); }
  .pu { grid-area: pu; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--muted); margin: 0; }
  .save { width: 100%; font-size: 1.1rem; margin-top: 4px; }
  .linklike { background: none; color: var(--accent); padding: 0; min-height: 0; text-decoration: underline; font-weight: 500; }
</style>
```

- [ ] **Step 2: Add the route in `src/App.svelte`**

Import:
```svelte
  import ScoreEntry from './routes/ScoreEntry.svelte';
```
Branch (above the ROUTES comment):
```svelte
      {:else if route.name === 'score'}
        {#key route.groupId}
          <ScoreEntry groupId={route.groupId} />
        {/key}
```

- [ ] **Step 3: Verify**

Run: `npm run check && npm run build`. Expected: 0 errors.

In the browser at 390px, go to the Scores tab. Expected:
- A group picker for Day 1. Tap Group 2.
- "Hole 1 · Par 4 · SI 7", with four rows showing 4 in grey.
- Group 2 has Chris Clark (6) and Dan Davies (14) against Ian Irwin (8) and Jack Jones (12). Lowest is 6, so the strokes are Dan 7, Ian 2 and Jack 5 at 90%. On SI 7, Dan's row is green with "1 shot"; Ian's (SI 7 > 2) and Chris's rows aren't.
- Tap + on Chris and Save. The strip marks hole 1 done and moves to hole 2.
- Tap Hole 1 and the saved values show in black.
- Turn Wi-Fi off, enter hole 2 and save. A "4 waiting to send" pill appears. Turn Wi-Fi on and it disappears within a few seconds.

Then run `npm run seed -- --yes-wipe`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: score entry with shot highlighting, hole strip and offline badge"
```

---

### Task 12: Player photos and the Players page

**Files:**
- Create: `src/lib/photos.ts`, `src/components/PhotoUpload.svelte`, `src/routes/Players.svelte`
- Modify: `src/App.svelte` (add a route)

**Interfaces:**
- Produces:
  - `resizeToSquareJpeg(file: Blob, size?: number): Promise<Blob>`
  - `uploadPlayerPhoto(playerId: string, file: Blob): Promise<void>`, which uploads to `player-photos/<playerId>/<timestamp>.jpg` and then calls `set_player_photo`
  - `<PhotoUpload playerId label? />`, containing a file input with `data-testid="photo-input-<playerId>"`

- [ ] **Step 1: Write the photo helpers and components**

`src/lib/photos.ts`:
```ts
import { must, supabase } from './supabase';

/** Centre-crop to a square and re-encode as JPEG (fixes phone EXIF rotation; ~30–60 KB). */
export async function resizeToSquareJpeg(file: Blob, size = 400): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', 0.85),
  );
}

export async function uploadPlayerPhoto(playerId: string, file: Blob): Promise<void> {
  const blob = await resizeToSquareJpeg(file);
  const path = `${playerId}/${Date.now()}.jpg`;
  await must(supabase.storage.from('player-photos').upload(path, blob, { contentType: 'image/jpeg' }));
  await must(supabase.rpc('set_player_photo', { p_player_id: playerId, p_path: path }));
}
```

`src/components/PhotoUpload.svelte`:
```svelte
<script lang="ts">
  import { uploadPlayerPhoto } from '../lib/photos';
  import { loadAll } from '../lib/data/store.svelte';

  let { playerId, label = 'Upload photo' }: { playerId: string; label?: string } = $props();
  let busy = $state(false);

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    try {
      await uploadPlayerPhoto(playerId, file);
      await loadAll();
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`);
    } finally {
      busy = false;
      input.value = '';
    }
  }
</script>

<label class="upload">
  <input type="file" accept="image/*" onchange={onPick} data-testid="photo-input-{playerId}" />
  <span>{busy ? 'Uploading…' : label}</span>
</label>

<style>
  .upload { display: inline-flex; margin: 0; }
  input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  span {
    display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border-radius: 10px;
    border: 1px solid var(--line); background: var(--surface); color: var(--text); font-weight: 600; cursor: pointer;
  }
</style>
```

`src/routes/Players.svelte`:
```svelte
<script lang="ts">
  import { db, photoUrl } from '../lib/data/store.svelte';
  import Avatar from '../components/Avatar.svelte';
  import PhotoUpload from '../components/PhotoUpload.svelte';

  const teams = $derived(
    (['A', 'B'] as const).map((team) => ({
      team,
      name: team === 'A' ? db.event?.team_a_name : db.event?.team_b_name,
      players: db.eventPlayers
        .filter((ep) => ep.team === team)
        .map((ep) => ({ ...ep, player: db.players.find((p) => p.id === ep.player_id) }))
        .filter((x) => x.player)
        .sort((x, y) => x.player!.name.localeCompare(y.player!.name)),
    })),
  );
</script>

<h1>Players</h1>
<p class="muted small">Tap "Upload photo" to add a headshot — a selfie works fine.</p>
{#each teams as t (t.team)}
  <h2 style="color:var(--team-{t.team === 'A' ? 'a' : 'b'})">{t.name}</h2>
  {#each t.players as ep (ep.player_id)}
    <div class="card prow" data-testid="player-row">
      <Avatar name={ep.player!.name} url={photoUrl(ep.player_id)} colour="var(--team-{t.team === 'A' ? 'a' : 'b'})" size={64} />
      <div class="who">
        <strong>{ep.player!.name}</strong>
        <div class="muted small">Handicap {ep.handicap}</div>
      </div>
      <PhotoUpload playerId={ep.player_id} label={ep.player!.photo_path ? 'Change' : 'Upload photo'} />
    </div>
  {/each}
{/each}

<style>
  .prow { display: flex; align-items: center; gap: 12px; }
  .who { flex: 1; min-width: 0; }
</style>
```

- [ ] **Step 2: Add the route in `src/App.svelte`**

Import:
```svelte
  import Players from './routes/Players.svelte';
```
Branch:
```svelte
      {:else if route.name === 'players'}
        <Players />
```

- [ ] **Step 3: Verify**

Run: `npm run check && npm run build`. Expected: 0 errors.

In the browser, go to Players and upload any photo for Alex Adams. The initials circle becomes the cropped photo with a blue ring. The Leaderboard card for Day 1 group 1 shows it too.

Use MCP `execute_sql`: `select photo_path from public.players where name = 'Alex Adams'`. It should return `<uuid>/<digits>.jpg`.

Also run MCP `get_advisors` (security) again and confirm there are no new storage warnings.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: player photo upload with client-side square crop"
```

---
### Task 13: Admin — home, players and courses

**Files:**
- Create: `src/routes/admin/AdminHome.svelte`, `src/routes/admin/AdminPlayers.svelte`, `src/routes/admin/AdminCourses.svelte`, `src/routes/admin/AdminCourse.svelte`
- Modify: `src/App.svelte` (add routes)

**Interfaces:**
- Consumes: `db`, `loadAll` and `photoUrl` (Task 9); `must` and `supabase` (Task 6); `validateHoles` (Task 4); `PhotoUpload` (Task 12); the `save_course` RPC (Task 5).
- Produces: routes `#/admin`, `#/admin/players`, `#/admin/courses` and `#/admin/courses/:id|new`. Admin pages are only reachable with an admin session, because `App.svelte` shows the admin login otherwise and RLS enforces it on the server.

- [ ] **Step 1: Write the pages**

`src/routes/admin/AdminHome.svelte`:
```svelte
<script lang="ts">
  import { logout } from '../../lib/auth.svelte';
  import { db } from '../../lib/data/store.svelte';
</script>

<h1>Admin</h1>
<p class="muted">Active event: <strong>{db.event?.name ?? 'none'}</strong></p>
<a class="card" href="#/admin/events">Events, teams, rounds &amp; pairings →</a>
<a class="card" href="#/admin/players">Players &amp; handicaps →</a>
<a class="card" href="#/admin/courses">Courses (par &amp; stroke index) →</a>
<button class="secondary" onclick={logout}>Sign out of admin</button>
<p class="muted small">Tip: sign out and back in with the trip password to see exactly what everyone else sees.</p>
```

`src/routes/admin/AdminPlayers.svelte`:
```svelte
<script lang="ts">
  import { db, loadAll, photoUrl } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import type { PlayerRow } from '../../lib/data/types';
  import Avatar from '../../components/Avatar.svelte';
  import PhotoUpload from '../../components/PhotoUpload.svelte';

  let name = $state('');
  let shortName = $state('');
  let handicap = $state(0);
  let msg = $state<string | null>(null);

  async function act(fn: () => Promise<unknown>, ok: string) {
    msg = null;
    try {
      await fn();
      await loadAll();
      msg = ok;
    } catch (e) {
      msg = `Error: ${(e as Error).message}`;
    }
  }

  const add = (e: SubmitEvent) => {
    e.preventDefault();
    const n = name.trim();
    void act(async () => {
      await must(
        supabase.from('players').insert({ name: n, short_name: shortName.trim() || n.split(/\s+/).at(-1), default_handicap: handicap }),
      );
      name = '';
      shortName = '';
      handicap = 0;
    }, `Added ${n}`);
  };
  const save = (p: PlayerRow) =>
    act(
      () => must(supabase.from('players').update({ name: p.name, short_name: p.short_name, default_handicap: p.default_handicap }).eq('id', p.id)),
      `Saved ${p.name}`,
    );
  const remove = (p: PlayerRow) => {
    if (confirm(`Delete ${p.name}? This also deletes their scores.`)) void act(() => must(supabase.from('players').delete().eq('id', p.id)), `Deleted ${p.name}`);
  };
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Players</h1>
{#if msg}<p class:error={msg.startsWith('Error')}>{msg}</p>{/if}

<form class="card" onsubmit={add}>
  <h3>Add player</h3>
  <div class="field"><label for="n">Full name</label><input id="n" bind:value={name} required /></div>
  <div class="row">
    <div class="field"><label for="s">Short name (cards)</label><input id="s" bind:value={shortName} placeholder="Surname" /></div>
    <div class="field"><label for="h">Handicap</label><input id="h" type="number" step="0.1" inputmode="decimal" bind:value={handicap} /></div>
  </div>
  <button type="submit">Add player</button>
</form>

{#each db.players as p (p.id)}
  <div class="card">
    <div class="row">
      <Avatar name={p.name} url={photoUrl(p.id)} colour="var(--accent)" size={48} />
      <PhotoUpload playerId={p.id} label={p.photo_path ? 'Change photo' : 'Add photo'} />
    </div>
    <div class="field"><label for="n-{p.id}">Full name</label><input id="n-{p.id}" bind:value={p.name} /></div>
    <div class="row">
      <div class="field"><label for="s-{p.id}">Short name</label><input id="s-{p.id}" bind:value={p.short_name} /></div>
      <div class="field"><label for="h-{p.id}">Default handicap</label><input id="h-{p.id}" type="number" step="0.1" inputmode="decimal" bind:value={p.default_handicap} /></div>
    </div>
    <div class="row">
      <button onclick={() => save(p)}>Save</button>
      <button class="secondary" onclick={() => remove(p)}>Delete</button>
    </div>
  </div>
{/each}
```

`src/routes/admin/AdminCourses.svelte`:
```svelte
<script lang="ts">
  import { db } from '../../lib/data/store.svelte';
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Courses</h1>
<a class="card" href="#/admin/courses/new"><strong>+ Add a course</strong></a>
{#each db.courses as c (c.id)}
  <a class="card" href="#/admin/courses/{c.id}">
    {c.name}
    <span class="muted small">· {db.courseHoles.filter((h) => h.course_id === c.id).length} holes</span>
  </a>
{:else}
  <p class="muted">No courses yet.</p>
{/each}
```

`src/routes/admin/AdminCourse.svelte`:
```svelte
<script lang="ts">
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import { validateHoles, type HoleInfo } from '../../lib/scoring';

  let { courseId }: { courseId: string } = $props();

  // Initial values are read once; App wraps this page in {#key courseId}.
  function initialName(): string {
    return db.courses.find((c) => c.id === courseId)?.name ?? '';
  }
  function initialHoles(): HoleInfo[] {
    return Array.from({ length: 18 }, (_, i) => {
      const h = db.courseHoles.find((x) => x.course_id === courseId && x.hole === i + 1);
      return { hole: i + 1, par: h?.par ?? 4, strokeIndex: h?.stroke_index ?? i + 1 };
    });
  }

  let name = $state(initialName());
  let holes = $state(initialHoles());
  let errors = $state<string[]>([]);
  let busy = $state(false);
  const isNew = $derived(courseId === 'new');
  const totalPar = $derived(holes.reduce((s, h) => s + (Number(h.par) || 0), 0));

  async function save() {
    const clean = holes.map((h) => ({ hole: h.hole, par: Number(h.par), strokeIndex: Number(h.strokeIndex) }));
    errors = validateHoles(clean);
    if (!name.trim()) errors = ['Course name is required', ...errors];
    if (errors.length) return;
    busy = true;
    try {
      await must(
        supabase.rpc('save_course', {
          p_course_id: isNew ? null : courseId,
          p_name: name.trim(),
          p_holes: clean.map((h) => ({ hole: h.hole, par: h.par, stroke_index: h.strokeIndex })),
        }),
      );
      await loadAll();
      location.hash = '#/admin/courses';
    } catch (e) {
      errors = [(e as Error).message];
    } finally {
      busy = false;
    }
  }
</script>

<p><a href="#/admin/courses">← Courses</a></p>
<h1>{isNew ? 'New course' : 'Edit course'}</h1>
<div class="field"><label for="cn">Course name</label><input id="cn" bind:value={name} /></div>
<p class="muted small">Copy par and stroke index (SI) from the scorecard. Every SI from 1 to 18 must be used once. Total par: {totalPar}</p>

<div class="card grid">
  <div class="hdr">Hole</div><div class="hdr">Par</div><div class="hdr">SI</div>
  {#each holes as h (h.hole)}
    <div class="hole">{h.hole}</div>
    <input type="number" inputmode="numeric" min="3" max="6" aria-label="Hole {h.hole} par" bind:value={h.par} />
    <input type="number" inputmode="numeric" min="1" max="18" aria-label="Hole {h.hole} SI" bind:value={h.strokeIndex} />
  {/each}
</div>

{#each errors as err (err)}<p class="error">{err}</p>{/each}
<button class="wide" disabled={busy} onclick={save}>Save course</button>

<style>
  .grid { display: grid; grid-template-columns: 56px 1fr 1fr; gap: 6px; align-items: center; }
  .hdr { font-weight: 700; color: var(--muted); font-size: 0.85rem; }
  .hole { font-weight: 700; text-align: center; }
  .wide { width: 100%; }
</style>
```

- [ ] **Step 2: Add the routes in `src/App.svelte`**

Imports:
```svelte
  import AdminHome from './routes/admin/AdminHome.svelte';
  import AdminPlayers from './routes/admin/AdminPlayers.svelte';
  import AdminCourses from './routes/admin/AdminCourses.svelte';
  import AdminCourse from './routes/admin/AdminCourse.svelte';
```
Branches (above the ROUTES comment):
```svelte
      {:else if route.name === 'admin'}
        <AdminHome />
      {:else if route.name === 'admin-players'}
        <AdminPlayers />
      {:else if route.name === 'admin-courses'}
        <AdminCourses />
      {:else if route.name === 'admin-course'}
        {#key route.courseId}
          <AdminCourse courseId={route.courseId} />
        {/key}
```

- [ ] **Step 3: Verify**

Run: `npm run check && npm run build`. Expected: 0 errors.

In the browser, sign in as admin and go to Admin → Courses → "+ Add a course".
- Name it "Test", set hole 2 SI to 1, and Save. Expected: "SI 1 is used more than once" and nothing saved.
- Fix it and Save. You're taken back to the list, which shows "Test · 18 holes".

Go to Admin → Players and add "Zed Zulu", handicap 12.5. They appear in the list.

Sign out, then sign in with the **trip** password and visit `#/admin/players`. Expected: the Admin login screen, not the page.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): players and courses management"
```

---

### Task 14: Admin — events, teams, rounds and pairings

**Files:**
- Create: `src/routes/admin/AdminEvents.svelte`, `src/routes/admin/AdminEvent.svelte`, `src/routes/admin/AdminPairings.svelte`
- Modify: `src/App.svelte` (add routes)

**Interfaces:**
- Consumes: `orderSlots` and `pairingErrors` (Task 4); the `save_group` RPC (Task 5); `db` and `loadAll` (Task 9).
- Produces: routes `#/admin/events`, `#/admin/events/:id` and `#/admin/pairings/:roundId`.
- These pages load their own event, round and group data directly, because they may edit an event that **isn't** active, while `db` only holds the active one.

- [ ] **Step 1: Write the pages**

`src/routes/admin/AdminEvents.svelte`:
```svelte
<script lang="ts">
  import { must, supabase } from '../../lib/supabase';
  import type { EventRow } from '../../lib/data/types';

  let events = $state<EventRow[]>([]);
  let name = $state('');
  let error = $state<string | null>(null);

  async function load() {
    events = (await must(supabase.from('events').select('*').order('created_at', { ascending: false }))) as EventRow[];
  }
  $effect(() => {
    void load();
  });

  async function create(e: SubmitEvent) {
    e.preventDefault();
    try {
      const ev = (await must(supabase.from('events').insert({ name: name.trim() }).select().single())) as EventRow;
      location.hash = `#/admin/events/${ev.id}`;
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Events</h1>
<form class="card" onsubmit={create}>
  <div class="field"><label for="en">New event name</label><input id="en" bind:value={name} required placeholder="Portugal 2026" /></div>
  {#if error}<p class="error">{error}</p>{/if}
  <button type="submit">Create event</button>
</form>
{#each events as ev (ev.id)}
  <a class="card" href="#/admin/events/{ev.id}">
    <strong>{ev.name}</strong>
    {#if ev.is_active}<span class="muted small"> · ACTIVE</span>{/if}
  </a>
{/each}
```

`src/routes/admin/AdminEvent.svelte`:
```svelte
<script lang="ts">
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import type { EventPlayerRow, EventRow, RoundRow } from '../../lib/data/types';

  let { eventId }: { eventId: string } = $props();

  type Member = { team: '' | 'A' | 'B'; handicap: number };
  let event = $state<EventRow | null>(null);
  let members = $state<Record<string, Member>>({});
  let rounds = $state<RoundRow[]>([]);
  let msg = $state<string | null>(null);
  let newRound = $state({ name: '', course_id: '', date: '' });

  async function load() {
    const id = eventId;
    const [ev, eps, rs] = await Promise.all([
      must(supabase.from('events').select('*').eq('id', id).single()) as Promise<EventRow>,
      must(supabase.from('event_players').select('*').eq('event_id', id)) as Promise<EventPlayerRow[]>,
      must(supabase.from('rounds').select('*').eq('event_id', id).order('round_no')) as Promise<RoundRow[]>,
    ]);
    event = ev;
    rounds = rs;
    members = Object.fromEntries(
      db.players.map((p) => {
        const m = eps.find((x) => x.player_id === p.id);
        return [p.id, { team: m?.team ?? '', handicap: m ? Number(m.handicap) : Number(p.default_handicap) }];
      }),
    );
  }
  $effect(() => {
    void load();
  });

  async function act(fn: () => Promise<unknown>, ok: string) {
    msg = null;
    try {
      await fn();
      await load();
      await loadAll();
      msg = ok;
    } catch (e) {
      msg = `Error: ${(e as Error).message}`;
    }
  }

  const countA = $derived(Object.values(members).filter((m) => m.team === 'A').length);
  const countB = $derived(Object.values(members).filter((m) => m.team === 'B').length);

  const saveDetails = () =>
    act(async () => {
      const ev = event!;
      // Only one active event is allowed (unique index): deactivate the others first.
      if (ev.is_active) await must(supabase.from('events').update({ is_active: false }).neq('id', ev.id));
      await must(
        supabase
          .from('events')
          .update({
            name: ev.name,
            team_a_name: ev.team_a_name,
            team_a_colour: ev.team_a_colour,
            team_b_name: ev.team_b_name,
            team_b_colour: ev.team_b_colour,
            is_active: ev.is_active,
          })
          .eq('id', ev.id),
      );
    }, 'Event saved');

  const saveMembers = () =>
    act(async () => {
      const entries = Object.entries(members);
      const rows = entries
        .filter(([, m]) => m.team)
        .map(([player_id, m]) => ({ event_id: eventId, player_id, team: m.team, handicap: Number(m.handicap) }));
      const removed = entries.filter(([, m]) => !m.team).map(([id]) => id);
      if (rows.length) await must(supabase.from('event_players').upsert(rows));
      if (removed.length) await must(supabase.from('event_players').delete().eq('event_id', eventId).in('player_id', removed));
    }, 'Teams & handicaps saved');

  const addRound = (e: SubmitEvent) => {
    e.preventDefault();
    const next = Math.max(0, ...rounds.map((r) => r.round_no)) + 1;
    void act(
      () =>
        must(
          supabase.from('rounds').insert({
            event_id: eventId,
            round_no: next,
            name: newRound.name.trim() || `Day ${next}`,
            course_id: newRound.course_id,
            date: newRound.date || null,
          }),
        ),
      'Round added',
    ).then(() => (newRound = { name: '', course_id: '', date: '' }));
  };

  const saveRound = (r: RoundRow) =>
    act(
      () =>
        must(
          supabase
            .from('rounds')
            .update({
              name: r.name,
              course_id: r.course_id,
              date: r.date || null,
              allowance_pct: Number(r.allowance_pct),
              better_ball_points: Number(r.better_ball_points),
              singles_enabled: r.singles_enabled,
              singles_points: Number(r.singles_points),
              singles_allowance_pct: Number(r.singles_allowance_pct),
            })
            .eq('id', r.id),
        ),
      `${r.name} saved`,
    );
</script>

<p><a href="#/admin/events">← Events</a></p>
{#if msg}<p class:error={msg.startsWith('Error')}>{msg}</p>{/if}

{#if event}
  <section class="card">
    <h2>Event</h2>
    <div class="field"><label for="evn">Name</label><input id="evn" bind:value={event.name} /></div>
    <div class="row">
      <div class="field"><label for="ta">Team A name</label><input id="ta" bind:value={event.team_a_name} /></div>
      <div class="field"><label for="tac">Colour</label><input id="tac" type="color" bind:value={event.team_a_colour} /></div>
    </div>
    <div class="row">
      <div class="field"><label for="tb">Team B name</label><input id="tb" bind:value={event.team_b_name} /></div>
      <div class="field"><label for="tbc">Colour</label><input id="tbc" type="color" bind:value={event.team_b_colour} /></div>
    </div>
    <label class="row"><input type="checkbox" bind:checked={event.is_active} /> Active event (shown on the leaderboard)</label>
    <button onclick={saveDetails}>Save event</button>
  </section>

  <section class="card">
    <h2>Teams &amp; handicaps</h2>
    <p class="muted small">{event.team_a_name}: {countA} · {event.team_b_name}: {countB} (6 each for three fourballs)</p>
    {#each db.players as p (p.id)}
      {#if members[p.id]}
        <div class="member">
          <span class="pname">{p.name}</span>
          <select aria-label="{p.name} team" bind:value={members[p.id].team}>
            <option value="">—</option>
            <option value="A">{event.team_a_name}</option>
            <option value="B">{event.team_b_name}</option>
          </select>
          <input aria-label="{p.name} handicap" type="number" step="0.1" inputmode="decimal" bind:value={members[p.id].handicap} />
        </div>
      {/if}
    {/each}
    <button onclick={saveMembers}>Save teams &amp; handicaps</button>
  </section>

  <section class="card">
    <h2>Rounds</h2>
    {#each rounds as r (r.id)}
      <div class="round">
        <div class="row">
          <div class="field"><label for="rn-{r.id}">Name</label><input id="rn-{r.id}" bind:value={r.name} /></div>
          <div class="field"><label for="rd-{r.id}">Date</label><input id="rd-{r.id}" type="date" bind:value={r.date} /></div>
        </div>
        <div class="field">
          <label for="rc-{r.id}">Course</label>
          <select id="rc-{r.id}" bind:value={r.course_id}>
            {#each db.courses as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
        </div>
        <div class="row">
          <div class="field"><label for="ra-{r.id}">Allowance %</label><input id="ra-{r.id}" type="number" min="0" max="100" bind:value={r.allowance_pct} /></div>
          <div class="field"><label for="rp-{r.id}">Fourball pts</label><input id="rp-{r.id}" type="number" step="0.5" bind:value={r.better_ball_points} /></div>
        </div>
        <label class="row"><input type="checkbox" bind:checked={r.singles_enabled} /> Also play low &amp; high singles in each fourball</label>
        {#if r.singles_enabled}
          <div class="row">
            <div class="field"><label for="rsp-{r.id}">Singles pts</label><input id="rsp-{r.id}" type="number" step="0.5" bind:value={r.singles_points} /></div>
            <div class="field"><label for="rsa-{r.id}">Singles allowance %</label><input id="rsa-{r.id}" type="number" min="0" max="100" bind:value={r.singles_allowance_pct} /></div>
          </div>
        {/if}
        <div class="row">
          <button onclick={() => saveRound(r)}>Save round</button>
          <a href="#/admin/pairings/{r.id}">Pairings →</a>
        </div>
      </div>
    {/each}

    <form class="round" onsubmit={addRound}>
      <h3>Add round</h3>
      <div class="row">
        <div class="field"><label for="nrn">Name</label><input id="nrn" bind:value={newRound.name} placeholder="Day {rounds.length + 1}" /></div>
        <div class="field"><label for="nrd">Date</label><input id="nrd" type="date" bind:value={newRound.date} /></div>
      </div>
      <div class="field">
        <label for="nrc">Course</label>
        <select id="nrc" bind:value={newRound.course_id} required>
          <option value="" disabled>Choose a course</option>
          {#each db.courses as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
      <button type="submit">Add round</button>
    </form>
  </section>
{:else}
  <p class="center muted">Loading…</p>
{/if}

<style>
  section h2 { margin-bottom: 10px; }
  section button { margin-top: 8px; }
  .member { display: grid; grid-template-columns: 1fr 120px 80px; gap: 6px; align-items: center; margin-bottom: 6px; }
  .pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .round { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
  input[type='color'] { padding: 4px; }
</style>
```

`src/routes/admin/AdminPairings.svelte`:
```svelte
<script lang="ts">
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import { orderSlots, pairingErrors, type Slot } from '../../lib/scoring';
  import type { EventPlayerRow, GroupPlayerRow, GroupRow, RoundRow } from '../../lib/data/types';

  let { roundId }: { roundId: string } = $props();

  type Draft = { groupNo: number; teeTime: string; a: string[]; b: string[] };
  let round = $state<RoundRow | null>(null);
  let members = $state<EventPlayerRow[]>([]);
  let drafts = $state<Draft[]>([]);
  let errors = $state<string[]>([]);
  let msg = $state<string | null>(null);

  async function load() {
    const id = roundId;
    const r = (await must(supabase.from('rounds').select('*').eq('id', id).single())) as RoundRow;
    const [eps, gs] = await Promise.all([
      must(supabase.from('event_players').select('*').eq('event_id', r.event_id)) as Promise<EventPlayerRow[]>,
      must(supabase.from('groups').select('*, group_players(*)').eq('round_id', id).order('group_no')) as Promise<
        (GroupRow & { group_players: GroupPlayerRow[] })[]
      >,
    ]);
    round = r;
    members = eps;
    const count = Math.max(1, Math.floor(eps.length / 4));
    drafts = Array.from({ length: count }, (_, i) => {
      const g = gs.find((x) => x.group_no === i + 1);
      const at = (slot: Slot) => g?.group_players.find((p) => p.slot === slot)?.player_id ?? '';
      return { groupNo: i + 1, teeTime: g?.tee_time?.slice(0, 5) ?? '', a: [at('A1'), at('A2')], b: [at('B1'), at('B2')] };
    });
  }
  $effect(() => {
    void load();
  });

  const nameOf = (id: string) => db.players.find((p) => p.id === id)?.name ?? '?';
  const hcpOf = (id: string) => Number(members.find((m) => m.player_id === id)?.handicap ?? 0);
  const teamPlayers = (team: 'A' | 'B') => members.filter((m) => m.team === team);

  /** Lower handicap goes to slot 1, so low plays low and high plays high in day-3 singles. */
  function autoOrder(pair: string[]) {
    if (!pair[0] || !pair[1]) return;
    const sorted = orderSlots('A', pair.map((id) => ({ playerId: id, handicap: hcpOf(id) })));
    pair[0] = sorted[0].playerId;
    pair[1] = sorted[1].playerId;
  }
  // Explicit handler rather than bind: — the pair arrays are reached through an inline {#each} literal.
  function pick(pair: string[], i: number, e: Event) {
    pair[i] = (e.currentTarget as HTMLSelectElement).value;
    autoOrder(pair);
  }
  function swap(pair: string[]) {
    [pair[0], pair[1]] = [pair[1], pair[0]];
  }

  async function saveAll() {
    msg = null;
    errors = pairingErrors(drafts.map((d) => ({ a: d.a.map((x) => x || null), b: d.b.map((x) => x || null) })));
    if (errors.length) return;
    try {
      for (const d of drafts) {
        await must(
          supabase.rpc('save_group', {
            p_round_id: roundId,
            p_group_no: d.groupNo,
            p_tee_time: d.teeTime || null,
            p_slots: [
              { slot: 'A1', player_id: d.a[0] },
              { slot: 'A2', player_id: d.a[1] },
              { slot: 'B1', player_id: d.b[0] },
              { slot: 'B2', player_id: d.b[1] },
            ],
          }),
        );
      }
      await loadAll();
      msg = 'Pairings saved';
    } catch (e) {
      errors = [(e as Error).message];
    }
  }
</script>

{#if round}
  <p><a href="#/admin/events/{round.event_id}">← Event</a></p>
  <h1>{round.name} pairings</h1>
  <p class="muted small">Pick 2 players per team for each group. The lower handicap is put first automatically; ⇅ swaps them (on singles days, player 1 plays the other team's player 1).</p>
  {#each drafts as d (d.groupNo)}
    <section class="card">
      <div class="row">
        <h3>Group {d.groupNo}</h3>
        <input aria-label="Group {d.groupNo} tee time" type="time" bind:value={d.teeTime} />
      </div>
      {#each [{ team: 'A' as const, pair: d.a }, { team: 'B' as const, pair: d.b }] as side (side.team)}
        <div class="pair">
          {#each [0, 1] as i (i)}
            <select
              aria-label="Group {d.groupNo} team {side.team} player {i + 1}"
              value={side.pair[i]}
              onchange={(e) => pick(side.pair, i, e)}
              style="border-color:var(--team-{side.team === 'A' ? 'a' : 'b'})"
            >
              <option value="">—</option>
              {#each teamPlayers(side.team) as m (m.player_id)}
                <option value={m.player_id}>{nameOf(m.player_id)} ({m.handicap})</option>
              {/each}
            </select>
          {/each}
          <button class="secondary" aria-label="Swap team {side.team} order" onclick={() => swap(side.pair)}>⇅</button>
        </div>
      {/each}
    </section>
  {/each}
  {#each errors as err (err)}<p class="error">{err}</p>{/each}
  {#if msg}<p>{msg}</p>{/if}
  <button class="wide" onclick={saveAll}>Save pairings</button>
{:else}
  <p class="center muted">Loading…</p>
{/if}

<style>
  .pair { display: grid; grid-template-columns: 1fr 1fr 48px; gap: 6px; margin-top: 8px; }
  .pair select { border-width: 2px; }
  .row h3 { margin: 0; flex: 1; }
  .row input { width: 120px; }
  .wide { width: 100%; }
</style>
```

- [ ] **Step 2: Add the routes in `src/App.svelte`**

Imports:
```svelte
  import AdminEvents from './routes/admin/AdminEvents.svelte';
  import AdminEvent from './routes/admin/AdminEvent.svelte';
  import AdminPairings from './routes/admin/AdminPairings.svelte';
```
Branches (above the ROUTES comment):
```svelte
      {:else if route.name === 'admin-events'}
        <AdminEvents />
      {:else if route.name === 'admin-event'}
        {#key route.eventId}
          <AdminEvent eventId={route.eventId} />
        {/key}
      {:else if route.name === 'admin-pairings'}
        {#key route.roundId}
          <AdminPairings roundId={route.roundId} />
        {/key}
```

- [ ] **Step 3: Verify the full admin flow from scratch**

Run: `npm run check && npm run build`. Expected: 0 errors.

In the browser, sign in as admin:
1. Events → create "Test Trip" → on its page, rename Team A to "Europe" in blue and Team B to "USA" in red. Tick Active and Save. The leaderboard now shows "Test Trip" with no rounds.
2. Assign 6 players to each team, change one handicap and Save. The counts read 6 · 6.
3. Add a round on "Seed Links" dated today. Set allowance 90 and tick singles. Save.
4. Pairings → pick 4 players per group. Picking the higher handicap first swaps them automatically. Try the same player in two groups and Save: you get "A player is in more than one place…". Fix it and Save: "Pairings saved".
5. The leaderboard shows 3 groups × 3 cards, and the tracker total is 6 (3 × 2).

Afterwards run `npm run seed -- --yes-wipe`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): events, teams, rounds and pairings"
```

---

### Task 15: Installable app (manifest, icons and service worker)

**Files:**
- Create: `public/manifest.webmanifest`, `public/icon.svg`, `public/sw.js`, `scripts/make-icons.ts`, generated `public/icon-180.png`, `public/icon-192.png` and `public/icon-512.png`
- Modify: `index.html` and `src/main.ts`

- [ ] **Step 1: Write the assets**

`public/icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0b3d2e"/>
  <ellipse cx="256" cy="410" rx="150" ry="36" fill="#1d6b4f"/>
  <rect x="244" y="96" width="16" height="316" rx="8" fill="#ffffff"/>
  <path d="M260 104 L408 152 L260 200 Z" fill="#e8b21f"/>
  <circle cx="318" cy="396" r="20" fill="#ffffff"/>
</svg>
```

`public/manifest.webmanifest`:
```json
{
  "name": "Golf Trip Cup",
  "short_name": "Golf Cup",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f4f6f3",
  "theme_color": "#0b3d2e",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

`public/sw.js` (network-first, so a new deploy is picked up straight away, with a cached fallback when there's no signal):
```js
const CACHE = 'golf-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? Response.error())),
  );
});
```

`scripts/make-icons.ts`:
```ts
// Renders public/icon.svg to the PNG sizes iOS/Android need. Usage: npm run icons
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch();
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icon-${size}.png` });
  await page.close();
}
await browser.close();
console.log('Wrote public/icon-180.png, icon-192.png, icon-512.png');
```

- [ ] **Step 2: Generate the icons**

Run: `npx playwright install chromium && npm run icons`
Expected: "Wrote public/icon-180.png, …", and the three PNGs exist.

- [ ] **Step 3: Wire them up**

In `index.html`, add inside `<head>` after the theme-color meta:
```html
    <link rel="manifest" href="./manifest.webmanifest" />
    <link rel="icon" href="./icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="./icon-180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Golf Cup" />
```

Append to `src/main.ts`:
```ts
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('./sw.js');
}
```

- [ ] **Step 4: Verify**

Run: `npm run build && npm run preview -- --port 4173`, then open http://localhost:4173. In DevTools → Application:
- the Manifest shows "Golf Trip Cup" with icons and no errors;
- the Service Worker is "activated".

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: installable PWA manifest, icons and network-first service worker"
```

---

### Task 16: End-to-end tests (Playwright, phone viewport, dev project)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/helpers.ts`, `tests/e2e/trip.spec.ts`

**Interfaces:**
- Consumes: the seed script (Task 6); the accessible names and test ids from Tasks 9–12.
- Each test re-seeds `golf-dev`, so tests are independent. They run serially with 1 worker, because they share one database.

- [ ] **Step 1: Write the config and helpers**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

process.loadEnvFile('.env.local');

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { ...devices['Pixel 7'], baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
});
```

`tests/e2e/helpers.ts`:
```ts
import { execSync } from 'node:child_process';
import { devices, expect, type Browser, type Page } from '@playwright/test';

export function reseed() {
  execSync('npm run seed -- --yes-wipe', { stdio: 'pipe' });
}

export async function newPhone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:5173' });
  return ctx.newPage();
}

export async function login(page: Page, password = process.env.TRIP_PASSWORD!) {
  await page.goto('/');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByTestId('tracker')).toBeVisible();
}

export async function openGroup1(page: Page) {
  await page.goto('/#/score');
  await page.getByRole('button', { name: /^Group 1/ }).click();
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
  page.locator('[data-match-id$=":better_ball"]').filter({ hasText: 'Group 1' });
```

- [ ] **Step 2: Write the tests**

`tests/e2e/trip.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { enterHole, group1Card, login, newPhone, openGroup1, reseed } from './helpers';

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
  await page.getByRole('button', { name: 'Confirm result' }).click();
  await expect(page.getByTestId('match-card')).toContainText('FINAL');

  await page.goto('/#/');
  await expect(page.getByTestId('conf-a')).toHaveText('1');

  await page.goto('/#/score');
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
```

- [ ] **Step 3: Run the tests**

Run: `npm run e2e`
Expected: 6 passed.

If the "live" test is flaky because Realtime isn't subscribed yet when the scorer saves, don't add sleeps. Instead, wait in `login()` for the store to be loaded (the tracker is visible) and rely on the `SUBSCRIBED` → `loadAll()` catch-up that is already in the store. Re-run 3 times with `npx playwright test --repeat-each=3` to check it's stable.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(e2e): login, live updates, corrections, confirm/lock, offline, photos"
```

---

### Task 17: Deploy — production Supabase, GitHub Pages and README

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`, `.env.prod` (gitignored)

- [ ] **Step 1: Apply the migrations to `golf-prod` via MCP**

For each migration file in order, call `apply_migration` on the **golf-prod** project ref, with the same `name`s as in Task 5. Then call:
- `list_tables`: 10 tables, with RLS enabled;
- `get_advisors` (security): only the intentional `set_player_photo` definer warning;
- `get_project_url` and `get_publishable_keys`, recording the values for `.env.prod`.

- [ ] **Step 2: USER ACTION — production secrets and logins**

Ask the user to:
1. Confirm that sign-ups are **off** in `golf-prod` (Task 0, Step 3).
2. Copy the `golf-prod` **secret** key.
3. Choose the real trip password (this is what goes in WhatsApp) and the admin password.

Create `.env.prod` (gitignored) with the prod URL, publishable key, secret key and both passwords. Then run:
```bash
node --env-file=.env.prod --import tsx scripts/create-users.ts
```
Expected: "Created trip@example.com" and "Created admin@example.com".

**Never run `scripts/seed.ts` against prod.** It wipes everything, and it only reads `.env.local`.

- [ ] **Step 3: Write the deploy workflow**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
          VITE_SUPABASE_KEY: ${{ vars.VITE_SUPABASE_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Write `README.md`**

````markdown
# Golf Trip Cup

Live Ryder Cup–style scoring for a golf trip: 12 players, 2 teams, 3 fourballs, better-ball matchplay
(plus optional low/high singles), handicaps at 90% off the lowest in each group, a live team tracker,
per-match confirmation and player photos. Free to run: Supabase free tier + GitHub Pages.

- Design: `docs/superpowers/specs/2026-09-27-golf-ryder-cup-design.md`
- Build plan: `docs/superpowers/plans/2026-09-27-golf-ryder-cup-phase1.md`

## Everyday use

- Share the site link and the **trip password** in WhatsApp.
- On iPhone: open the link in Safari → Share → **Add to Home Screen** for a full-screen app.
- One person per fourball uses **Scores**. Everyone else watches the **Leaderboard**.
- Wrong score? Tap the hole number in the strip, fix it and save. Everything recalculates.
- When a match finishes, open it and tap **Confirm result**. That locks it and its points go solid.
  Only the admin can unlock a confirmed result.

## Before the trip (organiser checklist)

1. **Wake the database.** Free Supabase projects pause after 7 days without use. Open the site 1–2 days
   before, and if it won't load, go to supabase.com → golf-prod → **Restore project**.
2. Admin → Courses: enter each course's par and stroke index from the scorecard.
3. Admin → Players: everyone's name and handicap. Photos can be added here or by players themselves.
4. Admin → Events: create the event, name and colour the teams, tick **Active**, assign 6 players per team,
   and set the playing handicaps.
5. Add a round per day (course and date). Tick **singles** on day 3.
6. Pairings: pick each fourball. The lower handicap is ordered first automatically.

## Development

Requires Node 22. Uses a separate `golf-dev` Supabase project, so no Docker is needed.

```bash
cp .env.example .env.local   # fill in golf-dev values
npm install
npm run users                # create the trip/admin logins
npm run seed -- --yes-wipe   # DEV ONLY: wipe + demo data
npm run dev                  # http://localhost:5173
npm test                     # unit + database (PGlite) tests
npm run e2e                  # Playwright, phone viewport, against golf-dev
```

Migrations live in `supabase/migrations/`. Apply new ones to golf-dev first, then golf-prod
(via the Supabase MCP `apply_migration`, or paste them into the SQL editor).

## Changing passwords

Edit `TRIP_PASSWORD` / `ADMIN_PASSWORD` in `.env.prod`, then run
`node --env-file=.env.prod --import tsx scripts/create-users.ts`.

## Security notes

- The publishable key in the site is public by design. Row-level security allows only the two logins.
- Public sign-ups are **disabled** in both projects. Keep them off.
- `.env.local` / `.env.prod` hold the secret key and passwords. They are gitignored; never commit them.
````

- [ ] **Step 5: Run the final full verification**

Run: `npm test && npm run check && npm run build && npm run e2e`
Expected: all unit and database tests pass; 0 type errors; the build succeeds; 6 e2e tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: GitHub Pages deploy workflow and README"
```

- [ ] **Step 7: USER ACTION — GitHub repo and Pages**

The `gh` CLI isn't installed and the GitHub MCP connector failed to connect, so the user does this in the browser:
1. **Repo visibility:** GitHub Pages is free only for **public** repos. The code contains no secrets, so public is fine. If the user wants a private repo, use Cloudflare Pages instead (free for private repos, same `npm run build` / `dist`) and skip the workflow.
2. Create an empty repo (for example `golf-trip-cup`) on github.com without a README.
3. Settings → Pages → Source: **GitHub Actions**.
4. Settings → Secrets and variables → Actions → **Variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` with the **prod** values. These are public values, so they go in Variables rather than Secrets.

Then push:
```bash
git branch -M main
git remote add origin https://github.com/<user>/golf-trip-cup.git
git push -u origin main
```
Expected: the "Deploy to GitHub Pages" action goes green, and the site is live at `https://<user>.github.io/golf-trip-cup/`.

- [ ] **Step 8: Smoke-test production on a real phone**

On a phone, open the Pages URL and log in with the trip password. You should see "No active event yet." Then Admin login → set up the real event (README checklist).
