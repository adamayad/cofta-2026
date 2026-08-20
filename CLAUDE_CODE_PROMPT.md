# Claude Code task — import the historical Coptic tournament archive

Paste everything below into Claude Code with `tournament_archive.json` placed in the repo root.

---

## Task

Import 13 historical tournament editions (2022–2026) into the COFTA app's Supabase database and expose them in a read-only History section. The source of truth is `tournament_archive.json` in the repo root. **Read it first, in full, before writing any migration.**

This is an archive, not live tournament data. It must never be mixed with, or overwrite, the live COFTA 2026 tournament rows.

## Non-negotiable rules

1. **Transcribe, never infer.** Every value in the JSON came from a source document or Adam's own notes. If a field is `null`, the source did not state it. Do not fill it, do not compute it, do not carry a value across from a similar edition.
2. **`null` ≠ `0`.** A missing scoreline is `null`. A missing goal total is `null`. Zero means the source said zero.
3. **Thin records stay thin.** Eight editions have `data_confidence: "minimal"` — often just a date, a champion and an entrant list. Render them as short cards. Do not pad them to look like the rich ones, and do not synthesise fixtures, standings or stats for them.
4. **Do not resolve anything in `conflict_register`.** Store both sides, flag the row, surface the flag in admin. Three items are marked `blocking` — see below.
5. **Preserve spelling exactly as given,** including variants of the same person across editions. The `player_name_variants` block lists them with an explicit `action`; follow it. Do not normalise, title-case, or auto-correct.
6. **Shootout conversions are not goals.** Store shootouts in their own columns. They must never appear in goalscorer totals.
7. **UK English** in all UI copy.

## Team identities — resolved, apply as given

- **SMPK = Pope Kyrillos, Hounslow.** One club, canonical `St Mary & Pope Kyrillos VI, Hounslow`, short name `SMPK`. Every `Hounslow` / `Pope Kyrillos, Hounslow` / `SMPK` string across all editions resolves to it. `PKSM (SMPK B)` is its B team.
- **Worthing is a different club that also carries Pope Kyrillos VI in its name** — canonical `St Demiana & Pope Kyrillos VI, Worthing`. **Never merge it with SMPK.** Add a guard in the import so a fuzzy match on "Pope Kyrillos" cannot collapse these two.
- **Ark Cup 2026 "St Mary's" = Golders Green's second team.** Canonical `Archangel Michael, Golders Green B`, displayed as `St Mary's` in that edition only. Both A and B teams of the host club competed.
- **All `St Mark` / `St Marks` / `St Mark's` entries = `St Mark, Kensington`.** `St Mark B` is its B team.

Every team in `team_registry` now has `merge_confidence: "confirmed"`. Import them deduplicated.

## Player identities

`player_registry` holds twelve confirmed merges. Store both forms:

- `player_name` — the string exactly as displayed in its source. Match pages render this.
- `player_canonical` — the merged identity. All aggregate stats group on this.

Two pairs are explicitly **not** merged (`player_registry.held_back`) — keep them as separate players. Identical spellings appearing at different clubs are one player who changed club, not a flag (`same_name_different_club`).

## Schema

Create these tables if they don't exist; if a historical-editions schema already exists, match its field names instead and tell me what you changed.

```
archive_editions        id (text pk), competition, year, display_name, category,
                        date_start, date_end, venue, format, team_count, match_count,
                        champion_team_id, runner_up_team_id, final_summary,
                        data_confidence ('full'|'minimal'), source, notes jsonb

archive_teams           id (uuid pk), canonical_name, short_name, aliases text[],
                        merge_status ('confirmed'|'probable'|'open')

archive_edition_teams   edition_id, team_id                      -- entrant list

archive_groups          id, edition_id, name
archive_standings       group_id, position, team_id, p, w, d, l, gf, ga, gd, pts,
                        gf_derived, ga_derived, note

archive_matches         id (text pk = ref), edition_id, stage, group_name, round,
                        match_date, kickoff_time, pitch,
                        home_team_id, away_team_id, home_score, away_score,
                        decided_by, shootout_home, shootout_away, shootout_winner_id,
                        events_status, gap_note

archive_players         id (uuid pk), canonical_name, variants text[], confidence

archive_match_events    id, match_id, minute (text, may be '45+1' or null),
                        team_id (nullable), player_name, player_canonical, event_type,
                        assist_player, event_source, flag, note

archive_awards          edition_id, match_id (nullable), award_type, player_name,
                        team_id (nullable), value, is_published_summary bool, flag

archive_leaderboards    edition_id, board_type, rank, player_name, team_id,
                        value, value_source ('published'|'derived_from_events'), flag
```

