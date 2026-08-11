-- ============================================================
-- COFTA 2026 — row level security
--
-- Anyone may READ. Only listed admins may write, and only through the
-- functions in 0002 — there are no insert/update/delete policies at all.
-- Function privileges are handled in 0006, NOT here: see the note below.
-- ============================================================

alter table public.teams          enable row level security;
alter table public.players        enable row level security;
alter table public.matches        enable row level security;
alter table public.match_events   enable row level security;
alter table public.slot_overrides enable row level security;
alter table public.admins         enable row level security;
alter table public.audit_log      enable row level security;

-- public read
create policy read_teams   on public.teams          for select using (true);
create policy read_players on public.players        for select using (true);
create policy read_matches on public.matches        for select using (true);
create policy read_events  on public.match_events   for select using (true);
create policy read_slots   on public.slot_overrides for select using (true);

-- admins only
create policy read_admins on public.admins    for select using (public.is_admin());
create policy read_audit  on public.audit_log for select using (public.is_admin());

-- ------------------------------------------------------------
-- WARNING, learned the hard way.
--
-- This file originally did `revoke all on function ... from anon`.
-- That does NOTHING useful. Postgres grants EXECUTE on every new function
-- to PUBLIC, and `anon` inherits from PUBLIC, so all of the write functions
-- stayed callable by anonymous visitors. Supabase's linter caught it.
--
-- The correct approach is to revoke from PUBLIC and grant back explicitly.
-- That is done in 0006_function_privileges.sql.
-- ------------------------------------------------------------
