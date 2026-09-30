-- Supabase-only (PGlite tests skip it): viewers of a share link can open that event's player and guide
-- photos (read only), per public.watch_shared_object.
create policy "watch link photos read" on storage.objects for select to anon, authenticated
  using (bucket_id in ('player-photos', 'course-guides') and (select public.watch_shared_object(bucket_id, name)));
