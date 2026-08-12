# CLAUDE.md — Scarborough Film Map

Project instructions for Claude Code. Read this at the start of every session.

## What this is

A web app that organises a **documentary about Scarborough** around a map. Locations are the
spine: each pin anchors footage, interviews, contacts and logistics, is auto-tagged to its
Scarborough neighbourhood, and can be batched into an efficient **shoot day** by proximity.
The data feeds script-writing now and a public website later.

Owner: Prem (documentary filmmaker). Single-user for now.

## Current status (as of 2026-08-12)

**2026-08-12 — the "proper website" build.** Three big changes in one day:

1. **Site restructure:** the public landing page now lives at `/` (film blurb + CTA to `/suggest`);
   the private console app moved to **`/app/`**. `sw.js` stays at root scope (cache `sfm-v3`) so
   existing PWA installs upgrade in place; `manifest.webmanifest` start_url is `/app/` and the
   landing redirects standalone-display opens to `/app/` (safety net for pre-move installs — an
   iPhone A2HS re-add picks up the new start_url). Access rules got SIMPLER: protect `/app*` +
   `/api/*`, bypass `/api/public/*`, everything else public by default — `docs/access-setup.md`
   was rewritten for this model.
2. **Filmmaker console** (🎬 toggle in the sidebar): a board view over the same records. Lanes
   group by status / type / neighbourhood / shoot day; sidebar search + filters apply to it; cards
   drag between lanes with a pointer-events ghost (status + type lanes re-file the location; day
   lanes add/move/reorder that day's stops; hood lanes are read-only since the hood derives from
   coordinates). UX patterns lifted from the Tripdeck project (`~/Documents/Dev/travel_planner`).
3. **Ideas + shoot days**, both in Postgres:
   - `ideas` — capture-first inbox (note / link / image). Paste a bare link and the Function
     fetches its `<title>` server-side. An idea can be **placed** on the map (seeds a new pin,
     archives itself, stays linked via `location_id`) or **attached** to an existing location;
     linked ideas resurface read-only in the location editor.
   - `shoot_days` + `shoot_day_stops` — named, dated days with an ordered stop list (per-stop
     planned time + note), edited in the planner panel (list → editor, proximity-sorted add-stop
     picker, leg distances, debounced autosave with honest state text) or by dragging in the
     console's day lanes. Output: a **print-first day sheet** (`@media print` strips everything
     else; readable on the iPad as-is) and a text export. The old radius planner remains as
     ⚡ Radius plan with **💾 Save as shoot day**.

## Previous status (2026-08-11)

**Working app on a Neon (Postgres 18 + PostGIS) backend.** All major features are done and syncing
to the cloud. Migrated off Supabase 2026-08-11 — its free tier idled the project into a
Cloudflare 521 and took the data offline with it; Neon does not idle-delete. **All 38 locations
were recovered**: Supabase came back mid-migration and everything was pulled across with
`tools/import-json.mjs`, verified field-by-field (see **Data recovery** below).

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
- **Neon Postgres + PostGIS backend** behind a same-origin Cloudflare Pages Function
  (`functions/api/[[route]].js`) — the browser holds no credential at all
- Reference photos: code path moved to **Cloudflare R2** via `/api/photo/<key>` — *pending R2 being
  enabled on the account* (see Storage below); the route returns a clear 503 until then
