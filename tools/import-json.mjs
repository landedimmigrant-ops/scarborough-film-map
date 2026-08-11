#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   tools/import-json.mjs — load locations into Neon from a JSON file
   ──────────────────────────────────────────────────────────────
   Written for the Supabase→Neon migration (2026-08-11): the Supabase
   project was unreachable when the schema moved, so this is the path
   back in for data that surfaces later.

   Accepts three shapes, auto-detected:
     1. The app's own ⭳ JSON export      { project: {...}, locations: [...] }
     2. A Supabase / API dump            { projects: [...], locations: [...],
                                           interviews: [...], contacts: [...], media: [...] }
        (snake_case rows straight from PostgREST or GET /api/db — child rows
         get joined back onto their location by location_id)
     3. A bare array of locations        [ {...}, {...} ]

   Field names are read in both camelCase and snake_case, so an export from
   the app and a raw row dump both work without pre-processing.

   Usage
     node tools/import-json.mjs my-film.json            # import
     node tools/import-json.mjs my-film.json --dry      # show what would happen
     node tools/import-json.mjs my-film.json --project "Scarborough doc"

   Re-running is safe: a location already present in the target project with
   the same title AND effectively the same coordinates (within ~1 m) is
   skipped rather than duplicated.
══════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { query } from './neon.mjs';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const pIdx = argv.indexOf('--project');
const projectOverride = pIdx !== -1 ? argv[pIdx + 1] : null;
const path = argv.find((a) => !a.startsWith('--') && a !== projectOverride);

if (!path) {
  console.error('usage: node tools/import-json.mjs <file.json> [--project "Name"] [--dry]');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(path, 'utf8'));

/* ---------- normalise the three input shapes to one ---------- */

// Read a field under either spelling. Locations arrive as app objects
// (shootDate) or as database rows (shoot_date); neither is more correct.
const pick = (o, ...names) => {
  for (const n of names) if (o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n];
  return null;
};

function normaliseLoc(l, children) {
  const lat = Number(pick(l, 'lat', 'latitude'));
  const lng = Number(pick(l, 'lng', 'lon', 'longitude'));
  return {
    title: pick(l, 'title') || 'Untitled',
    neighbourhood: pick(l, 'neighbourhood'),
    status: pick(l, 'status') || 'idea',
    category: pick(l, 'category'),
    shootDate: pick(l, 'shootDate', 'shoot_date'),
    bestTime: pick(l, 'bestTime', 'best_time'),
    parking: pick(l, 'parking'),
    permit: pick(l, 'permit') || 'n/a',
    notes: pick(l, 'notes'),
    address: pick(l, 'address'),
    lat, lng,
    contacts: (l.contacts || children.contacts || []).map((c) => ({
      name: pick(c, 'name'), role: pick(c, 'role'), detail: pick(c, 'detail'),
    })),
    interviews: (l.interviews || children.interviews || []).map((i) => ({
      subject: pick(i, 'subject'), role: pick(i, 'role'), status: pick(i, 'status') || 'idea',
    })),
    // Footage/photos live in one `media` table but are separate arrays in the app.
    footage: (l.footage || children.footage || []).map((f) => ({
      label: pick(f, 'label'), notes: pick(f, 'notes'),
    })),
    photos: (l.photos || children.photos || []).map((p) => (typeof p === 'string' ? p : pick(p, 'url'))).filter(Boolean),
  };
}

function parse(input) {
  if (Array.isArray(input)) return { projectName: projectOverride || 'Imported', locations: input.map((l) => normaliseLoc(l, {})) };

  // Shape 2 — row dump with separate child arrays to join by location_id.
  if (Array.isArray(input.locations) && (input.interviews || input.contacts || input.media)) {
    const byId = (rows, lid) => (rows || []).filter((r) => (r.location_id || r.locationId) === lid);
    const projectName = projectOverride
      || (input.projects && input.projects[0] && input.projects[0].name)
      || 'Imported';
    return {
      projectName,
      locations: input.locations.map((l) => {
        const media = byId(input.media, l.id);
        return normaliseLoc(l, {
          interviews: byId(input.interviews, l.id),
          contacts: byId(input.contacts, l.id),
          footage: media.filter((m) => m.kind === 'footage'),
          photos: media.filter((m) => m.kind === 'photo'),
        });
      }),
    };
  }

  // Shape 1 — the app's export: locations already carry their children.
  if (Array.isArray(input.locations)) {
    const projectName = projectOverride
      || (input.project && input.project.name)
      || (input.projects && input.projects[0] && input.projects[0].name)
      || 'Imported';
    return { projectName, locations: input.locations.map((l) => normaliseLoc(l, {})) };
  }

  throw new Error('unrecognised JSON: expected { project, locations }, { projects, locations, … } or [ … ]');
}

