# Archive conflict register

Every item here is an internal inconsistency in the source material, or an
identity question the sources cannot settle. **None of them is silently
resolved.** Both sides are stored, the row carries a `flag`, and the flag is
visible to organisers only — never to the public.

The live table is `public.archive_conflicts`. This file is the readable copy.

| id | edition | severity | status | issue |
|----|---------|----------|--------|-------|
| D1 | The Ark Cup 2026 | high | **resolved** | Published goalscorer leaderboard exceeds event-derived counts |
| D2 | The Ark Cup 2026 | high | open | Play-off event count exceeds the score |
| D3 | COSA 2026 | high | open | WOTM totals do not reconcile |
| D4 | COFTA 2024 | medium | open | The source's own count of unattributed goals is self-contradictory |
| D5 | COFTA 2025 | medium | open | Final home/away orientation conflicts within the source |
| D6 | COFTA 2025 | medium | open | Three Group B matches display goals with no team attribution |
| D7 | CONAFA 2026 | low | open | One goal did not come from the source app |

## D1 — resolved by Adam (Q5)

Daniel Samaan published 5 / events 4; Stavros Akriviadis published 5 / events 4;
Robel Hailemichael published 2 / events 1.

**Adam's ruling:** the extra entries were penalty shoot-out conversions from the
Brighton v Stevenage semi-final. Shoot-out conversions are not goals, so the
**event-derived figures are canonical** and the published leaderboard is
inflated. Both are still stored: the derived rows carry `is_canonical = true`
and History leads with them; the published rows are kept, flagged, and shown as
"as published" where they matter.

## D2 — open

Golders Green 2-0 St Mary's shows three Golders Green goal events (Marino
Rofail, CJ Forbes, Andrew Louis) against an official 2-0. The official score is
preserved; all three events are stored with
`flag = 'event_count_exceeds_score'`. This is the one match the verification
suite permits to exceed its scoreline.

## D3 — open

The published WOTM table gives Mariam Makkar 4 and totals 8 awards across 7
matches. The per-match records give her 3 (Games 1, 2 and the Final). The
**per-match awards are primary**; the published table is stored with
`is_published_summary = true` and flagged, and is never used as the match record.

## D4 — open

The summary page says three goals have no displayed scorer; the goalscorer
table's note says two, then describes four. Arithmetic against the fixtures
gives 35 goals and 31 recorded scorers, so **four** are unattributed: two in
Archangel Michael 0-2 St Anthony, one in the Brighton 1-0 St Mark semi-final,
one for St George in the final. Four are recorded. The source's own counts are
not reproduced.

## D5 — open

Two places in the source render the final as *Archangel Michael, Golders Green
0-1 Anba Abraam, Brighton*; one renders it the other way round. The result is
identical either way. The majority orientation is stored (Golders Green home)
and the match carries a `gap_note` saying so.

## D6 — open

Three COFTA 2025 Group B matches display goals with no team attribution. Which
scorer belongs to the losing side is not determinable from the source, and
inferring it from squad history in other editions was explicitly forbidden.
Those events are stored with `team_id = null` and the matches carry
`events_status = 'complete_unattributed'`.

## D7 — open

Nduoma Chilaka's goal in Nottingham 1-0 Rotherham (`CONAFA26-A-R6-02`) was
supplied by the tournament organiser rather than by a screenshot. Stored with
`event_source = 'organiser_confirmed'` and the minute left null.

---

## Open questions answered by Adam

- **Q5** — see D1 above.
- **Q10** — separate `archive_*` tables, not shared with the live 2026
  tournament. The only link is `archive_teams.live_team_id`, the deliberate
  crosswalk that lets historical clubs inherit the live crest and colours.
- **Q11 (partial)** — **Kiro Khir and Kyrelos Khir are the same St Mark
  player**, merged with canonical *Kyrelos Khir*. Fady Khir remains a separate
  person. The **Karim Rizkalla (Newcastle) / Karim Rizkallah (Stevenage)** pair
  stays held back as two players.
- **Player identity addition** — the COSA 2026 player published as **"Myven"**
  is **Myven Gaied**. The source string `Myven` is preserved as `player_name`
  everywhere it was published; `player_canonical` is `Myven Gaied` on all of her
  rows (goal event, assist, WOTM award, goalscorer board, published WOTM table).

## One contradiction inside the source, resolved by reading rather than by picking

`team_registry.player_name_variants` marks eight pairs `flag_do_not_merge`.
`player_registry.merges` then merges seven of them. The only pair it leaves
unmerged — Rizkalla / Rizkallah — is exactly the pair in
`player_registry.held_back`.

That is only coherent under one reading: **`flag_do_not_merge` means "never
merge these automatically"**, and Q9 then recorded the manual decision for each.
The import follows that reading, so `player_registry` is the merge authority and
`player_name_variants` is kept as the flagging record. Under any other reading
the two blocks simply contradict each other.

If that reading is wrong, seven players are affected and the import must be
re-run.
