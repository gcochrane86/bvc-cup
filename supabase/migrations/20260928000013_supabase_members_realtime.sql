-- Supabase-only (PGlite tests skip it): live updates for the access list, so the admin's Access tab
-- and a waiting phone see approvals straight away.
alter publication supabase_realtime add table public.members;
