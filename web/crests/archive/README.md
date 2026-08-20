# Archive club crests

Crests for clubs that appear only in the historical archive, and the women's
crests for churches that field both sides.

Drop files here in the local clone — **never through the GitHub web UI**, which
lands cache-first assets without a `VERSION` bump so no device already holding
the old cache ever fetches them (see CLAUDE.md → Workflow).

## Naming

| case | filename | example |
|---|---|---|
| club crosswalked to a live club | `<live_team_id>.webp` | `smpk.webp` |
| women's crest of a crosswalked club | `<live_team_id>-w.webp` | `smpk-w.webp`, `stm-w.webp`, `gg-w.webp` |
| club with no live row | slug of `canonical_name` | `st-mary-st-george.webp` |

Slug rule for the last case: lowercase, `&` dropped, spaces to hyphens —
"St Mary & St George" → `st-mary-st-george.webp`.

## Wiring a file in

A file here is inert until the club's `display` jsonb points at it. One
statement per crest, then bump `VERSION` in `sw.js`:

```sql
update public.archive_teams
   set display = coalesce(display, '{}'::jsonb)
               || jsonb_build_object('crest', './crests/archive/st-mary-st-george.webp')
 where canonical_name = 'St Mary & St George' and city = 'Nottingham';
```

Use the key `crest_women` instead for a women's crest. Setting a crest
replaces that club's monogram tile; the monogram keys (`colour`,
`text_colour`, `ring`) can stay, and are simply no longer read.
