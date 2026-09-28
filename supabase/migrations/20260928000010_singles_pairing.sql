-- Singles pairings per round: 'handicap' (low v low, high v high), 'random' (drawn per group) or
-- 'selected' (chosen per group by the admin). A group's actual line-up is groups.singles_crossed:
-- false = A1 v B1 & A2 v B2; true = A1 v B2 & A2 v B1.
alter table public.rounds
  add column singles_pairing text not null default 'handicap' check (singles_pairing in ('handicap', 'random', 'selected'));
alter table public.groups
  add column singles_crossed boolean not null default false;

-- The score lock follows the actual singles opponents.
create or replace function public.score_locked(p_round_id uuid, p_player_id uuid, p_hole int) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.match_results mr
    join public.groups g on g.id = mr.group_id
    join public.group_players gp on gp.group_id = g.id and gp.player_id = p_player_id
    where g.round_id = p_round_id
      and p_hole <= mr.final_hole
      and (
        mr.match_type = 'better_ball'
        or (mr.match_type = 'low_singles'
            and gp.slot in ('A1', case when g.singles_crossed then 'B2' else 'B1' end))
        or (mr.match_type = 'high_singles'
            and gp.slot in ('A2', case when g.singles_crossed then 'B1' else 'B2' end))
      )
  )
$$;
