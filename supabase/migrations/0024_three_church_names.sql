-- ============================================================
-- COFTA 2026 — church names for three clubs the sources never named
--
-- 0022 left Newcastle, Hove and the joint Liverpool & Bolton entry carrying
-- their source strings with a null city, because inventing a church name
-- would have broken the archive's first rule. Adam has now supplied them, so
-- they are recorded — transcription from a person who knows, not inference.
--
--   Newcastle  -> St George & St Athanasius
--   Hove       -> Archangel Michael          (the club that withdrew pre-draw;
--                                             nothing to do with the live km)
--   Liverpool  -> St Mary & St Cyril
-- ============================================================

update public.archive_teams
   set canonical_name = 'St George & St Athanasius', city = 'Newcastle'
 where id = 'a10cf158-4bd0-5682-9888-19674cefdbe7';

update public.archive_teams
   set canonical_name = 'Archangel Michael', city = 'Hove'
 where id = '5502dfc6-8f14-5f28-b906-f21ed9f3ac8d';

-- Liverpool & Bolton is a JOINT TEAM of two churches, so it is the one row in
-- the archive that has no single church name. Renaming it to either church
-- would be wrong, and stacking both on the primary line runs to 45 characters
-- — it truncates on a fixture row at 375px.
--
-- So the team keeps its own name, and the two churches are recorded beside it
-- in `display.joint`, which the cabinet renders as a sub-line. St Mary & St
-- Philopater already has its own row for Bolton's solo COFTA 2022 entry; this
-- does not merge with it, because a joint side is not either club.
update public.archive_teams
   set display = coalesce(display, '{}'::jsonb) || jsonb_build_object(
     'joint', jsonb_build_array(
       jsonb_build_object('name', 'St Mary & St Cyril',      'city', 'Liverpool'),
       jsonb_build_object('name', 'St Mary & St Philopater', 'city', 'Bolton')))
 where id = '30e06bb8-e5c7-500d-8d9b-dd102c340661';

do $$
declare bad int;
begin
  select count(*) into bad from public.archive_teams
   where canonical_name in ('Newcastle', 'Hove');
  if bad > 0 then raise exception '% clubs still carry a bare place name', bad; end if;

  -- every club that played now has a church name, except the joint entry
  select count(*) into bad from public.archive_teams
   where city is null and not (display ? 'joint');
  if bad > 0 then raise exception '% clubs still have no city', bad; end if;

  if (select count(*) from public.archive_teams where display ? 'joint') <> 1 then
    raise exception 'expected exactly one joint entry';
  end if;

  -- Four rows now carry Archangel Michael — Golders Green, its B side,
  -- Birmingham and Hove — and they must stay four. Same saint, different
  -- churches; the (canonical_name, city) index is what keeps them apart.
  if (select count(*) from public.archive_teams
       where canonical_name like '%Archangel Michael%') <> 4 then
    raise exception 'expected 4 Archangel Michael rows, found %',
      (select count(*) from public.archive_teams where canonical_name like '%Archangel Michael%');
  end if;

  -- likewise St George: Stevenage on its own, Newcastle with St Athanasius
  if (select count(*) from public.archive_teams
       where canonical_name like 'St George%') <> 2 then
    raise exception 'expected 2 St George rows';
  end if;

  raise notice 'Newcastle, Hove and the joint Liverpool & Bolton entry named';
end $$;
