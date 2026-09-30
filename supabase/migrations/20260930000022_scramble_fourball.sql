-- A fourth fourball game: 'scramble' — a 2-man scramble, one ball per team (team handicap 35% of each player).
alter table public.rounds drop constraint rounds_fourball_format_check;
alter table public.rounds add constraint rounds_fourball_format_check
  check (fourball_format in ('matchplay', 'stableford', 'flat', 'scramble'));