- **Crowd-sourced suggestions**: a public `/suggest` page anyone can be sent; submissions land in a
  review queue (💡 Suggestions in the sidebar) with the contributor's name, email and credit
  consent; accepting one promotes it to a real attributed location. 🎬 Credits exports the list.

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
≥44px and the map toggles dock into the map band instead of floating over the list.
**Shipped 2026-07-01 (Cycle 9 — data honesty & edit safety):** startup shows "Loading your locations…"
and a backend load failure shows an error + ↻ Retry (never a false "no locations yet"); Save disables
to "Saving…" and a failed save/delete alerts and keeps the editor open (`saveDetail`/`removeLoc` check
the write result); the `dirtyEdit` flag guards unsaved edits with a discard confirm on Esc / ✕ /
card-switch / planner / map-click (only real user input marks it dirty — programmatic auto-fill doesn't);
an on-map "Explore mode" pill (`#mode-pill`) shows while explore is active; list cards show a 🗓
shoot-date chip. Only backlog #8 (collapse editor logistics) remains — see the log.
**Shipped 2026-07-01 (Cycle 10 — planner + perf):** the planner has a "Plan around" anchor select
(sidebar default = most recently added); plan stops + the exported list show 🗓 shoot dates (and
addresses in the export); an inline hint appears when no stops fall inside the radius; the sidebar
search debounces 200 ms and `drawMarkers` diffs markers instead of clear-and-redraw (marker clicks
resolve the record by id at click time — don't reintroduce captured-object handlers there).
**Shipped 2026-07-01 (Cycle 11 — projects + script export):** projects can be renamed (✎ button,
`renameProject`); the footer offers **⭳ JSON** and **📝 Scenes** — `exportSceneList()` writes a
Markdown scene list grouped by neighbourhood (status, shoot date, logistics, address, interviews,
contacts, footage, notes), which is the "script-writing export" roadmap item.

### What's next
- [x] Offline PWA — shipped 2026-07-02: `manifest.webmanifest` + `icons/` + `sw.js` (shell/data
      precached network-first; tiles cache-first LRU-capped; `GET /api/db` network-first with
      cached fallback = last-known locations offline; `/api/photo/*` cache-first; writes never
      intercepted). **Hosted on
      Cloudflare Pages 2026-07-02** → https://scarborough-film-map.pages.dev (see Deploy section).
      **Remaining:** install on the phone (Add to Home Screen) + airplane-mode field test. The
      cache version is now `sfm-v2`; the v1 caches held dead supabase.co URLs and are purged on
      activate, so the phone needs one online load to pick up the new worker.
- [x] Photo/file upload — shipped 2026-07-02 (Supabase Storage), moved to **Cloudflare R2**
      2026-08-11: 📤 Upload in the editor (multi-select, client-side 1600px JPEG compression;
      URL flows into the existing media-row persistence). Follow-up idea: GC storage objects on
      photo removal. **Blocked on Prem:** R2 must be enabled once in the Cloudflare dashboard —
      that's the only outstanding item in the whole migration.
- [x] Off Supabase onto Neon — shipped, deployed and verified 2026-08-11 (see the Neon section):
      production secret set, all 38 locations imported and diffed, live site serving them.
- [x] Crowd-sourced location suggestions + contributor credits — shipped 2026-08-12.
      **Blocked on Prem:** Cloudflare Access must be configured before the /suggest link is shared,
      or the private side of the app stays open to anyone with the URL. Step-by-step:
      [`docs/access-setup.md`](docs/access-setup.md).
- [x] Public website — shipped 2026-08-12: landing page at `/` (film blurb + suggest CTA); the
      console moved to `/app/`. Embedding a public map view of selected locations is still open.
- [x] Filmmaker console (board over statuses/types/hoods/days) — shipped 2026-08-12
- [x] Idea capture (links / notes / images → place or attach) — shipped 2026-08-12
- [x] Saved shoot days + printable day sheet — shipped 2026-08-12
- [x] Script-writing export (locations → scene list) — shipped 2026-07-01 as the 📝 Scenes Markdown export

## Run / verify

```bash
./dev.sh                         # → http://localhost:8138
```

`dev.sh` runs `wrangler pages dev` on the repo root. **`python3 -m http.server` no longer works**
for anything but static rendering: the app's data comes from a Pages Function, and only Wrangler
can run one. There's a `.claude/launch.json` (server name `scarborough-film-map`, port 8138) that
invokes the same thing.

Requires `.dev.vars` (gitignored) with `NEON_DATABASE_URL="postgresql://…"`. The bucket binding
is mounted locally as a *simulated* R2 (`--r2 PHOTOS`), so dev uploads never touch the real one.

No build step; Leaflet 1.9.4 loads from CDN. There is no npm dependency anywhere — the Function
and `tools/*.mjs` both speak Neon's SQL-over-HTTP protocol with plain `fetch`.

Handy checks:

```bash
node tools/db-exec.mjs "select count(*) from locations"
node tools/db-exec.mjs --file schema.sql        # re-apply schema (idempotent)
```

## Deploy (Cloudflare Pages)

- **Live:** https://scarborough-film-map.pages.dev (HTTPS → the PWA installs on the phone)
- `./deploy.sh` — copies the runtime files **plus `functions/`** into `dist/` (CLAUDE.md, docs/,
  schema.sql, tools/ stay off the public site) and runs `wrangler pages deploy`.
  Forgetting `functions/` deploys an app whose every `/api/*` call 404s — that's why the copy is
  in the script rather than left to muscle memory.
- Auth: `npx wrangler login` (one-time, browser OAuth). Project `scarborough-film-map`, production branch `main`
- **The production secret is set once, out of band:**
  `npx wrangler pages secret put NEON_DATABASE_URL --project-name scarborough-film-map`
- Note: the URL is public — anyone who finds it can read and write, the same posture as the old
  anon key. Cloudflare Access (Zero Trust, free tier) can gate it behind an email login if wanted.

## Repo

- GitHub: `landedimmigrant-ops/scarborough-film-map` (private, SSH remote)
- Local: `/Users/Prem/Documents/Dev/scarborough film map/`
- Commit convention: short imperative subject + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Architecture

Vanilla JS + Leaflet. No framework, no bundler. Files:

| File | Purpose |
|---|---|
| `index.html` + `landing.css` | The **public landing page** at `/` — film blurb, CTA to `/suggest`, standalone-PWA redirect to `/app/` |
| `app/index.html` | Console shell: sidebar (with 🗺/🎬 view toggle) + map pane + `#console` board + slide-over panels + `#daysheet` print overlay |
| `app/app.js` | All client logic (sectioned with comments); the `/api/*` client is at the top; console/drag/days modules at the bottom |
| `app/styles.css` | Dark theme, responsive (mobile breakpoint 720px), console + day-sheet + `@media print` rules |
| `functions/api/[[route]].js` | The entire backend: routes, SQL over HTTP, R2 photo put/get, the owner gate |
| `suggest.html` / `suggest.js` / `suggest.css` | The **public** guest suggestion page at `/suggest` — standalone, no service worker, shows none of Prem's locations |
| `schema.sql` | The database, re-appliable: `node tools/db-exec.mjs --file schema.sql` |
| `tools/neon.mjs` | Node-side Neon access (dependency-free) shared by the scripts below |
| `tools/db-exec.mjs` | Run SQL / apply schema.sql |
| `tools/import-json.mjs` | Load locations from a JSON export — the data-recovery path |
| `dev.sh` / `deploy.sh` | Local Wrangler dev server / Pages deploy |
| `sw.js` | Service worker at ROOT scope (upgrades v2 installs in place) — offline strategies per resource type (see file header comment) |
| `manifest.webmanifest` + `icons/` | PWA install metadata + app icons (regenerable with PIL — pin motif, app palette) |
| `data/scarborough.geojson` | 30 Scarborough neighbourhood polygons (WGS84) + centroids |
| `data/scarborough-boundary.geojson` | Outer Scarborough perimeter (5121 pts, computed from shared-edge cancellation) |
| `data/toronto-neighbourhoods.geojson` | Full 158 Toronto neighbourhoods — **gitignored**, re-downloadable |

### Key functions in app.js

| Function | What it does |
|---|---|
| `api(path, opts)` | The only network seam to the backend — same-origin `fetch` to `/api/*`, throws with the server's own message; `lastApiError` holds the latest so alerts can say *why* |
| `loadDB()` | Async — one `GET /api/db` → projects + locations + child records |
| `saveLocation(loc)` | Async — one `POST /api/locations`; row + all children in a single transaction |
| `deleteLocation(id)` | Async — `DELETE /api/locations/<id>` |
| `saveProject(proj)` / `renameProject(id, name)` | Async — `POST` / `PATCH /api/projects` |
| `uploadPhoto(file)` | Async — compress → `POST /api/photo` → relative `/api/photo/<key>` URL |
| `migrateLocalStorage()` | One-time — moves old localStorage pins into Postgres. **Only clears localStorage if every write succeeded** — a partial failure keeps it, since it may be the last copy |
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
| `setView(v)` / `renderConsole(list)` | 🗺/🎬 view switch; the console board (lanes from `consoleLanes`, delegated `data-act` events) |
| `saveIdeaApi` / `deleteIdeaApi` / `saveDayApi` / `deleteDayApi` | Async writers, same null-on-failure contract as `saveLocation` |
| `captureIdea()` / `parseCapture(text)` | The capture box: bare URL → link (server fetches title), image extension → image, else note |
| `cdrag*` functions | Console drag: pointer events, 8px/250ms thresholds, ghost clone, `elementsFromPoint` targeting |
| `openDays(dayId?)` / `renderDayEditor` | Shoot-days panel (list ⇄ editor), debounced autosave via `scheduleDaySave`/`flushDaySaveNow` |
| `openDaySheet(day)` | Print-first day sheet overlay; `@media print` shows only it |
| `saveRadiusPlanAsDay(anchor, near)` | ⚡ radius plan → persisted shoot day |

### Data model (in-memory shape, maps 1:1 to the Postgres tables)

```js
db = {
  projects: [ { id, name, createdAt } ],
  activeProjectId,
  ideas: [ {                    // capture-first inbox (console's 💡 lane)
    id, projectId, kind,        // kind: 'note' | 'link' | 'image'
    title, body, url,           // url only http(s) or /api/photo/<key> — enforced server-side
    locationId,                 // set when placed on the map / attached to a pin
    status, createdAt,          // status: 'inbox' | 'archived'
  } ],
  shootDays: [ {                // the manual planner (also the console's day lanes)
    id, projectId, title,
    date,                       // 'YYYY-MM-DD' string, never Date-parsed (Safari)
    notes, createdAt,
    stops: [ { id, locationId, plannedTime, note } ],   // ordered; position = array index
  } ],
  locations: [ {
    id,           // uuid (server-generated)
    projectId,    // → projects.id
    createdAt,
    title, neighbourhood, status, category,
    lat, lng,     // extracted from PostGIS geom (via locations_view)
    shootDate, bestTime, parking, permit, address,
    contacts:   [ { id, name, role, detail } ],
    interviews: [ { id, subject, role, status } ],
    footage:    [ { id, label, notes } ],
    photos:     [ url ],   // media rows, kind='photo'; url is /api/photo/<r2-key>
    notes,
  } ]
}
```

## Suggestions, contributors & the public/private split

Prem asked people for location ideas and lost track of who suggested what. That's what
`contributors` + `suggestions` are for, and it's what forced the app to grow an auth boundary.

**Read [`docs/access-setup.md`](docs/access-setup.md) before touching any of this.** Until Cloudflare
Access is configured the private side is open to anyone with the URL, which was fine when nobody had
it and is not fine now that a `/suggest` link exists on the same host.

### The route split is load-bearing

| Prefix | Reachable by | |
|---|---|---|
| `/api/public/*` | anyone | currently just `POST /api/public/suggest` |
| everything else on `/api/` | Prem only | gated by Access, plus the `ownerGate()` tripwire |

`/api/public/suggest` vs `/api/suggestions` are deliberately NOT a shared prefix: an Access Bypass
rule written as `/api/suggest*` would also match `/api/suggestions` and expose the review queue —
every contributor's email address. Don't rename them to share a prefix, and don't add an owner route
under `/api/public/`. `onRequest` runs the gate BEFORE dispatch so a route added later is owner-only
by default.

### Why `suggestions` is its own table

`POST /api/public/suggest` is the only unauthenticated write in the app. Confining it to its own
table means the public endpoint has no reach into the 38 curated locations at all — the review queue
is the security boundary, not just workflow. Accepting is an owner action that copies the row into
`locations`, carrying `contributor_id`.

Public-endpoint guards, all in `postSuggestion`: field length caps, a Scarborough bounding box, a
loose email sanity check, and a per-email hourly rate cap (10, or 20 for anonymous). Errors thrown
inside it return a generic message — the owner routes return the real one, but a stranger has no
business seeing SQL text or column names.

### Consent is not implied

Suggesting a location is **not** the same as agreeing to be named in a film's credits.
`contributors.credit_consent` defaults to `false`, the form's checkbox is opt-in, and the credits
export filters on it. A later submission's answer overwrites the earlier one (honouring the newer
answer is the safer reading). `GET /api/credits` also returns `withheldCount` so an omission is
visible rather than a silent gap discovered at the end of the edit.

Contributors are deduplicated on `lower(email)` via a **partial** unique index — so `ON CONFLICT`
must repeat the predicate (`where email is not null`), or Postgres can't infer the index and throws
42P10. One person suggesting five places is one credit.

### Neighbourhood tagging on accept

`findHood` is a client-side ray-cast against `data/scarborough.geojson`, so the Function can't set a
suggestion's neighbourhood and the guest page is deliberately not trusted to (a public caller could
send any string). `reviewSuggestion` in app.js derives it after accepting, where the polygons are
already loaded. A suggestion accepted with raw SQL/curl will have a NULL neighbourhood.

