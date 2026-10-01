# Individual Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add individual events: 2- and 3-player groups playing Stableford, flat match play, Stableford match play, the six pointer and 2 v 1 Stableford. An optional season league table adds up confirmed results.

**Architecture:**
- An individual group's game is a `MatchDef` of type `'individual'`, carrying a `game` field. That lets match pages, locking, confirming and score entry keep working with small changes.
- Match play games reuse `computeMatchState`. The totals games (Stableford, 2 v 1, six pointer) get their own state function in a new pure module, `src/lib/scoring/individual.ts`.
- `buildEventView` branches on `events.kind`.
- One migration widens the database checks and adds the new columns and the `player_points` result field.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, Supabase (Postgres + PostgREST), Vitest (unit tests, plus PGlite database tests), Playwright (e2e against golf-dev).

**Spec:** `docs/superpowers/specs/2026-10-01-individual-events-design.md`

## Global Constraints

- Team cup events behave exactly as today. Every change only adds options, and existing rows keep their meaning (`events.kind` defaults to `'team'`).
- Dev first. Migrations go to golf-dev (`jwyigcqwpcogmdarmwdj`) during the build. Production (`zomsolfxwlzgfpszthst`) and the push to `main` wait for the user's explicit go-ahead.
- Defaults:
  - `pair_game` = `'stableford_match'`
  - `three_game` = `'six_stableford'`
  - `stableford_pct` = 100
  - `match_pct` = 85
  - `match_off_low` = true
- League points:
  - 1 v 1: win 2, halve 1, lose 0.
  - 2 v 1 single: win 4, halve 2, lose 0.
  - 2 v 1, each of the pair: win 2, halve 1, lose 0.
- Six pointer: 4 / 2 / 0 a hole, with ties splitting their places' points (3-3-0, 4-1-1, 2-2-2).
  - Flat six pointer: a pick-up is worst on the hole.
  - Stableford six pointer: a pick-up scores 0.
- Positions: individual groups use slots `P1`–`P3`, and in a 2 v 1, `P1` is the single.
- Code style: match the surrounding code, with short comments explaining *why*, no new dependencies, and plain user-facing copy.
- Commands:
  - Unit and database tests: `npx vitest run`
  - Types: `npm run check`
  - e2e: `npx playwright test` (Node at `~/.local/node/bin`)

## Review Focus

