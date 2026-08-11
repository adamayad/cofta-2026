-- ============================================================
-- COFTA 2026 — forfeit score fix
--
-- Bug: scores are derived from events, but a forfeited match has no
-- events, so an awarded 3-0 read as 0-0 — and any later recalc would
-- have wiped it anyway. The recalc must treat a forfeit as an override.
-- ============================================================

create or replace function public.recalc_match_score() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m   uuid := coalesce(new.match_id, old.match_id);
  ff  text;
begin
  select forfeit_side into ff from public.matches where id = m;

  if ff is not null then
    update public.matches
      set home_score = case when ff = 'home' then 0 else 3 end,
          away_score = case when ff = 'away' then 0 else 3 end,
          updated_at = now()
    where id = m;
    return null;
  end if;

  update public.matches set
    home_score = (select count(*) from public.match_events e
                   where e.match_id = m and not e.voided
                     and ((e.type = 'goal'     and e.side = 'home')
                       or (e.type = 'own_goal' and e.side = 'away'))),
    away_score = (select count(*) from public.match_events e
                   where e.match_id = m and not e.voided
                     and ((e.type = 'goal'     and e.side = 'away')
                       or (e.type = 'own_goal' and e.side = 'home'))),
    updated_at = now()
  where id = m;
  return null;
end $$;

create or replace function public.set_forfeit(p_match uuid, p_side text)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;
  if p_side is not null and p_side not in ('home','away') then raise exception 'bad_side'; end if;

  update public.matches set
    forfeit_side = p_side,
    status = case when p_side is null then 'scheduled' else 'full_time' end::public.match_status,
    clock_running = false, clock_anchor = null, clock_accum_ms = 0,
    locked = (p_side is not null),
    home_score = case when p_side is null then 0
                      when p_side = 'home' then 0 else 3 end,
    away_score = case when p_side is null then 0
                      when p_side = 'away' then 0 else 3 end,
    version = version + 1, updated_at = now()
  where id = p_match returning * into m;

  -- clearing a forfeit rebuilds the score from events
  if p_side is null then
    update public.matches set
      home_score = (select count(*) from public.match_events e
                     where e.match_id = p_match and not e.voided
                       and ((e.type='goal' and e.side='home') or (e.type='own_goal' and e.side='away'))),
      away_score = (select count(*) from public.match_events e
                     where e.match_id = p_match and not e.voided
                       and ((e.type='goal' and e.side='away') or (e.type='own_goal' and e.side='home')))
    where id = p_match returning * into m;
  end if;

  insert into public.audit_log(actor, action, match_id, detail)
  values (auth.uid(), 'forfeit', p_match, jsonb_build_object('side', p_side));
  return m;
end $$;
