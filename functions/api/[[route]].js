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
     GET    /api/db                 full snapshot (projects + locations + children
                                    + ideas + shoot days + stops + contributors)
     POST   /api/locations          create or update one location (+ its children)
     DELETE /api/locations/<id>     delete (children cascade)
     POST   /api/ideas              create or update one idea (link/note/image);
                                    fetches the <title> of a bare pasted link
     DELETE /api/ideas/<id>         delete
     POST   /api/days               create or update one shoot day + its ordered stops
     DELETE /api/days/<id>          delete (stops cascade)
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
// silently change this payload's shape. The cost of that safety is that adding a
// column to the view is TWO edits — the view in schema.sql and this list. Forget
// the second and the field is simply absent from the app with no error anywhere.
const LOCATION_COLS = `id, project_id, title, neighbourhood, status, category, shoot_date,
  best_time, parking, permit, notes, address, contributor_id, lat, lng,
  ${ISO('created_at')} as created_at`;

async function getSnapshot(cs) {
  let projects = await one(cs, `select id, name, ${ISO('created_at')} as created_at from projects order by created_at`);

  // First run on a fresh database — same behaviour the old loadDB() had.
  if (!projects.length) {
    projects = await one(cs,
      `insert into projects (name) values ('Untitled film') returning id, name, ${ISO('created_at')} as created_at`);
    return { projects, locations: [], interviews: [], contacts: [], media: [] };
  }

  const [locations, interviews, contacts, media, contributors, ideas, shootDays, shootDayStops] = await tx(cs, [
    { query: `select ${LOCATION_COLS} from locations_view order by created_at`, params: [] },
    { query: 'select id, location_id, subject, role, status from interviews order by position, id', params: [] },
    { query: 'select id, location_id, name, role, detail from contacts order by position, id', params: [] },
    { query: 'select id, location_id, kind, label, url, notes from media order by position, id', params: [] },
    // Contributors ride along so a location can display WHO suggested it —
    // the question that prompted this whole feature ("38 pins, no idea who
    // put them in"). Small table, one extra statement in a batch already
    // being sent.
    { query: 'select id, name, email, credit_name, credit_consent from contributors', params: [] },
    { query: `select id, project_id, kind, title, body, url, location_id, status,
                     ${ISO('created_at')} as created_at
                from ideas order by created_at desc`, params: [] },
    // date is a DATE column: Neon's HTTP layer hands it over as plain
    // 'YYYY-MM-DD' (verified), which every browser parses fine as a string —
    // only timestamptz needs the ISO() treatment.
    { query: `select id, project_id, title, date, notes, ${ISO('created_at')} as created_at
                from shoot_days order by date nulls last, created_at`, params: [] },
    { query: 'select id, day_id, location_id, position, planned_time, note from shoot_day_stops order by day_id, position, id', params: [] },
  ]);

  return { projects, locations, interviews, contacts, media, contributors, ideas, shootDays, shootDayStops };
}

/* ---------- POST /api/ideas ---------- */

/* Best-effort <title> fetch for a pasted link, so the card can say
   "Dragon Centre demolition coverage — blogTO" instead of a bare URL.
   Owner-only route; hard 4 s timeout; reads at most 64 KB of the body.
   Every failure path returns null — a title is a nicety, never a blocker. */
async function fetchLinkTitle(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    let res;
    try {
      res = await fetch(u.toString(), {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'Accept': 'text/html', 'User-Agent': 'ScarboroughFilmMap/1.0 (link titles)' },
      });
    } finally { clearTimeout(t); }
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    while (html.length < 65536) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/title>/i.test(html)) break;
    }
    try { await reader.cancel(); } catch (e) { /* stream already done */ }
    const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (!m) return null;
    const title = m[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
      .replace(/\s+/g, ' ').trim();
    return title.slice(0, 300) || null;
  } catch (e) { return null; }
}

