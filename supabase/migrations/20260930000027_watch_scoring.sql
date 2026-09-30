-- Scoring through an event's share link: anyone with a live link can enter scores and confirm results for
-- that event, like a signed-in player. Admin actions (unlock, resets, setup) stay admin-only.
--
-- The saving logic moves to save_score (unchanged), shared by upsert_score (members) and
-- watch_upsert_score (a live link), so the two paths can't drift apart.
create function public.save_score(
  p_round_id uuid, p_player_id uuid, p_hole int, p_gross int, p_picked_up boolean, p_client_updated_at timestamptz,
  p_if_absent boolean default false
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if public.score_locked(p_round_id, p_player_id, p_hole) then
    return 'locked';
  end if;

  if p_if_absent then
    if exists (select 1 from public.scores where round_id = p_round_id and player_id = p_player_id and hole = p_hole) then
      return 'exists';
    end if;
    if p_gross is null and not p_picked_up then
      return 'ok'; -- nothing to fill
    end if;
    -- Stamped as older than any real entry, so a real score that reaches the server later (e.g. from a
    -- phone with poor signal) still replaces it, even if the default was saved after it was typed.
    insert into public.scores (round_id, player_id, hole, gross, picked_up, client_updated_at)
    values (p_round_id, p_player_id, p_hole, p_gross, p_picked_up, 'epoch')
    on conflict (round_id, player_id, hole) do nothing;
    return case when found then 'ok' else 'exists' end;
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

revoke execute on function public.save_score(uuid, uuid, int, int, boolean, timestamptz, boolean) from public, anon;
grant execute on function public.save_score(uuid, uuid, int, int, boolean, timestamptz, boolean) to authenticated;

create or replace function public.upsert_score(
  p_round_id uuid, p_player_id uuid, p_hole int, p_gross int, p_picked_up boolean, p_client_updated_at timestamptz,
  p_if_absent boolean default false
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'not a trip member' using errcode = '42501';
  end if;
  return public.save_score(p_round_id, p_player_id, p_hole, p_gross, p_picked_up, p_client_updated_at, p_if_absent);
end;
$$;

-- The event a live share link belongs to, or an error (the app then says the link was turned off).
create function public.watch_link_event(p_token text) returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare v uuid;
begin
  select id into v from public.events where watch_token is not null and watch_token = p_token;
  if v is null then
    raise exception 'that share link has been turned off' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke execute on function public.watch_link_event(text) from public, anon, authenticated;

create function public.watch_upsert_score(
  p_token text, p_round_id uuid, p_player_id uuid, p_hole int, p_gross int, p_picked_up boolean,
  p_client_updated_at timestamptz, p_if_absent boolean default false
) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.rounds where id = p_round_id and event_id = public.watch_link_event(p_token)) then
    raise exception 'not this event''s round' using errcode = '42501';
  end if;
  return public.save_score(p_round_id, p_player_id, p_hole, p_gross, p_picked_up, p_client_updated_at, p_if_absent);
end;
$$;
revoke execute on function public.watch_upsert_score(text, uuid, uuid, int, int, boolean, timestamptz, boolean) from public;
grant execute on function public.watch_upsert_score(text, uuid, uuid, int, int, boolean, timestamptz, boolean) to anon, authenticated;

create function public.watch_confirm_match(
  p_token text, p_group_id uuid, p_match_type text, p_winner text, p_points_a numeric, p_points_b numeric,
  p_result_text text, p_final_hole int
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
  insert into public.match_results (group_id, match_type, winner, points_a, points_b, result_text, final_hole)
  values (p_group_id, p_match_type, p_winner, p_points_a, p_points_b, p_result_text, p_final_hole)
  on conflict (group_id, match_type) do nothing;
  if found then
    return 'ok';
  end if;
  return 'already_confirmed';
end;
$$;
revoke execute on function public.watch_confirm_match(text, uuid, text, text, numeric, numeric, text, int) from public;
grant execute on function public.watch_confirm_match(text, uuid, text, text, numeric, numeric, text, int) to anon, authenticated;
