-- ============================================================
-- COFTA 2026 — a women's crest slot, and the CONAFA 2026 player of the
-- tournament
--
-- Three churches field both a men's and a women's side under one name, each
-- with its own crest. The club is one row — it is one church — so the second
-- crest is a second field on it, not a second row. `display` is already the
-- place a club's branding lives, so it goes there rather than earning a
-- column of its own.
-- ============================================================

comment on column public.archive_teams.display is
  'Optional branding, all keys optional: '
  '{"colour","text_colour","ring"} for the monogram tile of a club with no '
  'crest; {"crest"} for a supplied crest file; {"crest_women"} where a church '
  'fields a women''s side with its own crest. Paths are relative to web/, e.g. '
  '"./crests/archive/smpk-w.webp". A club with a live_team_id and no crest key '
  'inherits the live crest. Rendering picks crest_women only on an edition '
  'whose category is women, and falls back to crest, then the live crest, then '
  'the monogram.';

-- ── CONAFA 2026 player of the tournament ────────────────────
-- Confirmed by Adam: Adrian Boghdady, SMPK. The edition's award row was
-- missing entirely — the source's summary screens never showed one, and the
-- compiler recorded no award rather than inferring the winner from the
-- player-of-the-match board.
do $$
declare smpk uuid;
begin
  select id into smpk from public.archive_teams
   where canonical_name = 'St Mary & Pope Kyrillos VI' and parent_club is null;
  if smpk is null then raise exception 'SMPK not found'; end if;

  delete from public.archive_awards
   where edition_id = 'conafa-2026' and award_type = 'player_of_the_tournament';

  insert into public.archive_awards
    (edition_id, match_id, award_type, player_name, player_canonical,
     team_id, value, is_published_summary, flag)
  values ('conafa-2026', null, 'player_of_the_tournament',
          'Adrian Boghdady', 'Adrian Boghdady', smpk, null, false, null);
end $$;

-- The player-of-the-match board already has Adrian Boghdady top on 3, which
-- agrees. Its team_id stays null: that screen carried no team attribution in
-- the source, and the award row is where the confirmed club now lives.
do $$
declare n int; who text;
begin
  select count(*), max(player_name) into n, who
    from public.archive_leaderboards
   where edition_id = 'conafa-2026' and board_type = 'player_of_the_match' and rank = 1;
  if n <> 1 or who <> 'Adrian Boghdady' then
    raise exception 'CONAFA 2026 POTM board leader is % (% rows), not Adrian Boghdady', who, n;
  end if;

  if (select count(*) from public.archive_awards
       where edition_id = 'conafa-2026' and award_type = 'player_of_the_tournament') <> 1 then
    raise exception 'CONAFA 2026 player_of_the_tournament did not land';
  end if;
  raise notice 'CONAFA 2026 POTM recorded: Adrian Boghdady (SMPK)';
end $$;
