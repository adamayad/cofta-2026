-- Managers: a name per club, shown on the Squads page. The snapshot already
-- serialises whole team rows, so the new column flows to the app untouched.
-- (Placeholder names applied live are temporary and not part of this record.)

alter table public.teams add column if not exists manager text;

create or replace function public.set_team_manager(p_team text, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;
  update public.teams set manager = nullif(btrim(p_name), '') where id = p_team;
  if not found then raise exception 'no_such_team'; end if;
  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'team:manager', jsonb_build_object('team', p_team, 'name', p_name));
end $$;

revoke all on function public.set_team_manager(text, text) from public, anon, authenticated;
grant execute on function public.set_team_manager(text, text) to authenticated;