Notes on specific columns:

- `minute` is **text**, not integer — CONAFA 2026 has `45+1`, and many editions have no minutes at all.
- `team_id` on `archive_match_events` is **nullable**. Three COFTA 2025 matches display goals with no team attribution; store them unattributed rather than guessing.
- `events_status` values in the data: `complete`, `complete_unattributed`, `partial`, `score_only`, `conflicted`.
- Where an event carries `team_attribution: "inferred_from_clean_sheet"`, the team was deduced from a clean-sheet scoreline (arithmetically certain). Keep that provenance in `note`.
- `player_canonical` is required on `archive_match_events`, `archive_awards` and `archive_leaderboards`. Index on it.
- `gf_derived` / `ga_derived` appear only on the Ark Cup 2026 table. They were computed from the fixture list, **not** displayed in the source, and reconcile exactly to the published GD. Store them in the derived columns or drop them — never in `gf`/`ga`.

## Import order

1. `archive_teams` from `team_registry.teams`, then `archive_players` from `player_registry.merges` plus every unmerged name appearing in the data.
2. `archive_editions` (13 rows), then `archive_edition_teams`.
3. Groups and standings for the four editions that have them (COFTA 2024, COFTA 2025, CONAFA 2026, Ark Cup 2026 league table).
4. `archive_matches` — 99 rows total.
5. `archive_match_events`.
6. Awards and leaderboards. For Ark Cup goalscorers and COSA WOTM, write **both** the published figures and the event-derived figures, distinguished by `value_source`, with `flag` set.
7. Write `conflict_register` to a `archive_conflicts` table or a repo-level `ARCHIVE_CONFLICTS.md` — your call, but it must be visible to me somewhere.

## Verification — run these before you report done

The archive has already been reconciled at compile time; these checks must still pass after import:

- All four published group/league tables rebuild exactly from the imported fixtures on P, W, D, L, GF, GA, GD and Pts.
- Goal-event count ≤ scoreline for every match **except** `ARK26-PO`, which is the one known conflict (2-0 official, 3 events).
- Goalscorer leaderboards match event-derived counts for every edition **except** the three Ark Cup players in `goalscorer_reconciliation`.
- CONAFA 2026: 43 matches, 93 goals, 89 recorded goal events, 11 yellow cards, 0 reds, 2 own goals, 2 shootouts.
- No `archive_*` row references a live 2026 tournament row.
- `St Mary & Pope Kyrillos VI, Hounslow` and `St Demiana & Pope Kyrillos VI, Worthing` exist as two separate team rows.
- Every `player_name` in `archive_match_events` resolves to exactly one `player_canonical`.

Report the results as a table. If any check fails, stop and tell me — do not adjust the data to make a check pass.

## UI

Add a History section listing editions newest-first, grouped by competition. Six separate competitions: COFTA, CONAFA, COSTA and The Ark Cup are men's; COSA and Ladies COFTA are women's. They are distinct competitions, not one renamed series — do not merge COSA with Ladies COFTA.

- **Full editions** get the treatment the live tournament gets: standings, fixtures, match events, goalscorers, awards.
- **Minimal editions** get a compact card: dates, champion, runner-up, final line if known, entrant list, and a short "limited records survive for this edition" line. No empty tables, no zero-filled stats.
- Every match with `events_status` other than `complete` shows a small marker explaining what's missing, using `gap_note`.
- Anything with a `flag` shows the flag in admin only, not to the public.

Keep it read-only. No editing of archive rows from the public app.
