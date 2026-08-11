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

-- The app reads lat/lng through this view rather than decoding PostGIS WKB.
-- Recreate it if you add a column to locations that the app needs.
create or replace view locations_view as
  select id, project_id, title, neighbourhood, status, category,
         shoot_date, best_time, parking, permit, notes, address, created_at,
         st_y(geom::geometry) as lat,
         st_x(geom::geometry) as lng
  from locations;