### Attribution round-trip

`locations.contributor_id` is exposed through `locations_view`, carried in the `/api/db` snapshot
alongside a `contributors` array, and shown as a 💡 chip on list cards plus a "Suggested by …" block
in the editor. `saveLocation` deliberately does NOT include `contributor_id` in its column list, so
editing an accepted location can't strip its attribution.

⚠️ Adding a column to `locations_view` is **two** edits: the view in `schema.sql` AND `LOCATION_COLS`
in the Function. Forget the second and the field is silently absent from the app with no error —
this bit once already, on `contributor_id`.

## Neon (the database)

- **Project:** `scarborough-film-map` — id `lively-voice-91994065`, org `org-lingering-shadow-80581799`
- **Region/version:** aws-us-east-1, Postgres 18 + PostGIS
- **Connection string:** `.neon` (gitignored) and `.dev.vars` (gitignored) locally; in production a
  Pages secret named `NEON_DATABASE_URL`. **It is never in client code** — that's the whole point of
  the Pages Function. Don't paste it into `app.js`, a doc, or a commit.
- CLI: `npx neonctl … --org-id org-lingering-shadow-80581799` (it prompts interactively without the org)
- Schema lives in `schema.sql` and is idempotent: `node tools/db-exec.mjs --file schema.sql`

