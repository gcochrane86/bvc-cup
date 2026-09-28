-- Per-person access. Everyone logs in with their own email (+ the trip password, checked by the
-- `join` Edge Function, which creates their account). The first login adds them here as 'pending';
-- the admin approves or removes them. Only approved members (or the admin) can read or write
-- anything — the shared trip login on its own no longer grants access.
create table public.members (
  user_id uuid primary key,
  email text not null unique check (email = lower(email)),
  status text not null default 'pending' check (status in ('pending', 'approved', 'removed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.members enable row level security;
grant select, update, delete on public.members to authenticated;
revoke all on public.members from anon;

-- People see their own entry (to know if they're approved); the admin sees and decides on everyone.
-- Rows are only inserted by the join Edge Function (service role), so there is no insert policy.
create policy "own entry or admin" on public.members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "admin decides" on public.members for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin deletes" on public.members for delete to authenticated
  using ((select public.is_admin()));

-- Membership now comes from the access list (plus the admin).
create or replace function public.is_member() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
      or exists (select 1 from public.members m where m.user_id = auth.uid() and m.status = 'approved')
$$;
