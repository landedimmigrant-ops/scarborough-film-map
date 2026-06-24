# Scarborough Shoot Map

A documentary-organizing tool built around a map of Scarborough. Locations are the spine:
each one anchors your **footage, interviews, contacts and logistics**, is auto-tagged to its
**neighbourhood**, and can be batched into an efficient **shoot day** by proximity. Built to
later feed a public website and to be queried while writing the script.

![status: working prototype](https://img.shields.io/badge/status-prototype-blue)

## Run it

```bash
# from the parent "tasks home" folder
python3 -m http.server 8138 --directory scarborough-map
# open http://localhost:8138
```

No build step, no install — Leaflet loads from a CDN.

## What it does

- **Projects** — each film/production owns its own set of locations (switcher top-left).
- **Drop a location** — click the map (or **📍 My location** on your phone) to add a pin;
  it's auto-tagged to the Scarborough neighbourhood it falls inside.
- **Rich location records** — status, type, shoot date, best light, parking, permit status,
  **contacts**, **interviews** (subject / role / status), **footage notes**, **reference photos**.
- **Plan a shoot day** — pick a location, set a radius, get an ordered list of everything
  nearby (with distances) to shoot in one day. Exports to a text shoot list.
- **Search & filter** — across titles, people, and notes; by status and neighbourhood.
- **Export** — the whole project to JSON.
- **Responsive** — usable on a phone in the field.

## Open data + licences

| Layer | Source | Licence |
|---|---|---|
| Base map tiles | **OpenStreetMap** | ODbL |
| Neighbourhood boundaries | **City of Toronto Open Data** — [Neighbourhoods](https://open.toronto.ca/dataset/neighbourhoods/) | Open Government Licence – Toronto |
| Map library | **Leaflet** 1.9.4 | BSD-2 |

`data/scarborough.geojson` = the city's `neighbourhoods-4326.geojson` (WGS84) filtered to the
30 Scarborough neighbourhoods, each with a centroid for label placement.

## Data model (localStorage now)

```js
db = {
  projects: [ { id, name, createdAt } ],
  activeProjectId,
  locations: [ {
    id, projectId, createdAt,
    title, neighbourhood, status, category,          // status: idea|scouting|confirmed|shot
    lat, lng,
    shootDate, bestTime, parking, permit,            // permit: n/a|needed|requested|granted
    contacts:   [ { name, role, detail } ],
    interviews: [ { subject, role, status } ],       // status: idea|reaching out|scheduled|recorded
    footage:    [ { label, notes } ],
    photos:     [ url ],
    notes,
  } ]
}
```

`loadDB()` / `save()` in `app.js` are the only storage seam — swap them for Supabase calls and
nothing else changes. Neighbourhood tagging is a ray-casting point-in-polygon; the planner uses
a haversine distance.

## Going to a real database (Supabase + PostGIS) — next step

```sql
create extension if not exists postgis;

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  neighbourhood text,
  status text default 'idea',
  category text,
  shoot_date date,
  best_time text, parking text, permit text default 'n/a',
  notes text,
  geom geography(point, 4326) not null,            -- lng/lat
  created_at timestamptz default now()
);
create index on locations using gist (geom);

-- child records (or keep as jsonb columns — your call)
create table interviews (id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete cascade,
  subject text, role text, status text default 'idea');
create table contacts (id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete cascade,
  name text, role text, detail text);
create table media (id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete cascade,
  kind text,                                       -- 'footage' | 'photo'
  label text, url text, notes text);
```

The **"plan a shoot day"** query becomes one line of PostGIS — everything within a radius of an
anchor location, ordered by distance:

```sql
select l.*, st_distance(l.geom, a.geom) as metres
from locations l, locations a
where a.id = :anchor_id
  and l.project_id = a.project_id
  and st_dwithin(l.geom, a.geom, :radius_metres)
order by metres;
```

This mirrors the Supabase PWA setup already used by the House Chores app in the parent folder.

## Roadmap

- [x] Map + Scarborough neighbourhoods + auto-tagging
- [x] Projects, rich location records, shoot-day planner, responsive layout
- [ ] Supabase + PostGIS backend (replace localStorage)
- [ ] Offline PWA (installable, works without signal in the field)
- [ ] Photo/file upload to Supabase Storage (vs. pasted URLs)
- [ ] Public website export from the same data