### Why the Pages Function exists

A browser can't speak Postgres, so reads/writes go through `functions/api/[[route]].js`:

| Route | Does |
|---|---|
| `GET /api/db` | whole snapshot: projects + locations + interviews + contacts + media (one request) |
| `POST /api/locations` | create **or** update one location and all its child rows, in one transaction |
| `DELETE /api/locations/<id>` | delete (children cascade) |
| `POST /api/projects` · `PATCH /api/projects/<id>` | create / rename |
| `POST /api/photo?project=<id>` | raw image body → R2 → `{ url: "/api/photo/<key>" }` |
| `GET /api/photo/<key>` | serve from R2, `immutable` (keys are uuids) |

Three things about it worth not re-deriving:

1. **No RLS, deliberately.** Under Supabase the client held a public anon key, so every table
   needed an allow-all policy. Here the client holds nothing and the Function is the trust
   boundary, so policies would be pure ceremony.
2. **Location ids are generated in the Function**, not by `gen_random_uuid()`, because a Neon HTTP
   batch can't read statement 1's output — the child-row inserts need the id up front to go in the
   same transaction.
3. **Every timestamp leaves as strict ISO-8601** via the `ISO()` helper. Neon's HTTP layer returns
   Postgres' own text form (`2026-08-11 23:31:10.910294+00` — space, no `T`), which Chrome parses
   and **Safari does not**. Unfixed, that silently makes `createdAt` NaN on the iPhone PWA. If you
   add a timestamp column the app reads, wrap it in `ISO()`.

