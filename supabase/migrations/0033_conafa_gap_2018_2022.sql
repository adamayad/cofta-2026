-- 0033 — CONAFA did not run in 2018-2022. Remove the two rows that said it did.
--
-- THIS REVERSES 0032, AND IT IS THE ONLY PLACE THE ARCHIVE HAS HAD TO CHOOSE
-- BETWEEN TWO THINGS THE ORGANISER SAID. Recorded in full because a silent
-- reversal is exactly what the conflict register exists to prevent.
--
-- On 2026-08-21 Adam wrote "Brighton won 2018 and 2019" in a sentence about
-- COSTA, then corrected it within the minute to CONAFA. 0032 created
-- conafa-2018 and conafa-2019 on that basis: champion Brighton, nothing else.
-- On 2026-08-24 he confirmed CONAFA did not run AT ALL between 2017 and 2023 —
-- a five-year gap. The later statement wins, and three things back it:
--
--   * it is specific where the earlier one was a one-line self-correction —
--     it names the gap, its length and the year of resumption;
--   * it is consistent with the rows either side, 2017 (Manchester) running
--     straight into 2023; and
--   * the earlier claim is fully explained as a misattribution, because
--     cofta-2018 and cofta-2019 BOTH already record Brighton as champion.
--     "Brighton won 2018 and 2019" was already true — of COFTA.
--
-- Effect on the reader: Brighton's CONAFA titles go from seven to five, and
-- CONAFA becomes an eight-edition competition with a visible five-year gap.
--
-- These years are a POSITIVE FACT, not a gap in our records. Nothing may ever
-- render them as "records being sought". There is no row to render, and
-- archive_meta in tournament_archive.json carries the confirmed absence.

begin;

-- Nothing else hangs off these two rows: 0032 created them with a champion and
-- an entrant apiece and no matches, events, awards, boards or standings. The
-- deletes are ordered anyway, and asserted below, so a future edition with real
-- children can never be silently half-removed by copying this file.
delete from public.archive_edition_teams where edition_id in ('conafa-2018','conafa-2019');
delete from public.archive_editions      where id         in ('conafa-2018','conafa-2019');

do $$
declare n int;
begin
  -- the two rows are gone
  select count(*) into n from public.archive_editions
   where competition = 'CONAFA' and year between 2018 and 2022;
  if n <> 0 then raise exception 'CONAFA 2018-2022 must have no edition rows, found %', n; end if;

  -- and nothing was orphaned
  select count(*) into n from public.archive_edition_teams
   where edition_id in ('conafa-2018','conafa-2019');
  if n <> 0 then raise exception 'orphaned CONAFA entrant rows: %', n; end if;

  -- CONAFA is now eight editions, 2014-2017 and 2023-2026
  select count(*) into n from public.archive_editions where competition = 'CONAFA';
  if n <> 8 then raise exception 'expected 8 CONAFA editions, found %', n; end if;

  -- the gap really is contiguous: 2017 then 2023, nothing between
  if exists (select 1 from public.archive_editions
              where competition = 'CONAFA' and year > 2017 and year < 2023) then
    raise exception 'CONAFA 2018-2022 gap is not clear';
  end if;

  -- the rows either side survived untouched
  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams t on t.id = e.champion_team_id
                  where e.id = 'conafa-2017' and t.short_name = 'Manchester') then
    raise exception 'conafa-2017 must still be Manchester';
  end if;
  if not exists (select 1 from public.archive_editions where id = 'conafa-2023') then
    raise exception 'conafa-2023 must still exist';
  end if;

  -- COFTA 2018 and 2019 are NOT touched by this. They are the rows that
  -- explain the original mistake, and Brighton keeps both.
  select count(*) into n from public.archive_editions e
    join public.archive_teams t on t.id = e.champion_team_id
   where e.id in ('cofta-2018','cofta-2019') and t.short_name = 'Brighton';
  if n <> 2 then raise exception 'COFTA 2018/2019 must still be Brighton, found %', n; end if;

  -- whole-archive count: 37 before, 35 after
  select count(*) into n from public.archive_editions;
  if n <> 35 then raise exception 'expected 35 editions, found %', n; end if;
end $$;

commit;
