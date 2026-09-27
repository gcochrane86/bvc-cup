-- Admin = the admin Supabase Auth user, marked via app_metadata (server-controlled; never user_metadata).
create function public.is_admin() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

-- True when a confirmed match includes this player and covers this hole (spec §3.5).
create function public.score_locked(p_round_id uuid, p_player_id uuid, p_hole int) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.match_results mr
    join public.groups g on g.id = mr.group_id
    join public.group_players gp on gp.group_id = g.id and gp.player_id = p_player_id
    where g.round_id = p_round_id
      and p_hole <= mr.final_hole
      and (
        mr.match_type = 'better_ball'
        or (mr.match_type = 'low_singles' and gp.slot in ('A1', 'B1'))
        or (mr.match_type = 'high_singles' and gp.slot in ('A2', 'B2'))
      )
  )
$$;

-- Explicit Data API grants: signed-in users only. RLS below decides which rows.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array['players', 'courses', 'course_holes', 'events', 'event_players', 'rounds', 'groups', 'group_players', 'scores', 'match_results'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "signed-in read %1$s" on public.%1$I for select to authenticated using (true)', t);
  end loop;
  foreach t in array array['players', 'courses', 'course_holes', 'events', 'event_players', 'rounds', 'groups', 'group_players'] loop
    execute format(
      'create policy "admin write %1$s" on public.%1$I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t
    );
  end loop;
end $$;

-- Scores: any signed-in user may write, except on holes locked by a confirmed match.
create policy "write unlocked scores" on public.scores for insert to authenticated
  with check (not public.score_locked(round_id, player_id, hole));
create policy "update unlocked scores" on public.scores for update to authenticated
  using (not public.score_locked(round_id, player_id, hole))
  with check (not public.score_locked(round_id, player_id, hole));
create policy "delete unlocked scores" on public.scores for delete to authenticated
  using (not public.score_locked(round_id, player_id, hole));

-- Results: any signed-in user may confirm; only the admin may unlock (delete).
create policy "confirm results" on public.match_results for insert to authenticated with check (true);
create policy "admin unlocks results" on public.match_results for delete to authenticated
  using ((select public.is_admin()));
