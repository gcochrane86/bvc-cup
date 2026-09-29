-- Tees. A tee is a course record (its own slope, rating, par and stroke index) named by `tee`; records
-- sharing a `name` are one course's tees. NULL = a course with one unnamed tee (shown as before).
alter table public.courses add column tee text;
create unique index courses_name_tee on public.courses (name, coalesce(tee, ''));

-- Glashedy's tee variants (created as separate courses) become one course with three tees.
update public.courses set name = 'Glashedy Links', tee = substring(name from '\((\w+)\)$')
where name in ('Glashedy Links (Black)', 'Glashedy Links (Gold)', 'Glashedy Links (White)');

-- Players on a different tee from the day's main tee (rounds.course_id). Everyone else plays the main tee.
create table public.round_tees (
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  primary key (round_id, player_id)
);
alter table public.round_tees enable row level security;
grant select, insert, update, delete on public.round_tees to authenticated;
create policy "members read round_tees" on public.round_tees for select to authenticated using ((select public.is_member()));
create policy "admin write round_tees" on public.round_tees for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- A confirmed match's tees are locked, like its scores: reopen the match to change them.
create function public.round_tee_locked() returns trigger
language plpgsql
set search_path = ''
as $$
declare r uuid := coalesce(new.round_id, old.round_id);
declare p uuid := coalesce(new.player_id, old.player_id);
begin
  if exists (
    select 1 from public.match_results mr
    join public.groups g on g.id = mr.group_id
    join public.group_players gp on gp.group_id = g.id
    where g.round_id = r and gp.player_id = p
  ) then
    raise exception 'that player''s match is confirmed — reopen it to change their tee' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger round_tees_locked before insert or update or delete on public.round_tees
  for each row execute function public.round_tee_locked();

-- save_course gains the tee name (default null, so calls without it — e.g. the app before this release — still work).
drop function public.save_course(uuid, text, jsonb, int, numeric);
create function public.save_course(
  p_course_id uuid, p_name text, p_holes jsonb, p_slope_rating int, p_course_rating numeric, p_tee text default null
) returns uuid
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_course_id is null then
    insert into public.courses (name, tee, slope_rating, course_rating)
    values (p_name, nullif(trim(p_tee), ''), p_slope_rating, p_course_rating) returning id into v_id;
  else
    update public.courses
    set name = p_name, tee = nullif(trim(p_tee), ''), slope_rating = p_slope_rating, course_rating = p_course_rating
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
revoke execute on function public.save_course(uuid, text, jsonb, int, numeric, text) from public, anon;
grant execute on function public.save_course(uuid, text, jsonb, int, numeric, text) to authenticated;
