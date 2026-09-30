-- Private bucket for course guide photos: members read; only the admin uploads or removes.
insert into storage.buckets (id, name, public) values ('course-guides', 'course-guides', false) on conflict (id) do nothing;
create policy "guides read" on storage.objects for select to authenticated
  using (bucket_id = 'course-guides' and (select public.is_member()));
create policy "guides insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'course-guides' and (select public.is_admin()));
create policy "guides delete" on storage.objects for delete to authenticated
  using (bucket_id = 'course-guides' and (select public.is_admin()));
-- Phones reload setup (and the Courses tab) when guide photos change.
alter publication supabase_realtime add table public.guide_photos;
