-- Each admin's favourite players: they sit at the top of an event's "Who's playing" list.
create table public.player_favourites (
  user_id uuid not null default auth.uid(),
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (user_id, player_id)
);
alter table public.player_favourites enable row level security;
grant select, insert, delete on public.player_favourites to authenticated;
create policy "admins keep their own favourites" on public.player_favourites for all to authenticated
  using ((select public.is_admin()) and user_id = (select auth.uid()))
  with check ((select public.is_admin()) and user_id = (select auth.uid()));
