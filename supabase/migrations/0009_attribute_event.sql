-- ============================================================
-- COFTA 2026 — attach a scorer to an already-logged goal
--
-- A goal is logged the instant it is tapped, so the score moves immediately.
-- The scorer is attached a moment later, once the organiser has picked a
-- name. Separating the two means attribution can never delay or block the
-- score, which is what makes the picker safe to use mid-match.
-- ============================================================

create or replace function public.attribute_event(p_event uuid, p_player uuid)
returns public.match_events
language plpgsql security definer set search_path = public as $$
declare e public.match_events;
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;

  update public.match_events
    set player_id = p_player
  where id = p_event and not voided
  returning * into e;

  if not found then raise exception 'no_such_event'; end if;

  insert into public.audit_log(actor, action, match_id, detail)
  values (auth.uid(), 'event:attribute', e.match_id,
          jsonb_build_object('event', p_event, 'player', p_player));
  return e;
end $$;

revoke all on function public.attribute_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.attribute_event(uuid, uuid) to authenticated;
