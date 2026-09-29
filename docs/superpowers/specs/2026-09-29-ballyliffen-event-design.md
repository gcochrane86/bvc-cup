# Ballyliffen event and event-aware course guides — design

Approved in chat on 2026-09-29. Built and shown on **dev only**; nothing reaches production until the user says so.
A rubber-band handicap was designed alongside this, then dropped by the user as too complicated.

## Goals

1. A one-day, four-player event called **Ballyliffen** at Ballyliffin's Glashedy Links.
2. The Courses tab shows only the active event's courses. **With BvC active it must look exactly as it does today.**

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

## 3. Testing

- **Unit tests (guides):** the guide list is filtered by the active event's rounds, in round order, without duplicates; with no guide courses it falls back to all; a remembered course that isn't in the list is ignored.
- **Unit tests:** the Glashedy guide matches all three tee variants and gives one page per hole.
- **Browser tests (dev):**
  - with BvC active, Courses lists exactly Dundonald, Robert the Bruce and Ailsa, and hole 1 of each looks as today;
  - with Ballyliffen active, Courses lists only Glashedy and shows its hole pages.
- **Screenshots from dev:**
  - the Ballyliffen leaderboard;
  - the Glashedy guide;
  - the admin event and day setup;
  - the BvC Courses tab, unchanged.

## Out of scope

- The rubber band (dropped).
- Automatic tee selection. The admin switches the day's course.
- Anything on production.