### Storage (Cloudflare R2)

Bucket `scarborough-film-map-photos`, bound as **PHOTOS**. Keys are `<project_id>/<uuid>.<ext>`;
the database stores only the relative `/api/photo/<key>` URL, so it survives a host change and the
service worker can cache it as a same-origin request.

**⚠️ Not enabled yet.** R2 has to be switched on once from the Cloudflare dashboard (R2 → accept
terms) before `wrangler r2 bucket create` works. Until then `/api/photo` returns a clear 503 —
"photo storage is not configured" — which the editor surfaces verbatim, and nothing else is
affected. Steps are in the README's Deploy section.

Follow-up idea (unchanged from the Supabase era): garbage-collect the R2 object when a photo row
is removed. Nothing deletes objects today.

### Data recovery — done, 38/38

The migration started with Supabase unreachable (REST host on Cloudflare 521, pooler timing out),
so schema and code moved first and the database went live empty. Supabase then came back, and the
whole dataset was pulled through `tools/import-json.mjs`:

```bash
# dump each table from the Supabase REST API into one file, then:
node tools/import-json.mjs supabase-dump.json --project "Untitled film"
```

**Verified, not assumed** — a field-by-field diff of all 38 locations (neighbourhood, status,
category, shoot_date, best_time, parking, permit, notes, address, plus lat/lng to 7 decimal places
through the PostGIS geography round-trip) reported **0 mismatches**, and contacts (3), interviews
(1) and footage rows (7) are byte-identical to the source. The docs previously said only 5 seeded
locations existed; the real count was 38 — Prem had been adding pins in the field.

