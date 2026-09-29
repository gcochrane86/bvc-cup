-- A third fourball game: 'flat' — match play with no shots (gross scores, lower best ball wins the hole).
alter table public.rounds drop constraint rounds_fourball_format_check;
alter table public.rounds add constraint rounds_fourball_format_check
  check (fourball_format in ('matchplay', 'stableford', 'flat'));
