# Games List and Season Team Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen: inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** One managed games catalogue (Admin → Games) used by every day's picker, two new 2 v 1 games, and season team events: players per day, points per format on the event, and 1 v 1 and 2 v 1 days counting for Team A v Team B.

**Architecture:**
- **Catalogue:** the fixed facts live in `src/lib/games.ts` (name, golfers, allowed events, settings). The admin-managed state (`enabled`, `defaults`) lives in a `games` table.
- **Season events** (`events.season`) always have teams.
  - Each day's golfers live in `round_players`.
  - The view builds each day's groups by size: 2/3 → `buildGame` with the lone-team golfer first, 4+ → `buildMatches`.
  - It maps individual game results to team points with `teamPoints`. Confirmed results store team points, so switching teams never moves earned points.

**Tech Stack:** Svelte 5, TypeScript, Supabase, Vitest (+ PGlite), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-games-and-season-events-design.md`

## Global Constraints

- Dev only (`jwyigcqwpcogmdarmwdj`). No production migration or push to `main` without the user's go-ahead.
- Normal events and team cup events behave exactly as today. The new columns default to today's behaviour.
- Default season points:
  - fourball 2 / 1
  - singles 1 / ½
  - 1 v 1: 1 / ½
  - 2 v 1 single: 2 / 1
  - 2 v 1, each of the pair: 1 / ½
- Season events never offer the six pointer, and groups made up entirely of one team are blocked.
- Per-day percentages stay editable. Games defaults only pre-fill new days.
- Branch: `feature/individual-events`. Commands: `npx vitest run`, `npm run check`, `npx playwright test`.

## Review Focus

- **A game switched off while a day already uses it:** that day must keep working and show its game. The picker keeps the current value as an option.
- **Switching a player's team after a confirmed season 2 v 1:** the team totals must not move. *(Task 4 test.)*
- **A season day with 2 golfers from the same team:** it must be blocked when added and when edited. *(Task 5 test.)*
- **A season 4+ day:** pairings must list only that day's golfers. *(Task 5.)*
- **Fourball halves in season events** use the event's halve value, not points ÷ 2. *(Task 4 test.)*

## Tasks

### Task 1: Database
- **Migration `20261002000030_games_and_seasons.sql`:**
  - `games` table, seeded with the 12 games, with members-read / admin-write RLS (following the existing `is_member()` / `is_admin()` policies).
  - `events.season` and `events.points` with the defaults.
  - `round_players`, with the same RLS.
  - `rounds.three_game` check adds `two_v_one_match` and `two_v_one_flat`.
- **DB tests:** seed rows and defaults, admin-only writes to `games` and `round_players`, the new `three_game` values accepted, and event defaults.
- **Apply to golf-dev.**

### Task 2: Catalogue + scoring
- **`src/lib/games.ts`:**
  - `GAMES` catalogue: key, name, size 2 | 3 | 4, `teamOk`, settings keys, default settings.
  - `gamesFor(size, { season, enabled })`.
  - `mergeDefaults(key, rows)`.
- **`individual.ts`:**
  - `two_v_one_match` and `two_v_one_flat`, through `computeMatchState`. Sides `[P1]` v `[P2, P3]`; `stableford` flag for the match version, 0 strokes for flat.
  - `buildGame(..., { singleFirst?: string })`, where the season view passes the lone-team golfer.
  - `teamPoints(def, winner, teamOf, points)` → `{ A, B }` per format, plus `projectedTeamPoints(def, state, teamOf, points)`.
- **Fourball halve support:** `MatchDef.halvePoints?`. Used by `computeMatchState` projections and `resultFromState`; the default stays `points / 2`.
- **Unit tests** for each.

### Task 3: Admin → Games + defaults + catalogue pickers
- **Route `#/admin/games`:** `AdminGames.svelte` lists the catalogue grouped by size, with `enabled` switches and defaults inputs. Saves to `games`. Admin home gets a tile.
- **Data:** the store loads the `games` rows (`db.games`).
- **New rounds** are filled from the defaults: allowance, scramble pcts, stableford_pct, match_pct, match_off_low. Their games are the first enabled game of each size, unless the round default is still enabled.
- **AdminEvent pickers:**
  - Built from `gamesFor`, with the current value always kept.
  - The 3-player picker adds the two new 2 v 1 games.
  - The fourball picker filters the enabled fourball games.
- **e2e:** switch a game off → gone from the picker; change the scramble default → a new day pre-fills it.

### Task 4: Season view + confirming
- **`buildEventView`, when `event.season`:**
  - Each group: P slots → `buildGame` with the lone-team golfer as P1. A1–B2 slots → `buildMatches` with points from `event.points`, including halves.
  - Tracker: confirmed results' `points_a/points_b` (team points); live games through `projectedTeamPoints`.
  - `pointsAvailable` = the sum of each group's maximum.
- **`resultFromState`/`gameResult`** take an optional team context. In season events, `pointsA/B` = team points.
- **Match.svelte** passes it.
- **Unit tests:** format by size, team totals, a switch after confirm doesn't move points, points available, fourball halves.

### Task 5: Season admin
- **AdminEvents:** Season team event checkbox (`season`).
- **AdminEvent, when season:**
  - Teams step always (no 2/3 individual shortcut).
  - Points card.
  - Add-round form: players "Same as Day N" (default) or "Different players" tick list in team colours, with a live format line ("3 golfers → 2 v 1, Kenny plays alone") and a block message for same-team groups. On add: insert `round_players` and auto-make the 2/3 group (lone-team golfer as P1).
  - Round tile: golfer count + format.
  - Round settings: the "Players" summary with Change (the same tick list and validation), and the game picker for that size only.
- **AdminPairings:** in season events, members are limited to the day's `round_players`.
- **Validation helper** `seasonDayCheck(ids, teamOf)` → `{ format, single?, error? }`, unit-tested.
- **e2e:** create a season event, set points, a 4-golfer day and a 3-golfer day (2 v 1 single from the teams), score + confirm the 2 v 1 → tracker shows the single's team +2; a same-team 3 is blocked; a player added part-way through is listed for a new day only.

### Task 6: Verify + review
- **Full suites:** `npx vitest run`, `npm run check`, `npx playwright test`.
- **Screenshots.**
- **Fresh review**, then the fix pass.
- **Report to the user.** Production waits for the go-ahead.
