-- ============================================================
-- Supabase preloads the safeupdate guard on API connections: any DELETE or
-- UPDATE without a WHERE clause is refused. reset_tournament() deliberately
-- touches whole tables, so every statement now carries an explicit
-- `where true` — the guard checks for the clause, not its selectivity.
-- Migrations run on a direct connection without the guard, which is why
-- this only surfaced when the button was pressed through the live site.
-- ============================================================

create or replace function public.reset_tournament() returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select role from public.admins where user_id = auth.uid()), '')
     <> 'organiser' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  delete from public.match_events  where true;
  delete from public.slot_overrides where true;
  delete from public.tie_shootouts  where true;

  update public.matches set
    status = 'scheduled', home_score = 0, away_score = 0,
    pens_home = 0, pens_away = 0, pens_decided = false,
    forfeit_side = null, clock_running = false, clock_anchor = null,
    clock_accum_ms = 0, locked = false, version = 0,
    controlled_by = null, controlled_at = null, updated_at = now()
  where true;

  update public.matches set home_team = null, away_team = null
  where stage in ('SF1','SF2','FINAL');

  update public.teams set disqualified = false where true;

  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'reset_tournament', '{}'::jsonb);
end $$;
