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
- Interactive map of Scarborough (OpenStreetMap **or Esri satellite** tiles + City of Toronto neighbourhood boundaries)
- Bold outer Scarborough boundary + thicker internal neighbourhood dividing lines
- **Click-to-mark with auto-naming**: a click drops a draggable pin, reverse-geocodes it (Nominatim) to
  auto-fill title + address, and offers nearby named buildings/parks as quick-pick chips → the exact site in one tap
- Auto-detected neighbourhood (ray-casting point-in-polygon) on every marked pin
- **Place search**: type a name → Scarborough-bounded results → fly there + drop a pre-named pin
- **Satellite / street base-map toggle** (Esri World Imagery) for scouting actual buildings & tree cover
- **Explore mode** ("🔍 What's here?"): click shows the neighbourhood blurb (30 hand-written) + nearest Wikipedia landmark
- Rich location records: status, type, shoot date, best light, parking, permit, **address**, contacts[],
  interviews[], footage[], reference photos[], notes
- Shoot-day planner: pick a location + radius → haversine nearby list + map circle → text export
- Search across people/notes, filter by status/neighbourhood, stats bar
- Responsive mobile layout, 📍 GPS capture button (also auto-names)
- JSON export
- **Supabase + PostGIS backend** (live, connected, data in the cloud)
- 5 real locations seeded in Supabase (see below)

### Two map modes (interaction model)
- **Mark mode (default):** click anywhere → drop + auto-name a pin. Drag the pin to fine-tune (re-identifies on drop).
- **Click a neighbourhood name** (the centroid label) → its summary popup (blurb + shoot count + Wikipedia), in
  either mode. Only the visible label text is clickable (`.hl-in`, `pointer-events:auto`, centred via `translate(-50%,-50%)`);
  the surrounding label box is `pointer-events:none` so map clicks pass through and still drop pins. Label clicks pass the
  known name to `exploreAt(latlng, knownHood)` — a thin lakeside hood's centroid can fall outside its own polygon, so
  `findHood` on the centroid would wrongly say "Outside Scarborough".
- **Explore mode (🔍 toggle):** click *anywhere* → neighbourhood blurb + nearest Wikipedia landmark (derives the hood
  from raw coords via `findHood`). The hood polygons don't intercept clicks (a click handler there used to block pin-dropping).
- The sidebar tagline reflects the active mode (it stops saying "add a location" while in explore mode).

### Usability & accessibility (audit in `docs/usability-log.md`)
An 8-cycle heuristic audit produced a prioritized backlog in [`docs/usability-log.md`](docs/usability-log.md).
**Shipped 2026-06-25:** delete now asks for confirmation (`removeLoc`); list cards are keyboard-operable
(`role=button`, Enter/Space) and the slide-overs are dialogs with focus move/trap/restore + **Esc-to-close**
(see the `keydown` handler + `captureFocus`/`restoreFocus`); `:focus-visible` rings; on mobile, tap targets are
≥44px and the map toggles dock into the map band instead of floating over the list. Remaining items (none
High-impact) are tracked in the log.

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
| `markAt(latlng)` | Mark mode — drop blank pin, open editor, show draggable temp marker, then `enrichEditing` |
| `enrichEditing(lat, lng)` | Async — fills title + address (reverseGeocode) and nearby chips (nearbyFeatures); guarded by `enrichToken` |
| `reverseGeocode(lat, lng)` | Nominatim reverse → `{ name, address }` |
| `searchPlaces(q)` | Nominatim search (Scarborough viewbox) → place results for the search box |
| `nearbyFeatures(lat, lng)` | Overpass — named buildings/parks within ~60 m, sorted by distance → quick-pick chips |
| `exploreAt(latlng)` | Explore mode — combined neighbourhood blurb + nearest Wikipedia landmark popup |
| `fetchNearestWiki(lat, lng)` | Wikipedia geosearch + summary → `{ title, short, url, others }` |

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
    lat, lng,     // extracted from PostGIS geom (via locations_view)
    shootDate, bestTime, parking, permit, address,
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
  address text,                       -- reverse-geocoded street address (auto-filled on click)
  geom geography(point, 4326) not null,
  created_at timestamptz default now()
);
create index on locations using gist(geom);

-- App reads through this view; it exposes lat/lng (and address) from the geography column.
-- If you add a column to locations that the app needs, recreate this view to include it.
create or replace view locations_view as
  select id, project_id, title, neighbourhood, status, category,
         shoot_date, best_time, parking, permit, notes, created_at,
         st_y(geom::geometry) as lat, st_x(geom::geometry) as lng, address
  from locations;

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
