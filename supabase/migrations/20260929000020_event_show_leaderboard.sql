-- Per-event switch for the players' Leaderboard tab. Off: players land on Scores and don't see the
-- leaderboard or match pages (the admin still does).
alter table public.events add column show_leaderboard boolean not null default true;
