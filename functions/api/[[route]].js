/* ══════════════════════════════════════════════════════════════
   /api/* — the app's whole backend, one Cloudflare Pages Function
   ──────────────────────────────────────────────────────────────
   WHY THIS EXISTS (the Supabase→Neon migration, 2026-08-11):
   The Supabase project slept on free-tier idle timeout and took the
   app's data with it. Neon doesn't idle-delete, but a browser can't
   speak Postgres — so reads and writes come through here.

   Two things live behind this boundary that the browser used to hold
   itself: the database credential (NEON_DATABASE_URL, a Pages secret)
   and the photo bucket (R2 binding PHOTOS). That's why the schema has
   no RLS: under Supabase the client shipped a public anon key, so
   every table needed an allow-all policy; here the client ships
   nothing and this function is the trust boundary.

   Talks to Neon over SQL-over-HTTP with plain fetch — no npm, no
   bundler, matching the project's no-build-step rule. Single query:
   POST {query, params} → {rows}. Transaction: POST {queries:[…]} →
   {results:[…]}, all-or-nothing, which is what makes saveLocation's
   delete-then-reinsert of child rows safe.

   Routes
     GET    /api/db                 full snapshot (projects + locations + children)
     POST   /api/locations          create or update one location (+ its children)
     DELETE /api/locations/<id>     delete (children cascade)
     POST   /api/projects           { name } → new project
     PATCH  /api/projects/<id>      { name } → rename
     POST   /api/photo?project=<id> raw image body → { url: "/api/photo/<key>" }
     GET    /api/photo/<key>        serve from R2 (immutable, keys are uuids)

   Posture: this API is unauthenticated, exactly like the public anon
   key it replaces — anyone who finds the Pages URL can read and write.
   Gate it with Cloudflare Access (Zero Trust, free tier) if that ever
   stops being acceptable.
══════════════════════════════════════════════════════════════ */

/* ---------- Neon SQL-over-HTTP (mirrors tools/neon.mjs) ---------- */

function endpoint(cs) {
  // The HTTP endpoint lives on the compute host, never the pooler host.
  return `https://${new URL(cs).hostname.replace('-pooler', '')}/sql`;
}