`supabase-dump.json` is committed at the repo root as the migration's raw source of truth — a
point-in-time snapshot, deliberately not maintained (the app's ⭳ JSON export is the live backup).
`deploy.sh` copies an explicit allowlist into `dist/`, so it never reaches the public site. There
were **no photos** in Supabase Storage, so nothing was lost to the storage change.

The importer stays useful for any future JSON: it reads the app's own ⭳ JSON export, a raw row
dump, or a bare array, in camelCase or snake_case, and re-running is safe (same title + within 1 m
⇒ skipped, via `ST_DWithin`). Always `--dry` first.

### What was lost / kept in the migration

- **Kept:** every table, column and relationship; the PostGIS `geography(point,4326)` column and
  its GiST index; the `locations_view` lat/lng seam; all app behaviour.
- **Added:** a `position` column on `interviews`/`contacts`/`media` so editor row order survives a
  save (the old delete-then-reinsert relied on Postgres returning rows in insertion order, which it
  doesn't promise); one-request snapshot reads; one-transaction writes.
- **Dropped:** the RLS policies (see above), Supabase Storage, the `supabase-js` CDN script,
  `.mcp.json` (the Supabase MCP server), and the anon key that used to sit in `app.js`.

### Live data (38 locations, migrated intact)

Project **"Untitled film"** — 28 idea · 2 scouting · 1 confirmed · 7 shot. Seven have shoot dates,
seven carry drone footage notes, three have contacts, one has an interview.

Beyond the five originally-documented pins (Guild Park, UTSC quad, Cathedral Bluffs, STC atrium,
plus West Rouge Beach) the set now spans the Bluffs waterfront, drone plates across mid-Scarborough,
food/retail spots (Dragon Centre, Perfect Chinese, Ital Vital, Bodega by City Cottage, Fresh Roti),
institutions (Scarborough Museum, Civic Centre, Cedarbrae CI, Momiji, Church of Holy Wisdom) and
parks (Morningside, Thompson, Rosetta McClain, Glen Rouge, Kidstown).

Don't re-seed or "restore" anything — this is Prem's real working set. `⭳ JSON` in the app footer
is the backup button.

## Open data licences (keep attributions)

- **OpenStreetMap** base tiles — ODbL
- **City of Toronto Open Data → Neighbourhoods** — Open Government Licence – Toronto

## Conventions

- Keep it dependency-light and framework-free unless there's a strong reason. There is currently
  **zero** npm dependency — the backend and `tools/*.mjs` both use plain `fetch` against Neon's
  SQL-over-HTTP endpoint rather than `@neondatabase/serverless`. Adding a bundler to this repo
  should be a deliberate decision, not a side effect of reaching for a driver.
- **Never commit a connection string.** `.neon` and `.dev.vars` are gitignored; production reads a
  Pages secret. If one leaks, rotate it: `npx neonctl roles reset-password neondb_owner …`.
- `.claude/` is gitignored (local workspace config). `.agents/` is gitignored (re-installable from
  `skills-lock.json`: `npx skills add neondatabase/agent-skills`). The lockfile still lists the
  Supabase skills from the old backend — harmless, and safe to drop whenever.
- The 2 MB `toronto-neighbourhoods.geojson` source is gitignored (re-downloadable per README).
- Verify UI changes with preview tools before calling done.
