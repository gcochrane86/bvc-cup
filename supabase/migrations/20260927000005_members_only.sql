-- Defence in depth against self-sign-ups: only the two shared logins (app_metadata.role 'trip' or
-- 'admin', which only the secret key can set) may read or write. A stray account created while
-- "Allow new users to sign up" is on gets nothing.

create function public.is_member() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('trip', 'admin'), false)
$$;

do $$
declare t text;
begin
  foreach t in array array['players', 'courses', 'course_holes', 'events', 'event_players', 'rounds', 'groups', 'group_players', 'scores', 'match_results'] loop
    execute format('drop policy "signed-in read %1$s" on public.%1$I', t);
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using ((select public.is_member()))', t);
  end loop;
end $$;

drop policy "write unlocked scores" on public.scores;
drop policy "update unlocked scores" on public.scores;
drop policy "delete unlocked scores" on public.scores;
create policy "write unlocked scores" on public.scores for insert to authenticated
  with check ((select public.is_member()) and not public.score_locked(round_id, player_id, hole));
create policy "update unlocked scores" on public.scores for update to authenticated
  using ((select public.is_member()) and not public.score_locked(round_id, player_id, hole))
  with check ((select public.is_member()) and not public.score_locked(round_id, player_id, hole));
create policy "delete unlocked scores" on public.scores for delete to authenticated
  using ((select public.is_member()) and not public.score_locked(round_id, player_id, hole));

drop policy "confirm results" on public.match_results;
create policy "confirm results" on public.match_results for insert to authenticated
  with check ((select public.is_member()));

-- The RPCs refuse non-members outright (clearer than RLS silently filtering).
create or replace function public.upsert_score(
  p_round_id uuid, p_player_id uuid, p_hole int, p_gross int, p_picked_up boolean, p_client_updated_at timestamptz
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'not a trip member' using errcode = '42501';
  end if;
  if public.score_locked(p_round_id, p_player_id, p_hole) then
    return 'locked';
  end if;

  if p_gross is null and not p_picked_up then
    delete from public.scores
    where round_id = p_round_id and player_id = p_player_id and hole = p_hole
      and client_updated_at <= p_client_updated_at;
    if found or not exists (
      select 1 from public.scores where round_id = p_round_id and player_id = p_player_id and hole = p_hole
    ) then
      return 'ok';
    end if;
    return 'stale';
  end if;

  insert into public.scores (round_id, player_id, hole, gross, picked_up, client_updated_at)
  values (p_round_id, p_player_id, p_hole, p_gross, p_picked_up, p_client_updated_at)
  on conflict (round_id, player_id, hole) do update
    set gross = excluded.gross,
        picked_up = excluded.picked_up,
        client_updated_at = excluded.client_updated_at,
        updated_at = now()
    where public.scores.client_updated_at <= excluded.client_updated_at;
  if found then
    return 'ok';
  end if;
  return 'stale';
end;
$$;

create or replace function public.confirm_match(
  p_group_id uuid, p_match_type text, p_winner text, p_points_a numeric, p_points_b numeric, p_result_text text, p_final_hole int
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'not a trip member' using errcode = '42501';
  end if;
  insert into public.match_results (group_id, match_type, winner, points_a, points_b, result_text, final_hole)
  values (p_group_id, p_match_type, p_winner, p_points_a, p_points_b, p_result_text, p_final_hole)
  on conflict (group_id, match_type) do nothing;
  if found then
    return 'ok';
  end if;
  return 'already_confirmed';
end;
$$;

create or replace function public.set_player_photo(p_player_id uuid, p_path text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'not a trip member' using errcode = '42501';
  end if;
  if p_path !~ ('^' || p_player_id::text || '/[0-9]+\.jpg$') then
    raise exception 'invalid photo path';
  end if;
  update public.players set photo_path = p_path where id = p_player_id;
end;
$$;