async function neon(cs, body) {
  const res = await fetch(endpoint(cs), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': cs },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`neon ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (json.error) throw new Error(`neon sql: ${json.error}`);
  return json;
}

const one = (cs, query, params = []) => neon(cs, { query, params }).then((j) => j.rows || []);
// All-or-nothing batch. `queries` are {query, params}; returns an array of row-arrays.
const tx = (cs, queries) => neon(cs, { queries }).then((j) => (j.results || []).map((r) => r.rows || []));

/* Neon's HTTP layer returns a timestamptz in Postgres' own text form —
   "2026-08-11 23:31:10.910294+00", with a space and no T. Chrome's Date parser
   accepts it; Safari's returns Invalid Date, which on an iPhone would quietly
   turn every createdAt into NaN (the planner's "most recently added" default
   sorts on it). So every timestamp leaves here as strict ISO-8601 UTC. */
const ISO = (col) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/* Build a multi-row INSERT with numbered params, e.g.
   values ($1,$2),($3,$4) — one statement instead of N round trips. */
function bulkInsert(table, cols, rows) {
  const params = [];
  const tuples = rows.map((row) => {
    const slots = cols.map((c) => { params.push(row[c] ?? null); return `$${params.length}`; });
    return `(${slots.join(',')})`;
  });
  return { query: `insert into ${table} (${cols.join(',')}) values ${tuples.join(',')}`, params };
}

/* ---------- helpers ---------- */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const fail = (message, status = 500) => json({ error: message }, status);

// '' and undefined both mean "no value" coming from the editor's text inputs.
const nz = (v) => (v === '' || v === undefined ? null : v);

/* ---------- GET /api/db ---------- */

// Named columns rather than `select *` so adding a column to locations_view can't
// silently change this payload's shape.
const LOCATION_COLS = `id, project_id, title, neighbourhood, status, category, shoot_date,
  best_time, parking, permit, notes, address, lat, lng, ${ISO('created_at')} as created_at`;

async function getSnapshot(cs) {
  let projects = await one(cs, `select id, name, ${ISO('created_at')} as created_at from projects order by created_at`);

  // First run on a fresh database — same behaviour the old loadDB() had.
  if (!projects.length) {
    projects = await one(cs,
      `insert into projects (name) values ('Untitled film') returning id, name, ${ISO('created_at')} as created_at`);
    return { projects, locations: [], interviews: [], contacts: [], media: [] };
  }

  const [locations, interviews, contacts, media] = await tx(cs, [
    { query: `select ${LOCATION_COLS} from locations_view order by created_at`, params: [] },
    { query: 'select id, location_id, subject, role, status from interviews order by position, id', params: [] },
    { query: 'select id, location_id, name, role, detail from contacts order by position, id', params: [] },
    { query: 'select id, location_id, kind, label, url, notes from media order by position, id', params: [] },
  ]);

  return { projects, locations, interviews, contacts, media };
}

/* ---------- POST /api/locations ---------- */

async function saveLocation(cs, loc) {
  if (!loc || typeof loc.title !== 'string') return fail('location needs a title', 400);
  const lat = Number(loc.lat), lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail('location needs finite lat/lng', 400);

  const cols = ['project_id', 'title', 'neighbourhood', 'status', 'category', 'shoot_date',
    'best_time', 'parking', 'permit', 'notes', 'address'];
  const vals = [
    nz(loc.projectId), loc.title, nz(loc.neighbourhood), loc.status || 'idea', nz(loc.category),
    nz(loc.shootDate), nz(loc.bestTime), nz(loc.parking), loc.permit || 'n/a', nz(loc.notes), nz(loc.address),
  ];
  // ST_MakePoint keeps the coordinates as bound params rather than string-built
  // WKT, so a hostile value can't reach the SQL text.
  const geom = `st_setsrid(st_makepoint($${vals.length + 1}, $${vals.length + 2}), 4326)::geography`;

  // The id is generated HERE, not by the database, so the child-row inserts in
  // the same transaction can reference it (a batch can't read statement 1's
  // output). A retried request with the same id is a harmless no-op update.
  const isNew = !loc.id;
  const locId = loc.id || crypto.randomUUID();

  const upsert = isNew
    ? {
        query: `insert into locations (id, ${cols.join(', ')}, geom)
                values ($${vals.length + 3}, ${cols.map((_, i) => `$${i + 1}`).join(', ')}, ${geom})
                returning id, ${ISO('created_at')} as created_at`,
        params: [...vals, lng, lat, locId],
      }
    : {
        query: `update locations set ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, geom = ${geom}
                where id = $${vals.length + 3}
                returning id, ${ISO('created_at')} as created_at`,
        params: [...vals, lng, lat, locId],
      };

  const queries = [
    upsert,
    { query: 'delete from interviews where location_id = $1', params: [locId] },
    { query: 'delete from contacts where location_id = $1', params: [locId] },
    { query: 'delete from media where location_id = $1', params: [locId] },
  ];

  const contacts = (loc.contacts || []).map((c, i) =>
    ({ location_id: locId, name: nz(c.name), role: nz(c.role), detail: nz(c.detail), position: i }));
  if (contacts.length) queries.push(bulkInsert('contacts', ['location_id', 'name', 'role', 'detail', 'position'], contacts));

  const interviews = (loc.interviews || []).map((iv, i) =>
    ({ location_id: locId, subject: nz(iv.subject), role: nz(iv.role), status: iv.status || 'idea', position: i }));
  if (interviews.length) queries.push(bulkInsert('interviews', ['location_id', 'subject', 'role', 'status', 'position'], interviews));

  const media = [];
  (loc.footage || []).forEach((f, i) =>
    media.push({ location_id: locId, kind: 'footage', label: nz(f.label), url: null, notes: nz(f.notes), position: i }));
  (loc.photos || []).filter(Boolean).forEach((url, i) =>
    media.push({ location_id: locId, kind: 'photo', label: null, url, notes: null, position: i }));
  if (media.length) queries.push(bulkInsert('media', ['location_id', 'kind', 'label', 'url', 'notes', 'position'], media));

  const results = await tx(cs, queries);
  const row = results[0] && results[0][0];
  // An update that matched nothing means the row was deleted elsewhere — say so
  // rather than reporting a save the database didn't make.
  if (!row) return fail('location not found', 404);
  return json({ id: row.id, createdAt: row.created_at });
}

/* ---------- photos (R2) ---------- */

async function putPhoto(env, request, url) {
  if (!env.PHOTOS) return fail('photo storage is not configured (missing R2 binding PHOTOS)', 503);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return fail('empty upload', 400);
  if (bytes.byteLength > 12 * 1024 * 1024) return fail('photo too large (12 MB max)', 413);

  const type = request.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) return fail('only images can be uploaded', 415);
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';

  // Path segment comes from our own project uuid; keep it to uuid characters so
  // a crafted ?project= can't walk the key namespace.
  const project = (url.searchParams.get('project') || 'no-project').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'no-project';
  const key = `${project}/${crypto.randomUUID()}.${ext}`;

  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  return json({ url: `/api/photo/${key}` });
}

