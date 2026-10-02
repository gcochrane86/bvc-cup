-- Wolf: a 3-player game with a rotating tee order. Each hole someone plays on their own (the wolf going solo,
-- or the player the wolf didn't partner); that's kept on the hole's score rows, so it is saved through the
-- same offline queue as the scores.
alter table public.rounds drop constraint rounds_three_game_check;
alter table public.rounds add constraint rounds_three_game_check
  check (three_game in ('six_stableford', 'six_flat', 'two_v_one', 'two_v_one_match', 'two_v_one_flat', 'two_v_one_best', 'wolf_stableford', 'wolf_flat'));
-- Stableford wolf: full handicaps (at stableford_pct), or off the lowest of the three (at stableford_pct).
alter table public.rounds add column wolf_off_low boolean not null default false;
insert into public.games (key, defaults) values
  ('wolf_stableford', '{"stableford_pct": 100}'),
  ('wolf_flat', '{}')
on conflict (key) do nothing;

alter table public.scores add column lone boolean not null default false;

-- p_lone: who played on their own (wolf). Null leaves it as it is, so correcting a score keeps it.
drop function public.watch_upsert_score(text, uuid, uuid, int, int, boolean, timestamptz, boolean);
drop function public.upsert_score(uuid, uuid, int, int, boolean, timestamptz, boolean);
drop function public.save_score(uuid, uuid, int, int, boolean, timestamptz, boolean);

create function public.save_score(
  p_round_id uuid, p_player_id uuid, p_hole int, p_gross int, p_picked_up boolean, p_client_updated_at timestamptz,
  p_if_absent boolean default false, p_lone boolean default null
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
    insert into public.scores (round_id, player_id, hole, gross, picked_up, client_updated_at, lone)
    values (p_round_id, p_player_id, p_hole, p_gross, p_picked_up, 'epoch', coalesce(p_lone, false))
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

  insert into public.scores (round_id, player_id, hole, gross, picked_up, client_updated_at, lone)
  values (p_round_id, p_player_id, p_hole, p_gross, p_picked_up, p_client_updated_at, coalesce(p_lone, false))
  on conflict (round_id, player_id, hole) do update
    set gross = excluded.gross,
        picked_up = excluded.picked_up,
        client_updated_at = excluded.client_updated_at,
        lone = coalesce(p_lone, public.scores.lone),
        updated_at = now()
    where public.scores.client_updated_at <= excluded.client_updated_at;
  if found then
    return 'ok';
  end if;
  return 'stale';
end;
$$;
revoke execute on function public.save_score(uuid, uuid, int, int, boolean, timestamptz, boolean, boolean) from public, anon;
grant execute on function public.save_score(uuid, uuid, int, int, boolean, timestamptz, boolean, boolean) to authenticated;

create function public.upsert_score(
  p_round_id uuid, p_player_id uuid, p_hole int, p_gross int, p_picked_up boolean, p_client_updated_at timestamptz,
  p_if_absent boolean default false, p_lone boolean default null
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'not a trip member' using errcode = '42501';
  end if;
  return public.save_score(p_round_id, p_player_id, p_hole, p_gross, p_picked_up, p_client_updated_at, p_if_absent, p_lone);
end;
$$;
revoke execute on function public.upsert_score(uuid, uuid, int, int, boolean, timestamptz, boolean, boolean) from public, anon;
grant execute on function public.upsert_score(uuid, uuid, int, int, boolean, timestamptz, boolean, boolean) to authenticated;

create function public.watch_upsert_score(
  p_token text, p_round_id uuid, p_player_id uuid, p_hole int, p_gross int, p_picked_up boolean,
  p_client_updated_at timestamptz, p_if_absent boolean default false, p_lone boolean default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.rounds where id = p_round_id and event_id = public.watch_link_event(p_token)) then
    raise exception 'not this event''s round' using errcode = '42501';
  end if;
  return public.save_score(p_round_id, p_player_id, p_hole, p_gross, p_picked_up, p_client_updated_at, p_if_absent, p_lone);
end;
$$;
revoke execute on function public.watch_upsert_score(text, uuid, uuid, int, int, boolean, timestamptz, boolean, boolean) from public;
grant execute on function public.watch_upsert_score(text, uuid, uuid, int, int, boolean, timestamptz, boolean, boolean) to anon, authenticated;
