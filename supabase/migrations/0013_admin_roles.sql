-- ============================================================
-- Admin roles: organiser vs pitch.
--
-- Pitch accounts run matches. Organisers additionally hold the destructive
-- tools — today that is reset_tournament(). Enforced here in the database:
-- hiding a button is cosmetic, the role check is the real gate.
--
-- Adding the future full-access admin is:
--   insert into admin_allowlist (email, label, role)
--   values ('their-address', 'Their name', 'organiser');
-- then create the user in Authentication -> Users. The trigger does the rest.
-- ============================================================

alter table public.admin_allowlist
  add column if not exists role text not null default 'pitch'
  check (role in ('organiser','pitch'));

alter table public.admins
  add column if not exists role text not null default 'pitch'
  check (role in ('organiser','pitch'));

-- Replace with the real organiser address before running.
update public.admin_allowlist set role = 'organiser'
where email = 'organiser@example.com';

update public.admins a set role = al.role
from auth.users u
join public.admin_allowlist al on lower(al.email) = lower(u.email)
where u.id = a.user_id;

create or replace function public.grant_admin_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.admin_allowlist a
             where lower(a.email) = lower(new.email)) then
    insert into public.admins (user_id, label, role)
    select new.id, a.label, a.role
    from public.admin_allowlist a
    where lower(a.email) = lower(new.email)
    on conflict (user_id) do update
      set label = excluded.label, role = excluded.role;
  end if;
  return new;
end $$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.admins where user_id = auth.uid();
$$;

create or replace function public.reset_tournament() returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select role from public.admins where user_id = auth.uid()), '')
     <> 'organiser' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  delete from public.match_events;
  delete from public.slot_overrides;
  delete from public.tie_shootouts;

  update public.matches set
    status = 'scheduled', home_score = 0, away_score = 0,
    pens_home = 0, pens_away = 0, pens_decided = false,
    forfeit_side = null, clock_running = false, clock_anchor = null,
    clock_accum_ms = 0, locked = false, version = 0,
    controlled_by = null, controlled_at = null, updated_at = now();

  update public.matches set home_team = null, away_team = null
  where stage in ('SF1','SF2','FINAL');

  update public.teams set disqualified = false;

  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'reset_tournament', '{}'::jsonb);
end $$;

revoke all on function public.my_role() from public, anon, authenticated;
grant execute on function public.my_role() to authenticated;