async function getPhoto(env, key) {
  if (!env.PHOTOS) return fail('photo storage is not configured', 503);
  const obj = await env.PHOTOS.get(key);
  if (!obj) return fail('photo not found', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // Keys are uuids, so a given key's bytes never change.
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}

/* ---------- router ---------- */

export async function onRequest({ request, env, params }) {
  const segs = (Array.isArray(params.route) ? params.route : [params.route]).filter(Boolean);
  const url = new URL(request.url);
  const head = segs[0] || '';
  const method = request.method;

  // Photos are served from R2 and need no database credential — handle them
  // before the NEON_DATABASE_URL check so a misconfigured DB doesn't blank
  // every image on the page.
  if (head === 'photo') {
    // HEAD is answered like GET (the runtime drops the body): caches, link
    // previews and `curl -I` all probe with it, and 405-ing them makes an image
    // that works look broken.
    if (method === 'GET' || method === 'HEAD') {
      const key = segs.slice(1).join('/');
      if (!key) return fail('photo key required', 400);
      return getPhoto(env, key);
    }
    if (method === 'POST') return putPhoto(env, request, url);
    return fail(`method ${method} not allowed on /api/photo`, 405);
  }

  const cs = env.NEON_DATABASE_URL;
  if (!cs) {
    return fail('NEON_DATABASE_URL is not set. Locally: put it in .dev.vars. ' +
      'In production: npx wrangler pages secret put NEON_DATABASE_URL --project-name scarborough-film-map', 503);
  }

  try {
    if (head === 'db' && method === 'GET') return json(await getSnapshot(cs));

    if (head === 'locations') {
      if (method === 'POST') return saveLocation(cs, await request.json());
      if (method === 'DELETE') {
        const id = segs[1];
        if (!id) return fail('location id required', 400);
        const rows = await one(cs, 'delete from locations where id = $1 returning id', [id]);
        if (!rows.length) return fail('location not found', 404);
        return json({ ok: true });
      }
      return fail(`method ${method} not allowed on /api/locations`, 405);
    }

    if (head === 'projects') {
      if (method === 'POST') {
        const { name } = await request.json();
        if (!name || typeof name !== 'string') return fail('project needs a name', 400);
        const rows = await one(cs, `insert into projects (name) values ($1) returning id, name, ${ISO('created_at')} as created_at`, [name]);
        return json(rows[0]);
      }
      if (method === 'PATCH') {
        const id = segs[1];
        const { name } = await request.json();
        if (!id || !name) return fail('project id and name required', 400);
        const rows = await one(cs, 'update projects set name = $1 where id = $2 returning id', [name, id]);
        if (!rows.length) return fail('project not found', 404);
        return json({ ok: true });
      }
      return fail(`method ${method} not allowed on /api/projects`, 405);
    }

    return fail(`no such route: /api/${segs.join('/')}`, 404);
  } catch (e) {
    // The message can carry SQL text but never the connection string (neon()
    // only ever puts it in a header), so it's safe to hand back — and this is
    // a single-user app where a real error beats a generic 500.
    console.error('api error', e);
    return fail(e.message || 'unknown error', 500);
  }
}
