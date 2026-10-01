# Individual events — design

Agreed in chat on 2026-10-01. Build and test on **dev first**; production waits for the user's go-ahead.

## Goal

Alongside today's team cup events, the admin can run **individual events**: 2- and 3-player groups playing each other, with no teams. An individual event can be a one-off day, or a **season league** whose days are spread through the year. In a league, game results add up in a table.

## What stays the same

Team cup events (fourballs, singles, scramble, the team tracker, pairings) are untouched. Every change below only adds new options, and existing rows keep their current meaning.

## The games

A round of an individual event has a **2-player game** and a **3-player game**. Each group plays the one that matches its size.

### 2-player groups (1 v 1)

| Game | Handicap | Result |
|---|---|---|
| **Stableford** (`stableford`) | Full course handicap × the round's Stableford % (default 100) | Higher Stableford total over 18 holes wins; equal totals halve. Shown as "Won by 3 pts" / "Halved". |
| **Flat match play** (`flat_match`) | None: gross | Lower gross score wins the hole; equal scores halve it. Normal match play: "2&1", "1 UP", "Halved". |
| **Stableford match play** (`stableford_match`) | **Off the low man** at the round's match % (default **85**): the lower course handicap plays off 0 and the other gets % × the difference, rounded half up. Or **full** handicaps (round setting). | More Stableford points on the hole wins it (a pick-up scores 0); equal halves. Match play result. |

### 3-player groups

| Game | When | Handicap | Result |
|---|---|---|---|
| **Six pointer, Stableford** (`six_stableford`) | League off | Full × Stableford % | Each hole shares 6 points by Stableford points: 4 / 2 / 0. Ties split the points for the places they share: two tie first = 3-3-0, two tie second = 4-1-1, all three tie = 2-2-2. Most points after 18 wins; a tie for most halves it. |
| **Six pointer, flat** (`six_flat`) | League off | None: gross | As above, comparing gross scores (lower is better). A pick-up counts as worst on the hole; two pick-ups tie. |
| **2 v 1 Stableford** (`two_v_one`) | League on | Full × Stableford % | The single (position P1) plays the pair (P2, P3). The single's Stableford total against the pair's **better-ball** total (the higher of the two on each hole). Higher total wins; equal halves. |

- **Holes not played.** A match play game ends when it's decided, as today. Stableford, six pointer and 2 v 1 games count all 18 holes. Their live status shows totals "thru" the last hole everyone has a score for.
- **Each player's tee** (different tees, course handicap from slope and rating) works exactly as in team events.

## League points (season league on)

| Game | Win | Halve | Lose |
|---|---|---|---|
| 1 v 1 (any 2-player game) | 2 | 1 each | 0 |
| 2 v 1: single | **4** | 2 | 0 |
| 2 v 1: each of the pair | 2 | 1 | 0 |

- **Season table:** Played, Won, Halved, Lost, Points. Sorted by Points, then total Stableford points over the season's games, then name.
- Only **confirmed** results count. A live game shows as "in progress" on the leaderboard and doesn't add to the table until it's confirmed.

## Data (one migration)

- **`events`**
  - `kind text not null default 'team' check (kind in ('team','individual'))`
  - `league boolean not null default false`. Only meaningful for individual events.
- **`event_players.team`:** becomes nullable. Individual events store `null`, and team events still require A/B (the app enforces this; the check becomes `team is null or team in ('A','B')`).
- **`rounds`**
  - `pair_game text not null default 'stableford_match' check (pair_game in ('stableford','flat_match','stableford_match'))`
  - `three_game text not null default 'six_stableford' check (three_game in ('six_stableford','six_flat'))`. A league event's rounds play `two_v_one` whatever this column says; the column only applies when the league is off.
  - `stableford_pct numeric(5,2) not null default 100 check (between 0 and 100)`
  - `match_pct numeric(5,2) not null default 85 check (between 0 and 100)`
  - `match_off_low boolean not null default true`. Stableford match play: off the low man (true) or full handicaps.
  - Team rounds ignore all five.
