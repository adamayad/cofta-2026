-- 0035 — three registry changes, and two new identity guards.
--
-- 1. "Republic of Ireland" IS A PARISH CHURCH. Both the CONAFA 2015 and 2016
--    reports print it, and 0026 registered it as canonical_name 'St Mina',
--    city 'Ireland' — a best guess at the time. Adam confirms the club is
--    St Mary & St Mina, Ireland. Renamed, with the report's string kept as an
--    alias, because aliases exist to hold exactly what a source printed.
--
--    THE ID DOES NOT CHANGE. archive_teams ids are stable keys and other rows
--    point at them; regenerating one to match the new name would orphan the
--    CONAFA 2015 entrant row. The documented uuidv5 scheme names a row at
--    creation, it does not re-derive it on every rename.
--
-- 2. St Mary & St Mark, BIRMINGHAM is new — CONAFA 2015 entrants and half of
--    COFTA 2017's joint side. A THIRD name collision after the St George trio.
--
-- 3. The Eritrean Orthodox side is new — CONAFA 2015 debutants. A community
--    representative team, not a parish: no city and no live crosswalk is
--    forced onto it, the same treatment every other non-parish entrant gets.
--
-- New ids follow the scheme documented in 0026:
--   uuidv5(DNS, 'archive_team:' || canonical name with city)
-- computed once and hard-coded. Verified by re-deriving East London's existing
-- id from the same inputs and getting ad74b633-… back.
--
-- GUARDS. Two pairs join G1-G3 in tournament_archive.json, and both are
-- asserted below:
--   G4  St Mary & St Mina, Manchester  vs  St Mary & St Mina, Ireland
--       — identical church names differing only by city, the same shape as
--         G1's Nottingham/East London pair. Manchester won CONAFA 2016 and
--         2017; Ireland were 2015 debutants who could not attend in 2016.
--   G5  St Mark, Kensington  vs  St Mary & St Mark, Birmingham
--       — a prefix or token match on "St Mark" collapses them. Never.
--
-- OPEN QUESTION Q12, deliberately NOT resolved here. The registry already
-- holds St Mary & Archangel Michael, Birmingham, from the CONAFA 2026 data.
-- Whether Birmingham has two Coptic churches or one of the two names is wrong
-- cannot be inferred from the sources, so BOTH rows stand and neither is
-- merged into the other. Adding the row the sources name is not the same as
-- ruling on the question.

begin;

-- 1. the rename
update public.archive_teams
   set canonical_name = 'St Mary & St Mina',
       aliases = array['Ireland','Republic of Ireland',
                       'St Mary & St Mina, Ireland','St Mary and St Mina, Ireland']::text[]
 where id = '035e3b7e-40bd-5f63-bc67-84026c88562e';

-- 2 and 3. the two new clubs
insert into public.archive_teams
  (id, canonical_name, short_name, aliases, merge_status, live_team_id, display, parent_club, city)
values
  ('b4bf6c3e-6152-55c9-9856-ea4f58ac63c5',
   'St Mary & St Mark', 'St Mary & St Mark',
   array['St Mary & St Mark, Birmingham','St Mary and St Mark, Birmingham',
         'St Mary & St Mark']::text[],
   'confirmed', null, null, null, 'Birmingham'),
  ('695e1b70-42aa-512a-a442-ea6e55071ad8',
   'Eritrean Orthodox', 'Eritrean',
   array['Eritrean Orthodox','the Eritrean Orthodox team','Eritrean']::text[],
   'confirmed', null, null, null, null),
  -- 4. COFTA 2017's joint side, ONE club and not two. Same treatment as the
  --    existing Liverpool & Bolton row: a combined entrant is its own entity,
  --    never split into its parishes and never merged into either of them.
  --    City is null because it has two.
  ('4df86be7-5dc7-5e2b-8cf1-948a7af72856',
   'St Anthony, Rotherham & St Mary & St Mark, Birmingham', 'Rotherham & Birmingham',
   array['St Anthony, Rotherham & St Mary & St Mark, Birmingham',
         'Rotherham & Birmingham']::text[],
   'confirmed', null, null, null, null)
on conflict (id) do nothing;

do $$
declare n int;
begin
  -- the rename landed and kept its id
  if not exists (select 1 from public.archive_teams
                  where id = '035e3b7e-40bd-5f63-bc67-84026c88562e'
                    and canonical_name = 'St Mary & St Mina' and city = 'Ireland') then
    raise exception 'Ireland rename failed';
  end if;
  -- and the report's own string still resolves
  if not exists (select 1 from public.archive_teams
                  where city = 'Ireland' and 'Republic of Ireland' = any(aliases)) then
    raise exception 'Republic of Ireland must remain an alias';
  end if;

  -- G4: two St Mary & St Mina clubs, separate rows, different cities
  select count(*) into n from public.archive_teams where canonical_name = 'St Mary & St Mina';
  if n <> 2 then raise exception 'expected 2 St Mary & St Mina rows, found %', n; end if;
  select count(distinct city) into n from public.archive_teams
   where canonical_name = 'St Mary & St Mina';
  if n <> 2 then raise exception 'the two St Mina clubs must differ by city'; end if;

  -- G5: St Mark, Kensington and St Mary & St Mark, Birmingham are separate
  if not exists (select 1 from public.archive_teams
                  where canonical_name = 'St Mark' and city = 'Kensington'
                    and parent_club is null) then
    raise exception 'St Mark, Kensington must survive untouched';
  end if;
  if not exists (select 1 from public.archive_teams
                  where canonical_name = 'St Mary & St Mark' and city = 'Birmingham') then
    raise exception 'St Mary & St Mark, Birmingham must exist';
  end if;

  -- Q12: BOTH Birmingham rows stand. This assertion exists so that a later
  -- dedupe pass which "tidies" one of them away fails loudly here.
  select count(*) into n from public.archive_teams where city = 'Birmingham';
  if n <> 2 then raise exception 'expected 2 Birmingham clubs pending Q12, found %', n; end if;

  -- the Eritrean side is registered without a city or a crosswalk
  if not exists (select 1 from public.archive_teams
                  where canonical_name = 'Eritrean Orthodox'
                    and city is null and live_team_id is null) then
    raise exception 'Eritrean Orthodox must have no city and no crosswalk';
  end if;

  -- the joint side exists as ONE row, and did not become two
  if not exists (select 1 from public.archive_teams
                  where id = '4df86be7-5dc7-5e2b-8cf1-948a7af72856'
                    and city is null and parent_club is null) then
    raise exception 'the Rotherham & Birmingham joint side must exist as one club';
  end if;
  -- and its two parishes are still their own separate clubs
  if not exists (select 1 from public.archive_teams
                  where canonical_name = 'St Anthony' and city = 'Rotherham') then
    raise exception 'Rotherham must survive independently of the joint side';
  end if;

  -- G1 still holds: the St George trio survived this migration untouched
  select count(*) into n from public.archive_teams
   where canonical_name in ('St George','St Mary & St George');
  if n <> 3 then raise exception 'the St George trio must still be 3 rows, found %', n; end if;

  -- short_name is a lookup key in these migrations, so it has to stay unique
  -- among parent clubs or a later join silently attaches the wrong team
  select count(*) into n from (
    select short_name from public.archive_teams
     where parent_club is null group by short_name having count(*) > 1) x;
  if n <> 0 then raise exception '% duplicated short_name(s) among parent clubs', n; end if;
end $$;

commit;
