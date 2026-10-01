-- Individual events: 2- and 3-player groups playing each other (no teams).
-- Team cup events are unchanged: every new column defaults to today's behaviour.

alter table public.events
  add column kind text not null default 'team' check (kind in ('team', 'individual'));

-- Individual events have no teams.
alter table public.event_players alter column team drop not null;
alter table public.event_players drop constraint event_players_team_check;
alter table public.event_players add constraint event_players_team_check check (team is null or team in ('A', 'B'));

-- An individual round's games: one for its 2-player groups, one for its 3-player groups.
alter table public.rounds
  add column pair_game text not null default 'stableford_match'
    check (pair_game in ('stableford', 'flat_match', 'stableford_match')),
  add column three_game text not null default 'six_stableford'
    check (three_game in ('six_stableford', 'six_flat', 'two_v_one')),
  add column stableford_pct numeric(5,2) not null default 100 check (stableford_pct between 0 and 100),
  add column match_pct numeric(5,2) not null default 85 check (match_pct between 0 and 100),
  add column match_off_low boolean not null default true;

-- P1-P3: an individual group's positions (in a 2 v 1, P1 plays alone).
alter table public.group_players drop constraint group_players_slot_check;
alter table public.group_players add constraint group_players_slot_check
  check (slot in ('A1', 'A2', 'B1', 'B2', 'P1', 'P2', 'P3'));

-- One 'individual' result per individual group; a six pointer is won by a position.
alter table public.match_results drop constraint match_results_match_type_check;
alter table public.match_results add constraint match_results_match_type_check
  check (match_type in ('better_ball', 'low_singles', 'high_singles', 'individual'));
alter table public.match_results drop constraint match_results_winner_check;
alter table public.match_results add constraint match_results_winner_check
  check (winner in ('A', 'B', 'halved', 'P1', 'P2', 'P3'));
-- { playerId: { points, stableford } }: each player's game points and Stableford total, for the result line.
alter table public.match_results add column player_points jsonb;

-- confirm_match gains p_player_points (optional, so team confirms keep working unchanged).
drop function public.confirm_match(uuid, text, text, numeric, numeric, text, int);
create function public.confirm_match(
  p_group_id uuid, p_match_type text, p_winner text, p_points_a numeric, p_points_b numeric, p_result_text text,
  p_final_hole int, p_player_points jsonb default null
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'not a trip member' using errcode = '42501';
  end if;
  insert into public.match_results (group_id, match_type, winner, points_a, points_b, result_text, final_hole, player_points)
  values (p_group_id, p_match_type, p_winner, p_points_a, p_points_b, p_result_text, p_final_hole, p_player_points)
  on conflict (group_id, match_type) do nothing;
  if found then
    return 'ok';
  end if;
  return 'already_confirmed';
end;
$$;
revoke execute on function public.confirm_match(uuid, text, text, numeric, numeric, text, int, jsonb) from public, anon;
grant execute on function public.confirm_match(uuid, text, text, numeric, numeric, text, int, jsonb) to authenticated;

drop function public.watch_confirm_match(text, uuid, text, text, numeric, numeric, text, int);
create function public.watch_confirm_match(
  p_token text, p_group_id uuid, p_match_type text, p_winner text, p_points_a numeric, p_points_b numeric,
  p_result_text text, p_final_hole int, p_player_points jsonb default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.groups g join public.rounds r on r.id = g.round_id
    where g.id = p_group_id and r.event_id = public.watch_link_event(p_token)
  ) then
    raise exception 'not this event''s match' using errcode = '42501';
  end if;
  insert into public.match_results (group_id, match_type, winner, points_a, points_b, result_text, final_hole, player_points)
  values (p_group_id, p_match_type, p_winner, p_points_a, p_points_b, p_result_text, p_final_hole, p_player_points)
  on conflict (group_id, match_type) do nothing;
  if found then
    return 'ok';
  end if;
  return 'already_confirmed';
end;
$$;
revoke execute on function public.watch_confirm_match(text, uuid, text, text, numeric, numeric, text, int, jsonb) from public;
grant execute on function public.watch_confirm_match(text, uuid, text, text, numeric, numeric, text, int, jsonb) to anon, authenticated;

-- A confirmed individual game locks all its players' holes up to its final hole.
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
        mr.match_type in ('better_ball', 'individual')
        or (mr.match_type = 'low_singles'
            and gp.slot in ('A1', case when g.singles_crossed then 'B2' else 'B1' end))
        or (mr.match_type = 'high_singles'
            and gp.slot in ('A2', case when g.singles_crossed then 'B1' else 'B2' end))
      )
  )
$$;
