# Golf Trip Ryder Cup — Design Spec

**Date:** 2026-09-27
**Status:** Draft for review

## 1. Purpose

A mobile-first website for a 12-player golf trip played as a Ryder Cup–style
team competition (two teams of six). One scorer per fourball enters gross
scores after each hole; every phone viewing the site updates in real time
with match states ("2 UP thru 7") and a team score tracker. It must cost
nothing to run, be reachable from a link shared in WhatsApp, and be gated by
a single shared password. It should be reusable for future events.

### Success criteria

- A scorer can enter a hole for their fourball in a few taps, even with poor
  signal, and nothing is lost.
- Everyone sees match states and team totals update within seconds.
- Any mistake on any earlier hole can be corrected, and all results
  recalculate.
- Finished matches can be confirmed, which locks them and turns their points
  solid on the tracker.
- Running cost: £0.

### Non-goals (v1)

- Per-player accounts or logins.
- Stats or history across events (data is kept, but no screens for it).
- Stroke play or Stableford formats.
- Native apps.

## 2. Access

- **Trip password** — shared in WhatsApp. Grants: view everything, enter and
  edit scores, confirm match results, upload player photos.
- **Admin password** — held by the organiser. Grants everything above plus:
  manage players, courses, events, rounds and pairings; unlock confirmed
  matches.
- Implemented as two Supabase Auth users (`trip@…` and `admin@…`, emails
  hard-coded in the frontend). The login screen asks only for a password and
  signs in as the trip user; a separate "Admin" login signs in as the admin
  user. The admin user carries `app_metadata.role = 'admin'`.
- Sessions persist on the device for the duration of the trip.
- Passwords are changed in the Supabase dashboard.

## 3. Competition rules

### 3.1 Structure

- An **event** has two teams (name and colour each), 12 players (6 per team)
  and several **rounds**.
- Each round has 3 **groups** (fourballs). Each group has 2 players from team
  A and 2 from team B, stored in slots `A1, A2, B1, B2`.
- Each round has settings:
  - `allowance_pct` (default 90) — the handicap allowance for the better-ball
    match.
  - `better_ball_points` (default 1).
  - `singles_enabled` (default false; true on day 3).
  - `singles_points` (default 0.5).
  - `singles_allowance_pct` (default 90).
- **Matches in a group:**
  - Always: **better-ball**, `A1+A2` v `B1+B2`.
  - If `singles_enabled`: **low singles**, `A1` v `B1`, and **high singles**,
    `A2` v `B2`.
  - Within each team, slot 1 is the lower handicap. The pairings screen fills
    this in automatically from handicaps; the admin can swap the slots, for
    example to break a tie.
- For this trip: days 1 and 2 are worth 3 points each (better-ball only).
  Day 3 is worth 6 points (3 better-ball + 6 singles × ½). That makes 12
  points in total.

### 3.2 Handicaps

- Each player has a default handicap. `event_players.handicap` holds their
  playing handicap for the event, which is editable at any time in admin.
- **Better-ball strokes:** each player receives
  `round_half_up((own_hcp − lowest_hcp_in_group) × allowance_pct / 100)`.
  The lowest player in the group receives 0.
- **Singles strokes:** the higher handicap of the two receives
  `round_half_up((higher − lower) × singles_allowance_pct / 100)`; the other
  receives 0.
- **Allocation:** strokes are given on holes in stroke index order (SI 1
  first). If a player receives more than 18, they get 2 on holes with SI ≤
  (n − 18), and so on.
- Net score = gross − strokes on that hole.

### 3.3 Hole and match results

- **Better-ball hole:** each side's score is the best net score among its
  players who have a score. A player who picked up has no score on that hole.
  - The lower side wins the hole; equal scores halve it.
  - If one side has no score, the other side wins the hole. If neither side
    has a score, the hole is halved.
- **Singles hole:** net v net, with the same no-score rules.
- A hole counts as **played** for a match only once every player in that
  match has either a score or a pick-up for it.
