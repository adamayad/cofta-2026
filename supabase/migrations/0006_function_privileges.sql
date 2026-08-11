-- ============================================================
-- COFTA 2026 — function privileges
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and `anon`
-- inherits from PUBLIC. Revoking from `anon` alone therefore achieves
-- nothing: every write function stayed reachable at /rest/v1/rpc/...
--
-- Strip everything, then grant back only what each role actually needs.
-- Run this AFTER any migration that creates or replaces a function.
-- ============================================================

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- Spectators: tournament state and a clock reference. Nothing else.
grant execute on function public.snapshot()    to anon, authenticated;
grant execute on function public.server_time() to anon, authenticated;

-- Needed by the RLS policies on admins / audit_log / admin_allowlist.
-- Only ever reports whether YOU are an admin, so it leaks nothing.
grant execute on function public.is_admin() to anon, authenticated;

-- Write path: signed-in only. Each function also checks is_admin()
-- internally, so a signed-in non-admin is still rejected.
grant execute on function public.set_clock(uuid, text, int, bigint)                                 to authenticated;
grant execute on function public.log_event(uuid, uuid, public.event_type, text, uuid, bigint, text) to authenticated;
grant execute on function public.void_event(uuid)                                                   to authenticated;
grant execute on function public.set_shootout(uuid, int, int, boolean)                              to authenticated;
grant execute on function public.set_forfeit(uuid, text)                                            to authenticated;
grant execute on function public.set_disqualified(text, boolean)                                    to authenticated;
grant execute on function public.set_slot(text, text)                                               to authenticated;

-- recalc_match_score() and grant_admin_on_signup() are trigger functions.
-- Triggers do not need EXECUTE granted to the calling role, so they stay
-- revoked from everyone and vanish from the REST surface entirely.

-- Stop future functions being world-executable by default.
alter default privileges in schema public revoke execute on functions from public;
