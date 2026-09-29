-- The fourball game per round: 'matchplay' (off the lowest handicap at the round's allowance — the
-- original game) or 'stableford' (everyone off their full course handicap; each side's best Stableford
-- points win the hole). Still match play by holes either way.
alter table public.rounds
  add column fourball_format text not null default 'matchplay' check (fourball_format in ('matchplay', 'stableford'));
