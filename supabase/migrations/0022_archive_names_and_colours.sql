-- ============================================================
-- COFTA 2026 — archive clubs: full church name, city as its own field,
-- and confirmed colours for the clubs that no longer compete
--
-- 0021 stored a club as one smushed string — "Anba Abraam, Brighton",
-- "Manchester (St Mary & St Mina)" — because that is how the sources wrote
-- them. The app renders a club as a church name with its city small
-- underneath, everywhere, and a single field cannot do that. So the name and
-- the city become separate columns and the name becomes the FULL church name,
-- matching the live `teams.name` exactly for the seven clubs that still
-- compete.
--
-- Where a source never recorded a church name (Newcastle, Hove, the joint
-- Liverpool & Bolton entry) the name stays as the source had it and the city
-- is null. Inventing one would break the archive's first rule.
-- ============================================================

alter table public.archive_teams add column if not exists city text;

comment on column public.archive_teams.canonical_name is
  'The FULL church name and nothing else — "St Mary & St Abraam", never '
  '"Anba Abraam" and never "St Mary & St Abraam, Brighton". For the clubs '
  'with a live_team_id this matches public.teams.name exactly. Null city '
  'means the source never recorded one.';

-- Two different churches share a name in different cities: Golders Green and
-- Birmingham are both "St Mary & Archangel Michael". The name alone can no
-- longer be unique, which is precisely why the city is now its own column.
alter table public.archive_teams drop constraint if exists archive_teams_canonical_name_key;
create unique index if not exists archive_teams_name_city_key
  on public.archive_teams (canonical_name, coalesce(city, ''));

-- ── the seven that still compete: names must match the live rows ──
update public.archive_teams a
   set canonical_name = t.name, city = t.city
  from public.teams t
 where a.live_team_id = t.id and a.parent_club is null;

-- ── B teams take the parent's name and city, plus a B ──────────
-- Their own row, never folded into the parent's: these sides have played
-- each other. The trailing B keeps the name unique and is what the UI's
-- B marker checks for.
update public.archive_teams a
   set canonical_name = t.name || ' B', city = t.city
  from public.teams t
 where a.live_team_id = t.id and a.parent_club is not null;

-- ── everyone else, split by hand from the source strings ───────
update public.archive_teams set canonical_name = 'St Demiana & Pope Kyrillos VI', city = 'Worthing'
  where id = 'f427c65b-cb87-5a3b-81e8-6809e4d8563f';
update public.archive_teams set canonical_name = 'St Mary & St George',          city = 'Nottingham'
  where id = '743e2246-6b55-5f58-8d23-35ce49b9e88b';
update public.archive_teams set canonical_name = 'St Mary & St Mina',            city = 'Manchester'
  where id = '88a5403b-5f3c-5c57-91cf-c2b1b34bd7ce';
update public.archive_teams set canonical_name = 'St Mary & St Abanoub',         city = 'Leeds'
  where id = 'ecd457ca-74ca-5495-a7b9-9ca613826fbc';
update public.archive_teams set canonical_name = 'St Mary & Archangel Michael',  city = 'Birmingham'
  where id = '2ad54543-5b62-5551-b294-597c3df178ef';
update public.archive_teams set canonical_name = 'St Mary & St Michael',         city = 'Scotland'
  where id = 'b7dd36f8-357e-56f4-9b0c-17b8f69a3949';
update public.archive_teams set canonical_name = 'St Mary & St Philopater',      city = 'Bolton'
  where id = '32a34dac-1b86-53ab-8e52-fbd72226d550';
update public.archive_teams set canonical_name = 'St Mina',                      city = 'Ireland'
  where id = '035e3b7e-40bd-5f63-bc67-84026c88562e';
update public.archive_teams set canonical_name = 'St Paul',                      city = 'London'
  where id = '066e0acd-d844-5b10-a106-2a4dcfd5f9a9';

-- No church name was ever recorded for these three, so the source string
-- stands and the city stays null rather than being guessed at.
update public.archive_teams set canonical_name = 'Liverpool & Bolton', city = null
  where id = '30e06bb8-e5c7-500d-8d9b-dd102c340661';
