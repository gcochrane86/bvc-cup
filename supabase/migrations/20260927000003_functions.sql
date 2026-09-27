-- All functions are SECURITY INVOKER (RLS applies) except set_player_photo.

create function public.upsert_score(
  p_round_id uuid, p_player_id uuid, p_hole int, p_gross int, p_picked_up boolean, p_client_updated_at timestamptz
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
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

create function public.confirm_match(
  p_group_id uuid, p_match_type text, p_winner text, p_points_a numeric, p_points_b numeric, p_result_text text, p_final_hole int
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
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

create function public.save_course(p_course_id uuid, p_name text, p_holes jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_course_id is null then
    insert into public.courses (name) values (p_name) returning id into v_id;
  else
    update public.courses set name = p_name where id = p_course_id;
    v_id := p_course_id;
  end if;
  delete from public.course_holes where course_id = v_id;
  insert into public.course_holes (course_id, hole, par, stroke_index)
  select v_id, h.hole, h.par, h.stroke_index
  from jsonb_to_recordset(p_holes) as h(hole int, par int, stroke_index int);
  return v_id;
end;
$$;

create function public.save_group(p_round_id uuid, p_group_no int, p_tee_time time, p_slots jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  insert into public.groups (round_id, group_no, tee_time)
  values (p_round_id, p_group_no, p_tee_time)
  on conflict (round_id, group_no) do update set tee_time = excluded.tee_time
  returning id into v_id;
  delete from public.group_players where group_id = v_id;
  insert into public.group_players (group_id, slot, player_id)
  select v_id, s.slot, s.player_id
  from jsonb_to_recordset(p_slots) as s(slot text, player_id uuid);
  return v_id;
end;
$$;

-- SECURITY DEFINER: lets the trip user set exactly one column (photo_path) without broader update rights.
create function public.set_player_photo(p_player_id uuid, p_path text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_path !~ ('^' || p_player_id::text || '/[0-9]+\.jpg$') then
    raise exception 'invalid photo path';
  end if;
  update public.players set photo_path = p_path where id = p_player_id;
end;
$$;

revoke execute on function public.upsert_score(uuid, uuid, int, int, boolean, timestamptz) from public, anon;
revoke execute on function public.confirm_match(uuid, text, text, numeric, numeric, text, int) from public, anon;
revoke execute on function public.save_course(uuid, text, jsonb) from public, anon;
revoke execute on function public.save_group(uuid, int, time, jsonb) from public, anon;
revoke execute on function public.set_player_photo(uuid, text) from public, anon;
grant execute on function public.upsert_score(uuid, uuid, int, int, boolean, timestamptz) to authenticated;
grant execute on function public.confirm_match(uuid, text, text, numeric, numeric, text, int) to authenticated;
grant execute on function public.save_course(uuid, text, jsonb) to authenticated;
grant execute on function public.save_group(uuid, int, time, jsonb) to authenticated;
grant execute on function public.set_player_photo(uuid, text) to authenticated;
