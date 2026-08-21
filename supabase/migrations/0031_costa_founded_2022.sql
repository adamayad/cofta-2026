-- 0031_costa_founded_2022.sql
--
-- COSTA's founding year is known after all: 2022, organiser-confirmed, which
-- also corrects what the acronym stands for (SOUTHERN, not Soccer — that is a
-- frontend/JSON change, not a database one).
--
-- 0026 put origins_unrecorded on every COSTA edition precisely so no view
-- would present the earliest row the archive happened to hold as the first
-- tournament played. That guard has done its job and is now obsolete:
-- costa-2022 IS the first, and the competition page says so.

begin;

update public.archive_editions
   set notes = (notes - 'origins_unrecorded')
 where competition = 'COSTA';

update public.archive_editions
   set notes = notes || '{"inaugural":true,"edition_note":"The first COSTA."}'::jsonb
 where id = 'costa-2022';

do $$
declare n int;
begin
  select count(*) into n from public.archive_editions
   where competition = 'COSTA' and notes ? 'origins_unrecorded';
  if n <> 0 then
    raise exception 'the origins-unrecorded note should be gone from COSTA, % remain', n;
  end if;

  select count(*) into n from public.archive_editions
   where competition = 'COSTA' and (notes->>'inaugural')::boolean;
  if n <> 1 then
    raise exception 'exactly one COSTA edition is the first, found %', n;
  end if;

  if not exists (select 1 from public.archive_editions
                  where id = 'costa-2022' and (notes->>'inaugural')::boolean) then
    raise exception 'costa-2022 must be the inaugural edition';
  end if;

  -- the inaugural row and the earliest row must be the same one, or the page
  -- would claim a first edition that is not the oldest it holds
  if (select min(year) from public.archive_editions where competition = 'COSTA') <> 2022 then
    raise exception 'costa-2022 must be the earliest COSTA edition held';
  end if;
end $$;

commit;