update public.archive_teams set canonical_name = 'Newcastle',          city = null
  where id = 'a10cf158-4bd0-5682-9888-19674cefdbe7';
update public.archive_teams set canonical_name = 'Hove',               city = null
  where id = '5502dfc6-8f14-5f28-b906-f21ed9f3ac8d';

-- ── confirmed colours for the clubs off the circuit ────────────
-- Explicit data, not a hash. These eight were confirmed by Adam; anything
-- not listed keeps the deterministic hashed palette, which is deliberately
-- muted so an unassigned club never looks like it has real branding.
--
-- Nottingham and Manchester are both red. Side by side in a fixture list
-- that is confusable, so they take clearly different reds and Manchester
-- carries a ring the other does not. The ring is data like the colour, so
-- the UI stays a renderer rather than a place where rules hide.
update public.archive_teams set display = jsonb_build_object(
    'colour', '#4B2E83', 'text_colour', '#FFFFFF')                       -- purple
  where id = 'ecd457ca-74ca-5495-a7b9-9ca613826fbc';                     -- Leeds
update public.archive_teams set display = jsonb_build_object(
    'colour', '#16305C', 'text_colour', '#FFFFFF')                       -- dark blue
  where id = 'a10cf158-4bd0-5682-9888-19674cefdbe7';                     -- Newcastle
update public.archive_teams set display = jsonb_build_object(
    'colour', '#A31621', 'text_colour', '#FFFFFF')                       -- deep red
  where id = '743e2246-6b55-5f58-8d23-35ce49b9e88b';                     -- Nottingham
update public.archive_teams set display = jsonb_build_object(
    'colour', '#D6402A', 'text_colour', '#FFFFFF', 'ring', '#FFD9D2')    -- brighter red + ring
  where id = '88a5403b-5f3c-5c57-91cf-c2b1b34bd7ce';                     -- Manchester
update public.archive_teams set display = jsonb_build_object(
    'colour', '#1B7A4B', 'text_colour', '#FFFFFF')                       -- green
  where id = '035e3b7e-40bd-5f63-bc67-84026c88562e';                     -- St Mina, Ireland
update public.archive_teams set display = jsonb_build_object(
    'colour', '#6B7280', 'text_colour', '#FFFFFF')                       -- grey
  where id = '5502dfc6-8f14-5f28-b906-f21ed9f3ac8d';                     -- Hove (historical)
update public.archive_teams set display = jsonb_build_object(
    'colour', '#E8A0C0', 'text_colour', '#3A1F2B')                       -- pink, dark ink
  where id = '066e0acd-d844-5b10-a106-2a4dcfd5f9a9';                     -- St Paul, London
update public.archive_teams set display = jsonb_build_object(
    'colour', '#1F6FB2', 'text_colour', '#FFFFFF')                       -- blue
  where id = '2ad54543-5b62-5551-b294-597c3df178ef';                     -- Birmingham

-- ── assertions ─────────────────────────────────────────────────
do $$
declare bad int; n int;
begin
  select count(*) into bad from public.archive_teams
   where canonical_name like '%,%' or canonical_name like '%(%';
  if bad > 0 then
    raise exception '% club names still carry a city or a bracket', bad;
  end if;

  select count(*) into bad
    from public.archive_teams a join public.teams t on t.id = a.live_team_id
   where a.parent_club is null and a.canonical_name <> t.name;
  if bad > 0 then
    raise exception '% crosswalked clubs do not match their live name', bad;
  end if;

  select count(*) into n from public.archive_teams where display ? 'colour';
  if n <> 8 then raise exception 'expected 8 clubs with a confirmed colour, found %', n; end if;

  select count(*) into bad from public.archive_teams
   where display ? 'colour' and live_team_id is not null;
  if bad > 0 then
    raise exception 'a crosswalked club was given an archive colour; it should inherit the live one';
  end if;

  raise notice 'archive_teams: names split, 8 colours assigned';
end $$;
