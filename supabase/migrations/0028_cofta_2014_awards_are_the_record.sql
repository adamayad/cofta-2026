-- 0028_cofta_2014_awards_are_the_record.sql
--
-- The three COFTA 2014 awards were imported with is_published_summary = true,
-- because the brief said to set it "where the figure comes from the report".
-- That reads as a citation, and in this schema it is not one: the flag marks
-- a figure taken from a published summary table that the archive does not
-- trust as the record. Both readers of that column act on it -
-- fetchArchiveHonours filters `is_published_summary=eq.false`, and
-- trophyCabinet skips those rows - so Nduoma Chilaka, Ashley Brown and Mark
-- Khalil were stored, and then appeared on no cabinet and no edition page.
--
-- They are organiser-confirmed, so they ARE the record, and the flag is
-- wrong. The report is still cited: provenance lives in the edition's
-- `source`, and Chilaka's five goals still come from it.
--
-- The genuinely flagged rows elsewhere - the Ark Cup goalscorer table and the
-- COSA WOTM totals, which contradict their own event data - keep the flag.
-- That is what it is for.

begin;

update public.archive_awards
   set is_published_summary = false
 where edition_id = 'cofta-2014'
   and award_type in ('top_scorer', 'player_of_the_tournament', 'most_clean_sheets');

do $$
declare
  n int;
begin
  select count(*) into n from public.archive_awards
   where edition_id = 'cofta-2014' and is_published_summary;
  if n <> 0 then
    raise exception 'COFTA 2014 awards must not be flagged as published-summary, % still are', n;
  end if;

  -- all six backfilled awards now reach a cabinet
  select count(*) into n from public.archive_awards
   where edition_id in ('cofta-2014','cofta-2015','cofta-2016')
     and not is_published_summary and match_id is null;
  if n <> 6 then
    raise exception 'expected 6 visible backfilled awards, found %', n;
  end if;

  -- the rows that SHOULD stay flagged are untouched
  select count(*) into n from public.archive_awards
   where is_published_summary and edition_id <> 'cofta-2014';
  if n = 0 then
    raise exception 'the genuinely flagged published-summary rows have been lost';
  end if;
end $$;

commit;
