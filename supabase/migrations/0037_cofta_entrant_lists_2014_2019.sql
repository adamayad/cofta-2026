-- 0037 — COFTA entrant lists, 2014-2019. Organiser-confirmed.
--
-- Five editions that until now listed only their finalists, or in 2016 and
-- 2017 only their champion. Nothing here replaces a result: champions,
-- runners-up, scores and awards are all untouched, and asserted so below.
--
-- 2017 CARRIES A JOINT SIDE. Rotherham and Birmingham entered as one team and
-- are recorded as ONE entrant — the club 0035 created — never as two rows.
-- Splitting them would put Rotherham in a tournament they did not enter alone
-- and would give Birmingham an appearance it never made on its own.
--
-- Every club resolves through the existing registry by short_name. Nothing new
-- is created here; 0035 did that.

begin;

insert into public.archive_edition_teams (edition_id, team_id)
select v.edition_id, t.id
  from (values
    ('cofta-2014','Golders Green'), ('cofta-2014','Stevenage'),
    ('cofta-2014','Nottingham'),    ('cofta-2014','Brighton'),
    ('cofta-2014','Rotherham'),     ('cofta-2014','Croydon'),

    ('cofta-2015','Croydon'),       ('cofta-2015','St Mark'),
    ('cofta-2015','Brighton'),      ('cofta-2015','Rotherham'),
    ('cofta-2015','Golders Green'),

    ('cofta-2016','Brighton'),      ('cofta-2016','Stevenage'),
    ('cofta-2016','St Mark'),       ('cofta-2016','Rotherham'),
    ('cofta-2016','Golders Green'), ('cofta-2016','Croydon'),

    ('cofta-2017','Stevenage'),     ('cofta-2017','Rotherham & Birmingham'),
    ('cofta-2017','Brighton'),      ('cofta-2017','Golders Green'),
    ('cofta-2017','St Mark'),       ('cofta-2017','Croydon'),

    ('cofta-2019','Brighton'),      ('cofta-2019','St Mark'),
    ('cofta-2019','Stevenage'),     ('cofta-2019','Croydon'),
    ('cofta-2019','Worthing'),      ('cofta-2019','Golders Green')
  ) as v(edition_id, short)
  join public.archive_teams t
    on t.short_name = v.short and t.parent_club is null
on conflict do nothing;

update public.archive_editions
   set team_count = c.n,
       notes = notes || jsonb_build_object('teams_note', c.note)
  from (values
    ('cofta-2014', 6, 'All six entrants are named.'),
    ('cofta-2015', 5, 'All five entrants are named.'),
    ('cofta-2016', 6, 'All six entrants are named.'),
    ('cofta-2017', 6, 'All six entrants are named. Rotherham and Birmingham entered as one joint side and are recorded as a single entrant, not as two clubs.'),
    ('cofta-2019', 6, 'All six entrants are named.')
  ) as c(id, n, note)
 where archive_editions.id = c.id;

do $$
declare n int; r record;
begin
  for r in select * from (values
      ('cofta-2014',6),('cofta-2015',5),('cofta-2016',6),
      ('cofta-2017',6),('cofta-2019',6)) as x(id, want)
  loop
    select count(*) into n from public.archive_edition_teams where edition_id = r.id;
    if n <> r.want then
      raise exception '% expected % entrants, found %', r.id, r.want, n;
    end if;
  end loop;

  -- the 2017 joint side is ONE entrant, and neither parish appears separately
  if not exists (select 1 from public.archive_edition_teams et
                   join public.archive_teams t on t.id = et.team_id
                  where et.edition_id = 'cofta-2017'
                    and t.short_name = 'Rotherham & Birmingham') then
    raise exception 'cofta-2017 must carry the joint side';
  end if;
  select count(*) into n from public.archive_edition_teams et
    join public.archive_teams t on t.id = et.team_id
   where et.edition_id = 'cofta-2017'
     and t.short_name in ('Rotherham','St Mary & St Mark');
  if n <> 0 then
    raise exception 'cofta-2017 must NOT list Rotherham or Birmingham separately, found % row(s)', n;
  end if;

  -- EVERY CHAMPION AND RUNNER-UP THIS MIGRATION COULD HAVE DISTURBED IS
  -- UNCHANGED. Checked by name, not by counting rows.
  if not exists (select 1 from public.archive_editions e join public.archive_teams t
                   on t.id = e.champion_team_id
                  where e.id = 'cofta-2014' and t.short_name = 'Nottingham') then
    raise exception 'cofta-2014 champion moved'; end if;
  if not exists (select 1 from public.archive_editions e join public.archive_teams t
                   on t.id = e.runner_up_team_id
                  where e.id = 'cofta-2014' and t.short_name = 'Brighton') then
    raise exception 'cofta-2014 runner-up moved'; end if;
  select count(*) into n from public.archive_editions e
    join public.archive_teams t on t.id = e.champion_team_id
   where e.id in ('cofta-2015','cofta-2016','cofta-2017','cofta-2019')
     and t.short_name = 'Brighton';
  if n <> 4 then raise exception 'a Brighton championship moved; found % of 4', n; end if;

  -- DISCREPANCY GUARD: an edition's champion or runner-up must appear in its
  -- own entrant list. 2017's joint side is the one legitimate exception and is
  -- excluded explicitly rather than by loosening the rule.
  select count(*) into n from public.archive_editions e
   where e.id in ('cofta-2014','cofta-2015','cofta-2016','cofta-2017','cofta-2019')
     and e.champion_team_id is not null
     and not exists (select 1 from public.archive_edition_teams et
                      where et.edition_id = e.id and et.team_id = e.champion_team_id);
  if n <> 0 then raise exception '% edition(s) have a champion who is not an entrant', n; end if;

  select count(*) into n from public.archive_editions e
   where e.id in ('cofta-2014','cofta-2015','cofta-2016','cofta-2017','cofta-2019')
     and e.runner_up_team_id is not null
     and not exists (select 1 from public.archive_edition_teams et
                      where et.edition_id = e.id and et.team_id = e.runner_up_team_id);
  if n <> 0 then raise exception '% edition(s) have a runner-up who is not an entrant', n; end if;
end $$;

commit;