- **Pick-ups everywhere:** a pick-up must score 0 Stableford points. In the flat six pointer it must lose the hole to any real score, and two pick-ups tie. *(Pinned in Task 2's `sixPoints` / `computeGameState` tests.)*
- **Unfinished holes in totals games:** a Stableford, 2 v 1 or six pointer game is "thru" the last hole *every* player has a score for. A hole with one score missing must not count yet. *(Task 2 test: missing score stops the count.)*
- **Low-man strokes when the two handicaps are equal, or when "full handicaps" is chosen:** equal handicaps give 0 shots each. Full handicaps give each player their own course handicap. *(Task 2 tests.)*
- **League table ignores six pointers and unconfirmed games:** only confirmed 1 v 1 and 2 v 1 results add up. *(Task 2 `leagueTable` test.)*
- **A team event must look and behave exactly as before** after the view and score entry changes. *(Covered by the full existing unit and e2e suites, run in Tasks 3, 4 and 7.)*

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261001000029_individual_events.sql` (new) | Columns, widened checks, `player_points`, the new `confirm_match` / `watch_confirm_match` signatures, `score_locked` |
| `src/lib/scoring/types.ts` | `Slot` + `P1–P3`; `MatchType` + `'individual'`; `Winner`; game types; new optional fields on `RoundSettings`, `MatchDef`, `MatchState`, `ConfirmedResult` |
| `src/lib/scoring/individual.ts` (new) | `gameFor`, `buildGame`, `sixPoints`, `computeGameState`, `leaguePoints`, `gameResult`, `leagueTable`, `gameLabel` |
| `src/lib/scoring/tracker.ts` | `resultFromState` delegates individual games to `gameResult` |
| `src/lib/scoring/index.ts` | Export `individual` |
| `src/lib/data/types.ts` | Row types: `EventRow.kind/league`, round game columns, nullable team, `player_points` |
| `src/lib/view.ts` | Individual branch in `buildEventView`; `settingsOf` new fields; `EventView.league`; labels for P slots |
| `src/App.svelte` | Neutral side colours for individual events |
| `src/components/MatchCard.svelte` | Game label; six pointer layout |
| `src/components/LeagueTable.svelte` (new) | Season table |
| `src/routes/Leaderboard.svelte` | Individual leaderboard (table + game cards, no team tracker) |
| `src/routes/ScoreEntry.svelte` | P slots, individual shots/points chips |
| `src/routes/Match.svelte` | Confirm passes `p_player_points` |
| `src/routes/admin/AdminEvents.svelte` | New event: Team cup / Individual + Season league |
| `src/routes/admin/AdminEvent.svelte` | Individual mode: no teams, simple player list, game settings per round |
| `src/routes/admin/AdminPairings.svelte` | Individual groups of 2–3, choose the single |
| `src/lib/scoring/pairings.ts` | `individualPairingErrors` |
| `tests/e2e/helpers.ts`, `tests/e2e/individual.spec.ts` (new) | Individual event seeding helper and e2e tests |

---

### Task 1: Database: individual event columns, wider checks, `player_points`

**Files:**
- Create: `supabase/migrations/20261001000029_individual_events.sql`
- Test: `tests/db/db.test.ts`

**Interfaces:**
- Produces:
  - Columns `events.kind`, `events.league`, `rounds.pair_game`, `rounds.three_game`, `rounds.stableford_pct`, `rounds.match_pct`, `rounds.match_off_low` and `match_results.player_points`.
  - Slots `P1–P3`, `match_type 'individual'`, and winners `P1–P3`.
  - `confirm_match(p_group_id, p_match_type, p_winner, p_points_a, p_points_b, p_result_text, p_final_hole, p_player_points jsonb default null)`, with `watch_confirm_match` gaining the same trailing parameter.

- [ ] **Step 1: Write the failing tests.** Add this to `tests/db/db.test.ts`, after the `'starts new rounds on a 35% / 15% scramble split…'` test:

```ts
  it('defaults events to team cups and new rounds to the individual game defaults', async () => {
    const e = await db.query(`select kind, league from public.events where id = $1`, [s.eventId]);
    expect(e.rows[0]).toEqual({ kind: 'team', league: false });
    const r = await db.query(
      `select pair_game, three_game, stableford_pct::float as sp, match_pct::float as mp, match_off_low from public.rounds where id = $1`,
      [s.roundId],
    );
    expect(r.rows[0]).toEqual({ pair_game: 'stableford_match', three_game: 'six_stableford', sp: 100, mp: 85, match_off_low: true });
    await expect(db.query(`update public.rounds set pair_game = 'skins' where id = $1`, [s.roundId])).rejects.toThrow(/check constraint/);
    await expect(db.query(`update public.events set kind = 'solo' where id = $1`, [s.eventId])).rejects.toThrow(/check constraint/);
  });

  it('lets an individual event have players without a team, in 2- or 3-player groups', async () => {
    await db.query(`update public.events set kind = 'individual' where id = $1`, [s.eventId]);
    await db.query(`update public.event_players set team = null where event_id = $1`, [s.eventId]);
    await db.query(`delete from public.group_players where group_id = $1`, [s.groupId]);
    for (const [slot, key] of [['P1', 'a1'], ['P2', 'a2'], ['P3', 'b1']] as const) {
      await db.query(`insert into public.group_players(group_id, slot, player_id) values ($1, $2, $3)`, [s.groupId, slot, s.players[key]]);
    }
    await expect(db.query(`update public.event_players set team = 'C' where event_id = $1`, [s.eventId])).rejects.toThrow(/check constraint/);
  });

  it('confirms an individual game with each player\'s points, and locks its players\' holes', async () => {
    await db.query(`delete from public.group_players where group_id = $1`, [s.groupId]);
    for (const [slot, key] of [['P1', 'a1'], ['P2', 'a2']] as const) {
      await db.query(`insert into public.group_players(group_id, slot, player_id) values ($1, $2, $3)`, [s.groupId, slot, s.players[key]]);
    }
    const pts = JSON.stringify({ [s.players.a1]: { points: 0, stableford: 36 }, [s.players.a2]: { points: 0, stableford: 30 } });
    const r = await as(db, 'trip', () =>
      db.query<{ r: string }>(
        `select public.confirm_match($1::uuid, 'individual', 'A', 2, 0, '3&2', 16, $2::jsonb) as r`,
        [s.groupId, pts],
      ),
    );
    expect(r.rows[0].r).toBe('ok');
    const row = await db.query<{ winner: string; player_points: Record<string, { stableford: number }> }>(
      `select winner, player_points from public.match_results where group_id = $1`,
      [s.groupId],
    );
    expect(row.rows[0].winner).toBe('A');
    expect(row.rows[0].player_points[s.players.a1].stableford).toBe(36);
    await expect(upsert('trip', s.players.a1, 16, 5)).rejects.toThrow(/locked/);
    expect(await upsert('trip', s.players.a1, 17, 5)).toBe('ok');
  });

  it('accepts a six pointer winner by position', async () => {
    const r = await as(db, 'trip', () =>
      db.query<{ r: string }>(`select public.confirm_match($1::uuid, 'individual', 'P2', 0, 0, '40 pts', 18) as r`, [s.groupId]),
    );
    expect(r.rows[0].r).toBe('ok');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/db/db.test.ts`
Expected: the 4 new tests FAIL (column "kind" does not exist / check constraint / function signature). The existing tests pass.

Check the `upsert` helper's lock error text before relying on `/locked/`. Run `grep -n "locked" supabase/migrations/20260929000016_default_never_beats_real.sql`. If the message differs (e.g. "score is locked"), keep `/locked/` only if it matches.

- [ ] **Step 3: Write the migration** `supabase/migrations/20261001000029_individual_events.sql`:

```sql
-- Individual events: 2- and 3-player groups playing each other (no teams), optionally as a season league.
-- Team cup events are unchanged: every new column defaults to today's behaviour.

alter table public.events
  add column kind text not null default 'team' check (kind in ('team', 'individual')),
  add column league boolean not null default false;

-- Individual events have no teams.
alter table public.event_players alter column team drop not null;
alter table public.event_players drop constraint event_players_team_check;
alter table public.event_players add constraint event_players_team_check check (team is null or team in ('A', 'B'));

-- An individual round's games. A league event's 3-player groups always play 2 v 1 Stableford.
alter table public.rounds
  add column pair_game text not null default 'stableford_match'
    check (pair_game in ('stableford', 'flat_match', 'stableford_match')),
  add column three_game text not null default 'six_stableford'
    check (three_game in ('six_stableford', 'six_flat')),
  add column stableford_pct numeric(5,2) not null default 100 check (stableford_pct between 0 and 100),
  add column match_pct numeric(5,2) not null default 85 check (match_pct between 0 and 100),
  add column match_off_low boolean not null default true;

-- P1-P3: an individual group's positions (in a 2 v 1, P1 plays alone).
alter table public.group_players drop constraint group_players_slot_check;
alter table public.group_players add constraint group_players_slot_check
  check (slot in ('A1', 'A2', 'B1', 'B2', 'P1', 'P2', 'P3'));

-- One 'individual' result per individual group; a six pointer is won by a position.
alter table public.match_results drop constraint match_results_match_type_check;
alter table public.match_results add constraint match_results_match_type_check
  check (match_type in ('better_ball', 'low_singles', 'high_singles', 'individual'));
alter table public.match_results drop constraint match_results_winner_check;
alter table public.match_results add constraint match_results_winner_check
  check (winner in ('A', 'B', 'halved', 'P1', 'P2', 'P3'));
-- { playerId: { points, stableford } }: game points and Stableford total (the league tiebreak).
alter table public.match_results add column player_points jsonb;

-- confirm_match gains p_player_points (optional, so team confirms keep working unchanged).
drop function public.confirm_match(uuid, text, text, numeric, numeric, text, int);
create function public.confirm_match(
  p_group_id uuid, p_match_type text, p_winner text, p_points_a numeric, p_points_b numeric, p_result_text text,
  p_final_hole int, p_player_points jsonb default null
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'not a trip member' using errcode = '42501';
  end if;
  insert into public.match_results (group_id, match_type, winner, points_a, points_b, result_text, final_hole, player_points)
  values (p_group_id, p_match_type, p_winner, p_points_a, p_points_b, p_result_text, p_final_hole, p_player_points)
  on conflict (group_id, match_type) do nothing;
  if found then
    return 'ok';
  end if;
  return 'already_confirmed';
end;
$$;
revoke execute on function public.confirm_match(uuid, text, text, numeric, numeric, text, int, jsonb) from public, anon;
grant execute on function public.confirm_match(uuid, text, text, numeric, numeric, text, int, jsonb) to authenticated;

drop function public.watch_confirm_match(text, uuid, text, text, numeric, numeric, text, int);
create function public.watch_confirm_match(
  p_token text, p_group_id uuid, p_match_type text, p_winner text, p_points_a numeric, p_points_b numeric,
  p_result_text text, p_final_hole int, p_player_points jsonb default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.groups g join public.rounds r on r.id = g.round_id
    where g.id = p_group_id and r.event_id = public.watch_link_event(p_token)
  ) then
    raise exception 'not this event''s match' using errcode = '42501';
  end if;
  insert into public.match_results (group_id, match_type, winner, points_a, points_b, result_text, final_hole, player_points)
  values (p_group_id, p_match_type, p_winner, p_points_a, p_points_b, p_result_text, p_final_hole, p_player_points)
  on conflict (group_id, match_type) do nothing;
  if found then
    return 'ok';
  end if;
  return 'already_confirmed';
end;
$$;
revoke execute on function public.watch_confirm_match(text, uuid, text, text, numeric, numeric, text, int, jsonb) from public;
grant execute on function public.watch_confirm_match(text, uuid, text, text, numeric, numeric, text, int, jsonb) to anon, authenticated;

-- A confirmed individual game locks all its players' holes up to its final hole.
create or replace function public.score_locked(p_round_id uuid, p_player_id uuid, p_hole int) returns boolean
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
        mr.match_type in ('better_ball', 'individual')
        or (mr.match_type = 'low_singles'
            and gp.slot in ('A1', case when g.singles_crossed then 'B2' else 'B1' end))
        or (mr.match_type = 'high_singles'
            and gp.slot in ('A2', case when g.singles_crossed then 'B1' else 'B2' end))
      )
  )
$$;
```

Before writing, confirm the constraint names. Run `grep -n "slot text\|team text\|match_type text\|winner text" supabase/migrations/20260927000001_schema.sql`. They're inline checks, so Postgres names them `<table>_<column>_check`. If a later migration renamed one, use that name. Also confirm the latest `score_locked` body matches `supabase/migrations/20260928000010_singles_pairing.sql`, with only the `in ('better_ball', 'individual')` change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db`
Expected: all pass (the 4 new tests included).

- [ ] **Step 5: Apply to golf-dev only.** Use the Supabase MCP `apply_migration` with `project_id: jwyigcqwpcogmdarmwdj`, name `individual_events`, and the file's SQL. Don't touch production.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261001000029_individual_events.sql tests/db/db.test.ts
git commit -m "feat(db): individual events — event kind, round games, P1–P3 slots, player_points on results"
```

---

### Task 2: Scoring: the individual games (pure, unit-tested)

**Files:**
- Modify: `src/lib/scoring/types.ts`
- Create: `src/lib/scoring/individual.ts`
- Modify: `src/lib/scoring/tracker.ts` (`resultFromState`)
- Modify: `src/lib/scoring/index.ts` (add `export * from './individual';`)
- Test: `src/lib/scoring/individual.test.ts`

**Interfaces:**
- Consumes: `computeMatchState`, `playerHole`, `scoreKey`, `indexScores` (matchState.ts); `playingStrokes`, `strokesOnHole` (strokes.ts).
- Produces:

```ts
export type Slot = 'A1' | 'A2' | 'B1' | 'B2' | 'P1' | 'P2' | 'P3';
export type MatchType = 'better_ball' | 'low_singles' | 'high_singles' | 'individual';
export type Winner = Outcome | 'P1' | 'P2' | 'P3';
export type PairGame = 'stableford' | 'flat_match' | 'stableford_match';
export type ThreeGame = 'six_stableford' | 'six_flat' | 'two_v_one';
export type IndividualGame = PairGame | ThreeGame;
export interface PlayerPoints { points: number; stableford: number }
// RoundSettings (all optional): pairGame?: PairGame; threeGame?: 'six_stableford' | 'six_flat'; stablefordPct?: number; matchPct?: number; matchOffLow?: boolean
// MatchDef (all optional): game?: IndividualGame; players?: string[]; league?: boolean; stablefordStrokes?: Record<string, number>
// MatchState: winner: Winner | null; totals?: Record<string, number>; stableford?: Record<string, number>
// ConfirmedResult: winner: Winner; playerPoints?: Record<string, PlayerPoints>
export interface GamePlayer { slot: Slot; playerId: string; handicap: number }
export function gameFor(size: number, s: RoundSettings, league: boolean): IndividualGame | null;
export function buildGame(groupId: string, players: GamePlayer[], s: RoundSettings, league: boolean): MatchDef | null;
export function sixPoints(values: number[], higherIsBetter: boolean): number[];
export function computeGameState(def: MatchDef, holes: HoleInfo[], idx: ScoreIndex): MatchState;
export function leaguePoints(def: MatchDef, winner: Winner): { pointsA: number; pointsB: number };
export function gameResult(def: MatchDef, state: MatchState): ConfirmedResult | null;
export interface LeagueRow { playerId: string; played: number; won: number; halved: number; lost: number; points: number; stableford: number }
export function leagueTable(games: { def: MatchDef; result: ConfirmedResult | null }[], playerIds: string[], nameOf?: (id: string) => string): LeagueRow[];
export function gameLabel(game: IndividualGame): string;
```

- [ ] **Step 1: Update `src/lib/scoring/types.ts`.** Replace the `Slot`, `MatchType` and `Outcome` lines with:

```ts
export type Team = 'A' | 'B';
/** A1–B2: a fourball's positions. P1–P3: an individual group's (in a 2 v 1, P1 plays alone). */
export type Slot = 'A1' | 'A2' | 'B1' | 'B2' | 'P1' | 'P2' | 'P3';
export type MatchType = 'better_ball' | 'low_singles' | 'high_singles' | 'individual';
export type Outcome = Team | 'halved';
/** A result's winner: a side, halved, or (six pointer) a position. */
export type Winner = Outcome | 'P1' | 'P2' | 'P3';
export type PairGame = 'stableford' | 'flat_match' | 'stableford_match';
export type ThreeGame = 'six_stableford' | 'six_flat' | 'two_v_one';
export type IndividualGame = PairGame | ThreeGame;
/** A player's figures from a confirmed individual game: game points, and Stableford total (the league tiebreak). */
export interface PlayerPoints { points: number; stableford: number }
```

Add these to `RoundSettings`, after `scrambleHighPct?`:

```ts
  /** Individual events: the 2-player game, the 3-player game (league events play 2 v 1 instead), and handicap settings. */
  pairGame?: PairGame;
  threeGame?: 'six_stableford' | 'six_flat';
  /** % of course handicap in the Stableford games (default 100). */
  stablefordPct?: number;
  /** Stableford match play off the low man: % of the difference (default 85). */
  matchPct?: number;
  /** Stableford match play: off the low man (default) or full handicaps. */
  matchOffLow?: boolean;
```

Add these to `MatchDef`, after `teeHoles?`:

```ts
  /** Individual events: the game this group plays. */
  game?: IndividualGame;
  /** Individual events: the players in position order (P1, P2, P3). */
  players?: string[];
  /** Individual events: a season league game (results earn league points). */
  league?: boolean;
  /** Individual events: each player's strokes off full handicap × the Stableford % (for Stableford totals). */
  stablefordStrokes?: Record<string, number>;
```

In `MatchState`, change `winner: Outcome | null;` to `winner: Winner | null;`, then add:

```ts
  /** Individual totals games: each player's points so far (six pointer points, or Stableford points). */
  totals?: Record<string, number>;
  /** Individual games: each player's Stableford total off full handicap × the Stableford %, over the holes scored. */
  stableford?: Record<string, number>;
```

In `ConfirmedResult`, change `winner: Outcome;` to `winner: Winner;`, and add `playerPoints?: Record<string, PlayerPoints>;`.

- [ ] **Step 2: Write the failing tests** in `src/lib/scoring/individual.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGame, computeGameState, gameFor, gameResult, leaguePoints, leagueTable, sixPoints } from './individual';
import { indexScores } from './matchState';
import type { HoleInfo, RoundSettings, ScoreEntry } from './types';

const base: RoundSettings = { allowancePct: 90, betterBallPoints: 1, singlesEnabled: false, singlesPoints: 0.5, singlesAllowancePct: 90 };
// Par 4s, stroke index = hole number.
const holes: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));
const two = (h1: number, h2: number) => [
  { slot: 'P1' as const, playerId: 'p1', handicap: h1 },
  { slot: 'P2' as const, playerId: 'p2', handicap: h2 },
];
const three = (h1: number, h2: number, h3: number) => [...two(h1, h2), { slot: 'P3' as const, playerId: 'p3', handicap: h3 }];
/** Scores for holes 1..n: gross per player, or 'P' for a pick-up. */
function card(rows: Record<string, (number | 'P')[]>): ScoreEntry[] {
  return Object.entries(rows).flatMap(([playerId, gs]) =>
    gs.map((g, i) => ({ playerId, hole: i + 1, gross: g === 'P' ? null : g, pickedUp: g === 'P' })),
  );
}
const all = (n: number) => Array(18).fill(n);