- **Match state:**
  - Status is `lead = holes won by A − holes won by B`, shown as
    "`|lead|` UP thru N" (or "All Square").
  - The match is **decided** when `|lead|` exceeds the holes remaining
    (shown as e.g. "4&3"), or when all 18 holes are played. After 18 holes,
    a lead gives "1 UP" or "2 UP"; level gives "Halved".
  - Dormie is flagged when `|lead|` equals the holes remaining.
- **Points:** the winner of the match gets the match points; a halved match
  gives half to each side.

### 3.4 Team tracker

- **Confirmed points:** the sum of the stored results of confirmed matches.
  Shown as a **solid** bar.
- **Projected points:** confirmed points, plus, for each unconfirmed match
  with at least 1 hole played, the full points to the leading side (half each
  if All Square). Shown as a **hatched** bar extension.
- **To win:** `total_points_available / 2 + 0.5` (for example, 6.5 of 12).
  Unplayed rounds count toward the total available.

### 3.5 Confirmation and locking

- A **"Confirm result"** button appears on a match once it is decided.
  Anyone signed in can press it, after an "Are you sure?" prompt.
- Confirming writes a row to `match_results` holding a snapshot of the
  result: the winner, the points for each side, the result text (for example
  "4&3"), and the final hole played.
- **Points always come from the snapshot**, so later score edits can never
  change a confirmed result.
- **Score lock:** a score `(round, player, hole)` cannot be edited if any
  confirmed match includes that player and `hole ≤ final_hole` of that match.
  - This means a day-3 singles match can keep going after the better-ball
    has been confirmed at 4&3.
  - The lock is enforced in the database write function, not only in the UI.
- **Unlocking:** the admin can unlock a match, which deletes its
  `match_results` row.

## 4. Data model (Postgres / Supabase)

| Table | Columns |
|---|---|
| `players` | `id`, `name`, `short_name`, `default_handicap`, `photo_path` (nullable), `created_at` |
| `courses` | `id`, `name` |
| `course_holes` | `course_id`, `hole` (1–18), `par`, `stroke_index` (1–18, unique per course) |
| `events` | `id`, `name`, `team_a_name`, `team_a_colour`, `team_b_name`, `team_b_colour`, `is_active` |
| `event_players` | `event_id`, `player_id`, `team` (`A`/`B`), `handicap` |
| `rounds` | `id`, `event_id`, `course_id`, `round_no`, `date`, `name` (for example "Day 3"), `allowance_pct`, `better_ball_points`, `singles_enabled`, `singles_points`, `singles_allowance_pct` |
| `groups` | `id`, `round_id`, `group_no` (1–3), `tee_time` |
| `group_players` | `group_id`, `slot` (`A1`/`A2`/`B1`/`B2`), `player_id` |
| `scores` | `round_id`, `player_id`, `hole`, `gross` (1–15, nullable), `picked_up` (bool), `client_updated_at`, `updated_at`; primary key `(round_id, player_id, hole)` |
| `match_results` | `group_id`, `match_type` (`better_ball`/`low_singles`/`high_singles`), `winner` (`A`/`B`/`halved`), `points_a`, `points_b`, `result_text`, `final_hole`, `confirmed_at`; primary key `(group_id, match_type)` |
| `push_subscriptions` | Phase 2 — see §8 |

Match states are **never stored**. They are derived from `scores` and the
round settings. The only exception is `match_results`, which holds the
confirmed snapshots.

### Writes

- Scores are written only through an RPC, `upsert_score(round_id, player_id,
  hole, gross, picked_up, client_updated_at)`. It:
  - rejects the write if the score is locked (see §3.5);
  - ignores the write if the stored `client_updated_at` is newer, so a
    queued offline write can't overwrite a later correction;
  - otherwise upserts the score.
- Match confirmation goes through the RPC `confirm_match(...)`. The client
  sends the computed snapshot and the function checks that the match isn't
  already confirmed.