- **`group_players.slot`:** the check widens to `('A1','A2','B1','B2','P1','P2','P3')`. An individual event's groups use P1–P3. In a 2 v 1, P1 is the single.
- **`match_results`**
  - `match_type` check adds `'individual'`: one result per individual group.
  - `winner` check adds `'P1','P2','P3'`. Used by the six pointer, whose winner is a player. 1 v 1 and 2 v 1 use `A` (P1 / the single), `B` (P2 / the pair) or `halved`.
  - New `player_points jsonb`: `{ playerId: { points, stableford } }`. `points` is the player's game points (six pointer points, or Stableford total in the Stableford games). `stableford` is always their Stableford total, off full handicap × the Stableford %, worked out even for flat match play, so the league tiebreak has a figure for every game.
  - `points_a` / `points_b` hold league points (0 when the league is off). For a 2 v 1, `points_b` is **each** pair member's points.
- **`confirm_match`:** gains an optional `p_player_points jsonb default null` and stores it. The current signature keeps working for team matches.
- **`save_group`:** unchanged. It already takes any slot list, and its handicap freezing works per player.
- **`watch_event`** returns `to_jsonb` rows, so the new columns flow to share links with no change.

## App

### Scoring: `src/lib/scoring/individual.ts` (new, pure, unit-tested)

- `buildGame(groupId, players, settings, league)`: the game definition for a 2- or 3-player group. It covers the sides and positions, each player's strokes (low-man % or full × %), and the game type.
- `gameState(def, holes, scores)`: live state per game.
  - Match play games: hole winners, lead, decided, and the result text (reusing the existing match maths where it fits).
  - Stableford, 2 v 1 and six pointer: running totals per player or side, hole-by-hole points, "thru", winner when finished.
- `sixPoints(scores)`: the 4/2/0 split with ties, for one hole.
- `leaguePoints(def, state)`: league points per player.
- `leagueTable(results, players)`: the season table from confirmed results.

### Views

- **`buildEventView`:** branches on `event.kind`. Individual events build groups of 2–3 players with one game each. There's no team tracker; the league table is built when `league` is on.

### Pages

- **Admin → Events → New event:** choose Team cup or Individual. For Individual, there's also a Season league switch.
- **Admin → Event (individual)**
  - No team names or colours.
  - Players is a single tick list, with no team step.
  - Each round tile's settings show the 2-player game and the 3-player game (or "2 v 1 Stableford" when the league is on), plus their handicap settings.
  - Course guide preview, tees and confirmed results work as now.
- **Admin → Pairings (individual):** build any number of groups of 2 or 3 from the players ticked. Each player is in at most one group. In a 3-player group in a league event, choose the single. Tee times as now.
- **Score entry:** one row per player in the group, using the same controls as today. The header shows the game and live status, for example:
  - "Alex 2 UP thru 9"
  - "Alex 14 · Ben 11 · Chris 9 pts thru 7"
  - "Single 31 v Pair 33 thru 12"
- **Leaderboard (individual event)**
  - League on: the **season table** first, then each day's groups and their results.
  - League off: each day's groups with live or final results.
  - Tapping a group opens its game page, which shows hole by hole, the result, and a **Confirm result** button (as the match page does now).
- **Form tab and Scorecards** work as now. Individual players are shown in the accent colour instead of a team colour.

## Testing

- **Unit:** every game's strokes and results, including:
  - the low-man % rounding;
  - the six pointer's tie splits (all 5 cases) and pick-ups;
  - the 2 v 1 better ball;
  - match play ending early;
  - league points for each outcome;
  - the table's ordering and tiebreak.
- **Database:** the new columns and checks, `confirm_match` storing `player_points`, and that team events still accept their old values.
- **Browser (dev):**
  - create an individual one-off event, pair a 2-ball and a 3-ball, score them, and see the results and the six pointer split;
  - in a league event, score a 1 v 1 and a 2 v 1, confirm them, and see the season table;
  - all existing team-event tests still pass.

## Out of scope (for now)

- Rotating 2 v 1 and extra shots for the single.
- Individual side games inside team events.
- Mixed group sizes beyond 2 and 3, such as an individual 4-ball.