async function saveIdea(cs, idea) {
  if (!idea || typeof idea !== 'object') return fail('idea payload required', 400);
  const kind = ['note', 'link', 'image'].includes(idea.kind) ? idea.kind : 'note';
  const status = idea.status === 'archived' ? 'archived' : 'inbox';
  let title = clean(idea.title, 300);
  const body = typeof idea.body === 'string' ? idea.body.trim().slice(0, 4000) || null : null;
  const url = clean(idea.url, 2000);
  if (kind !== 'note' && !url) return fail(`a ${kind} idea needs a url`, 400);
  if (kind === 'note' && !body && !title) return fail('a note needs some text', 400);

  // A pasted link with no title yet: go get one. Only on create-shaped saves
  // (no title), so editing a card never overwrites what Prem typed.
  if (kind === 'link' && !title && url) title = await fetchLinkTitle(url);

  const isNew = !idea.id;
  const ideaId = idea.id || crypto.randomUUID();
  const params = [nz(idea.projectId), kind, title, body, url, nz(idea.locationId), status, ideaId];
  const rows = isNew
    ? await one(cs,
      `insert into ideas (project_id, kind, title, body, url, location_id, status, id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, title, ${ISO('created_at')} as created_at`, params)
    : await one(cs,
      `update ideas set project_id = $1, kind = $2, title = $3, body = $4, url = $5,
              location_id = $6, status = $7
        where id = $8
        returning id, title, ${ISO('created_at')} as created_at`, params);
  if (!rows.length) return fail('idea not found', 404);
  return json({ id: rows[0].id, title: rows[0].title, createdAt: rows[0].created_at });
}

/* ---------- POST /api/days ---------- */

