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
| B team with a badge of its own | `<live_team_id>-b.webp` | `gg-b.webp` |
| club with no live row | slug of `canonical_name` | `st-mary-st-george.webp` |

**Name the file after the club it belongs to, not after what the badge says.**
Golders Green's B team is called "St Mary's" and its crest arrived as
`stm-ggb.webp` — but `stm` is *St Mark's* live_team_id everywhere in this
codebase, so that filename is one careless glance from being wired to the
wrong church. It is stored as `gg-b.webp`.

A B team only needs a file at all if it has a badge distinct from its
parent's; otherwise it inherits, which is the default.

Slug rule for the last case: lowercase, `&` dropped, spaces to hyphens —
"St Mary & St George" → `st-mary-st-george.webp`.

**The slug follows the canonical name, so it changes when a name is
corrected.** Newcastle, Hove and Liverpool & Bolton were named after the first
pass, so their files are now `st-george-st-athanasius.webp`,
`archangel-michael.webp` and `liverpool-bolton.webp`. Generate the current list
from the database rather than trusting a copy of it:

```sql
select coalesce(live_team_id,
         lower(regexp_replace(regexp_replace(canonical_name,'&','','g'),'\s+','-','g')))
       || '.webp' as filename,
       canonical_name, city
  from public.archive_teams
 where parent_club is null
 order by 1;
```

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