describe('gameFor', () => {
  it('picks the 2-player game, the six pointer when the league is off, and 2 v 1 when it is on', () => {
    expect(gameFor(2, base, false)).toBe('stableford_match');
    expect(gameFor(2, { ...base, pairGame: 'flat_match' }, true)).toBe('flat_match');
    expect(gameFor(3, base, false)).toBe('six_stableford');
    expect(gameFor(3, { ...base, threeGame: 'six_flat' }, false)).toBe('six_flat');
    expect(gameFor(3, { ...base, threeGame: 'six_flat' }, true)).toBe('two_v_one');
    expect(gameFor(1, base, false)).toBeNull();
    expect(gameFor(4, base, false)).toBeNull();
  });
});

describe('buildGame strokes', () => {
  it('Stableford match play off the low man at 85%: 8 v 20 gives the 20 ten shots', () => {
    const def = buildGame('g', two(8, 20), base, false)!;
    expect(def.type).toBe('individual');
    expect(def.game).toBe('stableford_match');
    expect(def.strokes).toEqual({ p1: 0, p2: 10 }); // 12 × 0.85 = 10.2 → 10
    expect(def.stableford).toBe(true);
    expect(def.sideA).toEqual(['p1']);
    expect(def.sideB).toEqual(['p2']);
  });
  it('equal handicaps off the low man give no shots; full handicaps give each their own', () => {
    expect(buildGame('g', two(12, 12), base, false)!.strokes).toEqual({ p1: 0, p2: 0 });
    expect(buildGame('g', two(8, 20), { ...base, matchOffLow: false }, false)!.strokes).toEqual({ p1: 8, p2: 20 });
  });
  it('flat games give no shots; Stableford games use full handicap × the Stableford %', () => {
    expect(buildGame('g', two(8, 20), { ...base, pairGame: 'flat_match' }, false)!.strokes).toEqual({ p1: 0, p2: 0 });
    expect(buildGame('g', two(8, 20), { ...base, pairGame: 'stableford', stablefordPct: 95 }, false)!.strokes).toEqual({ p1: 8, p2: 19 });
    expect(buildGame('g', three(6, 14, 3), { ...base, threeGame: 'six_flat' }, false)!.strokes).toEqual({ p1: 0, p2: 0, p3: 0 });
  });
  it('2 v 1: P1 is the single against the pair', () => {
    const def = buildGame('g', three(10, 12, 14), base, true)!;
    expect(def.game).toBe('two_v_one');
    expect(def.sideA).toEqual(['p1']);
    expect(def.sideB).toEqual(['p2', 'p3']);
    expect(def.league).toBe(true);
  });
});

describe('sixPoints', () => {
  it('shares 6 points 4/2/0, ties splitting their places', () => {
    expect(sixPoints([5, 3, 1], true)).toEqual([4, 2, 0]);
    expect(sixPoints([3, 3, 1], true)).toEqual([3, 3, 0]);
    expect(sixPoints([4, 2, 2], true)).toEqual([4, 1, 1]);
    expect(sixPoints([2, 2, 2], true)).toEqual([2, 2, 2]);
    expect(sixPoints([4, 5, 6], false)).toEqual([4, 2, 0]); // gross: lower is better
  });
});

describe('computeGameState', () => {
  it('flat match play: lower gross wins the hole, finishes early', () => {
    const def = buildGame('g', two(0, 20), { ...base, pairGame: 'flat_match' }, false)!;
    const st = computeGameState(def, holes, indexScores(card({ p1: Array(10).fill(4), p2: Array(10).fill(5) })));
    expect(st.decided).toBe(true);
    expect(st.resultText).toBe('10&8');
    expect(st.winner).toBe('A');
    expect(st.stableford?.p1).toBe(20); // 10 pars off 0 = 20 points
  });

  it('Stableford (1 v 1): higher total wins over 18; a pick-up scores 0', () => {
    const def = buildGame('g', two(0, 0), { ...base, pairGame: 'stableford' }, false)!;
    const p2 = all(4); p2[0] = 'P' as never;
    const st = computeGameState(def, holes, indexScores(card({ p1: all(4), p2 })));
    expect(st.totals).toEqual({ p1: 36, p2: 34 });
    expect(st.decided).toBe(true);
    expect(st.winner).toBe('A');
    expect(st.resultText).toBe('By 2 pts');
    expect(st.statusText).toBe('36–34');
  });

  it('a hole only counts once every player has a score', () => {
    const def = buildGame('g', two(0, 0), { ...base, pairGame: 'stableford' }, false)!;
    const st = computeGameState(def, holes, indexScores(card({ p1: [4, 4, 4], p2: [4, 4] })));
    expect(st.thru).toBe(2);
    expect(st.totals).toEqual({ p1: 4, p2: 4 });
    expect(st.decided).toBe(false);
  });

  it('2 v 1: the single against the pair\'s better ball; halved on equal totals', () => {
    const def = buildGame('g', three(0, 0, 0), base, true)!;
    // Single pars everything (36). Pair: p2 bogeys every hole, p3 birdies hole 1 and pars the rest... best ball = 3 + 17×2 = 37.
    const p3 = all(4); p3[0] = 3;
    const st = computeGameState(def, holes, indexScores(card({ p1: all(4), p2: all(5), p3 })));
    expect(st.winner).toBe('B');
    expect(st.statusText).toBe('36–37');
    const level = computeGameState(def, holes, indexScores(card({ p1: all(4), p2: all(5), p3: all(4) })));
    expect(level.winner).toBe('halved');
    expect(level.resultText).toBe('Halved');
  });

  it('six pointer (flat): a pick-up is worst on the hole; two pick-ups tie', () => {
    const def = buildGame('g', three(0, 0, 0), { ...base, threeGame: 'six_flat' }, false)!;
    const st = computeGameState(def, holes.slice(0, 1), indexScores(card({ p1: [5], p2: ['P'], p3: ['P'] })));
    expect(st.totals).toEqual({ p1: 4, p2: 1, p3: 1 });
  });

  it('six pointer (Stableford): totals, statusText in position order, winner by position', () => {
    const def = buildGame('g', three(0, 0, 0), base, false)!;
    // Each hole: p2 birdies (3 pts), p1 pars (2), p3 bogeys (1) -> 2/4/0 a hole.
    const st = computeGameState(def, holes, indexScores(card({ p1: all(4), p2: all(3), p3: all(5) })));
    expect(st.totals).toEqual({ p1: 36, p2: 72, p3: 0 });
    expect(st.statusText).toBe('36 · 72 · 0');
    expect(st.winner).toBe('P2');
    expect(st.decided).toBe(true);
  });
});

