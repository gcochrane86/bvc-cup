-- Course guide photos uploaded in Admin: one row per photo, per course (by name — every tee shares them) and hole.
-- Members see them; only the admin adds or removes them. The files live in the private 'course-guides' bucket.
create table public.guide_photos (
  id uuid primary key default gen_random_uuid(),
  course_name text not null,
  hole smallint not null check (hole between 1 and 18),
  path text not null,
  created_at timestamptz not null default now()
);
create index guide_photos_course on public.guide_photos (course_name, hole, created_at);
alter table public.guide_photos enable row level security;
grant select, insert, update, delete on public.guide_photos to authenticated;
create policy "members read guide_photos" on public.guide_photos for select to authenticated using ((select public.is_member()));
create policy "admin write guide_photos" on public.guide_photos for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
