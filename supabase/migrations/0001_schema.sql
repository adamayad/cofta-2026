-- ============================================================
-- COFTA 2026 — schema
-- Principles:
--   * Match state lives here, never on a device. Any admin can take over.
--   * The clock is stored as timestamps, never as a ticking counter.
--   * Scores are derived from events, so undo can never leave them wrong.
-- ============================================================

create extension if not exists "pgcrypto";

-- ── clubs ───────────────────────────────────────────────────
create table public.teams (
  id            text primary key,                -- 'smpk', 'hove', ...
  name          text not null,                   -- 'St Mary & Archangel Michael'
  city          text not null,                   -- 'Hove'
  colour        text not null,                   -- '#646C74'
  text_colour   text not null default '#FFFFFF', -- readable on `colour`
  crest_url     text,
  group_letter  text check (group_letter in ('A','B')),
  disqualified  boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ── players (squad lists arrive closer to the date) ─────────
create table public.players (
  id          uuid primary key default gen_random_uuid(),
  team_id     text not null references public.teams(id) on delete cascade,
  name        text not null,
  shirt_no    int,
  active      boolean not null default true
);
create index on public.players (team_id);

-- ── matches ─────────────────────────────────────────────────
create type public.match_status as enum
  ('scheduled','first_half','half_time','second_half','full_time');

create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  stage           text not null,          -- 'A' | 'B' | 'SF1' | 'SF2' | 'FINAL'
  day             int  not null,
  kickoff         text not null,          -- '09:30'
  pitch           text not null,
  home_team       text references public.teams(id),
  away_team       text references public.teams(id),

  -- scores are maintained by trigger from match_events
  home_score      int not null default 0,
  away_score      int not null default 0,

  -- shootout, knockouts only, kept apart from the score on purpose
  pens_home       int not null default 0,
  pens_away       int not null default 0,
  pens_decided    boolean not null default false,

  forfeit_side    text check (forfeit_side in ('home','away')),

  status          public.match_status not null default 'scheduled',

  -- clock: anchor + banked time. Never a counter.
  clock_running   boolean not null default false,
  clock_anchor    timestamptz,
  clock_accum_ms  bigint  not null default 0,

  -- teams freeze once a knockout tie kicks off
  locked          boolean not null default false,

  -- optimistic concurrency guard for clock writes
  version         int not null default 0,
  controlled_by   uuid references auth.users(id),
  controlled_at   timestamptz,

  updated_at      timestamptz not null default now()
);
create index on public.matches (day, kickoff);

-- ── events: the source of truth for scores ──────────────────
create type public.event_type as enum
  ('goal','own_goal','yellow','red','motm','pen_scored','pen_missed','note');

create table public.match_events (
  -- id is generated on the CLIENT. That is the idempotency key: a retry
  -- on bad signal re-sends the same id and inserts nothing the second time.
  id           uuid primary key,
  match_id     uuid not null references public.matches(id) on delete cascade,
  type         public.event_type not null,
  side         text check (side in ('home','away')),
  player_id    uuid references public.players(id),
  elapsed_ms   bigint,
  minute_label text,
  voided       boolean not null default false,   -- undo keeps the audit trail
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index on public.match_events (match_id, created_at desc);

-- ── knockout slot overrides (disqualification, unresolved ties) ──
create table public.slot_overrides (
  slot       text primary key check (slot in
              ('sf1_home','sf1_away','sf2_home','sf2_away','final_home','final_away')),
  team_id    text references public.teams(id),
  set_by     uuid references auth.users(id),
  set_at     timestamptz not null default now()
);

-- ── who may write ───────────────────────────────────────────
create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  label      text,          -- 'Pitch One'
  created_at timestamptz not null default now()
);

-- ── audit ───────────────────────────────────────────────────
create table public.audit_log (
  id         bigserial primary key,
  actor      uuid references auth.users(id),
  action     text not null,
  match_id   uuid,
  detail     jsonb,
  at         timestamptz not null default now()
);

-- ============================================================
-- Scores are recomputed from events. Undo therefore cannot drift.
-- ============================================================
create or replace function public.recalc_match_score() returns trigger
language plpgsql as $$
declare
  m uuid := coalesce(new.match_id, old.match_id);
begin
  update public.matches set
    home_score = (select count(*) from public.match_events e
                   where e.match_id = m and not e.voided
                     and ((e.type = 'goal'     and e.side = 'home')
                       or (e.type = 'own_goal' and e.side = 'away'))),
    away_score = (select count(*) from public.match_events e
                   where e.match_id = m and not e.voided
                     and ((e.type = 'goal'     and e.side = 'away')
                       or (e.type = 'own_goal' and e.side = 'home'))),
    updated_at = now()
  where id = m;
  return null;
end $$;

create trigger trg_recalc_score
after insert or update or delete on public.match_events
for each row execute function public.recalc_match_score();
