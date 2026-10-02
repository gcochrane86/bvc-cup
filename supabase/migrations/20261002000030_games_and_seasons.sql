-- The games list (Admin → Games) and season team events.

-- What the admin manages for each game: on/off and its default settings (a new day starts from these).
-- The games themselves (names, golfers, scoring) are defined in the app.
create table public.games (
  key text primary key,
  enabled boolean not null default true,
  defaults jsonb not null default '{}'
);
alter table public.games enable row level security;
grant select, insert, update, delete on public.games to authenticated;
create policy "members read games" on public.games for select to authenticated using ((select public.is_member()));
create policy "admin write games" on public.games for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
insert into public.games (key, defaults) values
  ('stableford_match', '{"match_off_low": true, "match_pct": 85}'),
  ('stableford', '{"stableford_pct": 100}'),
  ('flat_match', '{}'),
  ('two_v_one', '{"stableford_pct": 100}'),
  ('two_v_one_match', '{"stableford_pct": 100}'),
  ('two_v_one_flat', '{}'),
  ('six_stableford', '{"stableford_pct": 100}'),
  ('six_flat', '{}'),
  ('fourball_matchplay', '{"allowance_pct": 90}'),
  ('fourball_stableford', '{}'),
  ('fourball_flat', '{}'),
  ('scramble', '{"scramble_low_pct": 35, "scramble_high_pct": 15}');

-- Season team events: Team A v Team B all season, golfers change day to day, points per format set here.
alter table public.events
  add column season boolean not null default false,
  add column points jsonb not null default
    '{"fourball":{"win":2,"halve":1},"singles":{"win":1,"halve":0.5},"one_v_one":{"win":1,"halve":0.5},"two_v_one_single":{"win":2,"halve":1},"two_v_one_pair":{"win":1,"halve":0.5}}';

-- Season events: each day's golfers (a day keeps its own list when players join later).
create table public.round_players (
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (round_id, player_id)
);
alter table public.round_players enable row level security;
grant select, insert, update, delete on public.round_players to authenticated;
create policy "members read round_players" on public.round_players for select to authenticated using ((select public.is_member()));
create policy "admin write round_players" on public.round_players for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Two more 3-player games: 2 v 1 Stableford match play and 2 v 1 flat match play.
alter table public.rounds drop constraint rounds_three_game_check;
alter table public.rounds add constraint rounds_three_game_check
  check (three_game in ('six_stableford', 'six_flat', 'two_v_one', 'two_v_one_match', 'two_v_one_flat'));
