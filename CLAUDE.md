# CLAUDE.md — Scarborough Film Map

Project instructions for Claude Code. Read this at the start of every session.

## What this is

A web app that organises a **documentary about Scarborough** around a map. Locations are the
spine: each pin anchors footage, interviews, contacts and logistics, is auto-tagged to its
Scarborough neighbourhood, and can be batched into an efficient **shoot day** by proximity.
The data feeds script-writing now and a public website later.

Owner: Prem (documentary filmmaker). Single-user for now.

## Current status (as of 2026-06-24)

**Working app with live Supabase backend.** All major features are done and syncing to the cloud.

### What works end-to-end
- Interactive map of Scarborough (OpenStreetMap tiles + City of Toronto neighbourhood boundaries)
- Bold outer Scarborough boundary + thicker internal neighbourhood dividing lines
- Click-to-drop pins → auto-detected neighbourhood (ray-casting point-in-polygon)
- Rich location records: status, type, shoot date, best light, parking, permit, contacts[],
  interviews[], footage[], reference photos[], notes
- Shoot-day planner: pick a location + radius → haversine nearby list + map circle → text export
- Search across people/notes, filter by status/neighbourhood, stats bar
- Responsive mobile layout, 📍 GPS capture button
- JSON export
- **Supabase + PostGIS backend** (live, connected, data in the cloud)
- 5 real locations seeded in Supabase (see below)

### What's next
- [ ] Offline PWA (installable, works without signal on your phone in the field)
- [ ] Photo/file upload to Supabase Storage (replace pasted URLs)
- [ ] Public website export / embed from the same data
- [ ] Script-writing export (locations → scene list)

## Run / verify

```bash
python3 -m http.server 8138      # from this folder → http://localhost:8138
```
No build step, no install. Leaflet 1.9.4 + Supabase JS v2 load from CDN.
There's a `.claude/launch.json` (server name `scarborough-film-map`, port 8138).

## Repo

- GitHub: `landedimmigrant-ops/scarborough-film-map` (private, SSH remote)
- Local: `/Users/Prem/Documents/Dev/scarborough film map/`
- Commit convention: short imperative subject + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Architecture

Vanilla JS + Leaflet. No framework, no bundler. Files:

| File | Purpose |
|---|---|
| `index.html` | Shell: sidebar + map pane + two slide-over panels (editor, planner) |
| `app.js` | All logic (~500 lines, sectioned with comments) |
| `styles.css` | Dark theme, responsive (mobile breakpoint 720px) |
| `data/scarborough.geojson` | 30 Scarborough neighbourhood polygons (WGS84) + centroids |
| `data/scarborough-boundary.geojson` | Outer Scarborough perimeter (5121 pts, computed from shared-edge cancellation) |
| `data/toronto-neighbourhoods.geojson` | Full 158 Toronto neighbourhoods — **gitignored**, re-downloadable |

### Key functions in app.js

| Function | What it does |
|---|---|
| `loadDB()` | Async — loads all projects + locations + child records from Supabase |
| `saveLocation(loc)` | Async — upsert location + delete/re-insert child records |
| `deleteLocation(id)` | Async — delete from Supabase |
| `saveProject(proj)` | Async — insert new project |
| `migrateLocalStorage()` | One-time — moves old localStorage pins into Supabase, then clears localStorage |
| `findHood(lat, lng)` | Ray-casting point-in-polygon → neighbourhood name string |
| `distKm(a, b)` | Haversine distance between two {lat, lng} objects |
| `openDetail(loc, isNew)` | Opens the rich location editor slide-over panel |
| `openPlanner(anchor)` | Opens the shoot-day planner slide-over panel |

### Data model (in-memory shape, maps 1:1 to Supabase)

```js
db = {
  projects: [ { id, name, createdAt } ],
  activeProjectId,
  locations: [ {
    id,           // uuid (from Supabase)
    projectId,    // → projects.id
    createdAt,
    title, neighbourhood, status, category,
    lat, lng,     // extracted from PostGIS geom
    shootDate, bestTime, parking, permit,
    contacts:   [ { id, name, role, detail } ],
    interviews: [ { id, subject, role, status } ],
    footage:    [ { id, label, notes } ],
    photos:     [ url ],   // stored as media rows with kind='photo'
    notes,
  } ]
}
```

## Supabase

- **Project ref:** `hflalatfowksnggygulz`
- **URL:** `https://hflalatfowksnggygulz.supabase.co`
- **MCP:** configured in `.mcp.json` (project-scoped) — run `/mcp` → supabase → Authenticate if needed
- **Anon key:** in `app.js` lines 7-8 (safe to be in client code — this is the public anon key)
- **Agent skills:** installed in `.agents/skills/` (supabase + postgres-best-practices), symlinked for Claude Code. Re-install with `npx skills add supabase/agent-skills` if the `.agents/` folder is missing.

### Supabase schema (already created)

```sql
-- PostGIS enabled
create table projects (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now());

create table locations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null, neighbourhood text, status text default 'idea', category text,
  shoot_date date, best_time text, parking text, permit text default 'n/a', notes text,
  geom geography(point, 4326) not null,
  lat float generated always as (st_y(geom::geometry)) stored,
  lng float generated always as (st_x(geom::geometry)) stored,
  created_at timestamptz default now()
);
create index on locations using gist(geom);

create table interviews (id uuid primary key default gen_random_uuid(), location_id uuid references locations(id) on delete cascade, subject text, role text, status text default 'idea');
create table contacts (id uuid primary key default gen_random_uuid(), location_id uuid references locations(id) on delete cascade, name text, role text, detail text);
create table media (id uuid primary key default gen_random_uuid(), location_id uuid references locations(id) on delete cascade, kind text, label text, url text, notes text);
```

### Seeded data (already in Supabase)

Project: **"Untitled film"** (`3101dbd1-0df4-41d9-a7bd-04c0f3e8e646`)

| Location | Neighbourhood | Status |
|---|---|---|
| Guild Park sculpture lawn | Guildwood | Scouting |
| UTSC brutalist quad | Highland Creek | Confirmed |
| Rouge Beach mouth | West Rouge | Shot |
| Cathedral Bluffs lookout | Cliffcrest | Idea |
| STC interior atrium | Bendale-Glen Andrew | Scouting |

Guild Park also has a contact (Toronto Film Office) and an interview (Mr. Spencer, park historian).

## Open data licences (keep attributions)

- **OpenStreetMap** base tiles — ODbL
- **City of Toronto Open Data → Neighbourhoods** — Open Government Licence – Toronto

## Conventions

- Keep it dependency-light and framework-free unless there's a strong reason.
- `.claude/` is gitignored (local workspace config). `.agents/` is gitignored (re-installable).
- The 2 MB `toronto-neighbourhoods.geojson` source is gitignored (re-downloadable per README).
- Verify UI changes with preview tools before calling done.
