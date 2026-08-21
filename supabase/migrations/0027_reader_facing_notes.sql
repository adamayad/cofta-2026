-- 0027_reader_facing_notes.sql
--
-- Every note on an edition page is written for a reader looking up a
-- tournament, not for whoever assembled the archive. Two habits had crept
-- back in that the History work has otherwise been removing all along:
--
--   1. Naming the organiser as a source. "Era-level statement from Adam" is
--      provenance, and provenance belongs in `source`, which is stored and
--      deliberately never rendered.
--   2. Talking about the compilation. "not supplied to the compiler", "by the
--      compiler" - the reader did not ask who typed it in.
--
-- A note should say what is missing or uncertain ABOUT THE TOURNAMENT, and
-- stop. Nothing is being hidden: `source` still records where every figure
-- came from, so "where did this come from" stays answerable.

begin;

-- ── the era venue ──────────────────────────────────────────────────────
-- Fifteen COFTA editions carry Shephalbury Park as an era-level venue. What
-- the reader needs is that it is not separately confirmed for their edition.
update public.archive_editions
   set notes = jsonb_set(notes, '{venue_note}',
        to_jsonb('Recorded as the venue for COFTA through this era. Not separately confirmed for this edition.'::text))
 where competition = 'COFTA'
   and notes ? 'venue_note'
   and notes->>'venue_note' ilike '%adam%';

-- ── the two checked rows ───────────────────────────────────────────────
update public.archive_editions
   set notes = jsonb_set(notes, '{final_orientation_note}',
        to_jsonb('Home and away sides of the final are not recorded. The 1-1 and the 3-1 shoot-out are.'::text))
 where id = 'conafa-2023';

-- ── COSTA 2022's two Brighton labels ───────────────────────────────────
-- The identification still needs saying, because the timetable's own labels
-- are misleading. Who identified it does not.
update public.archive_editions
   set notes = jsonb_set(notes, '{teams_note}',
        to_jsonb('The timetable prints "Brighton A" and "Brighton B". Brighton A is St Mary & St Abraam, Brighton. Brighton B is St Demiana & Pope Kyrillos VI, Worthing - a separate church, not a Brighton second team.'::text))
 where id = 'costa-2022';

update public.archive_editions
   set notes = jsonb_set(notes, '{known_gaps}',
        (select jsonb_agg(case
            when g like 'The per-fixture timetable text%'
            then 'The individual fixtures are not recorded; only the format - six teams, five rounds of 30-minute matches, 10:00 to 16:00 with a midday lunch break.'
            else g end)
         from jsonb_array_elements_text(notes->'known_gaps') as t(g)))
 where id = 'costa-2022';

-- ── CONAFA 2016 ────────────────────────────────────────────────────────
-- The gap about the report text was about the compilation, and the gap the
-- reader cares about - no final scoreline - is already listed above it.
update public.archive_editions
   set notes = jsonb_set(notes, '{known_gaps}',
        (select jsonb_agg(g)
         from jsonb_array_elements_text(notes->'known_gaps') as t(g)
         where g not like '%not supplied to the compiler%'))
 where id = 'conafa-2016';

-- ── the Ark Cup's derived columns ──────────────────────────────────────
-- Pre-existing, and the same habit: it explains itself in terms of "the
-- compiler". The fact worth keeping is that GF and GA are computed rather
-- than published, and that they reconcile.
update public.archive_editions
   set notes = jsonb_set(notes, '{league_table_note}',
        to_jsonb('The published table showed goal difference and points only. Goals for and against are computed from the fixture list and reconcile exactly to the published goal difference.'::text))
 where id = 'ark-cup-2026';

-- ── assertions ─────────────────────────────────────────────────────────
do $$
declare
  n int;
begin
  -- nothing a reader can see may name the organiser or the compilation
  select count(*) into n
    from public.archive_editions e,
         lateral jsonb_each_text(e.notes) as x(k, v)
   where x.k in ('competition_note','teams_note','round_numbering_note','league_table_note',
                 'final_orientation_note','venue_note','third_place_note','squads_note','edition_note')
     and (x.v ilike '%adam%' or x.v ilike '%compiler%');
  if n <> 0 then
    raise exception '% rendered note(s) still name the organiser or the compiler', n;
  end if;

  select count(*) into n
    from public.archive_editions e,
         lateral jsonb_array_elements_text(coalesce(e.notes->'known_gaps','[]'::jsonb)) as g(gap)
   where g.gap ilike '%adam%' or g.gap ilike '%compiler%';
  if n <> 0 then
    raise exception '% known_gap(s) still name the organiser or the compiler', n;
  end if;

  -- the venue note survived on all fifteen, reworded rather than dropped
  select count(*) into n from public.archive_editions
   where competition = 'COFTA' and notes ? 'venue_note';
  if n <> 15 then
    raise exception 'expected 15 COFTA venue notes, found %', n;
  end if;

  -- COSTA 2022 still tells the reader Brighton B is Worthing
  if (select notes->>'teams_note' from public.archive_editions where id = 'costa-2022')
     not like '%Worthing%' then
    raise exception 'costa-2022 must still identify Brighton B as Worthing';
  end if;

  -- and its gap list still says the fixtures are missing
  if not exists (select 1 from public.archive_editions e,
                   lateral jsonb_array_elements_text(e.notes->'known_gaps') as g(gap)
                  where e.id = 'costa-2022' and g.gap like '%individual fixtures are not recorded%') then
    raise exception 'costa-2022 must still record that the fixtures are missing';
  end if;
end $$;

commit;
