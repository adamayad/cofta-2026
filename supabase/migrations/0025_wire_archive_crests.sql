-- ============================================================
-- COFTA 2026 — wire the supplied archive crests
--
-- Twelve files landed in web/crests/archive/, all 224x224 to match the live
-- crests. A file there is inert until the club's `display` points at it, so
-- this is that pointing — nine clubs that were showing a monogram tile, and
-- the three women's crests for the churches that field both sides.
--
-- The monogram keys (colour, text_colour, ring) are left on the rows. They
-- cost nothing, they stop being read the moment a crest exists, and they are
-- the fallback if a crest is ever withdrawn.
--
-- REMEMBER: bump VERSION in web/sw.js in the same push. Crests are
-- cache-first, so without it no installed device ever fetches them.
-- ============================================================

-- ── clubs that no longer compete: monogram -> crest ─────────
update public.archive_teams a
   set display = coalesce(a.display, '{}'::jsonb)
               || jsonb_build_object('crest', './crests/archive/' || v.file)
  from (values
    ('Archangel Michael',             'Hove',       'archangel-michael.webp'),
    ('St Demiana & Pope Kyrillos VI', 'Worthing',   'st-demiana-pope-kyrillos-vi.webp'),
    ('St George & St Athanasius',     'Newcastle',  'st-george-st-athanasius.webp'),
    ('St Mary & Archangel Michael',   'Birmingham', 'st-mary-archangel-michael.webp'),
    ('St Mary & St Abanoub',          'Leeds',      'st-mary-st-abanoub.webp'),
    ('St Mary & St George',           'Nottingham', 'st-mary-st-george.webp'),
    ('St Mary & St Michael',          'Scotland',   'st-mary-st-michael.webp'),
    ('St Mary & St Mina',             'Manchester', 'st-mary-st-mina.webp'),
    ('St Mina',                       'Ireland',    'st-mina.webp')
  ) as v(name, city, file)
 where a.canonical_name = v.name and a.city = v.city and a.parent_club is null;

-- ── the three churches that field a women's side ────────────
-- crest_women is read only on an edition whose category is women; the men's
-- editions keep inheriting the live crest through live_team_id.
update public.archive_teams a
   set display = coalesce(a.display, '{}'::jsonb)
               || jsonb_build_object('crest_women', './crests/archive/' || v.file)
  from (values
    ('St Mary & Pope Kyrillos VI',  'Hounslow',      'smpk-w.webp'),
    ('St Mark',                     'Kensington',    'stm-w.webp'),
    ('St Mary & Archangel Michael', 'Golders Green', 'gg-w.webp')
  ) as v(name, city, file)
 where a.canonical_name = v.name and a.city = v.city and a.parent_club is null;

do $$
declare n int; leftover text;
begin
  select count(*) into n from public.archive_teams where display ? 'crest';
  if n <> 9 then raise exception 'expected 9 clubs with a crest, found %', n; end if;

  select count(*) into n from public.archive_teams where display ? 'crest_women';
  if n <> 3 then raise exception 'expected 3 clubs with a women''s crest, found %', n; end if;

  -- Birmingham and Golders Green share a name; only Birmingham should have
  -- taken the standalone crest, and only Golders Green the women's one.
  if (select display ? 'crest' from public.archive_teams
       where canonical_name = 'St Mary & Archangel Michael' and city = 'Golders Green') then
    raise exception 'Golders Green wrongly took the Birmingham crest';
  end if;
  if (select display ? 'crest_women' from public.archive_teams
       where canonical_name = 'St Mary & Archangel Michael' and city = 'Birmingham') then
    raise exception 'Birmingham wrongly took the Golders Green women''s crest';
  end if;

  -- who is still on a monogram, so the summary can say so honestly
  select string_agg(canonical_name || coalesce(', ' || city, ''), '; ' order by canonical_name)
    into leftover
    from public.archive_teams
   where parent_club is null and live_team_id is null and not (display ? 'crest');
  raise notice 'still on a monogram tile: %', coalesce(leftover, 'none');
end $$;
