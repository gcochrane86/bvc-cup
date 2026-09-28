-- Several phones can score the same hole at once. A row the scorer didn't touch is only a par default,
-- so it is sent with p_if_absent = true: it fills an empty cell but never overwrites a score that
-- someone else has already entered (returns 'exists'). Touched rows are written as before.
drop function public.upsert_score(uuid, uuid, int, int, boolean, timestamptz);

create function public.upsert_score(
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
    insert into public.scores (round_id, player_id, hole, gross, picked_up, client_updated_at)
    values (p_round_id, p_player_id, p_hole, p_gross, p_picked_up, p_client_updated_at)
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

revoke execute on function public.upsert_score(uuid, uuid, int, int, boolean, timestamptz, boolean) from public, anon;
grant execute on function public.upsert_score(uuid, uuid, int, int, boolean, timestamptz, boolean) to authenticated;