const { projectName, locations } = parse(raw);

const bad = locations.filter((l) => !Number.isFinite(l.lat) || !Number.isFinite(l.lng));
if (bad.length) {
  // A location with no coordinates has nothing to pin, and the whole app is the
  // map — better to stop and let the file be fixed than to invent a position.
  console.error(`✗ ${bad.length} location(s) have no usable lat/lng: ${bad.map((b) => b.title).join(', ')}`);
  process.exit(1);
}

const deadPhotos = locations.flatMap((l) => l.photos).filter((u) => /supabase\.co/.test(u));

console.log(`Project : ${projectName}`);
console.log(`Loading : ${locations.length} location(s) from ${path}`);
if (deadPhotos.length) {
  console.log(`Note    : ${deadPhotos.length} photo URL(s) point at the retired Supabase bucket and will not load.`);
  console.log(`          They're imported anyway as a record of what was there — re-upload with 📤 Upload.`);
}
if (dry) {
  locations.forEach((l) => console.log(`  · ${l.title} (${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}) ${l.status}` +
    ` [${l.contacts.length}c ${l.interviews.length}i ${l.footage.length}f ${l.photos.length}p]`));
  console.log('\n--dry: nothing written.');
  process.exit(0);
}

/* ---------- write ---------- */

// Reuse a same-named project rather than making a second one on every re-run.
let [proj] = await query('select id from projects where name = $1 order by created_at limit 1', [projectName]);
if (!proj) {
  [proj] = await query('insert into projects (name) values ($1) returning id', [projectName]);
  console.log(`✓ created project ${projectName}`);
}

let added = 0, skipped = 0;
for (const l of locations) {
  // ST_DWithin on the geography column: "same spot" means within a metre, which
  // is tighter than any real pin nudge but immune to float round-tripping.
  const dupe = await query(
    `select id from locations
      where project_id = $1 and title = $2
        and st_dwithin(geom, st_setsrid(st_makepoint($3, $4), 4326)::geography, 1)
      limit 1`,
    [proj.id, l.title, l.lng, l.lat]);
  if (dupe.length) { skipped++; continue; }

  const [row] = await query(
    `insert into locations (project_id, title, neighbourhood, status, category, shoot_date,
                            best_time, parking, permit, notes, address, geom)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, st_setsrid(st_makepoint($12,$13),4326)::geography)
     returning id`,
    [proj.id, l.title, l.neighbourhood, l.status, l.category, l.shootDate,
      l.bestTime, l.parking, l.permit, l.notes, l.address, l.lng, l.lat]);

  for (const [i, c] of l.contacts.entries()) {
    await query('insert into contacts (location_id, name, role, detail, position) values ($1,$2,$3,$4,$5)',
      [row.id, c.name, c.role, c.detail, i]);
  }
  for (const [i, iv] of l.interviews.entries()) {
    await query('insert into interviews (location_id, subject, role, status, position) values ($1,$2,$3,$4,$5)',
      [row.id, iv.subject, iv.role, iv.status, i]);
  }
  for (const [i, f] of l.footage.entries()) {
    await query('insert into media (location_id, kind, label, notes, position) values ($1,\'footage\',$2,$3,$4)',
      [row.id, f.label, f.notes, i]);
  }
  for (const [i, u] of l.photos.entries()) {
    await query('insert into media (location_id, kind, url, position) values ($1,\'photo\',$2,$3)', [row.id, u, i]);
  }

  added++;
  console.log(`  + ${l.title}`);
}

console.log(`\n✓ imported ${added} location(s)${skipped ? `, skipped ${skipped} already present` : ''}.`);
