# Scarborough Film Map

Repo: **landedimmigrant-ops/scarborough-film-map** (private) · Local: `~/Documents/Dev/scarborough film map`

A documentary-organizing tool built around a map of Scarborough. Locations are the spine:
each one anchors your **footage, interviews, contacts and logistics**, is auto-tagged to its
**neighbourhood**, and can be batched into an efficient **shoot day** by proximity. Built to
later feed a public website and to be queried while writing the script.

![status: working prototype](https://img.shields.io/badge/status-prototype-blue)

**Live:** https://scarborough-film-map.pages.dev (installable PWA — works offline in the field)

## Run it

```bash
./dev.sh
```

Opens http://localhost:8138. Still no build step and no install — Leaflet loads from a CDN — but
the data now comes from a Cloudflare Pages Function (`functions/api/`), and only Wrangler can run
one, so this replaced `python3 -m http.server`. A plain static server will render the map and then
fail every read and write.

`dev.sh` needs `.dev.vars` (gitignored) holding the database credential:

```bash
echo 'NEON_DATABASE_URL="<connection string>"' > .dev.vars
```

Get the string from `.neon`, or `npx neonctl connection-string --project-id lively-voice-91994065`.

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

## Architecture

```
browser (index.html + app.js + sw.js)        no credential, no SDK
   │  fetch api/db, api/locations, api/photo …  (same-origin)
   ▼
functions/api/[[route]].js                   Cloudflare Pages Function
   │  SQL over HTTP  ·  holds NEON_DATABASE_URL + the R2 binding
   ▼
Neon Postgres 18 + PostGIS                   R2 bucket (reference photos)
```

The browser talks only to its own origin. The database credential and the photo bucket live
behind the Pages Function, which is why the schema needs no row-level security — under the
previous Supabase setup the client shipped a public anon key, so every table needed an
allow-all policy to be usable at all.

| File | Purpose |
|---|---|
| `index.html` / `app.js` / `styles.css` | the whole client (vanilla JS + Leaflet, no framework) |
| `functions/api/[[route]].js` | the entire backend — routes, SQL, R2 |
| `sw.js` | offline strategies per resource type |
| `schema.sql` | the database, re-appliable (`node tools/db-exec.mjs --file schema.sql`) |
| `tools/neon.mjs` | Node-side Neon access for the scripts below |
| `tools/db-exec.mjs` | run SQL against the database |
| `tools/import-json.mjs` | load locations from a JSON export |

## Data model

In-memory shape, mapping 1:1 to the tables in `schema.sql`:

```js
db = {
  projects: [ { id, name, createdAt } ],
  activeProjectId,
  locations: [ {
    id, projectId, createdAt,
    title, neighbourhood, status, category,          // status: idea|scouting|confirmed|shot
    lat, lng,                                        // from PostGIS geography via locations_view
    shootDate, bestTime, parking, permit, address,   // permit: n/a|needed|requested|granted
    contacts:   [ { id, name, role, detail } ],
    interviews: [ { id, subject, role, status } ],   // status: idea|reaching out|scheduled|recorded
    footage:    [ { id, label, notes } ],            // media rows, kind='footage'
    photos:     [ url ],                             // media rows, kind='photo'
    notes,
  } ]
}
```

`loadDB` / `saveLocation` / `deleteLocation` / `saveProject` / `renameProject` / `uploadPhoto`
in `app.js` are the only storage seam. Neighbourhood tagging is a ray-casting point-in-polygon
and the planner uses a haversine distance — both client-side, so they work offline.

## Importing data

`tools/import-json.mjs` takes the app's own **⭳ JSON** export, a raw row dump
(`{ projects, locations, interviews, contacts, media }`), or a bare array of locations, in
camelCase or snake_case:

```bash
node tools/import-json.mjs my-film.json --dry     # preview
node tools/import-json.mjs my-film.json
```

Re-running is safe — a location already in the target project with the same title and
effectively the same coordinates (within ~1 m, via `ST_DWithin`) is skipped, not duplicated.

## Deploy

```bash
./deploy.sh
```

Assembles the runtime files (plus `functions/`) into `dist/` and uploads to Cloudflare Pages.
One-time setup on a fresh Pages project:

```bash
npx wrangler login
npx wrangler pages secret put NEON_DATABASE_URL --project-name scarborough-film-map
```

Photos need R2 enabled on the account (dashboard → R2 → accept terms), then:

```bash
npx wrangler r2 bucket create scarborough-film-map-photos
```

and bind it as **PHOTOS** under Pages → Settings → Bindings. Until that's done, `/api/photo`
returns a clear 503 and the rest of the app is unaffected.

Note: the deployed URL is public — anyone who finds it can read and write, the same posture as
the anon key it replaced. Cloudflare Access (Zero Trust, free tier) can gate it behind an email
login if that changes.

## PostGIS

The geography column means the **"plan a shoot day"** query is one line of SQL when it ever
needs to move server-side (it's currently a client-side haversine, which is what lets it work
with no signal):

```sql
select l.*, st_distance(l.geom, a.geom) as metres
from locations l, locations a
where a.id = :anchor_id
  and l.project_id = a.project_id
  and st_dwithin(l.geom, a.geom, :radius_metres)
order by metres;
```

## Roadmap

- [x] Map + Scarborough neighbourhoods + auto-tagging
- [x] Projects, rich location records, shoot-day planner, responsive layout
- [x] Postgres + PostGIS backend (replaced localStorage)
- [x] Offline PWA (installable, works without signal in the field)
- [x] Photo upload to object storage (vs. pasted URLs)
- [x] Script-writing export (locations → Markdown scene list)
- [ ] Public website export from the same data