describe('league points and results', () => {
  const one = buildGame('g', two(0, 0), { ...base, pairGame: 'stableford' }, true)!;
  const solo = buildGame('g', three(0, 0, 0), base, true)!;
  it('1 v 1: win 2, halve 1 each; 2 v 1: single wins 4 (halve 2), pair 2 each (halve 1)', () => {
    expect(leaguePoints(one, 'A')).toEqual({ pointsA: 2, pointsB: 0 });
    expect(leaguePoints(one, 'halved')).toEqual({ pointsA: 1, pointsB: 1 });
    expect(leaguePoints(solo, 'A')).toEqual({ pointsA: 4, pointsB: 0 });
    expect(leaguePoints(solo, 'B')).toEqual({ pointsA: 0, pointsB: 2 });
    expect(leaguePoints(solo, 'halved')).toEqual({ pointsA: 2, pointsB: 1 });
  });
  it('no league points outside a league or in a six pointer', () => {
    expect(leaguePoints({ ...one, league: false }, 'A')).toEqual({ pointsA: 0, pointsB: 0 });
    expect(leaguePoints(buildGame('g', three(0, 0, 0), base, false)!, 'P1')).toEqual({ pointsA: 0, pointsB: 0 });
  });
  it('gameResult carries the winner, league points and each player\'s points', () => {
    const st = computeGameState(one, holes, indexScores(card({ p1: all(4), p2: all(5) })));
    const r = gameResult(one, st)!;
    expect(r).toMatchObject({ matchType: 'individual', winner: 'A', pointsA: 2, pointsB: 0, finalHole: 18, resultText: 'By 18 pts' });
    expect(r.playerPoints).toEqual({ p1: { points: 36, stableford: 36 }, p2: { points: 18, stableford: 18 } });
    expect(gameResult(one, computeGameState(one, holes, indexScores([])))).toBeNull();
  });
  it('leagueTable: confirmed 1 v 1 and 2 v 1 results only; points, then Stableford, then name', () => {
    const res = (def: typeof one, winner: 'A' | 'B' | 'halved', a: number, b: number, stab: Record<string, number>) => ({
      def,
      result: { groupId: 'g', matchType: 'individual' as const, winner, pointsA: a, pointsB: b, resultText: '', finalHole: 18,
        playerPoints: Object.fromEntries(Object.entries(stab).map(([k, v]) => [k, { points: 0, stableford: v }])) },
    });
    const six = buildGame('g', three(0, 0, 0), base, false)!;
    const rows = leagueTable(
      [
        res(one, 'A', 2, 0, { p1: 30, p2: 28 }),
        res(solo, 'B', 0, 2, { p1: 31, p2: 33, p3: 29 }),
        { def: six, result: { groupId: 'g', matchType: 'individual', winner: 'P1', pointsA: 0, pointsB: 0, resultText: '', finalHole: 18 } },
        { def: one, result: null },
      ],
      ['p1', 'p2', 'p3'],
    );
    expect(rows.map((r) => [r.playerId, r.played, r.won, r.halved, r.lost, r.points, r.stableford])).toEqual([
      ['p2', 2, 1, 0, 1, 2, 61],
      ['p1', 2, 1, 0, 1, 2, 61],
      ['p3', 1, 1, 0, 0, 2, 29],
    ].sort((x, y) => (y[5] as number) - (x[5] as number) || (y[6] as number) - (x[6] as number) || String(x[0]).localeCompare(String(y[0]))));
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/lib/scoring/individual.test.ts`
Expected: FAIL, "Failed to resolve import './individual'".

- [ ] **Step 4: Implement `src/lib/scoring/individual.ts`**

```ts
// Individual events: 2- and 3-player groups playing each other. A group's game is a MatchDef of type
// 'individual': the match play games reuse the fourball match maths; the totals games (Stableford, 2 v 1,
// six pointer) add up points over all 18 holes.
import { computeMatchState, playerHole, scoreKey, type ScoreIndex } from './matchState';
import { playingStrokes, strokesOnHole } from './strokes';
import type {
  ConfirmedResult, HoleInfo, IndividualGame, MatchDef, MatchState, Outcome, PlayerPoints, RoundSettings, Slot, Winner,
} from './types';

export interface GamePlayer { slot: Slot; playerId: string; handicap: number }

const POSITIONS: Slot[] = ['P1', 'P2', 'P3'];
const STABLEFORD_GAMES: IndividualGame[] = ['stableford', 'stableford_match', 'six_stableford', 'two_v_one'];
const isSix = (g: IndividualGame | undefined) => g === 'six_stableford' || g === 'six_flat';

const LABELS: Record<IndividualGame, string> = {
  stableford: 'Stableford',
  flat_match: 'Flat match play',
  stableford_match: 'Stableford match play',
  six_stableford: 'Six pointer (Stableford)',
  six_flat: 'Six pointer (flat)',
  two_v_one: '2 v 1 Stableford',
};
export const gameLabel = (game: IndividualGame) => LABELS[game];

/** The game a group of this size plays: a league event's 3-balls are always 2 v 1. */
export function gameFor(size: number, s: RoundSettings, league: boolean): IndividualGame | null {
  if (size === 2) return s.pairGame ?? 'stableford_match';
  if (size === 3) return league ? 'two_v_one' : (s.threeGame ?? 'six_stableford');
  return null;
}

/** players: each player's course handicap for the day, by position. Null for a group that isn't 2 or 3 players. */
export function buildGame(groupId: string, players: GamePlayer[], s: RoundSettings, league: boolean): MatchDef | null {
  const ps = POSITIONS.map((slot) => players.find((p) => p.slot === slot)).filter((p): p is GamePlayer => !!p);
  const game = gameFor(ps.length, s, league);
  if (!game) return null;
  const ids = ps.map((p) => p.playerId);
  const each = (f: (p: GamePlayer) => number) => Object.fromEntries(ps.map((p) => [p.playerId, f(p)]));
  const stablefordStrokes = each((p) => playingStrokes(p.handicap, s.stablefordPct ?? 100));
  let strokes: Record<string, number>;
  if (game === 'flat_match' || game === 'six_flat') strokes = each(() => 0);
  else if (game === 'stableford_match' && (s.matchOffLow ?? true)) {
    const low = Math.min(...ps.map((p) => p.handicap));
    strokes = each((p) => playingStrokes(p.handicap - low, s.matchPct ?? 85));
  } else if (game === 'stableford_match') strokes = each((p) => p.handicap);
  else strokes = stablefordStrokes;
  // Six pointer: everyone for themselves (one "side"). 1 v 1 and 2 v 1: P1 against the rest.
  const [sideA, sideB] = isSix(game) ? [ids, []] : [ids.slice(0, 1), ids.slice(1)];
  return {
    id: `${groupId}:individual`,
    groupId,
    type: 'individual',
    sideA,
    sideB,
    points: 0,
    strokes,
    game,
    players: ids,
    league,
    stablefordStrokes,
    ...(STABLEFORD_GAMES.includes(game) ? { stableford: true } : {}),
  };
}

/** 4 / 2 / 0 for 1st / 2nd / 3rd; players tied share the points of the places they cover. */
export function sixPoints(values: number[], higherIsBetter: boolean): number[] {
  const PLACES = [4, 2, 0];
  const order = values.map((v, i) => ({ v: higherIsBetter ? -v : v, i })).sort((a, b) => a.v - b.v);
  const out: number[] = Array(values.length).fill(0);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const share = PLACES.slice(k, j + 1).reduce((sum, p) => sum + p, 0) / (j - k + 1);
    for (let t = k; t <= j; t++) out[order[t].i] = share;
    k = j + 1;
  }
  return out;
}

/** Stableford points on a hole with the given strokes (own tee's par and SI); a pick-up scores 0. */
function holePoints(def: MatchDef, id: string, hole: HoleInfo, idx: ScoreIndex, strokes: Record<string, number>): number {
  const e = idx.get(scoreKey(id, hole.hole));
  if (!e || e.pickedUp || e.gross === null) return 0;
  const h = playerHole(def, id, hole);
  return Math.max(0, 2 + h.par - (e.gross - strokesOnHole(strokes[id] ?? 0, h.strokeIndex)));
}

/** Gross for the flat six pointer: a pick-up is worse than any real score (99, so two pick-ups tie). */
function grossOrWorst(id: string, hole: HoleInfo, idx: ScoreIndex): number {
  const e = idx.get(scoreKey(id, hole.hole));
  return !e || e.pickedUp || e.gross === null ? 99 : e.gross;
}

/** Each player's Stableford total (off full handicap × the Stableford %) over every hole they've scored. */
function stablefordTotals(def: MatchDef, holes: HoleInfo[], idx: ScoreIndex): Record<string, number> {
  const ids = def.players ?? [...def.sideA, ...def.sideB];
  const strokes = def.stablefordStrokes ?? def.strokes;
  return Object.fromEntries(
    ids.map((id) => [id, holes.reduce((sum, h) => sum + (idx.has(scoreKey(id, h.hole)) ? holePoints(def, id, h, idx, strokes) : 0), 0)]),
  );
}

export function computeGameState(def: MatchDef, holes: HoleInfo[], idx: ScoreIndex): MatchState {
  const stableford = stablefordTotals(def, holes, idx);
  if (def.game === 'flat_match' || def.game === 'stableford_match') return { ...computeMatchState(def, holes, idx), stableford };

  const sorted = [...holes].sort((x, y) => x.hole - y.hole);
  const ids = def.players ?? [...def.sideA, ...def.sideB];
  const totals: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const holeWinners: (Outcome | null)[] = Array(18).fill(null);
  const running: (number | null)[] = Array(18).fill(null);
  let thru = 0;
  let a = 0;
  let b = 0;
  for (const h of sorted) {
    // A hole counts once every player has a score for it.
    if (!ids.every((id) => idx.has(scoreKey(id, h.hole)))) break;
    if (isSix(def.game)) {
      const values = ids.map((id) => (def.game === 'six_flat' ? grossOrWorst(id, h, idx) : holePoints(def, id, h, idx, def.strokes)));
      sixPoints(values, def.game === 'six_stableford').forEach((p, i) => (totals[ids[i]] += p));
    } else {
      const pts = Object.fromEntries(ids.map((id) => [id, holePoints(def, id, h, idx, def.strokes)]));
      for (const id of ids) totals[id] += pts[id];
      // The pair's better ball: the higher of the two on the hole.
      const pa = Math.max(...def.sideA.map((id) => pts[id]));
      const pb = Math.max(...def.sideB.map((id) => pts[id]));
      a += pa;
      b += pb;
      holeWinners[h.hole - 1] = pa > pb ? 'A' : pb > pa ? 'B' : 'halved';
      running[h.hole - 1] = a - b;
    }
    thru = h.hole;
  }
  const started = thru > 0;
  const decided = sorted.length > 0 && thru === sorted[sorted.length - 1].hole;
  let winner: Winner | null = null;
  let statusText: string;
  let resultText: string | null = null;
  if (isSix(def.game)) {
    statusText = started ? ids.map((id) => totals[id]).join(' · ') : 'Not started';
    if (decided) {
      const best = Math.max(...ids.map((id) => totals[id]));
      const leaders = ids.filter((id) => totals[id] === best);
      winner = leaders.length === 1 ? POSITIONS[ids.indexOf(leaders[0])] as Winner : 'halved';
      resultText = winner === 'halved' ? 'Halved' : `${best} pts`;
    }
  } else {
    statusText = started ? `${a}–${b}` : 'Not started';
    if (decided) {
      winner = a > b ? 'A' : b > a ? 'B' : 'halved';
      const d = Math.abs(a - b);
      resultText = d === 0 ? 'Halved' : `By ${d} pt${d === 1 ? '' : 's'}`;
    }
  }
  return {
    started, thru, lead: a - b, holeWinners, running, decided, dormie: false, winner,
    finalHole: decided ? thru : null, resultText, statusText, projectedA: 0, projectedB: 0, totals, stableford,
  };
}

/** League points: sideA's player (or the single), and each of sideB. None outside a league or in a six pointer. */
export function leaguePoints(def: MatchDef, winner: Winner): { pointsA: number; pointsB: number } {
  if (!def.league || isSix(def.game)) return { pointsA: 0, pointsB: 0 };
  const single = def.game === 'two_v_one'; // a single who beats the pair earns double
  if (winner === 'A') return { pointsA: single ? 4 : 2, pointsB: 0 };
  if (winner === 'B') return { pointsA: 0, pointsB: 2 };
  return { pointsA: single ? 2 : 1, pointsB: 1 };
}

export function gameResult(def: MatchDef, state: MatchState): ConfirmedResult | null {
  if (!state.decided || !state.winner || state.finalHole === null || !state.resultText) return null;
  const ids = def.players ?? [...def.sideA, ...def.sideB];
  const playerPoints: Record<string, PlayerPoints> = Object.fromEntries(
    ids.map((id) => [id, { points: state.totals?.[id] ?? 0, stableford: state.stableford?.[id] ?? 0 }]),
  );
  return {
    groupId: def.groupId, matchType: def.type, winner: state.winner, ...leaguePoints(def, state.winner),
    resultText: state.resultText, finalHole: state.finalHole, playerPoints,
  };
}

export interface LeagueRow { playerId: string; played: number; won: number; halved: number; lost: number; points: number; stableford: number }

/** The season table from confirmed 1 v 1 and 2 v 1 results: points, then Stableford total, then name. */
export function leagueTable(
  games: { def: MatchDef; result: ConfirmedResult | null }[],
  playerIds: string[],
  nameOf: (id: string) => string = (id) => id,
): LeagueRow[] {
  const rows = new Map<string, LeagueRow>(playerIds.map((id) => [id, { playerId: id, played: 0, won: 0, halved: 0, lost: 0, points: 0, stableford: 0 }]));
  for (const { def, result } of games) {
    if (!result || def.type !== 'individual' || isSix(def.game)) continue;
    for (const [side, team, points] of [[def.sideA, 'A', result.pointsA], [def.sideB, 'B', result.pointsB]] as const) {
      for (const id of side) {
        const r = rows.get(id);
        if (!r) continue;
        r.played++;
        if (result.winner === 'halved') r.halved++;
        else if (result.winner === team) r.won++;
        else r.lost++;
        r.points += points;
        r.stableford += result.playerPoints?.[id]?.stableford ?? 0;
      }
    }
  }
  return [...rows.values()].sort(
    (x, y) => y.points - x.points || y.stableford - x.stableford || nameOf(x.playerId).localeCompare(nameOf(y.playerId)),
  );
}
```

- [ ] **Step 5: Wire `resultFromState` and the export.** In `src/lib/scoring/tracker.ts`, add `import { gameResult } from './individual';` and make the first line of `resultFromState`:

```ts
  if (def.game) return gameResult(def, state); // individual events: league points and each player's points
```

In `src/lib/scoring/index.ts`, add `export * from './individual';`.

- [ ] **Step 6: Run the tests and type check.** Fix the expectations only if a test is wrong about the spec, never the spec itself.

Run: `npx vitest run src/lib/scoring && npm run check`
Expected: individual tests PASS and all scoring tests pass. `npm run check` may report errors in files still using the old `Outcome` winner type: `src/lib/data/types.ts`'s `MatchResultRow.winner`. Change it to `Winner` (import it from `'../scoring'`) and add `player_points?: Record<string, PlayerPoints> | null;`. Re-run until clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scoring src/lib/data/types.ts
git commit -m "feat(scoring): individual games — Stableford, flat and Stableford match play, six pointer, 2 v 1, league points and table"
```

---

### Task 3: Event view for individual events

**Files:**
- Modify: `src/lib/data/types.ts` (`EventRow`, `EventPlayerRow`, `RoundRow`)
- Modify: `src/lib/view.ts`
- Modify: `src/lib/view.test.ts`, `src/lib/form.test.ts` (fixtures gain the new fields)
- Test: `src/lib/view.test.ts`

**Interfaces:**
- Consumes: `buildGame`, `computeGameState`, `leagueTable`, `gameLabel`, `LeagueRow` (Task 2).
- Produces:
  - `EventView.league: LeagueRow[] | null`, which is non-null only for individual events with `league` on.
  - `settingsOf(r)` now carries `pairGame`, `threeGame`, `stablefordPct`, `matchPct` and `matchOffLow`.
  - `pairingLabel` handles P slots: "Adams v Brown" (2), "Adams v Brown/Clark" (league 3-ball, the single first), "Adams v Brown v Clark" (six pointer).
  - `matchLabel('individual')` returns `'Game'`.

- [ ] **Step 1: Row types.** In `src/lib/data/types.ts`:

`EventRow`, after `watch_token`:

```ts
  /** Team cup (A v B) or individual (2- and 3-player games, no teams). */
  kind: 'team' | 'individual';
  /** Individual events: a season league (game results earn league points; 3-balls play 2 v 1). */
  league: boolean;
```

`EventPlayerRow`: change `team: Team` to `team: Team | null` (null in individual events).

`RoundRow`, after `scramble_low_pct…`:

```ts
  /** Individual events: the 2-player game, the 3-player game (league events play 2 v 1), and handicap settings. */
  pair_game: 'stableford' | 'flat_match' | 'stableford_match';
  three_game: 'six_stableford' | 'six_flat';
  stableford_pct: number; match_pct: number; match_off_low: boolean;
```

Update the fixtures in `src/lib/view.test.ts` and `src/lib/form.test.ts`:
- Add `kind: 'team', league: false` to the event object.
- Add `pair_game: 'stableford_match', three_game: 'six_stableford', stableford_pct: 100, match_pct: 85, match_off_low: true` to the base round.

Search with `grep -n "show_photos: true\|scramble_high_pct: 35" src/lib/*.test.ts`.

- [ ] **Step 2: Write the failing view tests.** Append to `src/lib/view.test.ts`, reusing its `snapshot()`, `baseRound` and score helpers. Read the top of the file for their exact names; the snippet below assumes `snapshot(over)` and `baseRound` as shown in the file.

```ts
describe('individual events', () => {
  const ind = (league: boolean, slots: [string, string][], scores: ScoreRow[] = []) =>
    snapshot({
      event: { ...snapshot().event!, kind: 'individual', league },
      eventPlayers: ['a1', 'a2', 'b1'].map((id) => ({ event_id: 'e', player_id: id, team: null, handicap: 10 })),
      groups: [{ id: 'g1', round_id: 'r1', group_no: 1, tee_time: null, singles_crossed: false }],
      groupPlayers: slots.map(([slot, player_id]) => ({ group_id: 'g1', slot: slot as Slot, player_id, handicap: null })),
      scores,
    });

  it('a 2-player group plays the round\'s 2-player game as one individual game; no team tracker points', () => {
    const view = buildEventView(ind(false, [['P1', 'a1'], ['P2', 'a2']]))!;
    const g = view.rounds[0].groups[0];
    expect(g.matches).toHaveLength(1);
    expect(g.matches[0].def.type).toBe('individual');
    expect(g.matches[0].def.game).toBe('stableford_match');
    expect(view.rounds[0].pointsAvailable).toBe(0);
    expect(view.league).toBeNull();
  });

  it('a league event\'s 3-ball plays 2 v 1 and builds the season table', () => {
    const view = buildEventView(ind(true, [['P1', 'a1'], ['P2', 'a2'], ['P3', 'b1']]))!;
    expect(view.rounds[0].groups[0].matches[0].def.game).toBe('two_v_one');
    expect(view.league?.map((r) => r.playerId).sort()).toEqual(['a1', 'a2', 'b1']);
  });

  it('labels individual groups by their players', () => {
    const view = buildEventView(ind(true, [['P1', 'a1'], ['P2', 'a2'], ['P3', 'b1']]))!;
    const short = (id: string) => id.toUpperCase();
    expect(pairingLabel(view.rounds[0].groups[0], short)).toBe('A1 v A2/B1');
    const six = buildEventView(ind(false, [['P1', 'a1'], ['P2', 'a2'], ['P3', 'b1']]))!;
    expect(pairingLabel(six.rounds[0].groups[0], short)).toBe('A1 v A2 v B1');
  });

  it('team events are unchanged', () => {
    const view = buildEventView(snapshot())!;
    expect(view.league).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/lib/view.test.ts`
Expected: FAIL (`def.type` is `better_ball` / `league` undefined).

- [ ] **Step 4: Implement in `src/lib/view.ts`**
- Imports: add `buildGame, computeGameState, leagueTable, type LeagueRow` to the import from `'./scoring'`.
- `EventView`: add `/** Individual season league: the table (null otherwise). */ league: LeagueRow[] | null;`.
- `settingsOf`: add

```ts
    pairGame: r.pair_game ?? 'stableford_match',
    threeGame: r.three_game ?? 'six_stableford',
    stablefordPct: Number(r.stableford_pct ?? 100),
    matchPct: Number(r.match_pct ?? 85),
    matchOffLow: r.match_off_low ?? true,
```

- In `buildEventView`, before `const groupCount`, add `const individual = s.event.kind === 'individual';`.
- Make `teamOf` default an individual player to `'A'`: `p.team ?? 'A'`. Their colour comes from App's neutral palette in Task 4.
- Set `pointsAvailable` with `const pointsAvailable = individual ? 0 : roundPointsAvailable(settings, groupCount);`.
- Replace the `const defs = buildMatches(...)` expression with:

```ts
          const players = members.map((gp) => ({ slot: gp.slot, playerId: gp.player_id, handicap: playingHcp[gp.player_id] }));
          const built = individual
            ? [buildGame(group.id, players, settings, s.event!.league)].filter((d): d is MatchDef => d !== null)
            : buildMatches(group.id, players, settings, !!group.singles_crossed);
          const defs = built.map((def) => (onOtherTees ? { ...def, teeHoles } : def));
```

- In the result mapping, add `playerPoints: row.player_points ?? undefined,`. Change the state line to

```ts
            return { def, state: def.game ? computeGameState(def, holes, scores) : computeMatchState(def, holes, scores), result, number: ++matchNo, net };
```

- In the return statement, add

```ts
league: individual && s.event.league ? leagueTable(everyMatch, s.eventPlayers.map((p) => p.player_id), (id) => s.players.find((p) => p.id === id)?.name ?? id) : null,
```

  `everyMatch` holds `MatchView`s, which have `def` and `result`.
- `LABELS`: add `individual: 'Game',`.
- `pairingLabel`: at the start, handle individual groups:

```ts
  if (group.slots.P1) {
    const ids = (['P1', 'P2', 'P3'] as Slot[]).map((s) => group.slots[s]).filter((x): x is string => !!x);
    const def = group.matches[0]?.def;
    // 2 v 1: the single, then the pair; otherwise everyone for themselves.
    return def?.game === 'two_v_one' ? `${short(ids[0])} v ${ids.slice(1).map(short).join('/')}` : ids.map(short).join(' v ');
  }
```

- [ ] **Step 5: Run the whole unit suite and the type check**

Run: `npx vitest run src && npm run check`
Expected: all pass, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/view.ts src/lib/data/types.ts src/lib/view.test.ts src/lib/form.test.ts
git commit -m "feat(view): individual events build one game per 2- or 3-player group, and the season table"
```

---

### Task 4: Playing an individual event: leaderboard, score entry, confirming

**Files:**
- Modify: `src/App.svelte`
- Modify: `src/components/MatchCard.svelte`
- Create: `src/components/LeagueTable.svelte`
- Modify: `src/routes/Leaderboard.svelte`, `src/routes/ScoreEntry.svelte`, `src/routes/Match.svelte`
- Modify: `tests/e2e/helpers.ts`
- Create: `tests/e2e/individual.spec.ts`

**Interfaces:**
- Consumes: `EventView.league`, `gameLabel`, `MatchDef.game`, `MatchState.totals`, `ConfirmedResult.playerPoints`.
- Produces: e2e helper `seedIndividual(opts: { league: boolean; pairGame?: string; threeGame?: string }): Promise<{ eventId: string; roundId: string; twoBall: string; threeBall: string }>`.

- [ ] **Step 1: Write the e2e helper.** Add this to `tests/e2e/helpers.ts`:

```ts
/**
 * Make an individual event the active one (after reseed): Day 1 on Seed Links with a 2-ball (Adams v Brown,
 * both off 10) and a 3-ball (Clark 6, Davies 14, Evans 3). Returns the ids.
 */
export async function seedIndividual(opts: { league: boolean; pairGame?: string; threeGame?: string }) {
  const db = serviceDb();
  const one = async <T>(q: PromiseLike<{ data: T; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data as T;
  };
  const players = await one(db.from('players').select('id, name'));
  const id = (name: string) => (players as { id: string; name: string }[]).find((p) => p.name === name)!.id;
  const course = await one(db.from('courses').select('id').eq('name', 'Seed Links').single());
  await one(db.from('events').update({ is_active: false }).eq('is_active', true));
  const event = await one(
    db.from('events').insert({ name: opts.league ? 'Saturday League' : 'Saturday Swindle', kind: 'individual', league: opts.league, is_active: true }).select('id').single(),
  ) as { id: string };
  const roster = ['Alex Adams', 'Ben Brown', 'Chris Clark', 'Dan Davies', 'Ed Evans'];
  const hcp: Record<string, number> = { 'Alex Adams': 10, 'Ben Brown': 10, 'Chris Clark': 6, 'Dan Davies': 14, 'Ed Evans': 3 };
  await one(db.from('event_players').insert(roster.map((n) => ({ event_id: event.id, player_id: id(n), team: null, handicap: hcp[n] }))));
  const round = await one(
    db.from('rounds').insert({
      event_id: event.id, round_no: 1, name: 'Day 1', course_id: (course as { id: string }).id, date: new Date().toLocaleDateString('en-CA'),
      ...(opts.pairGame ? { pair_game: opts.pairGame } : {}), ...(opts.threeGame ? { three_game: opts.threeGame } : {}),
    }).select('id').single(),
  ) as { id: string };
  const group = async (no: number, names: string[]) => {
    const g = await one(db.from('groups').insert({ round_id: round.id, group_no: no }).select('id').single()) as { id: string };
    await one(db.from('group_players').insert(names.map((n, i) => ({ group_id: g.id, slot: `P${i + 1}`, player_id: id(n) }))));
    return g.id;
  };
  const twoBall = await group(1, ['Alex Adams', 'Ben Brown']);
  const threeBall = await group(2, ['Chris Clark', 'Dan Davies', 'Ed Evans']);
  return { eventId: event.id, roundId: round.id, twoBall, threeBall };
}

/** Set each row's gross on the current hole of an individual group (by position) and save. */
export async function enterIndividualHole(page: Page, hole: number, gross: Record<string, number>) {
  await page.getByRole('button', { name: `Hole ${hole}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `Hole ${hole}`, exact: true })).toBeVisible();
  for (const [slot, target] of Object.entries(gross)) {
    const row = page.getByTestId(`row-${slot}`);
    const value = row.getByTestId(`gross-${slot}`);
    let current = Number(await value.textContent());
    while (current < target) { await row.getByRole('button', { name: /^Increase/ }).click(); current++; }
    while (current > target) { await row.getByRole('button', { name: /^Decrease/ }).click(); current--; }
    await expect(value).toHaveText(String(target));
  }
  await page.getByRole('button', { name: `Save hole ${hole}` }).click();
}
```

- [ ] **Step 2: Write the failing e2e tests** in `tests/e2e/individual.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { enterIndividualHole, login, reseed, seedIndividual, serviceDb } from './helpers';

test.beforeEach(() => reseed());

test('a one-off individual day: a 2-ball plays Stableford match play, a 3-ball the six pointer', async ({ page }) => {
  const { twoBall, threeBall } = await seedIndividual({ league: false });
  await login(page, undefined, undefined, { expectLeaderboard: false });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Saturday Swindle' })).toBeVisible();
  await expect(page.getByTestId('tracker')).toHaveCount(0); // no team tracker
  await expect(page.getByTestId('match-card')).toHaveCount(2);
  await expect(page.locator(`[data-match-id="${twoBall}:individual"]`)).toContainText('Stableford match play');

  // The 2-ball: both off 10, off the low man → no shots. Adams par, Brown bogey on the 1st.
  await page.goto(`/#/score/${twoBall}`);
  await enterIndividualHole(page, 1, { P1: 4, P2: 5 });
  await page.goto('/#/');
  await expect(page.locator(`[data-match-id="${twoBall}:individual"]`).getByTestId('status')).toHaveText('1 UP');

  // The 3-ball (full handicaps; hole 1 is SI 7): Clark 6 → no shot, Davies 14 → 1, Evans 3 → no shot.
  // All par 4: Clark 2 pts, Davies 3, Evans 2 → Davies 4, Clark and Evans tie second → 1 each.
  await page.goto(`/#/score/${threeBall}`);
  await enterIndividualHole(page, 1, { P1: 4, P2: 4, P3: 4 });
  await page.goto('/#/');
  await expect(page.locator(`[data-match-id="${threeBall}:individual"]`).getByTestId('status')).toHaveText('1 · 4 · 1');
});

test('a season league: confirm a 1 v 1 and a 2 v 1, and the table adds them up', async ({ page }) => {
  const { twoBall, threeBall, roundId } = await seedIndividual({ league: true, pairGame: 'flat_match' });
  const db = serviceDb();
  const ids = async (group: string) =>
    ((await db.from('group_players').select('slot, player_id').eq('group_id', group)).data ?? []) as { slot: string; player_id: string }[];
  // 2 v 1 (full handicaps): Clark alone pars every hole; Davies and Evans make 6s → the single wins.
  const three = await ids(threeBall);
  const rows = three.flatMap(({ slot, player_id }) =>
    Array.from({ length: 18 }, (_, i) => ({ round_id: roundId, player_id, hole: i + 1, gross: slot === 'P1' ? 4 : 7, picked_up: false, client_updated_at: new Date().toISOString() })),
  );
  await db.from('scores').insert(rows);

  await login(page, undefined, undefined, { expectLeaderboard: false });
  // Flat match play: Adams wins the first 10 holes → 10&8.
  await page.goto(`/#/score/${twoBall}`);
  for (let h = 1; h <= 10; h++) await enterIndividualHole(page, h, { P1: 4, P2: 5 });
  page.on('dialog', (d) => void d.accept());
  await page.goto(`/#/match/${twoBall}/individual`);
  await page.getByRole('button', { name: 'Confirm result' }).click();
  await expect(page.getByTestId('match-card')).toContainText('10&8');

  await page.goto(`/#/match/${threeBall}/individual`);
  await page.getByRole('button', { name: 'Confirm result' }).click();

  await page.goto('/#/');
  const table = page.getByTestId('league-table');
  await expect(table).toBeVisible();
  // Clark won 2 v 1 alone: 4 pts. Adams won 1 v 1: 2 pts.
  await expect(table.getByTestId('league-row').first()).toContainText('Clark');
  await expect(table.getByTestId('league-row').first()).toContainText('4');
  await expect(table.getByTestId('league-row').filter({ hasText: 'Adams' })).toContainText('2');
});

test('team events still show the team tracker', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('tracker')).toBeVisible();
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx playwright test tests/e2e/individual.spec.ts`
Expected: FAIL (the tracker is shown for the individual event, the game label is missing, and so on).

- [ ] **Step 4: Neutral colours.** In `src/App.svelte`, in both places that set `--team-a/--team-b`, use a helper:

```svelte
<script lang="ts">
  // ...existing imports...
  /** Side colours: the teams' own, or for an individual event a neutral green v bronze. */
  const sideColours = $derived(
    db.event?.kind === 'individual'
      ? '--team-a:#0b3d2e;--team-b:#9a5b13'
      : `--team-a:${db.event?.team_a_colour ?? '#1f4e9c'};--team-b:${db.event?.team_b_colour ?? '#c8102e'}`,
  );
</script>
```

Then use `style={sideColours}` on both `.app` divs.

- [ ] **Step 5: MatchCard.** In `src/components/MatchCard.svelte`:
- Import `gameLabel` from `'../lib/scoring'`.
- Header: replace `{#if mv.def.type !== 'better_ball'}<small class="muted">{matchLabel(mv.def.type)}</small>{/if}` with

```svelte
      {#if mv.def.game}<small class="muted">{gameLabel(mv.def.game)}</small>
      {:else if mv.def.type !== 'better_ball'}<small class="muted">{matchLabel(mv.def.type)}</small>{/if}
```

- Six pointer body: wrap the existing `<div class="body">…</div>` in `{#if mv.def.game === 'six_stableford' || mv.def.game === 'six_flat'} … {:else} existing body {/if}`, where the six branch is:

```svelte
    <div class="six">
      {#each mv.def.players ?? [] as id (id)}
        <div class="who">
          <Avatar name={playerName(id)} url={photoUrl(id)} colour="var(--team-a)" size={40} />
          <span class="name">{playerShort(id)}</span>
          <strong class="pts">{mv.state.totals?.[id] ?? 0}</strong>
        </div>
      {/each}
    </div>
    <div class="status six-status"><strong data-testid="status">{status}</strong>{#if sub}<small class="muted">{sub}</small>{/if}</div>
```

- Add the styles:

```css
  .six { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center; }
  .six .who { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
  .six .pts { font-size: 1.2rem; }
  .six-status { margin-top: 6px; }
```

- Six pointer status colour: since `lead` is 0 for six pointers, the colour stays muted. That's intended.

- [ ] **Step 6: LeagueTable component** `src/components/LeagueTable.svelte`:

```svelte
<script lang="ts">
  // The season league table for an individual event: confirmed games only.
  import { playerName } from '../lib/data/store.svelte';
  import { formatPoints, type LeagueRow } from '../lib/scoring';
  let { rows }: { rows: LeagueRow[] } = $props();
</script>

<section class="card" data-testid="league-table">
  <h2>Season table</h2>
  <table>
    <thead><tr><th></th><th class="name">Player</th><th>P</th><th>W</th><th>H</th><th>L</th><th>Pts</th></tr></thead>
    <tbody>
      {#each rows as r, i (r.playerId)}
        <tr data-testid="league-row">
          <td class="muted">{i + 1}</td>
          <td class="name">{playerName(r.playerId)}</td>
          <td>{r.played}</td><td>{r.won}</td><td>{r.halved}</td><td>{r.lost}</td>
          <td><strong>{formatPoints(r.points)}</strong></td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="muted small">Win 2 · halve 1. A 2 v 1 single who wins gets 4. Ties split on Stableford points. Confirmed games only.</p>
</section>

<style>
  h2 { margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 6px 4px; text-align: center; border-bottom: 1px solid var(--line); }
  .name { text-align: left; }
  th { font-size: 0.8rem; color: var(--muted); }
</style>
```

- [ ] **Step 7: Leaderboard.** In `src/routes/Leaderboard.svelte`:
- Import `LeagueTable`.
- Replace the tracker block (the `<div bind:this={full}>…</div>` and `<ScoreBar …/>`) with:

```svelte
  {#if view.event.kind === 'individual'}
    {#if view.league}<LeagueTable rows={view.league} />{/if}
  {:else}
    <div bind:this={full}>
      <TeamTracker tracker={view.tracker} event={view.event} breakdown={view.rounds.map((r) => ({ name: r.round.name, points: r.pointsAvailable }))} />
    </div>
    <ScoreBar tracker={view.tracker} event={view.event} visible={compact} />
  {/if}
```

- Change `matches completed` to `{rv.completed} of {rv.totalMatches} {view.event.kind === 'individual' ? 'games' : 'matches'} completed`.

- [ ] **Step 8: Score entry.** In `src/routes/ScoreEntry.svelte`:
- `const SLOTS: Slot[] = ['A1', 'A2', 'B1', 'B2', 'P1', 'P2', 'P3'];`
- In `shots(pid)`, find the main match as `found.group.matches.find((m) => m.def.type === 'better_ball' || m.def.type === 'individual')`, still named `bbMatch`.
- In `points(pid, bb)`, an individual game shows Stableford points off the game's own strokes (`bb`), which is right for every Stableford game. Leave it unchanged.
- The summary grid line `{@const summary = …}`: change the find to `m.def.type === 'better_ball' || m.def.type === 'individual'`.
- Statuses: change `{(m.def.scramble ? 'Scramble' : matchLabel(m.def.type))}` to `{m.def.scramble ? 'Scramble' : m.def.game ? gameLabel(m.def.game) : matchLabel(m.def.type)}`, importing `gameLabel` from `'../lib/scoring'`.
- Avatar colour per row: replace both `slot.startsWith('A') ? 'var(--team-a)' : 'var(--team-b)'` with `sideColour(slot)`, adding:

```ts
  /** A row's colour: team A/B, or in an individual game P1 (the single / first player) against the rest. */
  const sideColour = (slot: Slot) => (slot.startsWith('A') || slot === 'P1' ? 'var(--team-a)' : 'var(--team-b)');
```

- [ ] **Step 9: Confirm passes player points.** In `src/routes/Match.svelte`:
- In the RPC args, add `p_player_points: snap.playerPoints ?? null,` after `p_final_hole`.
- Change the confirm prompt label to `${mv.def.game ? gameLabel(mv.def.game) : matchLabel(mv.def.type)}`, importing `gameLabel`.
- The `Scorecard` and `HoleGrid` already take any def/state.

- [ ] **Step 10: Run e2e and the existing suites**

Run: `npx vitest run && npm run check && npx playwright test`
Expected: all pass, the 3 new individual tests included. If `login(page, …, { expectLeaderboard: false })` lands somewhere else, check `helpers.ts` `login` and use what it waits for (`nav`).

- [ ] **Step 11: Commit**

```bash
git add src/App.svelte src/components/MatchCard.svelte src/components/LeagueTable.svelte src/routes/Leaderboard.svelte src/routes/ScoreEntry.svelte src/routes/Match.svelte tests/e2e/helpers.ts tests/e2e/individual.spec.ts
git commit -m "feat: play individual events — game cards, six pointer card, season table, score entry and confirming"
```

---

### Task 5: Admin: create an individual event and set up its days

**Files:**
- Modify: `src/routes/admin/AdminEvents.svelte`, `src/routes/admin/AdminEvent.svelte`
- Test: `tests/e2e/individual.spec.ts`

**Interfaces:**
- Consumes: `EventRow.kind/league`, the round game columns.
- Produces: an admin UI that creates `kind='individual'` events, saves `team = null` event players, and saves the round game columns.

- [ ] **Step 1: Write the failing e2e test.** Append to `tests/e2e/individual.spec.ts` (import `loginAdmin`, `unfoldEvent` from helpers):

```ts
test('the admin creates an individual league event, picks players and sets a day\'s games', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/#/admin/events');
  await page.getByRole('button', { name: '+ New event' }).click();
  await page.getByLabel('New event name').fill('Winter League');
  await page.getByLabel('Individual').check();
  await page.getByLabel('Season league').check();
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
  await expect(day1.getByLabel('3-player game')).toHaveCount(0); // league: always 2 v 1
  await expect(day1).toContainText('2 v 1 Stableford');
  await day1.getByLabel('2-player game').selectOption('flat_match');
  await day1.getByRole('button', { name: 'Save round' }).click();
  await expect(page.getByText('Day 1 saved')).toBeVisible();

  const db = serviceDb();
  const ev = (await db.from('events').select('kind, league').eq('id', eventId).single()).data;
  expect(ev).toEqual({ kind: 'individual', league: true });
  const eps = (await db.from('event_players').select('team').eq('event_id', eventId)).data!;
  expect(eps).toHaveLength(3);
  expect(eps.every((e) => e.team === null)).toBe(true);
  const r = (await db.from('rounds').select('pair_game').eq('event_id', eventId).single()).data;
  expect(r).toEqual({ pair_game: 'flat_match' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/individual.spec.ts -g "creates an individual"`
Expected: FAIL (no "Individual" option).

- [ ] **Step 3: AdminEvents create form.** In `src/routes/admin/AdminEvents.svelte`:
- Add `let kind = $state<'team' | 'individual'>('team'); let league = $state(false);`.
- In `create`, insert `{ name: name.trim(), kind, league: kind === 'individual' && league }`.
- In the form, after the name field:

```svelte
    <fieldset class="kind">
      <label><input type="radio" name="kind" value="team" bind:group={kind} /> Team cup</label>
      <label><input type="radio" name="kind" value="individual" bind:group={kind} /> Individual</label>
    </fieldset>
    {#if kind === 'individual'}
      <label class="row"><input type="checkbox" bind:checked={league} /> Season league <span class="muted small">(results add up in a table; 3-balls play 2 v 1)</span></label>
    {/if}
```

- Styles: `.kind { border: 0; padding: 0; margin: 0 0 12px; display: flex; gap: 16px; } .kind label { display: flex; gap: 6px; align-items: center; }`.
- In `summary(ev)`, prefix `ev.kind === 'individual' ? (ev.league ? 'League' : 'Individual') : ''` to the parts.

- [ ] **Step 4: AdminEvent individual mode.** In `src/routes/admin/AdminEvent.svelte`, add `const individual = $derived(event?.kind === 'individual');` and change the following.

**Event card:**

```svelte
    {#if !individual}
      <div class="teams"> …existing team name/colour fields… </div>
    {:else}
      <label class="setting"><span>Season league<span class="sub">Results add up in a table; 3-balls play 2 v 1</span></span><input class="switch" type="checkbox" bind:checked={event.league} /></label>
    {/if}
```

`saveDetails` adds `league: ev.league` to the update.

**Players fold:**
- The summary sub-line for individual events is `{playingIds.length} playing`, and the pill reads `Players ✓` when `playingIds.length >= 2`.
- Inside the fold, when `individual`, render only the "who" step (search, select all/clear, tick list) with a button `<button class="wide" disabled={!playingIds.length} onclick={savePlayers}>Save players</button>`. Hide the step tabs and the Teams step.
- Add:

```ts
  /** Individual events: everyone ticked plays, with no team. */
  const savePlayers = () =>
    act(async () => {
      const entries = Object.entries(members);
      const rows = entries.filter(([, m]) => m.playing).map(([player_id, m]) => ({ event_id: eventId, player_id, team: null, handicap: Number(m.handicap) }));
      const removed = entries.filter(([, m]) => !m.playing).map(([id]) => id);
      if (rows.length) await must(supabase.from('event_players').upsert(rows));
      if (removed.length) await must(supabase.from('event_players').delete().eq('event_id', eventId).in('player_id', removed));
    }, 'Players saved');
```

- In `load()`, members' `playing` is `!!m`, as today. That works for individual events because `team` is null.
- `if (!eps.length) playersOpen = true;` stays.

**Pairing status for individual events:**
- In `load()`, count groups with at least 2 players. Change the `paired` computation:

```ts
      paired = Object.fromEntries(ids.map((id) => [id, gs.filter((g) => g.round_id === id && g.group_players.length >= (ev.kind === 'individual' ? 2 : 4)).length]));
```

- In `pairingStatus`, at the top:

```ts
    if (individual) return (paired[r.id] ?? 0) > 0 ? `${paired[r.id]} group${paired[r.id] === 1 ? '' : 's'} set ✓` : 'Groups not set yet';
```

  `.endsWith('✓')` then still drives the pill.
- In `roundGame(r)`, for individual events:

```ts
    if (individual) return `${gameLabel(r.pair_game)} · ${event?.league ? gameLabel('two_v_one') : gameLabel(r.three_game)}`;
```

  Import `gameLabel` from `'../../lib/scoring'`.

**Round settings:** replace the fourball block (`Fourball game` select through the singles block) with `{#if individual} …individual… {:else} …existing… {/if}`:

```svelte
        {#if individual}
          <div class="field">
            <label for="rpg-{r.id}">2-player game</label>
            <select id="rpg-{r.id}" bind:value={r.pair_game}>
              <option value="stableford_match">Stableford match play</option>
              <option value="stableford">Stableford</option>
              <option value="flat_match">Flat match play (no shots)</option>
            </select>
          </div>
          {#if event.league}
            <p class="muted small">3-player groups play <strong>2 v 1 Stableford</strong>: the single's points against the pair's better ball.</p>
          {:else}
            <div class="field">
              <label for="rtg-{r.id}">3-player game</label>
              <select id="rtg-{r.id}" bind:value={r.three_game}>
                <option value="six_stableford">Six pointer (Stableford)</option>
                <option value="six_flat">Six pointer (flat, no shots)</option>
              </select>
            </div>
          {/if}
          {#if r.pair_game === 'stableford_match'}
            <label class="row"><input type="checkbox" bind:checked={r.match_off_low} /> Stableford match play off the low man</label>
            {#if r.match_off_low}
              <div class="field"><label for="rmp-{r.id}">Low man %</label><input id="rmp-{r.id}" type="number" min="0" max="100" bind:value={r.match_pct} /></div>
            {/if}
          {/if}
          <div class="field"><label for="rsp2-{r.id}">Stableford %</label><input id="rsp2-{r.id}" type="number" min="0" max="100" bind:value={r.stableford_pct} /></div>
        {:else}
          …existing fourball/singles fields, unchanged…
        {/if}
```

`saveRound` adds:

```ts
              pair_game: r.pair_game,
              three_game: r.three_game,
              stableford_pct: Number(r.stableford_pct),
              match_pct: Number(r.match_pct),
              match_off_low: r.match_off_low,
```

**Team-only logic:**
- `saveMembers`, `saveTeams` and `pairTwoVTwo` run only for team events. Guard `pairTwoVTwo` with `if (individual) return [];` at its top.
- In `addRound`, `pairTwoVTwo([added])` then does nothing for individual events.

- [ ] **Step 5: Run the tests**

Run: `npm run check && npx playwright test tests/e2e/individual.spec.ts && npx playwright test tests/e2e/trip.spec.ts`
Expected: all pass, with team event tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin/AdminEvents.svelte src/routes/admin/AdminEvent.svelte tests/e2e/individual.spec.ts
git commit -m "feat(admin): create individual events (one-off or season league), pick players, set each day's games"
```

---

### Task 6: Admin: pairings for individual events (groups of 2 or 3)

**Files:**
- Modify: `src/lib/scoring/pairings.ts`
- Test: `src/lib/scoring/pairings.test.ts`
- Modify: `src/routes/admin/AdminPairings.svelte`
- Test: `tests/e2e/individual.spec.ts`

**Interfaces:**
- Produces: `individualPairingErrors(groups: (string | null)[][]): string[]`, which checks that each group has 2 or 3 players and that nobody appears twice.

- [ ] **Step 1: Write the failing unit test.** Append to `src/lib/scoring/pairings.test.ts`:

```ts
describe('individualPairingErrors', () => {
  it('needs 2 or 3 players per group and nobody twice', () => {
    expect(individualPairingErrors([['a', 'b'], ['c', 'd', 'e']])).toEqual([]);
    expect(individualPairingErrors([['a', null, null]])).toEqual(['Group 1 needs 2 or 3 players']);
    expect(individualPairingErrors([['a', 'b'], ['b', 'c']])).toEqual(['A player is in more than one place (group 1 and group 2)']);
  });
});
```

Add `individualPairingErrors` to that file's import from `'./pairings'`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/scoring/pairings.test.ts`
Expected: FAIL ("individualPairingErrors is not a function").

- [ ] **Step 3: Implement** in `src/lib/scoring/pairings.ts`:

```ts
/** Individual events: each group is 2 or 3 players (empty places are null), and nobody plays twice. */
export function individualPairingErrors(groups: (string | null)[][]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  groups.forEach((g, i) => {
    const ids = g.filter((id): id is string => !!id);
    if (ids.length < 2 || ids.length > 3) errors.push(`Group ${i + 1} needs 2 or 3 players`);
    for (const id of ids) {
      const first = seen.get(id);
      if (first !== undefined) errors.push(`A player is in more than one place (group ${first + 1} and group ${i + 1})`);
      else seen.set(id, i);
    }
  });
  return errors;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/scoring/pairings.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing e2e test.** Append to `tests/e2e/individual.spec.ts`:

```ts
test('the admin pairs an individual day into a 2-ball and a 3-ball, choosing the single', async ({ page }) => {
  const { roundId } = await seedIndividual({ league: true });
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
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx playwright test tests/e2e/individual.spec.ts -g "pairs an individual"`
Expected: FAIL (heading "Day 1 pairings").

- [ ] **Step 7: Implement individual pairings** in `src/routes/admin/AdminPairings.svelte`:
- In `load()`, also fetch the event:

```ts
    const ev = (await must(supabase.from('events').select('kind, league').eq('id', r.event_id).single())) as { kind: string; league: boolean };
    individual = ev.kind === 'individual';
    league = ev.league;
```

- Declare `let individual = $state(false); let league = $state(false);`.
- Build `groups` drafts for individual events. Inside `load()`, after `members = eps;`:

```ts
    if (individual) {
      // Each group's players by position; in a 2 v 1 the single (P1) is listed first and marked.
      groupsDraft = gs.map((g) => {
        const at = (slot: Slot) => g.group_players.find((p) => p.slot === slot)?.player_id ?? '';
        return { groupNo: g.group_no, teeTime: g.tee_time?.slice(0, 5) ?? '', players: [at('P1'), at('P2'), at('P3')], single: 0 };
      });
      return;
    }
```

- Declare:

```ts
  /** Individual events: a group of 2 or 3 (empty places ''), and which place plays alone in a 2 v 1. */
  type IndDraft = { groupNo: number; teeTime: string; players: string[]; single: number };
  let groupsDraft = $state<IndDraft[]>([]);
  const addGroup = () => groupsDraft.push({ groupNo: groupsDraft.length + 1, teeTime: '', players: ['', '', ''], single: 0 });
  function removeGroup(i: number) {
    groupsDraft.splice(i, 1);
    groupsDraft.forEach((g, k) => (g.groupNo = k + 1));
  }
  async function saveGroups() {
    msg = null;
    errors = individualPairingErrors(groupsDraft.map((g) => g.players.map((p) => p || null)));
    if (errors.length) return;
    try {
      for (const g of groupsDraft) {
        const ids = g.players.filter(Boolean);
        // The single goes to P1 (only matters for a league 3-ball); the others follow in order.
        const ordered = league && ids.length === 3 ? [g.players[g.single], ...ids.filter((id) => id !== g.players[g.single])] : ids;
        await must(supabase.rpc('save_group', {
          p_round_id: roundId, p_group_no: g.groupNo, p_tee_time: g.teeTime || null,
          p_slots: ordered.map((player_id, i) => ({ slot: `P${i + 1}`, player_id })),
        }));
      }
      // Groups removed from the list go (with their players).
      await must(supabase.from('groups').delete().eq('round_id', roundId).gt('group_no', groupsDraft.length));
      await loadAll();
      msg = 'Groups saved';
    } catch (e) {
      errors = [(e as Error).message];
    }
  }
```

- Import `individualPairingErrors` from `'../../lib/scoring'`.
- Template: in the `{#if round}` branch, render the individual UI first:

```svelte
  {#if individual}
    <p><a href="#/admin/events/{round.event_id}">← Event</a></p>
    <h1>{round.name} groups</h1>
    <p class="muted small">Groups of 2 or 3.{#if league} In a 3-ball, choose who plays alone (2 v 1).{/if}</p>
    {#each groupsDraft as g, gi (g.groupNo)}
      <section class="card">
        <div class="row">
          <h3>Group {g.groupNo}</h3>
          <input aria-label="Group {g.groupNo} tee time" type="time" bind:value={g.teeTime} />
          <button class="secondary" aria-label="Remove group {g.groupNo}" onclick={() => removeGroup(gi)}>✕</button>
        </div>
        {#each [0, 1, 2] as i (i)}
          <div class="indrow">
            <select aria-label="Group {g.groupNo} player {i + 1}" bind:value={g.players[i]}>
              <option value="">{i === 2 ? '— (2-ball)' : '—'}</option>
              {#each members as m (m.player_id)}<option value={m.player_id}>{nameOf(m.player_id)} ({m.handicap})</option>{/each}
            </select>
            {#if league && g.players.filter(Boolean).length === 3 && g.players[i]}
              <label class="alone"><input type="radio" name="single-{g.groupNo}" aria-label="Group {g.groupNo}: {nameOf(g.players[i])} plays alone" checked={g.single === i} onchange={() => (g.single = i)} /> alone</label>
            {/if}
          </div>
        {/each}
      </section>
    {/each}
    <button class="secondary wide" onclick={addGroup}>+ Add group</button>
    {#each errors as err (err)}<p class="error">{err}</p>{/each}
    {#if msg}<p>{msg}</p>{/if}
    <button class="wide" onclick={saveGroups}>Save groups</button>
  {:else}
    …existing team pairings markup (from the "← Event" link through "Save pairings")…
  {/if}
```

- Styles: `.indrow { display: flex; gap: 8px; align-items: center; margin-top: 8px; } .indrow select { flex: 1; } .alone { display: flex; gap: 4px; align-items: center; white-space: nowrap; margin: 0; }`.
- In `load()`, the existing team `drafts` computation stays after the `individual` early return.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/lib/scoring && npm run check && npx playwright test tests/e2e/individual.spec.ts && npx playwright test tests/e2e/trip.spec.ts -g "pairings|singles"`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/scoring/pairings.ts src/lib/scoring/pairings.test.ts src/routes/admin/AdminPairings.svelte tests/e2e/individual.spec.ts
git commit -m "feat(admin): pair individual days into 2- and 3-balls, choosing the single for 2 v 1"
```

---

### Task 7: Full verification, then production (only with the user's go-ahead)

**Files:** none new.

- [ ] **Step 1: Run everything on dev**

Run: `npx vitest run && npm run check && npx playwright test`
Expected: every unit, database and e2e test passes, including all existing team-event tests.

- [ ] **Step 2: Look at it.** Take screenshots: the individual leaderboard (league table and a six pointer card), score entry for a 3-ball, and the admin individual event page. Fix anything visibly off (overflowing names in the six pointer card at phone width, for example) and re-run the affected e2e test.

- [ ] **Step 3: Ask the user.** Report the results and screenshots. Ask whether to apply the migration to production and push. **Stop here until they say yes.**

- [ ] **Step 4: On yes, apply and deploy.**
- Apply `20261001000029_individual_events.sql` to golf-prod (`zomsolfxwlzgfpszthst`) with the Supabase MCP `apply_migration`.
- Verify with `select kind, league from public.events limit 3;`: existing events should show `team` / `false`.
- Then `git push origin main` and watch the "Deploy to GitHub Pages" run until it succeeds.
