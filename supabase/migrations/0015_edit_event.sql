-- Edit a recorded event after the fact: the scorer and the minute.
-- Full replace of both fields — passing null for the player clears the
-- attribution. Voided events cannot be edited (undo them properly instead).

create or replace function public.edit_event(
  p_event uuid, p_player uuid, p_minute text
) returns public.match_events
language plpgsql security definer set search_path = public as $$
declare e public.match_events;
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;
  if p_minute is null or length(p_minute) > 8
     or p_minute !~ '^\d{1,2}(\+\d{1,2})?[′'']?$' then
    raise exception 'bad_minute';
  end if;

  update public.match_events
    set player_id = p_player,
        minute_label = regexp_replace(p_minute, '[′'']$', '') || '′'
  where id = p_event and not voided
  returning * into e;

  if not found then raise exception 'no_such_event'; end if;

  insert into public.audit_log(actor, action, match_id, detail)
  values (auth.uid(), 'event:edit', e.match_id,
          jsonb_build_object('event', p_event, 'player', p_player, 'minute', p_minute));
  return e;
end $$;

revoke all on function public.edit_event(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.edit_event(uuid, uuid, text) to authenticated;
