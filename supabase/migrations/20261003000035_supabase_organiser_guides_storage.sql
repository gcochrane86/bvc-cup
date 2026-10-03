-- Supabase-only (PGlite tests skip it): organisers upload and remove course guide photos too.
drop policy "guides insert" on storage.objects;
drop policy "guides delete" on storage.objects;
create policy "guides insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'course-guides' and (select public.is_organiser()));
create policy "guides delete" on storage.objects for delete to authenticated
  using (bucket_id = 'course-guides' and (select public.is_organiser()));
