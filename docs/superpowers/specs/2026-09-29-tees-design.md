# Tees — design

Approved in chat on 2026-09-29. Built and shown on **dev only**; production waits for the user's go-ahead.

## Goal

Each day is set up with a **course** and then a **tee**, and any player can be put on a **different tee** for that day. Each player's handicap, shots, Stableford points and net scores follow their own tee.

## Approach: a tee is a course record, grouped by course name

A course record already carries everything a tee has: slope, rating, and par and stroke index per hole. So:

- **`courses.tee`** is a new text column, `null` for a course with a single unnamed tee.
  - A "course" in the UI is every record that shares a `name`; each record is one of its tees.
  - A record is shown as `name` when `tee` is null, else `name · tee tees` (e.g. "Glashedy Links · Gold tees").
- **`rounds.course_id`** stays as it is and now means the day's **main tee**.
- The alternative, a new `tees` table under `courses`, was rejected. It would mean rebuilding the course admin, `save_course` and the round link, and migrating production data, all for the same visible result.

### Data changes (migration 18)

- `alter table courses add column tee text` (nullable).
- Unique `(name, coalesce(tee, ''))` so a course can't have the same tee twice.
- New table **`round_tees`**:
  - `round_id uuid references rounds on delete cascade`
  - `player_id uuid references players on delete cascade`
  - `course_id uuid references courses`
  - `primary key (round_id, player_id)`
  - It holds only the players who are **not** on the day's main tee.
- Row-level security follows the other setup tables: members can read, and only the admin can write (the existing "members read" / "admin write" pattern).
- **Data migration.** Glashedy's three records become `name = 'Glashedy Links'` with `tee` = `Black` / `Gold` / `White`.
  - It runs on dev and prod in the migration: an `update` by the current names, which does nothing where they don't exist.
  - BvC's courses keep `tee = null`, so they show exactly as now.
- **`scripts/add-ballyliffen.ts`:** finds and creates the Glashedy records by `(name, tee)`.
- **`save_course`:** gains a `p_tee text` parameter. It stays admin-only and replaces the holes, as now.

## Rules

For each player on each hole, the player's **tee holes** are the holes of their tee: the `round_tees` course if they have one, otherwise the day's main tee.

- **Course handicap:** from the player's own tee: index × slope / 113 + (rating − par), with that tee's par total.
- **Shots:** where the player's own tee's stroke index puts them. That applies to match play off the low, Stableford off full handicaps, and singles.
- **Match play:** each hole compares each player's **net score to their own tee's par** (net − own par), best per side, and the lower wins.
  - When everyone's tees have the same par on a hole, this is exactly today's comparison of net scores.
  - This stands in for the WHS rule of extra shots when tee pars differ. It gives the same total over the round, and it also handles holes where the par itself differs between tees.
- **Stableford:** points are counted against the player's own tee par.
- **Pair net, Form and scorecard birdies:** use the player's own tee par and stroke index.
- **Confirmed matches:** a confirmed match keeps its result, as now.
  - Changing a player's tee for a day is refused while that player's match that day is confirmed. This is enforced in the database: a trigger on `round_tees`, like the score lock.
  - Reopening the match allows the change again.
- **No per-player tees on a day:** results are identical to today. This is covered by the existing tests, unchanged.

## Engine shape

- `GroupView` gains `teeHoles: Record<playerId, HoleInfo[]>` (the player's tee holes) and `teeOf: Record<playerId, string | null>` (the course record id when it differs from the main tee).
- `MatchDef` gains optional `teeHoles?: Record<playerId, HoleInfo[]>`.
  - `holeOutcome`, `sideBest` and `sidePoints` look up each player's own par and stroke index for the hole when it's present, and otherwise use the round's hole, as today.
  - `sideBest` compares net − own par.
- The course handicap uses each player's tee (slope, rating, par total).
- `pairNet(ids, holes, idx, courseHcp, teeHoles?)` and `computeForm` use each player's `teeHoles` when present.

## Screens

- **Admin → Courses:** the list groups records by name, e.g. "Glashedy Links — Black · Gold · White". The course editor gains a **Tee** field; it's blank for a course with one tee. There's an "Add a tee" link that opens a new record with the course name filled in.
- **Admin → Event → each day:**
  - **Course** lists the distinct course names.
  - **Tees** lists that course's tees and sets `rounds.course_id`. It's hidden when the course has only one unnamed tee.
  - Under **Players on different tees**, each event player has a tee picker for that day, starting as "Main tee". Changing it writes or deletes the player's `round_tees` row. The picker is disabled for a player whose match that day is confirmed.
- **Leaderboard day header:** shows the course name and main tee, e.g. "Glashedy Links · Gold tees".
- **Score entry and match scorecard:** show the main tee's par and stroke index. A player on another tee gets a small tag (e.g. "White tees"). Their shots, shot dots and Stableford points use their own tee.
- **Courses tab:** unchanged, because guides match by course name (`/glashedy/i`).

## Testing

- **Unit tests:**
  - course handicap from each player's own tee;
  - shots placed by the player's own stroke index;
  - match play comparing net − own par, including a hole where the pars differ;
  - Stableford against own par;
  - pair net and Form using own par and stroke index;
  - with no per-player tees, output identical to today (existing tests unchanged).
- **Database tests:**
  - `round_tees` can be read by members and changed only by the admin;
  - changing a tee is refused for a confirmed player;
  - the Glashedy data migration;
  - `courses` uniqueness.
- **Browser tests:**
  - the admin picks a course and then a tee for a day;
  - putting one player on a different tee changes their handicap in score entry and their shots;
  - the leaderboard header shows "· Gold tees".
- **Screenshots (dev):** Admin Courses, the event day with the tee pickers, score entry showing the tee tag, and the leaderboard header.

## Out of scope

- Separate ladies' ratings for the same tee. Each record is one rating; add another record, e.g. "Red (ladies)", if needed.
- Per-player tees across a whole event in one go. Tees are set per day.
