-- WHS: players hold a Handicap Index; each round converts it to a course handicap using the
-- course's slope and rating (for the tees being played). NULL = not set: the index is used as-is.
alter table public.courses
  add column slope_rating smallint check (slope_rating between 55 and 155),
  add column course_rating numeric(4,1) check (course_rating between 50 and 90);

drop function public.save_course(uuid, text, jsonb);

create function public.save_course(
  p_course_id uuid, p_name text, p_holes jsonb, p_slope_rating int, p_course_rating numeric
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
    insert into public.courses (name, slope_rating, course_rating)
    values (p_name, p_slope_rating, p_course_rating) returning id into v_id;
  else
    update public.courses
    set name = p_name, slope_rating = p_slope_rating, course_rating = p_course_rating
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

revoke execute on function public.save_course(uuid, text, jsonb, int, numeric) from public, anon;
grant execute on function public.save_course(uuid, text, jsonb, int, numeric) to authenticated;