### Row-level security

- Any authenticated user can read every table.
- Only the admin can write to `players`, `courses`, `course_holes`, `events`,
  `event_players`, `rounds`, `groups` and `group_players`.
- The one exception for the trip user is `players.photo_path`, which it
  updates through an RPC.
- Only the admin can delete from `match_results`.
- Storage bucket `player-photos`: authenticated users can read and write.

## 5. Screens

All screens are mobile-first (designed for 375px width, one-handed use), with
large tap targets and team colours throughout.

1. **Login.** A single password field. There is a small "Admin" link.
2. **Leaderboard (home).**
   - Team tracker at the top: a bar with team A filling from the left and
     team B from the right. Confirmed points are solid and projected points
     are hatched, with a centre line. Under the bar are each team's name,
     projected total and "X to win".
   - Round tabs.
   - A header per round, e.g. "2 of 6 matches completed".
   - **Match cards:**
     - Circular player photos with a team-coloured ring (pairs overlap for
       better-ball) and names.
     - The status in the centre ("2 UP / THRU 7", "All Square", "4&3") in
       the leading team's colour.
     - A "LEADS" or "FINAL" badge.
   - On day 3, each fourball shows 3 cards.
3. **Match summary** (tap a card).
   - A holes 1–18 grid showing a running-state chip per hole ("T" when all
     square after that hole, otherwise "1UP", "2UP" and so on), coloured by
     the team leading. The current hole is highlighted.
   - Below the grid: a scorecard with gross and net scores per player, and
     dots for the strokes received in this match.
   - A "Confirm result" button when the match is decided. "Unlock" appears
     for the admin.
4. **Score entry** (one per group).
   - The scorer chooses their group once; the choice is remembered on the
     device.
   - A hole selector strip (1–18) shows filled, empty and locked states.
     Tapping any hole opens it for editing.
   - Per hole: the 4 players with photo, strokes-received dots, and a big
     −/+ stepper that starts at par. There is a "Picked up" toggle.
   - Save moves on to the next hole.
   - A mini status of the group's matches is shown at the top.
   - A badge shows "N scores waiting to send" while offline.
5. **Players.** A list of the event's players. Tapping one lets you upload or
   replace their photo.
   - Photos are cropped to a square and resized to about 400px as JPEG on the
     device before upload.
   - A player without a photo shows their initials on the team colour.
6. **Admin** (admin session only).
   - Players: add, edit, set default handicap, add a photo.
   - Courses: add, edit, with an 18-row par/SI grid that is validated (SI
     unique 1–18).
   - Events: name, teams, colours, which event is active, add players to
     teams, set event handicaps.
   - Rounds: course, date and all the settings in §3.1.
   - Pairings: assign players to the slots of the 3 groups, with slots
     auto-ordered by handicap and swappable. Tee times.

## 6. Architecture

- **Frontend:** Svelte 5, Vite and TypeScript, built as a static single-page
  app with hash routing. It is installable as a PWA (manifest and service
  worker).
- **Hosting:** GitHub Pages, deployed by a GitHub Actions workflow on every
  push to `main`.
- **Backend:** Supabase free tier.
  - Postgres with RLS for data.
  - Realtime (Postgres changes on `scores`, `match_results` and the setup
    tables) for live updates.
  - Storage for photos.
  - Edge Functions for push notifications (phase 2).
- **Scoring module** (`src/lib/scoring/`): pure TypeScript with no I/O. It
  covers stroke allocation, hole results, match state, projected and
  confirmed totals, and hole-by-hole running state. The UI uses it, and so
  does the phase-2 Edge Function.
- **Data flow:**
  - On load, the app fetches the active event and all of its data (tiny), then
    subscribes to Realtime changes.
  - Every screen derives its view from local state and the scoring module.
  - A score entry updates local state straight away, is written to an
    outbox, and is sent via `upsert_score`.
