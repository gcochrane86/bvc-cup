# Games list and season team events — design

Agreed in chat on 2026-10-02 (mockups: claude.ai/artifact/DuRLeDSfzZAgEeKzNRHNBK). This builds on the individual events branch (`feature/individual-events`). Everything goes to **dev first**. Production, meaning both the migrations and the push to `main`, happens all at once, only on the user's go-ahead.

## 1. One games list (Admin → Games)

Every game lives in one catalogue, grouped by how many golfers play it. Every day's game picker reads from it.

| Key | Name | Golfers | Allowed in | Default settings |
|---|---|---|---|---|
| `stableford_match` | Stableford match play | 2 | all | off the low man, 85% |
| `stableford` | Stableford | 2 | all | Stableford 100% |
| `flat_match` | Flat match play | 2 | all | none |
| `two_v_one` | 2 v 1 Stableford | 3 | all | Stableford 100% |
| `two_v_one_match` (new) | 2 v 1 Stableford match play | 3 | all | Stableford 100% |
| `two_v_one_flat` (new) | 2 v 1 flat match play | 3 | all | none |
| `six_stableford` | Six pointer (Stableford) | 3 | **normal events only** | Stableford 100% |
| `six_flat` | Six pointer (flat) | 3 | **normal events only** | none |
| `fourball_matchplay` | Fourball match play | 4+ | all | allowance 90% |
| `fourball_stableford` | Fourball Stableford | 4+ | all | full handicaps |
| `fourball_flat` | Fourball flat | 4+ | all | none |
| `scramble` | 2-man scramble | 4+ | all | 35% low, 15% high |

- **What lives where:**
  - The catalogue's fixed facts are in code (`src/lib/games.ts`): name, golfers, which events allow it, which settings it has, and its scoring.
  - The database table `games` (key, `enabled`, `defaults jsonb`) holds what the admin manages.
  - Adding a game later means one catalogue entry plus its scoring rule.
- **Admin → Games page** (`#/admin/games`, with a tile on Admin home):
  - Each game has an on/off switch and its default settings.
  - A game that's switched off disappears from day pickers. Days already using it keep it.
  - Changing a default only affects days set up afterwards.
- **Per-day settings still win:** a new day is filled from the defaults, and its percentages stay editable on the day (e.g. scramble 35/35 for an even field).
- **New 2 v 1 games:**
  - **Stableford match play:** on each hole, the single's Stableford points against the pair's best points. Match play result.
  - **Flat match play:** on each hole, the single's gross against the pair's best gross, with no shots. Match play result.

## 2. Season team events

- **Creating one:** a plain **Season team event** checkbox on New event (`events.season`). Unticked, the event behaves as now: the 2/3-player individual rule and 4+ teams.
- **Teams:**
  - A season event always has Team A v Team B. Every player is on a team, set on the event's Players as today.
  - Players can be added at any time, and can switch teams.
  - **Confirmed results keep their points with the team they were earned for:** results store team points at confirmation.
- **Points for each format** are set once on the event (`events.points jsonb`), each with a win and a halve value:

  | Format | Win | Halve |
  |---|---|---|
  | Fourball | 2 | 1 |
  | Singles (in a fourball) | 1 | ½ |
  | 1 v 1 | 1 | ½ |
  | 2 v 1, the single | 2 | 1 |
  | 2 v 1, the pair (together) | 1 | ½ |

  Days use these points, and the round's own fourball and singles point fields are ignored in season events.
- **Players per day** (new `round_players` table):
  - Adding a day offers "Same as Day N" (the previous day's golfers, the default) or "Different players", a tick list of the event's players in team colours.
  - Each day keeps its own list. Adding a player to the event doesn't change earlier days.
  - The day's tile shows its golfer count and format.
- **The number of golfers sets the format:**
  - **2:** 1 v 1. Must be one golfer from each team.
  - **3:** 2 v 1. Must be two from one team and one from the other. The one on their own plays alone (position P1).
  - **4+:** fourballs, with pairings as today, limited to that day's golfers.
  - **Groups where everyone is on the same team are not allowed:** the day shows "These 3 are all on Team Red. A 2 v 1 needs golfers from both teams" and can't be saved.
- **Groups:** 2 or 3 golfers make one group, built automatically, with the single first.
- **Game choice per day:** from the catalogue, filtered by golfer count, by whether the game is switched on, and by event type. Season events never offer a six pointer.
- **Team score:** the tracker adds up every day.
  - 1 v 1 and 2 v 1 results add their win or halve points to each golfer's team.
  - Live games project the same way, by who's ahead.
  - Points available per day: fourballs (with singles if on) plus each 1 v 1 and 2 v 1, at its winning side's value.

## Data (one migration on top of `20261001000029`)

- **New table `games`:**
  - Columns: `key text primary key`, `enabled boolean not null default true`, `defaults jsonb not null default '{}'`.
  - Seeded with the 12 games and the defaults above.
  - Members can read. Only the admin can write.
- **`events`:**
  - `season boolean not null default false`
  - `points jsonb not null default '{"fourball":{"win":2,"halve":1},"singles":{"win":1,"halve":0.5},"one_v_one":{"win":1,"halve":0.5},"two_v_one_single":{"win":2,"halve":1},"two_v_one_pair":{"win":1,"halve":0.5}}'`
- **New table `round_players`:**
  - Columns: `round_id` (references rounds, on delete cascade), `player_id` (references players, on delete cascade), primary key on both.
  - Members can read. Only the admin can write.
- **`rounds.three_game`:** the check adds `two_v_one_match` and `two_v_one_flat`.
- **`match_results`:** no new columns. In season events, `points_a` / `points_b` are **Team A / Team B points**, frozen at confirmation.

## App

- **`src/lib/games.ts` (new):** the catalogue, `gamesFor(size, eventKind)`, and `defaultsFor(key)`, which merges the catalogue defaults with the database row.
- **`src/lib/scoring/individual.ts`:**
  - New 2 v 1 match play games, reusing `computeMatchState` with best-of-pair sides.
  - `teamPoints(def, winner, teamOf, points)`.
  - Season `buildGame` puts the lone-team golfer first.
- **`src/lib/view.ts`:** season branch.
  - The day's format comes from its group sizes.
  - Fourball points come from `events.points`.
  - Individual games feed the tracker through `teamPoints`.
  - `pointsAvailable` covers every group.
- **Admin pages:**
  - **Games page (new).**
  - **AdminEvents:** the Season checkbox.
  - **AdminEvent (season):** a points card, players per day on the add and edit round forms, golfer count and format on round tiles, game pickers from the catalogue, and the same-team block.
  - **AdminPairings:** the season day's golfers only.
- **Confirming:** in season events, Match confirms individual games with team points (`teamPoints`).

## Testing

- **Unit:**
  - the catalogue filter, including no six pointer in team events;
  - defaults merging;
  - the 2 v 1 match play games;
  - `teamPoints` for each format, win and halve;
  - season view: format by golfer count, tracker totals, points available, and points staying with the old team after a switch;
  - same-team validation.
- **Database:** the `games` seed and rights, `round_players` rights, and the new `three_game` values.
- **Browser (dev):**
  - Games page: switching a game off removes it from a day's picker, and changing a default pre-fills a new day.
  - Season event: create it, set points, add a 4-golfer day and a 3-golfer day, and check the 2 v 1 single comes from the teams.
  - Score and confirm the 2 v 1, and the team tracker adds the right points.
  - A same-team 3 is blocked.
  - Add a player part-way through, and they appear for the next day only.
  - All existing tests still pass.

## Out of scope

- A season league table per player.
- Six pointer team points.
- Rotating singles.
