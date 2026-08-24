-- 0051 — the COFTA 2017 joint side takes the short name it already had.
--
-- `canonical_name` was the whole two-church string:
--
--     St Anthony, Rotherham & St Mary & St Mark, Birmingham
--
-- Fifty-two characters, two churches and two cities on a line built for one
-- church with its city small underneath. It overruns wherever it lands, and
-- `tests/naming_drill.html` has been failing on it — the drill's rule is that
-- no rendered name carries a comma, because a comma means a city has been
-- folded into the name.
--
-- THE ARCHIVE ALREADY SOLVED THIS ONCE. Liverpool & Bolton is the same kind of
-- side and is stored the way this one now is: a short name on the row, the two
-- parishes in `display.joint`, and `archSubtitle` renders them underneath as
-- "Joint team — St Mary & St Cyril, Liverpool and St Mary & St Philopater,
-- Bolton". This migration is only catching the second one up.
--
-- NOTHING HERE IS A JUDGEMENT CALL. `short_name` on this row was ALREADY
-- 'Rotherham & Birmingham', and that string was already an alias; the two
-- churches are the old canonical split at its top-level '&'. No new fact is
-- being introduced, and no name is being invented.
--
-- THE ID DOES NOT MOVE. Ids are stable keys other rows point at, and the uuidv5
-- scheme names a row at creation rather than re-deriving on rename — the same
-- reasoning as `0035` renaming the Ireland club. `archive_edition_teams` and
-- every match row keep pointing at exactly the same team.
--
-- THE OLD STRING STAYS AN ALIAS. Team strings resolve by exact match against
-- `aliases` and nothing else, so dropping it would break resolution for any
-- source that prints the long form. It is already in the array; this asserts it
-- is still there afterwards rather than assuming.
--
-- Still true and still asserted: a joint side is ONE club. It is never split
-- into its parishes and never merged into either, so Rotherham and Birmingham
-- must not appear separately as COFTA 2017 entrants.

begin;

update public.archive_teams
   set canonical_name = 'Rotherham & Birmingham',
       display = coalesce(display, '{}'::jsonb) || jsonb_build_object(
         'joint', jsonb_build_array(
           jsonb_build_object('name', 'St Anthony',          'city', 'Rotherham'),
           jsonb_build_object('name', 'St Mary & St Mark',   'city', 'Birmingham')))
 where id = '4df86be7-5dc7-5e2b-8cf1-948a7af72856'
   and short_name = 'Rotherham & Birmingham';

do $do$
declare n int; t record;
begin
  select * into t from public.archive_teams
   where id = '4df86be7-5dc7-5e2b-8cf1-948a7af72856';

  if t.canonical_name <> 'Rotherham & Birmingham' then
    raise exception 'canonical_name is %, expected Rotherham & Birmingham', t.canonical_name;
  end if;
  -- The name a reader sees must not fold a city into it. This is the drill's
  -- rule, asserted at the source so it cannot regress silently.
  if t.canonical_name like '%,%' then
    raise exception 'a joint side''s name must not carry a comma: %', t.canonical_name;
  end if;
  -- City stays null, exactly like Liverpool & Bolton: the club has two.
  if t.city is not null then
    raise exception 'a joint side has no single city, found %', t.city;
  end if;

  -- both parishes are recorded, and archSubtitle can render them
  if jsonb_array_length(t.display -> 'joint') <> 2 then
    raise exception 'expected 2 joint parishes, found %',
      jsonb_array_length(t.display -> 'joint');
  end if;
  if not (t.display -> 'joint' @> '[{"name":"St Anthony","city":"Rotherham"}]'::jsonb
      and t.display -> 'joint' @> '[{"name":"St Mary & St Mark","city":"Birmingham"}]'::jsonb) then
    raise exception 'the two parishes are not the ones the old name named';
  end if;

  -- the source string still resolves
  if not (t.aliases @> array['St Anthony, Rotherham & St Mary & St Mark, Birmingham']) then
    raise exception 'the long form must survive as an alias';
  end if;

  -- A JOINT SIDE IS ONE CLUB. Neither parish appears separately in 2017.
  select count(*) into n
    from public.archive_edition_teams et
    join public.archive_teams at on at.id = et.team_id
   where et.edition_id = 'cofta-2017'
     and at.id <> t.id
     and (at.city in ('Rotherham', 'Birmingham'));
  if n <> 0 then raise exception '% parish row(s) appear separately in 2017', n; end if;

  -- and Q12's two Birmingham churches are untouched by this
  select count(*) into n from public.archive_teams where city = 'Birmingham';
  if n <> 2 then raise exception 'expected 2 Birmingham rows, found %', n; end if;

  -- nothing lost its team: the id never moved
  select count(*) into n from public.archive_edition_teams where team_id = t.id;
  if n < 1 then raise exception 'the joint side is no longer an entrant anywhere'; end if;
end
$do$;

commit;
