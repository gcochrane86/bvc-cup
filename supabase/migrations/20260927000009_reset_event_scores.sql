-- Admin "reset all scores": clears every score and confirmed result for one event in a single
-- transaction (setup — players, courses, pairings, handicaps — is untouched). Deleting the results
-- fires the unfreeze trigger, so groups go back to playing off current handicaps.
create function public.reset_event_scores(p_event_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.match_results mr
  using public.groups g, public.rounds r
  where g.id = mr.group_id and r.id = g.round_id and r.event_id = p_event_id;
  delete from public.scores s
  using public.rounds r
  where r.id = s.round_id and r.event_id = p_event_id;
end;
$$;

revoke execute on function public.reset_event_scores(uuid) from public, anon;
grant execute on function public.reset_event_scores(uuid) to authenticated;
