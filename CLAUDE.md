# CLAUDE.md — Scarborough Film Map

Project instructions for Claude Code. Read this first when working in this repo.

## What this is

A web app that organises a **documentary about Scarborough** around a map. Locations are the
spine of the project: each pin anchors footage, interviews, contacts and logistics, is
auto-tagged to its Scarborough neighbourhood, and can be batched into an efficient **shoot day**
by proximity. The data is meant to be reused later — to query while writing the script, and to
feed a public website.

Owner: Prem (documentary filmmaker). Single-user for now; a crew-sharing mode is possible later.

## Status (as of 2026-06-24)

Working **client-side prototype (v2)**, committed and pushed. Everything runs from
`localStorage` — no backend yet. **Next planned step: wire in Supabase + PostGIS** (see below).

- Repo: `landedimmigrant-ops/scarborough-film-map` (private, GitHub, SSH remote)
- This folder is its own standalone project (it used to live inside `Dev/tasks home/` next to an
  unrelated House Chores app — it was moved out and separated on 2026-06-24).

## Run / verify

```bash
python3 -m http.server 8138      # from this folder → http://localhost:8138
```
No build step, no dependencies installed — Leaflet 1.9.4 loads from a CDN. There's a
`.claude/launch.json` (server name `scarborough-film-map`, port 8138) so `preview_start` works.

## Architecture

Vanilla JS + Leaflet. No framework, no bundler. Files:

- `index.html` — sidebar + map + two slide-over panels (location editor, shoot-day planner).
- `app.js` — all logic (~single file, sectioned with comments).
- `styles.css` — dark theme, responsive (mobile breakpoint at 720px).
- `data/scarborough.geojson` — the 30 Scarborough neighbourhood polygons (WGS84) + centroids.
  Derived from `data/toronto-neighbourhoods.geojson` (the full 158, **gitignored**, re-downloadable).

Key seams in `app.js`:
- `loadDB()` / `save()` — **the only storage functions.** Swap these for Supabase; nothing else
  changes. Storage key `scarborough_shoots_v2` (auto-migrates the older `_v1` array).
- `findHood(lat,lng)` — ray-casting point-in-polygon → neighbourhood name.
- `distKm()` + the planner — haversine "nearby" search (becomes PostGIS `ST_DWithin` server-side).

## Data model

See README.md for the full shape. In short: `db = { projects[], activeProjectId, locations[] }`,
where each location has logistics (status/category/shootDate/bestTime/parking/permit), plus
`contacts[]`, `interviews[]`, `footage[]`, `photos[]`, `notes`, and `lat`/`lng`.

## Open data (already wired in)

- **OpenStreetMap** base tiles — ODbL.
- **City of Toronto Open Data → Neighbourhoods** — Open Government Licence – Toronto.
- Keep the attributions intact.

## Next step: Supabase + PostGIS

The README has the exact SQL schema (`projects`, `locations` with a `geography(point,4326)` geom,
child tables for interviews/contacts/media) and the one-line `ST_DWithin` shoot-day query. Plan:
1. Create the Supabase project + run the schema (enable `postgis`).
2. Replace `loadDB()`/`save()` with Supabase client calls; keep the same in-memory `db` shape.
3. Single-user, no auth to start (add Auth + RLS only if crew-sharing is wanted).
4. Then: offline PWA, photo upload to Supabase Storage, public-website export.

Mirrors the Supabase PWA approach Prem used on the (separate) House Chores app.

## Conventions

- Keep it dependency-light and framework-free unless there's a strong reason.
- Commit messages: short imperative subject; end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `.claude/` is gitignored (local workspace config). Don't commit the 2 MB source geojson.
- Verify UI changes with the preview tools (start server, screenshot) before calling done.
