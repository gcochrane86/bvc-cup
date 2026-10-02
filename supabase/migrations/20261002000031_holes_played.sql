-- A day can play a set of holes (9, 13, or e.g. 1–9, 14 and 18 in winter). null = all 18.
alter table public.rounds add column holes smallint[]
  check (holes is null or (cardinality(holes) between 1 and 18 and holes <@ '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18}'::smallint[]));

-- 2 v 1 Stableford (best individual): the single's own total against the better of the pair's own totals.
alter table public.rounds drop constraint rounds_three_game_check;
alter table public.rounds add constraint rounds_three_game_check
  check (three_game in ('six_stableford', 'six_flat', 'two_v_one', 'two_v_one_match', 'two_v_one_flat', 'two_v_one_best'));
insert into public.games (key, defaults) values ('two_v_one_best', '{"stableford_pct": 100}') on conflict (key) do nothing;