async function saveDay(cs, day) {
  if (!day || typeof day !== 'object') return fail('day payload required', 400);
  const title = clean(day.title, 200) || 'Untitled day';
  const date = typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? day.date : null;
  const notes = typeof day.notes === 'string' ? day.notes.trim().slice(0, 4000) || null : null;
  const stops = (Array.isArray(day.stops) ? day.stops : [])
    .filter((s) => s && typeof s.locationId === 'string' && s.locationId)
    .slice(0, 60);

  const isNew = !day.id;
  const dayId = day.id || crypto.randomUUID();

  const upsert = isNew
    ? {
        query: `insert into shoot_days (id, project_id, title, date, notes)
                values ($1, $2, $3, $4, $5)
                returning id, ${ISO('created_at')} as created_at`,
        params: [dayId, nz(day.projectId), title, date, notes],
      }
    : {
        query: `update shoot_days set project_id = $2, title = $3, date = $4, notes = $5
                 where id = $1
                returning id, ${ISO('created_at')} as created_at`,
        params: [dayId, nz(day.projectId), title, date, notes],
      };

  // Same shape as saveLocation: parent upsert + wholesale child rewrite,
  // one transaction, id minted here so the stop inserts can reference it.
  const queries = [upsert, { query: 'delete from shoot_day_stops where day_id = $1', params: [dayId] }];
  const stopRows = stops.map((s, i) => ({
    day_id: dayId,
    location_id: s.locationId,
    position: i,
    planned_time: clean(s.plannedTime, 40),
    note: clean(s.note, 1000),
  }));
  if (stopRows.length) {
    queries.push(bulkInsert('shoot_day_stops', ['day_id', 'location_id', 'position', 'planned_time', 'note'], stopRows));
  }

  const results = await tx(cs, queries);
  const row = results[0] && results[0][0];
  if (!row) return fail('shoot day not found', 404);
  return json({ id: row.id, createdAt: row.created_at });
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

/* ---------- owner gate ----------
   Cloudflare Access is the real lock: it sits in front of this Function and
   never forwards an unauthenticated request to an owner path at all. This is a
   SECOND line of defence for one specific failure mode — an Access policy that
   is missing, disabled, or whose Bypass rule is scoped too broadly. If Access
   ever stops covering /api/*, requests start arriving without the header it
   injects, and these routes fail closed instead of silently serving Prem's data
   to the internet.

   Be clear about the limit: with no Access in front, a client can simply send
   the header itself, so this check alone is NOT authentication. It only has
   teeth downstream of Access (which strips inbound Cf-Access-* headers and sets
   its own). Treat it as a tripwire, not the lock.

   Unset OWNER_EMAIL leaves the API open, which is the posture the app has had
   all along — so nothing breaks before Access is configured. Set it in the same
   breath as turning Access on:
     npx wrangler pages secret put OWNER_EMAIL --project-name scarborough-film-map */
function ownerGate(env, request) {
  const expected = (env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!expected) return null;   // not configured yet → behave as before

  const seen = (request.headers.get('Cf-Access-Authenticated-User-Email') || '').trim().toLowerCase();
  if (!seen) {
    return fail('This is the private side of the app and it is not signed in. ' +
      'Expected a Cloudflare Access session.', 401);
  }
  if (seen !== expected) return fail(`${seen} is not allowed here.`, 403);
  return null;
}

/* ---------- public suggestions (the ONLY unauthenticated write) ----------
   Everything in this block is reachable by anyone with the /suggest link, so it
   is written defensively: bounded field lengths, a coordinate bounding box, and
   a per-email rate cap. It can only ever insert into `contributors` and
   `suggestions` — never `locations` — so the worst case is a queue Prem has to
   clear, not damage to the 38 curated pins. */

// Greater Scarborough plus a generous margin. A suggestion outside this is
// either a mis-click or someone poking the endpoint; neither belongs in the queue.
const BBOX = { minLat: 43.55, maxLat: 44.00, minLng: -79.45, maxLng: -78.95 };

// Trim, collapse whitespace, cap length. Returns null for empty so the column
// stays NULL rather than storing ''.
function clean(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}

async function postSuggestion(cs, body) {
  const title = clean(body.title, 160);
  const name = clean(body.name, 120);
  if (!title) return fail('Please give the place a name.', 400);
  if (!name) return fail('Please tell us who you are, so we can credit you.', 400);

  const lat = Number(body.lat), lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail('Please pick the spot on the map.', 400);
  if (lat < BBOX.minLat || lat > BBOX.maxLat || lng < BBOX.minLng || lng > BBOX.maxLng) {
    return fail('That spot is outside the Scarborough area this film covers.', 400);
  }

  const email = clean(body.email, 200);
  // Deliberately loose: one @ with something either side. Anything stricter
  // rejects real addresses, and this field is for Prem to reply to, not to
  // authenticate anyone.
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('That email address looks incomplete.', 400);

  const note = clean(body.note, 2000);
  const creditName = clean(body.creditName, 120);
  const creditConsent = body.creditConsent === true;

  // Rate cap. Keyed on email when given, otherwise on the whole pending queue
  // depth, which is crude but prevents an anonymous flood from being unbounded.
  if (email) {
    const [{ n }] = await one(cs,
      `select count(*)::int as n from suggestions s join contributors c on c.id = s.contributor_id
        where lower(c.email) = lower($1) and s.created_at > now() - interval '1 hour'`, [email]);
    if (n >= 10) return fail('That is a lot of suggestions in one hour — thank you! Try again a little later.', 429);
  } else {
    const [{ n }] = await one(cs,
      `select count(*)::int as n from suggestions
        where status = 'pending' and contributor_id is null and created_at > now() - interval '1 hour'`);
    if (n >= 20) return fail('We are getting a lot of suggestions right now — please try again shortly.', 429);
  }

  // Upsert the contributor by email so one person suggesting five places earns
  // one credit. COALESCE on update: a later blank submission must not wipe
  // details they gave earlier. Consent is OR-ed — never revoked by omission
  // here, but see the note below.
  let contributorId = null;
  if (email) {
    const rows = await one(cs,
      // `where email is not null` repeats contributors_email_key's predicate.
      // Postgres cannot infer a PARTIAL unique index from the columns alone —
      // without it this fails with 'no unique or exclusion constraint matching
      // the ON CONFLICT specification'.
      `insert into contributors (name, email, credit_name, credit_consent)
       values ($1, $2, $3, $4)
       on conflict (lower(email)) where email is not null do update set
         name           = coalesce(excluded.name, contributors.name),
         credit_name    = coalesce(excluded.credit_name, contributors.credit_name),
         -- Consent is taken from THIS submission rather than OR-ed with history:
         -- if someone ticks the box once and leaves it unticked later, honouring
         -- the newer answer is the safer reading of what they want.
         credit_consent = excluded.credit_consent
       returning id`,
      [name, email, creditName, creditConsent]);
    contributorId = rows[0].id;
  } else {
    const rows = await one(cs,
      'insert into contributors (name, credit_name, credit_consent) values ($1, $2, $3) returning id',
      [name, creditName, creditConsent]);
    contributorId = rows[0].id;
  }

  // Attach to the one project. The public form deliberately doesn't let the
  // caller choose a project_id — that would be an information leak and a way to
  // scribble into an unrelated film.
  const [proj] = await one(cs, 'select id from projects order by created_at limit 1');

  const rows = await one(cs,
    `insert into suggestions (project_id, contributor_id, title, note, geom)
     values ($1, $2, $3, $4, st_setsrid(st_makepoint($5, $6), 4326)::geography)
     returning id`,
    [proj ? proj.id : null, contributorId, title, note, lng, lat]);

  return json({ ok: true, id: rows[0].id });
}

/* ---------- owner: review queue + credits ---------- */

async function listSuggestions(cs) {
  const rows = await one(cs,
    `select id, title, note, neighbourhood, address, status, location_id, lat, lng,
            contributor_id, contributor_name, contributor_email, contributor_phone,
            credit_name, credit_consent,
            ${ISO('created_at')} as created_at, ${ISO('reviewed_at')} as reviewed_at
       from suggestions_view
      order by (status = 'pending') desc, created_at desc`);
  return json({ suggestions: rows });
}

async function reviewSuggestion(cs, id, action) {
  if (action !== 'accept' && action !== 'decline') return fail(`unknown action ${action}`, 400);

  const [s] = await one(cs,
    `select id, project_id, contributor_id, title, note, neighbourhood, address, status,
            st_y(geom::geometry) as lat, st_x(geom::geometry) as lng
       from suggestions where id = $1`, [id]);
  if (!s) return fail('suggestion not found', 404);
  // Guard against a double-accept from a stale queue in another tab.
  if (s.status !== 'pending') return fail(`that suggestion was already ${s.status}`, 409);

  if (action === 'decline') {
    await one(cs, "update suggestions set status = 'declined', reviewed_at = now() where id = $1", [id]);
    return json({ ok: true, status: 'declined' });
  }

  // Accept: copy into `locations`, carrying attribution, then mark reviewed.
  // One transaction so a suggestion can't end up accepted with no pin, or a pin
  // with the suggestion still sitting in the queue.
  const locId = crypto.randomUUID();
  const results = await tx(cs, [
    {
      query: `insert into locations (id, project_id, title, neighbourhood, status, category,
                                     notes, address, contributor_id, geom)
              values ($1, $2, $3, $4, 'idea', 'Exterior', $5, $6, $7,
                      st_setsrid(st_makepoint($8, $9), 4326)::geography)
              returning id, ${ISO('created_at')} as created_at`,
      params: [locId, s.project_id, s.title, s.neighbourhood, s.note, s.address, s.contributor_id,
        Number(s.lng), Number(s.lat)],
    },
    {
      query: "update suggestions set status = 'accepted', reviewed_at = now(), location_id = $2 where id = $1",
      params: [id, locId],
    },
  ]);
  const row = results[0] && results[0][0];
  return json({ ok: true, status: 'accepted', locationId: locId, createdAt: row && row.created_at });
}

/* Credits: only contributors who ticked the box, and only those whose suggestion
   actually made it onto the map. Someone whose idea was declined hasn't
   contributed to the film, and listing them would be misleading. */
async function getCredits(cs) {
  const rows = await one(cs,
    `select distinct on (c.id)
            c.id, coalesce(nullif(c.credit_name, ''), c.name) as credit,
            c.name, c.email, c.credit_consent,
            count(*) over (partition by c.id) as accepted_count
       from contributors c
       join suggestions s on s.contributor_id = c.id
      where c.credit_consent = true and s.status = 'accepted'
      order by c.id, s.created_at`);
  // Also surface who is being withheld, so the omission is visible rather than
  // a silent gap Prem discovers at the end of the edit.
  const [withheld] = await one(cs,
    `select count(distinct c.id)::int as n
       from contributors c join suggestions s on s.contributor_id = c.id
      where c.credit_consent = false and s.status = 'accepted'`);
  return json({
    credits: rows.map((r) => ({ credit: r.credit, name: r.name, email: r.email, count: Number(r.accepted_count) }))
      .sort((a, b) => a.credit.localeCompare(b.credit)),
    withheldCount: withheld ? withheld.n : 0,
  });
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

  // The gate goes FIRST, before any route is dispatched, so a route added later
  // is owner-only by default rather than open by default. /api/public/* is the
  // single deliberate exception.
  if (head !== 'public') {
    const denied = ownerGate(env, request);
    if (denied) return denied;
  }

  // Photos are served from R2 and need no database credential — handle them
  // before the NEON_DATABASE_URL check so a misconfigured DB doesn't blank
  // every image on the page. (Owner-only: the guest page shows no photos, and
  // an ungated POST here would be an open upload endpoint.)
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
    /* ── PUBLIC ──────────────────────────────────────────────────
       Everything under /api/public/ is meant to be reachable without a login;
       everything else on /api/ is owner-only. The prefix exists so Cloudflare
       Access can be configured with a Bypass rule on `/api/public/*` that
       CANNOT accidentally widen to an owner route — note that `/api/suggest*`
       would have matched `/api/suggestions` and quietly exposed the queue,
       which is exactly the mistake this naming avoids. Don't add an owner
       route under /api/public/, and don't rename these to share a prefix. */
    if (head === 'public') {
      if (segs[1] === 'suggest' && method === 'POST') return postSuggestion(cs, await request.json());
      return fail(`no such public route: /api/public/${segs.slice(1).join('/')}`, 404);
    }

    /* ── OWNER (already gated above) ───────────────────────────── */
    if (head === 'db' && method === 'GET') return json(await getSnapshot(cs));

    if (head === 'suggestions') {
      if (method === 'GET') return listSuggestions(cs);
      // POST /api/suggestions/<id>/accept | /decline
      if (method === 'POST' && segs[1] && segs[2]) return reviewSuggestion(cs, segs[1], segs[2]);
      return fail(`method ${method} not allowed on /api/suggestions`, 405);
    }

    if (head === 'credits' && method === 'GET') return getCredits(cs);

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

    if (head === 'ideas') {
      if (method === 'POST') return saveIdea(cs, await request.json());
      if (method === 'DELETE') {
        const id = segs[1];
        if (!id) return fail('idea id required', 400);
        const rows = await one(cs, 'delete from ideas where id = $1 returning id', [id]);
        if (!rows.length) return fail('idea not found', 404);
        return json({ ok: true });
      }
      return fail(`method ${method} not allowed on /api/ideas`, 405);
    }

    if (head === 'days') {
      if (method === 'POST') return saveDay(cs, await request.json());
      if (method === 'DELETE') {
        const id = segs[1];
        if (!id) return fail('day id required', 400);
        const rows = await one(cs, 'delete from shoot_days where id = $1 returning id', [id]);
        if (!rows.length) return fail('shoot day not found', 404);
        return json({ ok: true });
      }
      return fail(`method ${method} not allowed on /api/days`, 405);
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
    console.error('api error', e);
    // On OWNER routes, hand back the real message: it's Prem's own data and a
    // real error beats a generic 500 when something breaks in the field.
    // On the PUBLIC route, don't — these messages carry SQL text, column names
    // and stack frames, and a stranger submitting a location has no business
    // seeing the schema. They get something actionable instead.
    if (head === 'public') {
      return fail("Something went wrong saving that suggestion. It's not your fault — " +
        'please try again in a moment.', 500);
    }
    // The message can carry SQL text but never the connection string (neon()
    // only ever puts it in a header), so it's safe to hand back here.
    return fail(e.message || 'unknown error', 500);
  }
}
