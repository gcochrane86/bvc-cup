# Ballyliffen event, event-aware course guides, rubber band — design

Approved in chat on 2026-09-29. Built and shown on **dev only**; nothing reaches production until the user says so.

## Goals

1. A one-day, four-player event called **Ballyliffen** at Ballyliffin's Glashedy Links.
2. The Courses tab shows only the active event's courses. **With BvC active it must look exactly as it does today.**
3. An optional **rubber band** handicap for match play that any member can switch on or off from the leaderboard.

## 1. Ballyliffen event

- Event name: "Ballyliffen", spelt as the user wrote it (the club spells it Ballyliffin). It is not made active.
- One round, "Day 1", with one group: better ball only, and singles off.
- Three courses built from the official scorecard (`BGC-SC-GLASHEDY-OCTOBER-2025.pdf`) and the club's WHS tables (from 16 Sep 2025). All are par 72 and share one set of men's stroke indexes:

  | Course name | Rating | Slope |
  |---|---|---|
  | Glashedy Links (Black) | 77.4 | 136 |
  | Glashedy Links (Gold) | 73.6 | 127 |
  | Glashedy Links (White) | 71.3 | 123 |

  Par by hole: 4 4 4 5 3 4 3 4 4 · 4 4 4 5 3 4 4 5 4.
  Stroke index by hole: 10 2 8 18 16 14 12 6 4 · 17 7 3 11 15 1 5 9 13.

- The day starts on Gold, because the yardage book is for Gold. The admin switches the day's course to the tees being played on the day.
- On prod, the admin picks the four players, the teams and the pairing. On dev, four dev players are filled in for the screenshots.

## 2. Courses tab follows the active event

- Guides listed = the guides whose course is used by one of the active event's rounds, in `round_no` order. A guide appears once, even if several rounds or tees use it.
- If the active event has no guide courses, fall back to showing all guides. This keeps the tab usable while an event is being set up.
- BvC rounds are Dundonald (Day 1), King Robert the Bruce (Day 2) and Ailsa (Day 3), so the list is unchanged. The existing guide pages, notes and flyovers are untouched.
- The remembered course on each phone is used only if it is in the current list. Otherwise the first listed course opens.
- **New Glashedy guide:** slug `glashedy`, matching `/glashedy/i`, so it covers all three tee variants. It uses one image per hole, rendered from the user's yardage book. Pages 3–20 of the 21-page PDF are holes 1–18; this is to be confirmed when rendering. Par and stroke index come from Admin, as for the other guides.

## 3. Rubber band

### Rules

These apply per match, for each hole *n* with the rubber band active:

- Let *L* be the match lead after hole *n − 1*, worked out with rubber-band shots already applied to earlier holes. Hole 1 always has L = 0.
- **|L| = 3:** the trailing side's **highest handicapper** is *due* +1 shot on hole *n*.
  - "Highest" means the most match strokes. On a tie, the higher course handicap wins. If still tied, the first slot (A1 before A2, B1 before B2) wins.
- **|L| ≥ 4:** **every** trailing player is due +1 shot.
- **Singles** (one player per side): the trailing player is due +1 when |L| ≥ 3.
- A due shot is **applied** if that player's per-hole choice says so. With no choice recorded, it follows the mode: **automatic** applies it, and **choose on each hole** does not.
- Net for the match = gross − handicap strokes on the hole − applied rubber-band shots.
- The rubber band affects match play only. Form, Stableford and gross/net rankings keep using course handicaps.
- Once a match is confirmed, its result is stored and locked as today. Nothing about the rubber band can change it.

### Settings and data

| Where | Field | Meaning |
|---|---|---|
| `events` | `rubber_band_available boolean default false` | Admin option: shows the leaderboard button. |
| `events` | `rubber_band_on boolean default false` | Leaderboard switch state, used for display. |
| `events` | `rubber_band_auto boolean default true` | Automatic vs choose on each hole. |
| `groups` | `rubber_band_holes int[] default '{}'` | The holes on which the rubber band is active for this group. |
| new `rubber_band_choices` | `group_id, hole, player_id, applied boolean`, primary key (group_id, hole, player_id) | Per-hole, per-player switch. |

- **Switching on:** the user picks *from the start* or *from the next hole*, and *automatic* or *choose on each hole*.
  - Every open (unconfirmed) group in the event gets holes added: 1–18 from the start, or thru+1–18 from the next hole, using each group's own progress.
- **Switching off:** the user picks *stop from the next hole* (remove thru+1–18) or *remove from the whole match* (clear all holes).
- Both go through one database function, `set_rubber_band(event, on, from_start, auto)`. It is members-only and skips confirmed groups.
- Per-hole choices use `set_rubber_band_choice(group, hole, player, applied)`. It is members-only and refused once the match is confirmed.
- Row-level security follows the existing pattern: members can read, and writes happen only through the functions. The admin option (`rubber_band_available`) is set by the admin in the event editor.
- Realtime and the 15-second catch-up check include the new table and fields, so every phone updates.

### Screens

- **Admin → event:** a "Rubber band" checkbox with a one-line explanation, next to the Form tab option.
- **Leaderboard:** when available, a "Rubber band: Off / On" button sits under the tracker. Pressing it opens a small panel with the two choices, then Confirm or Cancel. When it's on, the button also says "Automatic" or "Choose each hole".
- **Score entry:** on a hole where a rubber-band shot is due for a player, that player's row shows a switch, e.g. "Rubber band +1 · 2 shots on this hole". The shot count updates live when it's flicked. The switch starts on (automatic) or off (choose).
- **Match scorecard:** applied rubber-band shots are marked distinctly from handicap shots, with a legend line.

### Engine shape

- `computeMatchState(match, holes, idx, rubber?)` takes an optional `{ holes: Set<number>; auto: boolean; choice(hole, playerId): boolean | undefined; order: Record<playerId, rank> }`.
- It walks the holes in order. For each active hole it computes the players due a shot from the running lead, then the applied extra shots, and adds them to `strokesOnHole`.
- It returns, per hole, the due and applied players, so the score entry and scorecard use the same numbers as the result.
- With no `rubber` argument the output is identical to today. Existing tests must pass unchanged.

## 4. Testing

- **Unit tests (engine):**
  - no shot at 2 up;
  - one shot at 3 up, to the highest handicapper;
  - the tie-breaks;
  - both players at 4 up;
  - singles;
  - a shot can swing the lead, which changes later holes;
  - inactive holes are ignored;
  - automatic vs choose, and choice overrides both ways;
  - no `rubber` gives identical output to today.
- **Unit tests (guides):** the guide list is filtered by the active event's rounds, in round order, without duplicates; with no guide courses it falls back to all.
- **Database tests:**
  - both functions are members-only and refuse pending users and strangers;
  - confirmed groups are skipped or refused;
  - from the start vs from the next hole, and stopping vs removing;
  - choices are upserted.
- **Browser tests (dev):**
  - with BvC active, Courses lists exactly Dundonald, Robert the Bruce and Ailsa;
  - on an event with the rubber band available, switching it on from the start in choose mode, then turning on the switch on a due hole, changes the match status.
- **Screenshots from dev:**
  - admin option;
  - leaderboard button and the switch-on panel;
  - score entry with the switch;
  - scorecard markers;
  - the Glashedy guide;
  - the BvC Courses tab, unchanged.

## Out of scope

- A rubber band for Form, Stableford or the net leaderboards.
- Automatic tee selection. The admin switches the day's course.
- Anything on production.
