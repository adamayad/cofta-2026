-- Username-style admin accounts.
--
-- Supabase Auth requires an email, so usernames are synthetic addresses on
-- a reserved domain that can never receive mail: pitch1@cofta.example.
-- The login form takes just "pitch1" and appends the domain silently.
-- Sessions, refresh and is_admin() all keep working unchanged.

insert into public.admin_allowlist (email, label) values
  ('pitch1@cofta.example', 'Pitch One'),
  ('pitch2@cofta.example', 'Pitch Two')
on conflict (email) do nothing;

-- Adding another admin later is one insert here, then creating the user in
-- Authentication -> Users. Revoking is deleting both.
