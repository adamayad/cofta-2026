-- 0050 — winner_team_id / loser_team_id: a result the source recorded as
--        "A beat B" rather than as a fixture.
--
-- Ten matches across four thin editions carry no home/away at all. Their
-- sources say who won and who lost and never which way round they were
-- printed, so `home_team_id`/`away_team_id` are correctly NULL — filling them
-- would invent an orientation — and the result has been living in `notes` as
-- `{"winner":"Brighton","loser":"St Mark"}`.
--
-- THOSE ARE `short_name` STRINGS, AND `short_name` IS NOT A DISPLAY STRING.
-- It survives only as a monogram's initials, because half these clubs are
-- "St Mary & …" and canonical names collide. So a renderer given `notes.winner`
-- has two bad options: print "Brighton" — an alias-only spelling, exactly what
-- the naming drill exists to catch — or print nothing. It cannot link to the
-- club either, while every other club mention in History can.
--
-- The archive already has a pattern for this and this follows it: `player_name`
-- keeps the string a source printed, `player_canonical` carries the resolved
-- identity. `notes.winner` stays untouched as the source string; the new
-- columns are the resolved identity, so `archTeamLink` can render a full church
-- name over its city and open the club's record like everything else.
--
-- SCOPE IS DELIBERATELY NARROW. These columns are for a result recorded
-- WITHOUT an orientation, so they are populated only where `home_team_id` is
-- null. Where a fixture exists, the winner is derivable from the scoreline and
-- storing it again would be a second copy of the same fact, free to drift.
--
-- COFTA10-SF2 GETS A WINNER AND NO LOSER, which is the whole reason `loser` is
-- separately nullable: the report says Rotherham came back from a goal down to
-- win and never names their opponent. Croydon is probable by elimination and
-- stays in the gap note as probable.
--
-- Resolution is by `short_name` scoped to the edition's own entrant list, never
-- registry-wide. "St Mark" and "Manchester" are precisely the strings that
-- collide across the registry — see the identity guards — and an edition's
-- entrants are the only place they are unambiguous.

begin;

alter table public.archive_matches
  add column if not exists winner_team_id uuid references public.archive_teams(id),
  add column if not exists loser_team_id  uuid references public.archive_teams(id);

comment on column public.archive_matches.winner_team_id is
  'Resolved winner where the source recorded a result but no home/away. NULL when a fixture orientation exists - derive it from the score instead.';
comment on column public.archive_matches.loser_team_id is
  'Resolved loser for the same rows. Separately nullable: a source can name a winner and not their opponent.';

with ent as (
  select et.edition_id, at.short_name, at.id
    from public.archive_edition_teams et
    join public.archive_teams at on at.id = et.team_id
)
update public.archive_matches m
   set winner_team_id = w.id,
       loser_team_id  = l.id
  from (select id, edition_id, notes from public.archive_matches) src
  left join ent w on w.edition_id = src.edition_id
                 and w.short_name = src.notes ->> 'winner'
  left join ent l on l.edition_id = src.edition_id
                 and l.short_name = src.notes ->> 'loser'
 where m.id = src.id
   and m.home_team_id is null
   and src.notes ->> 'winner' is not null;

do $do$
declare n int;
begin
  -- ten rows resolved, and every one of them had an orientation-less source
  select count(*) into n from public.archive_matches where winner_team_id is not null;
  if n <> 10 then raise exception 'expected 10 resolved winners, found %', n; end if;

  select count(*) into n from public.archive_matches
   where winner_team_id is not null and home_team_id is not null;
  if n <> 0 then raise exception '% row(s) have both a fixture and a resolved winner', n; end if;

  -- NOTHING WAS LEFT UNRESOLVED. A winner string that did not match an entrant
  -- would fail silently as a blank name on the page, so it fails loudly here.
  select count(*) into n from public.archive_matches
   where home_team_id is null and notes ->> 'winner' is not null and winner_team_id is null;
  if n <> 0 then raise exception '% winner string(s) did not resolve to an entrant', n; end if;
  select count(*) into n from public.archive_matches
   where home_team_id is null and notes ->> 'loser' is not null and loser_team_id is null;
  if n <> 0 then raise exception '% loser string(s) did not resolve to an entrant', n; end if;

  -- the resolved id agrees with the string it came from, for every row
  select count(*) into n from public.archive_matches m
    join public.archive_teams t on t.id = m.winner_team_id
   where t.short_name is distinct from m.notes ->> 'winner';
  if n <> 0 then raise exception '% winner id(s) disagree with their source string', n; end if;

  -- COFTA 2010's unnamed opponent stays unnamed
  if (select loser_team_id from public.archive_matches where id = 'COFTA10-SF2') is not null then
    raise exception 'COFTA10-SF2 must not resolve a loser the report never named';
  end if;
  if (select winner_team_id from public.archive_matches where id = 'COFTA10-SF2') is null then
    raise exception 'COFTA10-SF2 does name a winner and it must resolve';
  end if;

  -- and the source strings are untouched: this adds an identity, it does not
  -- replace the record of what was printed
  select count(*) into n from public.archive_matches
   where home_team_id is null and winner_team_id is not null
     and notes ->> 'winner' is null;
  if n <> 0 then raise exception '% row(s) lost their source string', n; end if;
end
$do$;

commit;
