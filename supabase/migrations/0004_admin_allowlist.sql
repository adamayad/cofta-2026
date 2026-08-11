-- ============================================================
-- COFTA 2026 — admin access by email allowlist
--
-- Nobody is made an admin by hand. An email is listed here, and whoever
-- signs up with that address is granted admin automatically. Adding a
-- future organiser is one insert; revoking is one delete.
-- ============================================================

create table if not exists public.admin_allowlist (
  email      text primary key,
  label      text,
  added_at   timestamptz not null default now()
);

alter table public.admin_allowlist enable row level security;
create policy read_allowlist on public.admin_allowlist
  for select using (public.is_admin());

insert into public.admin_allowlist (email, label)
-- Replace with the real organiser address before running.
values ('organiser@example.com', 'Organiser')
on conflict (email) do nothing;

create or replace function public.grant_admin_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.admin_allowlist a
             where lower(a.email) = lower(new.email)) then
    insert into public.admins (user_id, label)
    values (new.id, (select label from public.admin_allowlist
                     where lower(email) = lower(new.email)))
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_grant_admin on auth.users;
create trigger trg_grant_admin
after insert on auth.users
for each row execute function public.grant_admin_on_signup();

-- grant to anyone already registered
insert into public.admins (user_id, label)
select u.id, a.label
from auth.users u
join public.admin_allowlist a on lower(a.email) = lower(u.email)
on conflict (user_id) do nothing;