- **Migrations:** SQL files in `supabase/migrations/`, applied with the
  Supabase CLI. A `seed.sql` holds sample data for local development.

## 7. Reliability and error handling

- **Offline outbox.**
  - Pending score writes are stored in IndexedDB and retried with backoff,
    and immediately when the device comes back online. The badge shows the
    count.
  - Writes rejected because the score is locked are dropped, and the user
    sees a message.
- **Realtime reconnect.** When the device reconnects or the tab becomes
  visible, the app re-fetches the event's scores to catch up on any missed
  changes.
- **Concurrent edits.** The last write by `client_updated_at` wins. Everyone
  converges through Realtime.
- **Validation.** Gross must be 1–15 or picked up. This is enforced both in
  the UI and by database constraints.
- **Supabase pausing.** Free projects pause after 7 days with no activity. The
  organiser should open the site 1–2 days before the trip, and unpause from
  the dashboard if needed. This goes in the README.

## 8. Phase 2 — Push notifications

Phase 2 is built only after phase 1 is complete and tested.

- **How it works:**
  - Web Push with VAPID keys. A service worker handles `push` events.
  - The `push_subscriptions` table holds the endpoint, the keys, the
    preference (`big_moments`/`every_hole`/`off`), the followed match ids and
    `created_at`.
  - A Supabase **database webhook** on `scores` and `match_results` calls an
    **Edge Function**. The function recomputes the affected group's matches
    with the shared scoring module and compares them with the previous state
    to find events. It then sends notifications to the matching
    subscriptions and removes any that are no longer valid (HTTP 410).
- **Events that trigger a notification:**
  - **Big moments (default):** the lead changes hands, a match goes dormie,
    a match is decided, a match is confirmed, and the team projected totals
    change after a confirmation.
  - **Every hole:** each hole result, only for matches the user follows.
- **Enabling on iOS:** a guided flow. Opening the link from WhatsApp → "Open
  in Safari" → "Add to Home Screen" → "Enable notifications". Requires iOS
  16.4 or later. On Android, notifications can be enabled directly.
- **Settings screen:** notification preference and followed matches, per
  device.

## 9. Testing

- **Scoring module (Vitest, written test-first).**
  - Stroke allocation: 90% rounding, a difference of 0, differences above
    18, and SI ordering.
  - Better-ball: net best-ball, pick-ups, one side or both sides with no
    score, and halved holes.
  - Singles pairing and ½-point values.
  - Match state: thru counts with partial hole entry, dormie, early finish
    (4&3, 5&4, 2&1), and after 18 holes (1 UP or halved).
  - Tracker: projected versus confirmed totals, and to-win with unplayed
    rounds.
  - Lock rule: `final_hole` per player.
- **Database.** SQL tests (run via the Supabase CLI) cover:
  - RLS: the trip user cannot write setup tables; the admin user can.
  - `upsert_score`: lock rejection and ordering by `client_updated_at`.
- **End-to-end (Playwright, phone viewport, local Supabase).**
  - Log in; enter 18 holes for a group; edit hole 3 from hole 6; watch a
    second browser update live; confirm the match; check that its bar
    segment turns solid and that locked holes reject edits.
  - Queue scores offline, then check they're sent on reconnect.
  - Upload a photo.

## 10. Setup and operations (for the README)

1. Create a Supabase project (free). Run the migrations. Create the `trip` and
   `admin` auth users, and set `app_metadata.role = 'admin'` on the admin
   user.
2. Put the Supabase URL and anon key in the GitHub repo's Actions variables.
   Enable GitHub Pages.
3. Sign in as admin and set up the players, courses, event, rounds and
   pairings.
4. Share the link and the trip password in WhatsApp.

## 11. Assumptions to confirm

- A single playing handicap per player per event is enough (no per-round
  override).
- Hole lock and confirmation apply per match, not per round.
- Stroke rounding is round-half-up.
- On day 3, the singles use the same slot pairing as the fourball (low v low,
  high v high within each group).
