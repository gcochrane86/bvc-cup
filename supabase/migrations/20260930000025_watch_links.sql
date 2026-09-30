-- Share links (#/watch/<token>): the admin can give an event a private link that lets anyone watch that
-- event without signing in. Read only, and only that event: the tables stay members-only, and the link's
-- data comes from watch_event(). Turning the link off (null) or replacing it stops the old one working.
alter table public.events add column watch_token text unique check (watch_token is null or length(watch_token) >= 16);

-- Everything the app shows for one event, or null when the token isn't a live link.
create function public.watch_event(p_token text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with ev as (select * from public.events where watch_token is not null and watch_token = p_token),
  r as (select * from public.rounds where event_id in (select id from ev)),
  g as (select * from public.groups where round_id in (select id from r)),
  gp as (select * from public.group_players where group_id in (select id from g)),
  rt as (select * from public.round_tees where round_id in (select id from r)),
  ep as (select * from public.event_players where event_id in (select id from ev)),
  c as (select * from public.courses where id in (select course_id from r union select course_id from rt)),
  p as (select * from public.players where id in (select player_id from ep union select player_id from gp))
  select case when exists (select 1 from ev) then jsonb_build_object(
    'event', (select to_jsonb(ev) - 'watch_token' from ev),
    'players', coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from p), '[]'),
    'eventPlayers', coalesce((select jsonb_agg(to_jsonb(ep)) from ep), '[]'),
    'rounds', coalesce((select jsonb_agg(to_jsonb(r) order by r.round_no) from r), '[]'),
    'groups', coalesce((select jsonb_agg(to_jsonb(g)) from g), '[]'),
    'groupPlayers', coalesce((select jsonb_agg(to_jsonb(gp)) from gp), '[]'),
    'roundTees', coalesce((select jsonb_agg(to_jsonb(rt)) from rt), '[]'),
    'courses', coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from c), '[]'),
    'courseHoles', coalesce((select jsonb_agg(to_jsonb(h)) from public.course_holes h where h.course_id in (select id from c)), '[]'),
    'scores', coalesce((select jsonb_agg(to_jsonb(s)) from public.scores s where s.round_id in (select id from r)), '[]'),
    'results', coalesce((select jsonb_agg(to_jsonb(m)) from public.match_results m where m.group_id in (select id from g)), '[]'),
    'guidePhotos', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.guide_photos x
                             where x.course_name in (select name from c)), '[]')
  ) end
$$;
revoke execute on function public.watch_event(text) from public;
grant execute on function public.watch_event(text) to anon, authenticated;

-- Storage (policy in the _supabase_ migration after this): a photo a live link shows — a player of a shared
-- event, or a guide photo for one of its courses.
create function public.watch_shared_object(p_bucket text, p_path text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_bucket
    when 'player-photos' then exists (
      select 1 from public.players pl
      join public.event_players ep on ep.player_id = pl.id
      join public.events e on e.id = ep.event_id
      where e.watch_token is not null and pl.photo_path = p_path)
    when 'course-guides' then exists (
      select 1 from public.guide_photos gph
      join public.courses c on c.name = gph.course_name
      join public.rounds r on r.course_id = c.id
      join public.events e on e.id = r.event_id
      where e.watch_token is not null and gph.path = p_path)
    else false
  end
$$;
revoke execute on function public.watch_shared_object(text, text) from public;
grant execute on function public.watch_shared_object(text, text) to anon, authenticated;
