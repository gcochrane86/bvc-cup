-- Organisers: approved members the admin picks in Admin → Access. They run events (any event), add and edit
-- players and courses (and guide photos), and reset scores on events they created. Deleting players,
-- courses and events, Access and Games stay with the admin.
alter table public.members add column role text not null default 'member' check (role in ('member', 'organiser'));
-- Who created each event (organisers may reset scores only on their own). Older events have none.
alter table public.events add column created_by uuid default auth.uid();

create function public.is_organiser() returns boolean
language sql stable
set search_path = ''
as $$
  select public.is_admin()
      or exists (select 1 from public.members m where m.user_id = auth.uid() and m.status = 'approved' and m.role = 'organiser')
$$;

-- Event setup: organisers write; only the admin deletes players, courses and events.
do $$
declare t text;
begin
  foreach t in array array['event_players', 'rounds', 'groups', 'group_players', 'course_holes'] loop
    execute format('drop policy "admin write %1$s" on public.%1$I', t);
    execute format(
      'create policy "organisers write %1$s" on public.%1$I for all to authenticated using ((select public.is_organiser())) with check ((select public.is_organiser()))', t);
  end loop;
  foreach t in array array['players', 'courses', 'events'] loop
    execute format('drop policy "admin write %1$s" on public.%1$I', t);
    execute format('create policy "organisers add %1$s" on public.%1$I for insert to authenticated with check ((select public.is_organiser()))', t);
    execute format(
      'create policy "organisers edit %1$s" on public.%1$I for update to authenticated using ((select public.is_organiser())) with check ((select public.is_organiser()))', t);
    execute format('create policy "admin deletes %1$s" on public.%1$I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

drop policy "admin write round_tees" on public.round_tees;
create policy "organisers write round_tees" on public.round_tees for all to authenticated
  using ((select public.is_organiser())) with check ((select public.is_organiser()));
drop policy "admin write round_players" on public.round_players;
create policy "organisers write round_players" on public.round_players for all to authenticated
  using ((select public.is_organiser())) with check ((select public.is_organiser()));
drop policy "admin write guide_photos" on public.guide_photos;
create policy "organisers write guide_photos" on public.guide_photos for all to authenticated
  using ((select public.is_organiser())) with check ((select public.is_organiser()));
-- Reopening a confirmed result.
drop policy "admin unlocks results" on public.match_results;
create policy "organisers reopen results" on public.match_results for delete to authenticated
  using ((select public.is_organiser()));
drop policy "admins keep their own favourites" on public.player_favourites;
create policy "organisers keep their own favourites" on public.player_favourites for all to authenticated
  using ((select public.is_organiser()) and user_id = (select auth.uid()))
  with check ((select public.is_organiser()) and user_id = (select auth.uid()));

-- Pairings and courses: organisers too (same functions, new check).
create or replace function public.save_group(p_round_id uuid, p_group_no int, p_tee_time time, p_slots jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_frozen jsonb;
begin
  if not public.is_organiser() then
    raise exception 'organisers only' using errcode = '42501';
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

create or replace function public.save_course(
  p_course_id uuid, p_name text, p_holes jsonb, p_slope_rating int, p_course_rating numeric, p_tee text default null
) returns uuid
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_organiser() then
    raise exception 'organisers only' using errcode = '42501';
  end if;
  if p_course_id is null then
    insert into public.courses (name, tee, slope_rating, course_rating)
    values (p_name, nullif(trim(p_tee), ''), p_slope_rating, p_course_rating) returning id into v_id;
  else
    update public.courses
    -- No p_tee (the app before tees): keep the tee name. '' clears it.
    set name = p_name, tee = case when p_tee is null then tee else nullif(trim(p_tee), '') end,
        slope_rating = p_slope_rating, course_rating = p_course_rating
    where id = p_course_id;
    v_id := p_course_id;
  end if;
  delete from public.course_holes where course_id = v_id;
  insert into public.course_holes (course_id, hole, par, stroke_index)
  select v_id, h.hole, h.par, h.stroke_index
  from jsonb_to_recordset(p_holes) as h(hole int, par int, stroke_index int);
  return v_id;
end;
$$;

-- Reset scores: the admin, or an organiser on an event they created.
create function public.can_reset_event(p_event_id uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_organiser() and exists (select 1 from public.events e where e.id = p_event_id and e.created_by = auth.uid()))
$$;

create or replace function public.reset_event_scores(p_event_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.can_reset_event(p_event_id) then
    raise exception 'only the event''s creator or an admin' using errcode = '42501';
  end if;
  delete from public.match_results mr
  using public.groups g, public.rounds r
  where g.id = mr.group_id and r.id = g.round_id and r.event_id = p_event_id;
  delete from public.scores s
  using public.rounds r
  where r.id = s.round_id and r.event_id = p_event_id;
end;
$$;

create or replace function public.reset_round_scores(p_round_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.can_reset_event((select event_id from public.rounds where id = p_round_id)) then
    raise exception 'only the event''s creator or an admin' using errcode = '42501';
  end if;
  delete from public.match_results mr
  using public.groups g
  where g.id = mr.group_id and g.round_id = p_round_id;
  delete from public.scores where round_id = p_round_id;
end;
$$;
