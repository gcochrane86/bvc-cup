# BvC Cup

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

## Copying the dev setup to production

Set everything up in golf-dev (players, photos, handicaps, courses, event, rounds, pairings), then:

```bash
npm run copy-to-prod -- --dry-run   # shows what will be copied
npm run copy-to-prod -- --yes       # replaces golf-prod's setup with golf-dev's
```

Scores and results are never copied, and it refuses to run once golf-prod has any, so it can't wipe a live trip.

## Changing passwords

Edit `TRIP_PASSWORD` / `ADMIN_PASSWORD` in `.env.prod`, then run
`node --env-file=.env.prod --import tsx scripts/create-users.ts`.

## Security notes

- The publishable key in the site is public by design. Row-level security allows only the two logins.
- Public sign-ups are **disabled** in both projects. Keep them off.
- `.env.local` / `.env.prod` hold the secret key and passwords. They are gitignored; never commit them.
