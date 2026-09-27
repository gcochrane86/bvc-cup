-- Private bucket for player photos: signed-in users read, upload and replace.
insert into storage.buckets (id, name, public)
values ('player-photos', 'player-photos', false)
on conflict (id) do nothing;

create policy "photos read" on storage.objects for select to authenticated
  using (bucket_id = 'player-photos');
create policy "photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'player-photos');
create policy "photos update" on storage.objects for update to authenticated
  using (bucket_id = 'player-photos') with check (bucket_id = 'player-photos');

-- Live updates for everything the app displays.
alter publication supabase_realtime add table
  public.scores, public.match_results, public.players, public.courses, public.course_holes,
  public.events, public.event_players, public.rounds, public.groups, public.group_players;
