-- Handicaps are edited in admin at any time, but a group's handicaps freeze when one of its matches
-- is confirmed, so later changes (e.g. cutting someone after a bad day 1) only affect rounds still
-- to be played. NULL = not frozen: the player's current event handicap applies.
alter table public.group_players add column handicap numeric(4,1);

-- SECURITY DEFINER: a trip user confirming a match must be able to freeze group_players,
-- which only the admin may write directly. Runs only as a trigger (execute revoked below).
create function public.freeze_group_handicaps() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.group_players gp
    set handicap = ep.handicap
    from public.groups g
    join public.rounds r on r.id = g.round_id
    join public.event_players ep on ep.event_id = r.event_id
    where gp.group_id = new.group_id
      and g.id = gp.group_id
      and ep.player_id = gp.player_id
      and gp.handicap is null;
    return new;
  end if;
  -- DELETE (admin unlock): lift the freeze once the group has no confirmed results left.
  if not exists (select 1 from public.match_results where group_id = old.group_id) then
    update public.group_players set handicap = null where group_id = old.group_id;
  end if;
  return old;
end;
$$;
revoke execute on function public.freeze_group_handicaps() from public, anon, authenticated;

create trigger match_results_freeze after insert on public.match_results
  for each row execute function public.freeze_group_handicaps();
create trigger match_results_unfreeze after delete on public.match_results
  for each row execute function public.freeze_group_handicaps();

-- Re-saving pairings keeps each remaining player's frozen handicap; newcomers to a frozen group
-- freeze at their current event handicap.
create or replace function public.save_group(p_round_id uuid, p_group_no int, p_tee_time time, p_slots jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_frozen jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  insert into public.groups (round_id, group_no, tee_time)
  values (p_round_id, p_group_no, p_tee_time)
  on conflict (round_id, group_no) do update set tee_time = excluded.tee_time
  returning id into v_id;
  select coalesce(jsonb_object_agg(player_id::text, handicap), '{}'::jsonb) into v_frozen
  from public.group_players where group_id = v_id and handicap is not null;
  delete from public.group_players where group_id = v_id;
  insert into public.group_players (group_id, slot, player_id, handicap)
  select v_id, s.slot, s.player_id, (v_frozen ->> s.player_id::text)::numeric
  from jsonb_to_recordset(p_slots) as s(slot text, player_id uuid);
  if exists (select 1 from public.match_results where group_id = v_id) then
    update public.group_players gp
    set handicap = ep.handicap
    from public.event_players ep
    join public.rounds r on r.event_id = ep.event_id
    where gp.group_id = v_id and r.id = p_round_id and ep.player_id = gp.player_id and gp.handicap is null;
  end if;
  return v_id;
end;
$$;
