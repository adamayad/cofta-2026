-- Run this once smpk-w.webp, stm-w.webp and gg-w.webp are in
-- web/crests/archive/. Not runnable before then — it would point three clubs
-- at files that 404. (The client falls back to the live crest if they do, so
-- a premature run degrades rather than breaks, but the files should land first.)
--
-- Remember to bump VERSION in web/sw.js in the same push: crests are
-- cache-first, so without it no installed device ever fetches them.

update public.archive_teams a
   set display = coalesce(a.display, '{}'::jsonb)
               || jsonb_build_object('crest_women', './crests/archive/' || v.file)
  from (values
    ('St Mary & Pope Kyrillos VI', 'Hounslow',      'smpk-w.webp'),
    ('St Mark',                    'Kensington',    'stm-w.webp'),
    ('St Mary & Archangel Michael','Golders Green', 'gg-w.webp')
  ) as v(name, city, file)
 where a.canonical_name = v.name and a.city = v.city and a.parent_club is null;

do $$
begin
  if (select count(*) from public.archive_teams where display ? 'crest_women') <> 3 then
    raise exception 'expected 3 clubs with a women''s crest';
  end if;
  raise notice 'women''s crests wired for SMPK, St Mark and Golders Green';
end $$;
