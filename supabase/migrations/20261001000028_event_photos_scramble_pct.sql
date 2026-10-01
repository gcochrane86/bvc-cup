-- Per-event switch for player photos. Off: everyone shows as coloured initials (Admin → Players still shows photos).
alter table public.events add column show_photos boolean not null default true;

-- A 2-man scramble team plays off scramble_low_pct of the lower partner's handicap plus scramble_high_pct of
-- the higher. Existing rounds keep the 35% / 35% they were set up with; new rounds start at 35% / 15%.
alter table public.rounds
  add column scramble_low_pct numeric(5,2) not null default 35 check (scramble_low_pct between 0 and 100),
  add column scramble_high_pct numeric(5,2) not null default 35 check (scramble_high_pct between 0 and 100);
alter table public.rounds alter column scramble_high_pct set default 15;
