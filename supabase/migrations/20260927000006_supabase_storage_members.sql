-- Supabase-only (PGlite tests skip it): photos are members-only too, matching 20260927000005.
drop policy "photos read" on storage.objects;
drop policy "photos insert" on storage.objects;
drop policy "photos update" on storage.objects;
create policy "photos read" on storage.objects for select to authenticated
  using (bucket_id = 'player-photos' and (select public.is_member()));
create policy "photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'player-photos' and (select public.is_member()));
create policy "photos update" on storage.objects for update to authenticated
  using (bucket_id = 'player-photos' and (select public.is_member()))
  with check (bucket_id = 'player-photos' and (select public.is_member()));
