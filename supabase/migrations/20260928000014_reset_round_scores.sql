-- Admin "reset a day": clears every score and confirmed result for one round in a single transaction
-- (other rounds and all setup are untouched). Deleting the results fires the unfreeze trigger.
create function public.reset_round_scores(p_round_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.match_results mr
  using public.groups g
  where g.id = mr.group_id and g.round_id = p_round_id;
  delete from public.scores where round_id = p_round_id;
end;
$$;

revoke execute on function public.reset_round_scores(uuid) from public, anon;
grant execute on function public.reset_round_scores(uuid) to authenticated;
