-- ══════════════════════════════════════════════════════════════
-- Scarborough Film Map — Neon (Postgres 18 + PostGIS) schema
-- ──────────────────────────────────────────────────────────────
-- Migrated off Supabase 2026-08-11 (free-tier idle pause made the
-- project unreachable). Shape is deliberately 1:1 with the old
-- Supabase schema so app.js's row↔object mappers barely changed.
--
-- NO ROW-LEVEL SECURITY, on purpose. Under Supabase the browser held
-- a public anon key and every table needed an allow-all policy to be
-- usable. Here the browser never sees a credential: it talks to
-- same-origin /api/* (a Cloudflare Pages Function) and only that
-- function holds NEON_DATABASE_URL. The trust boundary moved from
-- "RLS policies" to "the Pages Function", so allow-all policies would
-- be pure ceremony.
--
-- Apply / re-apply (idempotent):
--   node tools/db-exec.mjs --file schema.sql
-- ══════════════════════════════════════════════════════════════

create extension if not exists postgis;

create table if not exists projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists locations (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references projects(id) on delete cascade,
  title         text not null,
  neighbourhood text,
  status        text not null default 'idea',
  category      text,
  shoot_date    date,
  best_time     text,
  parking       text,
  permit        text not null default 'n/a',
  notes         text,
  address       text,                      -- reverse-geocoded, auto-filled on click
  geom          geography(point, 4326) not null,
  created_at    timestamptz not null default now()
);
create index if not exists locations_geom_idx on locations using gist (geom);
create index if not exists locations_project_idx on locations (project_id);

-- Child tables. `position` exists so the editor's row order survives a
-- round-trip: saveLocation deletes and re-inserts children in one go, so
-- every row lands with the same created_at and Postgres gives no implicit
-- ordering — without this, contacts/photos could come back shuffled.
create table if not exists interviews (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete cascade,
  subject     text,
  role        text,
  status      text not null default 'idea',
  position    int not null default 0
);
create index if not exists interviews_loc_idx on interviews (location_id);

create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete cascade,
  name        text,
  role        text,
  detail      text,
  position    int not null default 0
);
create index if not exists contacts_loc_idx on contacts (location_id);

-- kind = 'footage' (label + notes) | 'photo' (url, an /api/photo/<key> R2 path)
create table if not exists media (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete cascade,
  kind        text not null,
  label       text,
  url         text,
  notes       text,
  position    int not null default 0
);
create index if not exists media_loc_idx on media (location_id);

-- ══════════════════════════════════════════════════════════════
-- Crowd-sourced suggestions (added 2026-08-11)
-- ──────────────────────────────────────────────────────────────
-- Prem asked people for location ideas and lost track of who suggested what.
-- Two tables carry that: who contributed, and what they proposed.
--
-- WHY `suggestions` IS SEPARATE FROM `locations`, and not just a status value:
-- POST /api/public/suggest is the only unauthenticated write in the whole app.
-- Keeping it confined to its own table means the public endpoint has no reach
-- into the 38 curated locations at all — the review queue is the security
-- boundary, not merely a workflow nicety. Accepting a suggestion is an OWNER
-- action that copies it into `locations`.
-- ══════════════════════════════════════════════════════════════

create table if not exists contributors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text,
  phone          text,
  -- How they want to appear in the credits, when that differs from `name`
  -- (spelling, stage name, "anonymous"). Falls back to name.
  credit_name    text,
  -- Suggesting a location is NOT the same as agreeing to be named in a film's
  -- credits, so consent is stored explicitly and defaults to false. The credits
  -- export filters on it — never assume it.
  credit_consent boolean not null default false,
  created_at     timestamptz not null default now()
);
-- Contributors are deduplicated by email so one person suggesting five places is
-- one credit, not five. Partial index: contributors without an email are allowed
-- and simply never merge.
create unique index if not exists contributors_email_key
  on contributors (lower(email)) where email is not null;

create table if not exists suggestions (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references projects(id) on delete cascade,
  contributor_id uuid references contributors(id) on delete set null,
  title          text not null,
  -- "why this place matters / your connection to it" — often the most useful
  -- field on the form for a documentary.
  note           text,
  neighbourhood  text,
  address        text,
  geom           geography(point, 4326) not null,
  status         text not null default 'pending',   -- pending | accepted | declined
  -- Set when accepted, so a suggestion can never be accepted twice and the
  -- resulting pin is traceable back to its origin.
  location_id    uuid references locations(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists suggestions_status_idx on suggestions (status, created_at);
create index if not exists suggestions_geom_idx on suggestions using gist (geom);

-- Attribution on the real pin, so credits survive even if the suggestion row is
-- later cleaned up. Nullable: Prem's own 38 locations have no contributor.
alter table locations add column if not exists contributor_id uuid references contributors(id) on delete set null;

-- ══════════════════════════════════════════════════════════════
-- Ideas + shoot days (added 2026-08-12, the "filmmaker console" build)
-- ──────────────────────────────────────────────────────────────
-- `ideas` is the loose-capture inbox: a link, a note, or an image that isn't
-- a location yet. Placing one on the map creates a location and links it via
-- location_id, so the idea's provenance survives its promotion.
--
-- `shoot_days` + `shoot_day_stops` are the manual planner: a named, dated day
-- with an ORDERED list of stops. Order lives in `position` (0,1,2…), rewritten
-- wholesale on every save — same delete-then-reinsert transaction pattern as
-- locations' child rows, and the same reason `position` exists there.
-- ══════════════════════════════════════════════════════════════

create table if not exists ideas (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id) on delete cascade,
  kind        text not null default 'note',   -- note | link | image
  title       text,
  body        text,                            -- the note itself / a comment on the link
  url         text,                            -- link href, or an image url (/api/photo/<key> or external)
  location_id uuid references locations(id) on delete set null,
  status      text not null default 'inbox',   -- inbox | archived
  created_at  timestamptz not null default now()
);
create index if not exists ideas_project_idx on ideas (project_id, status, created_at);

create table if not exists shoot_days (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title      text not null default '',
  date       date,
  notes      text,
  created_at timestamptz not null default now()
);
create index if not exists shoot_days_project_idx on shoot_days (project_id, date);

create table if not exists shoot_day_stops (
  id           uuid primary key default gen_random_uuid(),
  day_id       uuid not null references shoot_days(id) on delete cascade,
  location_id  uuid not null references locations(id) on delete cascade,
  position     int not null default 0,
  planned_time text,    -- free text "09:30" — a plan, not a timestamp
  note         text
);
create index if not exists shoot_day_stops_day_idx on shoot_day_stops (day_id, position);

-- The app reads lat/lng through this view rather than decoding PostGIS WKB.
-- Recreate it if you add a column to locations that the app needs.
--
-- DROP then CREATE, not CREATE OR REPLACE: replace can only append columns, so
-- inserting one mid-list fails with 'cannot change name of view column'. Views
-- hold no data, so dropping is free. Add new columns at the END anyway — it
-- keeps this replaceable for anyone who reaches for the shorter form.
drop view if exists locations_view;
create view locations_view as
  select id, project_id, title, neighbourhood, status, category,
         shoot_date, best_time, parking, permit, notes, address, created_at,
         st_y(geom::geometry) as lat,
         st_x(geom::geometry) as lng,
         contributor_id
  from locations;

-- Suggestions joined to their contributor, with lat/lng decoded — what the
-- owner's review queue reads.
drop view if exists suggestions_view;
create view suggestions_view as
  select s.id, s.project_id, s.title, s.note, s.neighbourhood, s.address,
         s.status, s.location_id, s.reviewed_at, s.created_at,
         st_y(s.geom::geometry) as lat,
         st_x(s.geom::geometry) as lng,
         c.id as contributor_id, c.name as contributor_name, c.email as contributor_email,
         c.phone as contributor_phone, c.credit_name, c.credit_consent
  from suggestions s
  left join contributors c on c.id = s.contributor_id;
