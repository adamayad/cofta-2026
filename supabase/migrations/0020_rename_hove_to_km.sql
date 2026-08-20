-- ============================================================
-- COFTA 2026 — retire the 'hove' alias: Kidane Mihret become 'km'
--
-- Hove withdrew before the draw and Kidane Mihret took their slot. 0017
-- changed the display name and deliberately kept the internal id, because at
-- the time the id was private and repointing four tables was risk for no
-- reward.
--
-- The History feature changes that calculation. Past tournaments can contain
-- the actual Hove club, so an id that says 'hove' and means Kidane Mihret
-- stops being a harmless shortcut and becomes a genuine ambiguity — in the
-- crest map, in a debugging session, in anything anyone reads later.
--
-- teams.id is text and referenced by six columns across four tables, none of
-- them ON UPDATE CASCADE, so this is an insert-repoint-delete rather than an
-- UPDATE. It runs as one transaction: every assertion below aborts the whole
-- thing rather than leaving the tournament half-renamed.
-- ============================================================

do $$
declare
  b_players int; b_home int; b_away int; b_ties int; b_slots int;
  a_players int; a_home int; a_away int; a_slots int;
  leftover  int;
begin
  -- ── before ────────────────────────────────────────────────
  if (select count(*) from public.teams where id = 'hove') <> 1 then
    raise exception 'no hove row to rename — already applied?';
  end if;
  if (select count(*) from public.teams where id = 'km') <> 0 then
    raise exception 'a km row already exists — refusing to merge two clubs';
  end if;

  select count(*) into b_players from public.players       where team_id   = 'hove';
  select count(*) into b_home    from public.matches       where home_team = 'hove';
  select count(*) into b_away    from public.matches       where away_team = 'hove';
  select count(*) into b_slots   from public.slot_overrides where team_id  = 'hove';
  select count(*) into b_ties    from public.tie_shootouts;

  -- tie_shootouts carries check (team_a < team_b), and 'km' sorts after
  -- 'hove', so a renamed pair could violate it. The table is empty after a
  -- reset — assert that rather than trust it. (The constraint is the backstop
  -- if this is ever run against a live group stage.)
  if b_ties <> 0 then
    raise exception 'tie_shootouts is not empty (% rows): re-check team_a < team_b ordering under the new id before running this', b_ties;
  end if;

  raise notice 'before: players=% home=% away=% slots=% ties=%',
    b_players, b_home, b_away, b_slots, b_ties;

  -- ── 1. copy the row under the new id ──────────────────────
  -- Round-tripped through jsonb so every column comes across whatever the
  -- table grows later, with only the id overridden. A positional column list
  -- would silently drop a column added after this was written.
  insert into public.teams
  select * from jsonb_populate_record(
    null::public.teams,
    (select to_jsonb(t) || jsonb_build_object('id', 'km')
       from public.teams t where t.id = 'hove'));

  -- ── 2. repoint every referencing column ───────────────────
  -- The six FK columns confirmed against information_schema:
  --   players.team_id, matches.home_team, matches.away_team,
  --   tie_shootouts.team_a, tie_shootouts.team_b, slot_overrides.team_id
  update public.players        set team_id   = 'km' where team_id   = 'hove';
  update public.matches        set home_team = 'km' where home_team = 'hove';
  update public.matches        set away_team = 'km' where away_team = 'hove';
  update public.tie_shootouts  set team_a    = 'km' where team_a    = 'hove';
  update public.tie_shootouts  set team_b    = 'km' where team_b    = 'hove';
  update public.slot_overrides set team_id   = 'km' where team_id   = 'hove';

  -- ── 3. delete the old row ─────────────────────────────────
  -- players.team_id is ON DELETE CASCADE. If a single player were still
  -- pointing at 'hove' this delete would take them with it, silently. Prove
  -- the repoint was total before going anywhere near it.
  if (select count(*) from public.players where team_id = 'hove') <> 0 then
    raise exception 'players still reference hove — refusing to delete (cascade would destroy the squad)';
  end if;

  delete from public.teams where id = 'hove';

  -- ── 4. after ──────────────────────────────────────────────
  select count(*) into a_players from public.players        where team_id   = 'km';
  select count(*) into a_home    from public.matches        where home_team = 'km';
  select count(*) into a_away    from public.matches        where away_team = 'km';
  select count(*) into a_slots   from public.slot_overrides where team_id   = 'km';

  if (a_players, a_home, a_away, a_slots) is distinct from (b_players, b_home, b_away, b_slots) then
    raise exception 'row counts moved: players %→%, home %→%, away %→%, slots %→%',
      b_players, a_players, b_home, a_home, b_away, a_away, b_slots, a_slots;
  end if;

  select (select count(*) from public.teams          where id       = 'hove')
       + (select count(*) from public.players        where team_id  = 'hove')
       + (select count(*) from public.matches        where home_team= 'hove' or away_team = 'hove')
       + (select count(*) from public.tie_shootouts  where team_a   = 'hove' or team_b    = 'hove')
       + (select count(*) from public.slot_overrides where team_id  = 'hove')
    into leftover;
  if leftover <> 0 then
    raise exception '% hove references still remain', leftover;
  end if;

  if (select count(*) from public.teams where id = 'km') <> 1 then
    raise exception 'km row missing after rename';
  end if;

  raise notice 'after:  players=% home=% away=% slots=% — zero hove references remain',
    a_players, a_home, a_away, a_slots;
end $$;

-- Deliberately NOT rewritten:
--   * audit_log — it records what was actually done at the time, under the id
--     that was actually used. Editing it would falsify the record it exists to
--     keep. It has no FK to teams, so nothing depends on it.
--   * migrations 0007 and 0017 — replaying the series from empty must still
--     produce this database. 0007 seeds 'hove', 0017 renames the club, 0020
--     renames the id; rewriting the earlier files would make the later ones
--     lies and break a rebuild from scratch.
