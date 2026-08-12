/* Scarborough Film Map — v4 (Neon Postgres + PostGIS, via same-origin /api/*)
   A documentary-organizing tool: projects -> locations -> footage / interviews / logistics,
   plus a proximity "plan a shoot day" generator.
   Base map: OpenStreetMap (ODbL). Boundaries: City of Toronto Open Data (158 neighbourhoods).
   Storage: Neon (PostGIS geography) behind functions/api/[[route]].js — a Cloudflare Pages
   Function that holds the database credential so this file never has to. Migrated off
   Supabase 2026-08-11 after its free tier idled the project offline.
   Auto-migrates localStorage data on first load. */

const STORE_KEY = "scarborough_shoots_v2";
const V1_KEY = "scarborough_shoots_v1";
const STATUS = {
  idea:      { label: "Idea",      color: "#8a97a6" },
  scouting:  { label: "Scouting",  color: "#f0a93b" },
  confirmed: { label: "Confirmed", color: "#4ea1ff" },
  shot:      { label: "Shot",      color: "#46c98b" },
};
const CATEGORIES = ["Exterior", "Interior", "Park / Nature", "Street", "Landmark", "Studio", "Other"];
const PERMIT = ["n/a", "needed", "requested", "granted"];
const INTERVIEW_STATUS = ["idea", "reaching out", "scheduled", "recorded"];

/* ---------- data ---------- */
function rid(p) { return p + Math.random().toString(36).slice(2, 9); }
function blankLoc() {
  return {
    id: null, createdAt: Date.now(), projectId: null,
    title: "", neighbourhood: "", status: "idea", category: "Exterior",
    shootDate: "", bestTime: "", parking: "", permit: "n/a", lat: 0, lng: 0,
    contacts: [], interviews: [], footage: [], photos: [], notes: "", address: "",
  };
}

/* ---------- /api/* client ----------
   Every call goes to the same-origin Pages Function; there is no key or token
   here by design. Errors are surfaced as thrown Errors carrying the server's
   own message, and each data function below catches them and returns the same
   null/false the Supabase versions did — so the callers (saveDetail, removeLoc)
   keep their existing "keep the editor open and tell the truth" behaviour.
   lastApiError holds the most recent message so those alerts can say why. */
let lastApiError = "";
// id → { name, email, creditName, creditConsent }, filled by loadDB. Lets a
// location card/editor name whoever suggested it.
let contributorsById = {};
function contributorOf(loc) { return loc && loc.contributorId ? contributorsById[loc.contributorId] : null; }

/* Short label for the card chip. First name where that's meaningful, but not
   when it's a bare initial — "A neighbour" must not become "💡 A", which reads
   as a glitch rather than a person. Falls back to a truncated full name. */
function shortName(name) {
  const n = (name || "").trim();
  if (!n) return "suggested";
  const first = n.split(" ")[0];
  if (first.length > 2) return first;
  return n.length > 14 ? `${n.slice(0, 13)}…` : n;
}

/* "Suggested by …" block for the editor. Shows the contact details (that's the
   point — Prem needs to be able to follow up) and states the consent position
   plainly, because it decides whether this person may appear in the credits. */
function creditLine(loc) {
  const by = contributorOf(loc);
  if (!by) return "";
  const mail = by.email ? ` · <a href="mailto:${esc(by.email)}">${esc(by.email)}</a>` : "";
  const credit = by.creditName && by.creditName !== by.name ? ` (credit as “${esc(by.creditName)}”)` : "";
  const consent = by.creditConsent
    ? `<span class="chip ok">✓ may credit</span>`
    : `<span class="chip warn">✕ asked not to be credited</span>`;
  return `<div class="credit-line">💡 Suggested by <strong>${esc(by.name)}</strong>${credit}${mail} ${consent}</div>`;
}

async function api(path, { method = "GET", body, raw, contentType } = {}) {
  const init = { method, headers: {} };
  if (raw !== undefined) {
    init.body = raw;
    init.headers["Content-Type"] = contentType || "application/octet-stream";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`api/${path}`, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON — handled below */ }
  if (!res.ok) {
    const msg = (data && data.error) || `${res.status} ${res.statusText}` || "request failed";
    throw new Error(msg);
  }
  return data;
}

function apiFailed(where, err) {
  lastApiError = err && err.message ? err.message : String(err);
  console.error(`${where}:`, err);
}

/* --- row ↔ in-memory shape helpers --- */
function rowToLoc(row, interviews, contacts, media) {
  return {
    id: row.id,
    projectId: row.project_id,
    createdAt: new Date(row.created_at).getTime(),
    title: row.title,
    neighbourhood: row.neighbourhood || "",
    status: row.status || "idea",
    category: row.category || "Exterior",
    shootDate: row.shoot_date || "",
    bestTime: row.best_time || "",
    parking: row.parking || "",
    permit: row.permit || "n/a",
    lat: row.lat,
    lng: row.lng,
    notes: row.notes || "",
    address: row.address || "",
    // Who suggested this place, when it came in through /suggest. null for
    // Prem's own pins. Note that saveLocation deliberately does NOT send this
    // back — contributor_id isn't in its column list, so editing an accepted
    // location can't accidentally strip its attribution.
    contributorId: row.contributor_id || null,
    contacts: (contacts || []).map((c) => ({ id: c.id, name: c.name || "", role: c.role || "", detail: c.detail || "" })),
    interviews: (interviews || []).map((i) => ({ id: i.id, subject: i.subject || "", role: i.role || "", status: i.status || "idea" })),
    footage: (media || []).filter((m) => m.kind === "footage").map((m) => ({ id: m.id, label: m.label || "", notes: m.notes || "" })),
    photos: (media || []).filter((m) => m.kind === "photo").map((m) => m.url || ""),
  };
}

async function loadDB() {
  // One request returns the whole snapshot — projects, locations (lat/lng already
  // decoded out of the geography column by locations_view) and every child row.
  // Five round trips became one, which also makes the service worker's offline
  // copy a single cache entry instead of five that could disagree.
  let snap;
  try { snap = await api("db"); }
  catch (e) { apiFailed("loadDB", e); return null; }

  const byLoc = (rows, lid) => (rows || []).filter((r) => r.location_id === lid);
  const locations = (snap.locations || []).map((row) => {
    row.lat = Number(row.lat);
    row.lng = Number(row.lng);
    return rowToLoc(row, byLoc(snap.interviews, row.id), byLoc(snap.contacts, row.id), byLoc(snap.media, row.id));
  });

  const projects = (snap.projects || []).map((p) => ({ id: p.id, name: p.name, createdAt: new Date(p.created_at).getTime() }));
  if (!projects.length) { apiFailed("loadDB", new Error("no projects returned")); return null; }

  // id → contributor, so a location can name the person who suggested it without
  // a second request.
  contributorsById = {};
  (snap.contributors || []).forEach((c) => {
    contributorsById[c.id] = {
      id: c.id, name: c.name || "", email: c.email || "",
      creditName: c.credit_name || "", creditConsent: !!c.credit_consent,
    };
  });

  return { projects, activeProjectId: projects[0].id, locations };
}

async function saveLocation(loc) {
  // The whole record (row + contacts + interviews + footage + photos) goes over
  // in one POST and lands in one Postgres transaction — so a half-saved
  // location, which the old delete-then-reinsert-over-5-requests could leave
  // behind if the connection dropped mid-save, is no longer possible.
  let out;
  try { out = await api("locations", { method: "POST", body: loc }); }
  catch (e) { apiFailed("saveLocation", e); return null; }
  if (!out || !out.id) { apiFailed("saveLocation", new Error("no id returned")); return null; }
  loc.id = out.id;
  if (out.createdAt) loc.createdAt = new Date(out.createdAt).getTime();
  return out.id;
}

async function deleteLocation(id) {
  try { await api(`locations/${encodeURIComponent(id)}`, { method: "DELETE" }); return true; }
  catch (e) { apiFailed("deleteLocation", e); return false; }
}

async function saveProject(proj) {
  if (proj._isNew) {
    try {
      const p = await api("projects", { method: "POST", body: { name: proj.name } });
      return { id: p.id, name: p.name, createdAt: new Date(p.created_at).getTime() };
    } catch (e) { apiFailed("saveProject", e); return null; }
  }
  return proj;
}

async function renameProject(id, name) {
  try { await api(`projects/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } }); return true; }
  catch (e) { apiFailed("renameProject", e); return false; }
}

// Legacy save() kept as a no-op so existing event handlers don't break during init
function save() {}

let db = { projects: [], activeProjectId: null, locations: [] };
function activeProject() { return db.projects.find((p) => p.id === db.activeProjectId) || db.projects[0]; }
function projectLocs() { return db.locations.filter((l) => l.projectId === db.activeProjectId); }

/* ---------- migrate localStorage → the database ---------- */
async function migrateLocalStorage() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return;
  let old;
  try { old = JSON.parse(raw); } catch { return; }
  if (!old.locations || !old.locations.length) { localStorage.removeItem(STORE_KEY); return; }

  console.log(`Migrating ${old.locations.length} location(s) from localStorage → Neon…`);
  const projMap = {};

  // Create any localStorage projects that don't already exist in the database
  for (const op of (old.projects || [])) {
    const existing = db.projects.find((p) => p.name === op.name);
    if (existing) {
      projMap[op.id] = existing.id;
      continue;
    }
    const p = await saveProject({ name: op.name, _isNew: true });
    if (!p) { console.error("migrate project failed:", op.name, lastApiError); continue; }
    db.projects.push(p);
    projMap[op.id] = p.id;
  }

  // Migrate locations. A failed write must NOT clear localStorage — that would
  // destroy the only copy of the data, which is the whole reason this app left
  // Supabase in the first place.
  let failed = 0;
  for (const loc of old.locations) {
    loc.projectId = projMap[loc.projectId] || db.activeProjectId;
    loc.id = null; // force insert
    if (await saveLocation(loc)) db.locations.push(loc);
    else failed++;
  }
  if (failed) {
    console.error(`Migration incomplete — ${failed} location(s) failed; localStorage kept so nothing is lost.`);
    alert(`Couldn't move ${failed} saved location${failed === 1 ? "" : "s"} to the cloud. Nothing was deleted — reload to retry.`);
    return;
  }

  // Clear localStorage so migration doesn't re-run
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem(V1_KEY);
  console.log("Migration complete — localStorage cleared.");
}

let hoods = [];
const markers = new Map();
let editing = null, isNewLoc = false, plannerAnchor = null, planCircle = null;
let hoodBlurbs = {}, exploreMode = false, tempMarker = null, enrichToken = 0, lastFocused = null;
let dirtyEdit = false, dbLoadFailed = false;

/* ---------- map ---------- */
const map = L.map("map", { zoomControl: true }).setView([43.773, -79.233], 12);
const osmLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
// Esri World Imagery — free, keyless aerial tiles for scouting actual buildings / tree cover
const satLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
});
let satOn = false;

let hoodLayer, fitted = false;
function fitWhenReady() {
  const el = map.getContainer();
  if (el.clientHeight > 0 && el.clientWidth > 0) {
    map.invalidateSize();
    if (!fitted && hoodLayer) { map.fitBounds(hoodLayer.getBounds(), { padding: [20, 20] }); fitted = true; }
  }
}
new ResizeObserver(fitWhenReady).observe(map.getContainer());

// Boot: load geojson + the /api/db snapshot in parallel, then render
(async function boot() {
  const [geoRes, boundaryRes, dbRes, blurbsData] = await Promise.all([
    fetch("data/scarborough.geojson").then((r) => r.json()),
    fetch("data/scarborough-boundary.geojson").then((r) => r.json()),
    loadDB(),
    fetch("data/neighbourhood-blurbs.json").then((r) => r.json()).catch(() => ({})),
  ]);
  hoodBlurbs = blurbsData || {};

  // Set up neighbourhoods
  const geo = geoRes;
  hoods = geo.features;
  // Internal neighbourhood boundaries — subtle fill, visible dividing lines
  hoodLayer = L.geoJSON(geo, {
    style: () => ({ color: "#4ea1ff", weight: 1.5, opacity: 0.6, fillColor: "#4ea1ff", fillOpacity: 0.04 }),
    onEachFeature: (f, layer) => {
      layer.on("mouseover", () => layer.setStyle({ fillOpacity: 0.15, weight: 2.5, opacity: 1 }));
      layer.on("mouseout", () => hoodLayer.resetStyle(layer));
      layer.bindTooltip(() => hoodTooltip(f.properties.name), { sticky: true });
    },
  }).addTo(map);

  // Outer Scarborough boundary — bold outline so the whole area reads clearly
  L.geoJSON(boundaryRes, {
    style: () => ({ color: "#ffffff", weight: 4, opacity: 0.25, fill: false }),
    interactive: false,
  }).addTo(map);
  L.geoJSON(boundaryRes, {
    style: () => ({ color: "#4ea1ff", weight: 2.5, opacity: 0.9, fill: false, dashArray: null }),
    interactive: false,
  }).addTo(map);

  geo.features.forEach((f) => {
    const [lng, lat] = f.properties.centroid;
    const lbl = L.marker([lat, lng], {
      interactive: true,
      icon: L.divIcon({ className: "hood-label", html: `<span class="hl-in">${f.properties.name}</span>`, iconSize: null }),
    }).addTo(map);
    lbl.on("click", (e) => { L.DomEvent.stopPropagation(e); exploreAt({ lat, lng }, f.properties.name); }); // click a name → its summary
  });
  fitWhenReady();
  buildHoodFilter();

  // Set up the loaded data
  if (dbRes) { db = dbRes; }
  else { dbLoadFailed = true; }   // renderList shows a retry state instead of a false "no locations yet"

  // Migrate any existing localStorage data
  await migrateLocalStorage();

  render();

  // Pending-suggestion count, after the first paint — the map shouldn't wait on
  // it, and a failure here must not take the app down with it.
  loadSuggestions().then((ok) => { if (ok) renderSuggestionBadge(); });
})().catch((e) => { console.error("Boot failed:", e); showLoadError(); });

function showLoadError() {
  document.getElementById("count").textContent = "—";
  // Include the server's reason when there is one: "NEON_DATABASE_URL is not set"
  // is a setup problem, not a connection problem, and the retry button won't fix it.
  const why = lastApiError ? `<br><span class="err-detail">${esc(lastApiError)}</span>` : "";
  document.getElementById("list").innerHTML =
    `<div class="empty">Couldn't load your locations — check your connection.${why}<br><button class="btn ghost" id="retry-load" style="flex:none;margin-top:10px">↻ Retry</button></div>`;
  const rb = document.getElementById("retry-load");
  if (rb) rb.onclick = () => location.reload();
}

map.on("click", (e) => {
  if (exploreMode) { exploreAt(e.latlng); return; }   // explore: show info about the place
  markAt(e.latlng);                                    // default: drop + auto-name a pin
});

/* ---------- geo helpers ---------- */
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInFeature(lng, lat, geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    if (!pointInRing(lng, lat, poly[0])) continue;
    let inHole = false;
    for (let k = 1; k < poly.length; k++) if (pointInRing(lng, lat, poly[k])) inHole = true;
    if (!inHole) return true;
  }
  return false;
}
function findHood(lat, lng) {
  const f = hoods.find((f) => pointInFeature(lng, lat, f.geometry));
  return f ? f.properties.name : "Outside Scarborough";
}
function distKm(a, b) {
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ---------- escaping ---------- */
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function selectHtml(id, pairs, val) {
  return `<select id="${id}">` + pairs.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(l)}</option>`).join("") + `</select>`;
}
function bindInput(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener("input", (e) => fn(e.target.value)); }

/* ---------- detail editor ---------- */
// Google Maps link for a location's exact coordinates (drops a pin there; user can then get directions / street view)
function gmapsUrl(loc) { return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`; }
function refreshGmapsLink() { const el = document.getElementById("gmaps-link"); if (el && editing) el.href = gmapsUrl(editing); }
// Focus management for the slide-over panels (keyboard a11y)
function captureFocus() { const ae = document.activeElement; if (ae && ae !== document.body && !ae.closest(".panel")) lastFocused = ae; }
function restoreFocus() { if (lastFocused && document.body.contains(lastFocused)) { try { lastFocused.focus(); } catch (e) {} } }

function openDetail(source, isNew) {
  if (!closeDetail()) return false;   // an open editor with unsaved edits asks before being replaced
  captureFocus();
  closePlanner();
  clearTempMarker();
  editing = JSON.parse(JSON.stringify(source));
  isNewLoc = !!isNew;
  if (isNewLoc) editing.neighbourhood = findHood(editing.lat, editing.lng);
  document.getElementById("detail-h").textContent = isNewLoc ? "New location" : "Edit location";
  document.getElementById("detail-body").innerHTML = `
    <div class="field"><label>Title</label><input id="f-title" value="${esc(editing.title)}" placeholder="${isNewLoc ? "📍 Identifying this spot…" : "e.g. Bluffs cliff edge"}"></div>
    <div id="nearby-chips" class="nearby-chips"></div>
    <div class="field"><label>Neighbourhood (auto)</label><input data-hood value="${esc(editing.neighbourhood)}" readonly></div>
    <div class="field"><label>Address (auto)</label><input id="f-address" value="${esc(editing.address)}" placeholder="auto-filled from the map"></div>
    <a id="gmaps-link" class="ext-link" href="${gmapsUrl(editing)}" target="_blank" rel="noopener">🧭 Open in Google Maps ↗</a>
    ${creditLine(editing)}
    <div class="field"><div class="row2">
      <div style="flex:1"><label>Status</label>${selectHtml("f-status", Object.keys(STATUS).map((k) => [k, STATUS[k].label]), editing.status)}</div>
      <div style="flex:1"><label>Type</label>${selectHtml("f-category", CATEGORIES.map((c) => [c, c]), editing.category)}</div>
    </div></div>
    <div class="field"><div class="row2">
      <div style="flex:1"><label>Shoot date</label><input id="f-date" type="date" value="${esc(editing.shootDate)}"></div>
      <div style="flex:1"><label>Best light / time</label><input id="f-best" value="${esc(editing.bestTime)}" placeholder="golden hour"></div>
    </div></div>
    <div class="field"><div class="row2">
      <div style="flex:1"><label>Permit</label>${selectHtml("f-permit", PERMIT.map((p) => [p, p]), editing.permit)}</div>
      <div style="flex:1"><label>Parking</label><input id="f-parking" value="${esc(editing.parking)}" placeholder="lot / street"></div>
    </div></div>
    <div class="field"><label>Notes (access, hazards, story beats)</label><textarea id="f-notes" rows="3">${esc(editing.notes)}</textarea></div>

    <div class="subhead">👤 People / contacts <button class="btn ghost" id="add-contact">＋ Add</button></div>
    <div id="contacts"></div>
    <div class="subhead">🎤 Interviews <button class="btn ghost" id="add-interview">＋ Add</button></div>
    <div id="interviews"></div>
    <div class="subhead">🎬 Footage / shots <button class="btn ghost" id="add-footage">＋ Add</button></div>
    <div id="footage"></div>
    <div class="subhead">📷 Reference photos <span class="subhead-btns"><button class="btn ghost" id="add-photo-upload">📤 Upload</button><button class="btn ghost" id="add-photo">＋ URL</button></span></div>
    <div id="photos"></div>

    <div class="panel-actions">
      ${isNewLoc ? "" : '<button class="btn danger" id="d-delete">Delete</button>'}
      <button class="btn ghost" id="d-plan">🗓 Plan day</button>
      <button class="btn primary" id="d-save">Save</button>
    </div>`;

  bindInput("f-title", (v) => (editing.title = v));
  bindInput("f-status", (v) => (editing.status = v));
  bindInput("f-category", (v) => (editing.category = v));
  bindInput("f-date", (v) => (editing.shootDate = v));
  bindInput("f-best", (v) => (editing.bestTime = v));
  bindInput("f-permit", (v) => (editing.permit = v));
  bindInput("f-parking", (v) => (editing.parking = v));
  bindInput("f-address", (v) => (editing.address = v));
  bindInput("f-notes", (v) => (editing.notes = v));
  renderContacts(); renderInterviews(); renderFootage(); renderPhotos();

  document.getElementById("add-contact").onclick = () => { dirtyEdit = true; editing.contacts.push({ name: "", role: "", detail: "" }); renderContacts(); };
  document.getElementById("add-interview").onclick = () => { dirtyEdit = true; editing.interviews.push({ subject: "", role: "", status: "idea" }); renderInterviews(); };
  document.getElementById("add-footage").onclick = () => { dirtyEdit = true; editing.footage.push({ label: "", notes: "" }); renderFootage(); };
  document.getElementById("add-photo").onclick = () => { dirtyEdit = true; editing.photos.push(""); renderPhotos(); };
  document.getElementById("add-photo-upload").onclick = pickAndUploadPhotos;
  document.getElementById("d-save").onclick = saveDetail;
  document.getElementById("d-plan").onclick = async () => {
    const savedId = await saveDetail();   // wait for the save — a brand-new pin gets its id here
    if (savedId) openPlanner(db.locations.find((l) => l.id === savedId));
  };
  const del = document.getElementById("d-delete");
  if (del) del.onclick = () => removeLoc(editing.id);

  const panel = document.getElementById("detail");
  panel.hidden = false;
  panel.focus();   // move focus into the dialog for keyboard/screen-reader users
  dirtyEdit = false;   // enrich/auto-fill sets values programmatically; only real user input marks it dirty
  return true;
}
function repeatRow(fields, item, onRemove) {
  const row = document.createElement("div");
  row.className = "repeat-row";
  fields.forEach((f) => {
    let inp;
    if (f.options) { inp = document.createElement("select"); f.options.forEach((o) => { const op = document.createElement("option"); op.value = op.textContent = o; if (o === item[f.k]) op.selected = true; inp.appendChild(op); }); }
    else { inp = document.createElement("input"); inp.value = item[f.k] || ""; inp.placeholder = f.ph; }
    if (f.flex) inp.style.flex = f.flex;
    inp.addEventListener("input", (e) => (item[f.k] = e.target.value));
    row.appendChild(inp);
  });
  const rm = document.createElement("button"); rm.className = "rm"; rm.textContent = "✕"; rm.onclick = onRemove;
  row.appendChild(rm);
  return row;
}
function fillRepeat(containerId, arr, emptyMsg, fields) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = "";
  if (!arr.length) { wrap.innerHTML = `<div class="empty-mini">${emptyMsg}</div>`; return; }
  arr.forEach((item, i) => wrap.appendChild(repeatRow(fields, item, () => { dirtyEdit = true; arr.splice(i, 1); fillRepeat(containerId, arr, emptyMsg, fields); })));
}
function renderContacts() { fillRepeat("contacts", editing.contacts, "No contacts yet.", [{ k: "name", ph: "Name", flex: "1.2" }, { k: "role", ph: "Role", flex: "1" }, { k: "detail", ph: "Phone / email", flex: "1.3" }]); }
function renderInterviews() { fillRepeat("interviews", editing.interviews, "No interviews logged.", [{ k: "subject", ph: "Subject / name", flex: "1.4" }, { k: "role", ph: "Role", flex: "1" }, { k: "status", options: INTERVIEW_STATUS, flex: "1" }]); }
function renderFootage() { fillRepeat("footage", editing.footage, "No footage notes.", [{ k: "label", ph: "Shot / clip", flex: "1" }, { k: "notes", ph: "Note", flex: "1.4" }]); }
function renderPhotos() {
  const wrap = document.getElementById("photos");
  wrap.innerHTML = "";
  if (!editing.photos.length) { wrap.innerHTML = `<div class="empty-mini">No reference photos. Paste image URLs.</div>`; return; }
  editing.photos.forEach((url, i) => {
    const row = document.createElement("div"); row.className = "repeat-row";
    const inp = document.createElement("input"); inp.value = url; inp.placeholder = "https://…image.jpg";
    inp.addEventListener("input", (e) => (editing.photos[i] = e.target.value));
    const rm = document.createElement("button"); rm.className = "rm"; rm.textContent = "✕"; rm.onclick = () => { dirtyEdit = true; editing.photos.splice(i, 1); renderPhotos(); };
    row.append(inp, rm); wrap.appendChild(row);
  });
  const grid = document.createElement("div"); grid.className = "photo-grid";
  editing.photos.filter(Boolean).forEach((u) => {
    const img = document.createElement("img"); img.src = u; img.onerror = () => (img.style.display = "none");
    img.title = "Open full size"; img.onclick = () => window.open(u, "_blank", "noopener");
    grid.appendChild(img);
  });
  wrap.appendChild(grid);
}
/* ---------- reference-photo upload (Cloudflare R2, via POST /api/photo) ---------- */
// phones hand over 3–12 MB originals; a 1600px JPEG is plenty for scouting reference
async function compressImage(file, maxDim = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", quality));
}
async function uploadPhoto(file) {
  const blob = await compressImage(file).catch(() => file);   // unreadable format → upload the original
  // The function picks the key and returns a relative /api/photo/<key> URL, so the
  // stored value stays portable across hosts and the service worker can cache it
  // as a same-origin request.
  const out = await api(`photo?project=${encodeURIComponent(db.activeProjectId || "no-project")}`, {
    method: "POST",
    raw: blob,
    contentType: blob.type || "image/jpeg",
  });
  if (!out || !out.url) throw new Error("upload returned no url");
  return out.url;
}
function pickAndUploadPhotos() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
  inp.onchange = async () => {
    const files = Array.from(inp.files || []);
    if (!files.length) return;
    const btn = document.getElementById("add-photo-upload");
    if (btn) { btn.disabled = true; btn.textContent = "Uploading…"; }
    let failed = 0, why = "";
    for (const f of files) {
      try {
        const url = await uploadPhoto(f);
        if (!editing) return;   // editor closed mid-upload — stop quietly
        editing.photos.push(url);
        dirtyEdit = true;
        renderPhotos();
      } catch (e) { console.error("photo upload:", e); failed++; why = why || (e && e.message) || ""; }
    }
    const b = document.getElementById("add-photo-upload");
    if (b) { b.disabled = false; b.textContent = "📤 Upload"; }
    // Show the server's actual reason — "photo storage is not configured" is a very
    // different problem from a dropped connection, and guessing wastes the user's time.
    if (failed) alert(`Couldn't upload ${failed} photo${failed === 1 ? "" : "s"}.${why ? `\n\n${why}` : " Check your connection and try again."}`);
  };
  inp.click();
}

async function saveDetail() {
  const btn = document.getElementById("d-save");
  if (btn && btn.disabled) return;   // a save is already in flight — no double-insert
  editing.title = (editing.title || "").trim() || "Untitled";
  // drop empty repeatable rows so blank entries don't count toward chips/exports
  editing.contacts = editing.contacts.filter((c) => c.name || c.role || c.detail);
  editing.interviews = editing.interviews.filter((i) => i.subject || i.role);
  editing.footage = editing.footage.filter((f) => f.label || f.notes);
  editing.photos = editing.photos.filter(Boolean);
  if (isNewLoc) { editing.projectId = db.activeProjectId; }
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  const locId = await saveLocation(editing);
  if (!locId) {   // the cloud write failed — keep the editor open so nothing is lost
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
    alert(`Couldn't save — your edits are still here.${lastApiError ? `\n\n${lastApiError}` : " Check your connection and try again."}`);
    return;
  }
  if (isNewLoc) { db.locations.push(editing); isNewLoc = false; }
  else { const i = db.locations.findIndex((l) => l.id === editing.id); if (i >= 0) db.locations[i] = editing; }
  closeDetail(true); render();
  return locId;
}
async function removeLoc(id) {
  const loc = db.locations.find((l) => l.id === id);
  if (!confirm(`Delete ${loc && loc.title ? `“${loc.title}”` : "this location"}? This can't be undone.`)) return;
  if (!(await deleteLocation(id))) { alert(`Couldn't delete.${lastApiError ? `\n\n${lastApiError}` : " Check your connection and try again."}`); return; }
  db.locations = db.locations.filter((l) => l.id !== id); closeDetail(true); render();
}
function closeDetail(force) {
  const panel = document.getElementById("detail");
  if (panel.hidden) return true;
  if (!force && dirtyEdit && !confirm("Discard unsaved changes to this location?")) return false;
  panel.hidden = true; editing = null; dirtyEdit = false; clearTempMarker(); restoreFocus();
  return true;
}
document.getElementById("detail-close").onclick = () => closeDetail();
// any real keystroke/selection in the editor marks it dirty (programmatic .value writes don't fire input)
document.getElementById("detail-body").addEventListener("input", () => { dirtyEdit = true; });

/* ---------- shoot-day planner ---------- */
function openPlanner(anchor) {
  if (!anchor) return;
  if (!closeDetail()) return;   // don't silently discard unsaved edits under the planner
  captureFocus();
  plannerAnchor = anchor;
  const panel = document.getElementById("planner");
  panel.hidden = false;
  renderPlanner(2);
  panel.focus();
}
function planMeta(l) { return `${esc(l.neighbourhood)} · ${STATUS[l.status].label}${l.shootDate ? ` · 🗓 ${esc(l.shootDate)}` : ""}`; }
function renderPlanner(km) {
  const a = plannerAnchor;
  const near = projectLocs().filter((l) => l.id !== a.id).map((l) => ({ l, d: distKm(a, l) })).filter((x) => x.d <= km).sort((x, y) => x.d - y.d);
  const anchorOpts = projectLocs().slice().sort((x, y) => (x.title || "").localeCompare(y.title || ""))
    .map((l) => `<option value="${esc(l.id)}" ${l.id === a.id ? "selected" : ""}>${esc(l.title || "Untitled")}</option>`).join("");
  document.getElementById("planner-body").innerHTML = `
    <div class="field"><label>Plan around</label><select id="plan-anchor">${anchorOpts}</select></div>
    <div class="field"><label>Radius: <span class="dist">${km.toFixed(1)} km</span></label>
      <input id="r-range" type="range" min="0.5" max="10" step="0.5" value="${km}"></div>
    <div class="field"><label>${near.length + 1} stop${near.length ? "s" : ""} this day</label></div>
    <div class="plan-item"><b>${esc(a.title)}</b> <span class="dist">0.0 km</span><div class="pm">${planMeta(a)}</div></div>
    ${near.length ? near.map((x) => `<div class="plan-item"><b>${esc(x.l.title)}</b> <span class="dist">${x.d.toFixed(1)} km</span><div class="pm">${planMeta(x.l)}</div></div>`).join("")
      : `<div class="empty-mini" style="margin:10px 0">No other locations within ${km.toFixed(1)} km — widen the radius.</div>`}
    <div class="panel-actions"><button class="btn primary" id="plan-export">⭳ Export shoot list</button></div>`;
  document.getElementById("plan-anchor").onchange = (e) => {
    const next = projectLocs().find((l) => l.id === e.target.value);
    if (next) { plannerAnchor = next; renderPlanner(km); }
  };
  document.getElementById("r-range").addEventListener("input", (e) => renderPlanner(parseFloat(e.target.value)));
  document.getElementById("plan-export").onclick = () => exportShootList(a, km, near);
  drawPlanCircle(a, km);
}
function drawPlanCircle(a, km) {
  if (planCircle) map.removeLayer(planCircle);
  planCircle = L.circle([a.lat, a.lng], { radius: km * 1000, color: "#4ea1ff", weight: 1, fillOpacity: 0.06 }).addTo(map);
  map.fitBounds(planCircle.getBounds(), { padding: [40, 40] });
}
function closePlanner() {
  document.getElementById("planner").hidden = true;
  if (planCircle) { map.removeLayer(planCircle); planCircle = null; }
  plannerAnchor = null;
  restoreFocus();
}
document.getElementById("planner-close").onclick = closePlanner;

/* ---------- suggestion review queue ----------
   People suggest locations through the public /suggest page; those land in the
   `suggestions` table, never in `locations`. Accepting one here is what promotes
   it to a real pin, carrying the contributor's attribution with it. */
let suggestions = [];
let suggestionsLoaded = false;

async function loadSuggestions() {
  try {
    const out = await api("suggestions");
    suggestions = out.suggestions || [];
    suggestionsLoaded = true;
    return true;
  } catch (e) { apiFailed("loadSuggestions", e); return false; }
}

function pendingCount() { return suggestions.filter((s) => s.status === "pending").length; }

// The badge is the only reason Prem would think to open the panel, so it's
// refreshed on boot and after every review action.
function renderSuggestionBadge() {
  const b = document.getElementById("sugg-badge");
  const n = pendingCount();
  b.hidden = !n;
  b.textContent = n;
}

async function openSuggestions() {
  if (!closeDetail()) return;   // don't discard unsaved edits underneath
  closePlanner();
  captureFocus();
  const panel = document.getElementById("suggestions");
  panel.hidden = false;
  document.getElementById("suggestions-body").innerHTML = `<div class="empty">Loading suggestions…</div>`;
  panel.focus();
  if (!suggestionsLoaded && !(await loadSuggestions())) {
    document.getElementById("suggestions-body").innerHTML =
      `<div class="empty">Couldn't load suggestions.${lastApiError ? `<br><span class="err-detail">${esc(lastApiError)}</span>` : ""}</div>`;
    return;
  }
  renderSuggestions();
}

function closeSuggestions() {
  document.getElementById("suggestions").hidden = true;
  restoreFocus();
}
document.getElementById("suggestions-close").onclick = closeSuggestions;
document.getElementById("review-suggestions").onclick = openSuggestions;

function renderSuggestions() {
  const body = document.getElementById("suggestions-body");
  const pending = suggestions.filter((s) => s.status === "pending");
  const done = suggestions.filter((s) => s.status !== "pending");

  if (!suggestions.length) {
    body.innerHTML = `<div class="empty">No suggestions yet.<br><br>Share the link below and they'll show up here for review.</div>${shareBlock()}`;
    wireShare();
    return;
  }

  const card = (s) => {
    // Contact details are the whole point of the queue, so they're shown plainly
    // — but the consent state is shown just as plainly, because it decides
    // whether this person may be named in the film.
    const who = esc(s.contributor_name || "Anonymous");
    const credit = s.credit_name && s.credit_name !== s.contributor_name ? ` (credit as “${esc(s.credit_name)}”)` : "";
    const mail = s.contributor_email
      ? `<a href="mailto:${esc(s.contributor_email)}">${esc(s.contributor_email)}</a>` : "<span class='muted'>no email</span>";
    const consent = s.credit_consent
      ? `<span class="chip ok">✓ may credit</span>`
      : `<span class="chip warn">✕ no credit</span>`;
    const statusChip = s.status === "pending" ? ""
      : `<span class="chip ${s.status === "accepted" ? "ok" : "muted-chip"}">${esc(s.status)}</span>`;
    return `
      <div class="sugg" data-id="${esc(s.id)}">
        <div class="sugg-head">
          <strong>${esc(s.title)}</strong>${statusChip}
        </div>
        ${s.note ? `<p class="sugg-note">${esc(s.note)}</p>` : ""}
        <div class="sugg-meta">
          👤 ${who}${credit} · ${mail} · ${consent}
        </div>
        <div class="sugg-meta muted">
          📍 ${Number(s.lat).toFixed(5)}, ${Number(s.lng).toFixed(5)}
          · <a href="https://www.google.com/maps?q=${s.lat},${s.lng}" target="_blank" rel="noopener">street view ↗</a>
          · ${esc((s.created_at || "").slice(0, 10))}
        </div>
        ${s.status === "pending" ? `
          <div class="sugg-actions">
            <button class="btn ghost sugg-show" type="button">Show on map</button>
            <button class="btn ghost sugg-decline" type="button">Decline</button>
            <button class="btn primary sugg-accept" type="button">Accept</button>
          </div>` : ""}
      </div>`;
  };

  body.innerHTML =
    (pending.length
      ? `<div class="field"><label>${pending.length} awaiting review</label></div>${pending.map(card).join("")}`
      : `<div class="empty">Nothing awaiting review. 🎉</div>`) +
    (done.length ? `<div class="field"><label>Already reviewed</label></div>${done.map(card).join("")}` : "") +
    shareBlock();

  body.querySelectorAll(".sugg").forEach((el) => {
    const id = el.dataset.id;
    const s = suggestions.find((x) => x.id === id);
    const show = el.querySelector(".sugg-show");
    if (show) show.onclick = () => {
      // Temporary marker so Prem can eyeball the spot before committing to it.
      map.setView([s.lat, s.lng], 16);
      if (window._suggMarker) map.removeLayer(window._suggMarker);
      window._suggMarker = L.circleMarker([s.lat, s.lng], { radius: 9, weight: 3, color: "#f0a93b", fillColor: "#f0a93b", fillOpacity: .5 })
        .addTo(map).bindTooltip(`💡 ${s.title}`).openTooltip();
    };
    const acc = el.querySelector(".sugg-accept");
    if (acc) acc.onclick = () => reviewSuggestion(id, "accept", acc);
    const dec = el.querySelector(".sugg-decline");
    if (dec) dec.onclick = () => {
      if (!confirm(`Decline “${s.title}”? It stays in this list as declined, and ${s.contributor_name || "the contributor"} won't be credited for it.`)) return;
      reviewSuggestion(id, "decline", dec);
    };
  });
  wireShare();
}

function shareBlock() {
  const url = `${location.origin}/suggest`;
  return `
    <div class="share">
      <label>Share this link to collect suggestions</label>
      <div class="share-row">
        <input id="share-url" value="${esc(url)}" readonly />
        <button class="btn ghost" id="share-copy" type="button">Copy</button>
      </div>
      <p class="hint-inline">Anyone with this link can suggest a location. They can't see or change your locations.</p>
    </div>`;
}
function wireShare() {
  const btn = document.getElementById("share-copy");
  if (!btn) return;
  btn.onclick = async () => {
    const inp = document.getElementById("share-url");
    try {
      await navigator.clipboard.writeText(inp.value);
      btn.textContent = "Copied ✓";
    } catch {
      // Clipboard API needs a secure context and permission; selecting the text
      // is a working fallback rather than a dead button.
      inp.select();
      btn.textContent = "Press ⌘C";
    }
    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
  };
}

async function reviewSuggestion(id, action, btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = action === "accept" ? "Accepting…" : "Declining…";
  try {
    const out = await api(`suggestions/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    const s = suggestions.find((x) => x.id === id);
    if (s) { s.status = out.status; s.location_id = out.locationId || null; }

    if (action === "accept") {
      // Re-read the whole snapshot rather than synthesising the new location
      // locally: the server set its category and created_at, and guessing them
      // here is how the list and the map drift apart.
      const fresh = await loadDB();
      if (fresh) { db = fresh; render(); }

      // Neighbourhood tagging is a client-side ray-cast against the polygons in
      // data/scarborough.geojson, so the Function couldn't set it and the guest
      // page is deliberately not trusted to (a public caller could send any
      // string). Derive it here, where the polygons are already loaded, so an
      // accepted pin behaves like every other one in the hood filter and the
      // scene-list grouping.
      const loc = db.locations.find((l) => l.id === out.locationId);
      if (loc && !loc.neighbourhood) {
        loc.neighbourhood = findHood(loc.lat, loc.lng);
        if (await saveLocation(loc)) render();
        else console.error("couldn't tag the accepted location's neighbourhood:", lastApiError);
      }
    }
    renderSuggestions();
    renderSuggestionBadge();
  } catch (e) {
    apiFailed("reviewSuggestion", e);
    alert(`Couldn't ${action} that suggestion.${lastApiError ? `\n\n${lastApiError}` : ""}`);
    btn.disabled = false; btn.textContent = label;
  }
}

/* ---------- credits export ----------
   Only contributors who ticked the consent box AND whose suggestion was
   accepted. The withheld count is printed so a gap is visible rather than
   silently missing at the end of the edit. */
async function exportCredits() {
  let out;
  try { out = await api("credits"); }
  catch (e) { apiFailed("exportCredits", e); alert(`Couldn't build the credits list.${lastApiError ? `\n\n${lastApiError}` : ""}`); return; }

  const list = out.credits || [];
  if (!list.length && !out.withheldCount) {
    alert("No credited contributors yet — accept a suggestion from someone who consented and it'll appear here.");
    return;
  }
  const lines = [
    `LOCATION CONTRIBUTORS — ${activeProject().name}`,
    `Generated ${new Date().toISOString().slice(0, 10)}`,
    "",
    "With thanks to the people who put these places on the map:",
    "",
    ...list.map((c) => `  ${c.credit}${c.count > 1 ? `  (${c.count} locations)` : ""}`),
  ];
  if (out.withheldCount) {
    lines.push("", `— ${out.withheldCount} further contributor${out.withheldCount === 1 ? "" : "s"} asked not to be credited.`);
  }
  lines.push("", "Contact details (not for publication):", "");
  list.forEach((c) => lines.push(`  ${c.name}${c.email ? ` — ${c.email}` : ""}`));
  download(lines.join("\n"), `${activeProject().name.replace(/\W+/g, "-").toLowerCase()}-credits.txt`, "text/plain");
}
document.getElementById("export-credits").onclick = exportCredits;
function exportShootList(a, km, near) {
  // field-usable lines: status + shoot date on the stop line, street address underneath when known
  const stop = (n, l, d) => `${n}. ${l.title} — ${l.neighbourhood} — ${d} km — ${STATUS[l.status].label}` +
    (l.shootDate ? ` — shoot ${l.shootDate}` : "") + (l.address ? `\n   ${l.address}` : "");
  const lines = [`SHOOT DAY — ${activeProject().name}`, `Anchor: ${a.title} (${a.neighbourhood})`, `Within ${km.toFixed(1)} km — ${near.length + 1} locations`, "",
    stop(1, a, "0.0")];
  near.forEach((x, i) => lines.push(stop(i + 2, x.l, x.d.toFixed(1))));
  download(lines.join("\n"), `shoot-day-${(a.neighbourhood || "scarborough").replace(/\W+/g, "-").toLowerCase()}.txt`, "text/plain");
}
function download(content, name, type) { const b = new Blob([content], { type }); const u = document.createElement("a"); u.href = URL.createObjectURL(b); u.download = name; u.click(); }

/* ---------- markers + sidebar ---------- */
function drawMarkers(list) {
  // diff instead of clear-and-redraw so filtering/search stays cheap at 100+ pins
  const keep = new Set(list.map((l) => l.id));
  markers.forEach((m, id) => { if (!keep.has(id)) { map.removeLayer(m); markers.delete(id); } });
  list.forEach((loc) => {
    const existing = markers.get(loc.id);
    if (existing) {
      existing.setLatLng([loc.lat, loc.lng]);
      existing.setStyle({ fillColor: STATUS[loc.status].color });
      existing.setTooltipContent(loc.title || "Untitled");
      return;
    }
    const m = L.circleMarker([loc.lat, loc.lng], { radius: 7, weight: 2, color: "#0c1117", fillColor: STATUS[loc.status].color, fillOpacity: 1 }).addTo(map);
    m.bindTooltip(loc.title || "Untitled");
    // look the record up at click time — the in-memory object is replaced on save
    m.on("click", () => { const cur = db.locations.find((x) => x.id === loc.id); if (cur) openDetail(cur, false); });
    markers.set(loc.id, m);
  });
}
function currentFilter() {
  return { q: document.getElementById("search").value.toLowerCase().trim(), status: document.getElementById("filter-status").value, hood: document.getElementById("filter-hood").value };
}
function haystack(l) {
  return [l.title, l.notes, l.neighbourhood, l.category,
    ...(l.contacts || []).map((c) => c.name + " " + c.role),
    ...(l.interviews || []).map((i) => i.subject + " " + i.role),
    ...(l.footage || []).map((f) => f.label)].join(" ").toLowerCase();
}
function filtered() {
  const { q, status, hood } = currentFilter();
  return projectLocs().filter((l) => (!status || l.status === status) && (!hood || l.neighbourhood === hood) && (!q || haystack(l).includes(q)));
}
function render() {
  renderProjects();
  const list = filtered();
  drawMarkers(list); renderStats(); renderList(list);
  const n = projectLocs().length;
  document.getElementById("count").textContent = (dbLoadFailed && !n) ? "—" : `${n} location${n === 1 ? "" : "s"}`;
}
function renderProjects() {
  const sel = document.getElementById("project-select"); sel.innerHTML = "";
  db.projects.forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; if (p.id === db.activeProjectId) o.selected = true; sel.appendChild(o); });
}
function renderStats() {
  const c = { idea: 0, scouting: 0, confirmed: 0, shot: 0 };
  projectLocs().forEach((l) => c[l.status]++);
  document.getElementById("stats").innerHTML = Object.entries(STATUS).map(([k, v]) => `<span class="pill" style="border-left:3px solid ${v.color}"><b>${c[k]}</b> ${v.label}</span>`).join("");
}
function clearFilters() {
  document.getElementById("search").value = "";
  document.getElementById("filter-status").value = "";
  document.getElementById("filter-hood").value = "";
  render();
}
function renderList(list) {
  const el = document.getElementById("list");
  if (!list.length) {
    if (dbLoadFailed && !projectLocs().length) { showLoadError(); return; }
    if (!projectLocs().length) {
      el.innerHTML = `<div class="empty">No locations in this project yet.<br>Click anywhere on the map to add your first one.</div>`;
    } else {
      el.innerHTML = `<div class="empty">No locations match your search or filters.<br><button class="btn ghost" id="clear-filters" style="flex:none;margin-top:10px">Clear search &amp; filters</button></div>`;
      const cf = document.getElementById("clear-filters"); if (cf) cf.onclick = clearFilters;
    }
    return;
  }
  el.innerHTML = "";
  list.slice().sort((a, b) => b.createdAt - a.createdAt).forEach((loc) => {
    const chips = [];
    if (loc.shootDate) chips.push(`🗓 ${esc(loc.shootDate)}`);
    if (loc.interviews?.length) chips.push(`🎤 ${loc.interviews.length}`);
    if (loc.footage?.length) chips.push(`🎬 ${loc.footage.length}`);
    if (loc.contacts?.length) chips.push(`👤 ${loc.contacts.length}`);
    if (loc.photos?.filter(Boolean).length) chips.push(`📷 ${loc.photos.filter(Boolean).length}`);
    if (loc.permit && loc.permit !== "n/a") chips.push(`📋 ${loc.permit}`);
    // The whole point of the suggestions feature: at a glance, whose idea was this?
    const by = contributorOf(loc);
    if (by) chips.push(`💡 ${esc(shortName(by.name))}`);
    const card = document.createElement("div");
    card.className = `card s-${loc.status}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open ${loc.title || "Untitled"}`);
    card.innerHTML = `
      <div class="t">${esc(loc.title)} <span class="badge ${loc.status}">${STATUS[loc.status].label}</span></div>
      <div class="meta">📍 ${esc(loc.neighbourhood)} · ${esc(loc.category)} <button type="button" class="del" title="Delete" aria-label="Delete ${esc(loc.title)}">✕</button></div>
      ${chips.length ? `<div class="chips">${chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div>` : ""}`;
    const open = () => { if (!openDetail(loc, false)) return; map.flyTo([loc.lat, loc.lng], 15, { duration: 0.6 }); };
    card.onclick = (e) => { if (e.target.closest(".del")) { removeLoc(loc.id); return; } open(); };
    card.onkeydown = (e) => { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } };
    el.appendChild(card);
  });
}
function hoodTooltip(name) { const n = projectLocs().filter((l) => l.neighbourhood === name).length; return `<b>${name}</b><br>${n} shoot location${n === 1 ? "" : "s"}`; }

/* ---------- geocoding lookups (free OpenStreetMap services, no key) ----------
   Nominatim usage policy = low-volume only, which fits this single-user tool.
   When this becomes a public website, swap to a self-hosted Nominatim or a keyed
   provider (LocationIQ / Mapbox). Browsers can't set User-Agent, but the Referer
   header they send automatically satisfies the policy for occasional requests. */
// fetch JSON with a hard timeout so a hung request never leaves the UI stuck "loading"
async function fetchJSON(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function reverseGeocode(lat, lng) {
  try {
    const d = await fetchJSON(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { "Accept-Language": "en" } }
    );
    const a = d.address || {};
    // prefer the feature's own name (park, building, landmark); else build a street address
    const name = (d.name && d.name.trim())
      || [a.house_number, a.road].filter(Boolean).join(" ")
      || a.neighbourhood || a.suburb || "";
    // keep the local part of display_name (drop the city/province/country tail)
    const address = (d.display_name || "").split(",").slice(0, 4).join(",").trim();
    return { name, address, failed: false };
  } catch (e) { console.error("reverseGeocode:", e); return { name: "", address: "", failed: true }; }
}
async function searchPlaces(q) {
  // viewbox biases results toward Scarborough: W,N,E,S
  const viewbox = "-79.32,43.86,-79.10,43.68";
  try {
    const rows = await fetchJSON(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${viewbox}&bounded=1&limit=6&addressdetails=1`,
      { headers: { "Accept-Language": "en" } }
    );
    return (rows || []).map((r) => ({
      name: r.name || (r.display_name || "").split(",")[0],
      label: r.display_name || "",
      lat: parseFloat(r.lat), lng: parseFloat(r.lon),
    }));
  } catch (e) { console.error("searchPlaces:", e); return null; }   // null = lookup failed (vs [] = no matches)
}
async function nearbyFeatures(lat, lng) {
  // every named building / park / amenity within ~60 m of the click, nearest first
  const q = `[out:json][timeout:10];(nwr(around:60,${lat},${lng})[name];);out tags center 40;`;
  try {
    const data = await fetchJSON("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q),
    }, 12000);
    const seen = new Set();
    return (data.elements || [])
      .map((el) => { const c = el.center || el; return { name: el.tags && el.tags.name, lat: c.lat, lng: c.lon }; })
      .filter((e) => e.name && e.lat != null && !seen.has(e.name) && seen.add(e.name))
      .map((e) => ({ ...e, d: distKm({ lat, lng }, e) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
  } catch (e) { console.error("nearbyFeatures:", e); return null; }   // null = lookup failed (vs [] = none nearby)
}
async function fetchNearestWiki(lat, lng) {
  const geoData = await fetchJSON(
    `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=500&gslimit=5&format=json&origin=*`
  );
  const pages = (geoData?.query?.geosearch) || [];
  if (!pages.length) return null;
  const title = pages[0].title;
  const sum = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  const extract = sum.extract || "";
  const short = extract.length > 240 ? extract.slice(0, 240).replace(/\s\S*$/, "") + "…" : extract;
  const url = sum.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
  const others = pages.slice(1, 3).map((p) => esc(p.title)).join(", ");
  return { title, short, url, others };
}

/* ---------- explore mode: neighbourhood blurb + nearest Wikipedia landmark ---------- */
async function exploreAt(latlng, knownHood) {
  const { lat, lng } = latlng;
  // label clicks pass the known name (a centroid can fall outside its own polygon, e.g. thin lakeside hoods)
  const hood = knownHood || findHood(lat, lng);
  const blurb = hoodBlurbs[hood] || "";
  const count = projectLocs().filter((l) => l.neighbourhood === hood).length;
  const pop = L.popup({ maxWidth: 320 }).setLatLng(latlng)
    .setContent(exploreHtml(hood, blurb, count, lat, lng, "loading")).openOn(map);
  let wiki = "error";
  try { wiki = await fetchNearestWiki(lat, lng); } catch (e) { console.error("wiki:", e); }
  if (map.hasLayer(pop)) pop.setContent(exploreHtml(hood, blurb, count, lat, lng, wiki));
}
function exploreHtml(hood, blurb, count, lat, lng, wiki) {
  let wikiBlock;
  if (wiki === "loading") wikiBlock = `<p class="info-pop-text" style="margin-top:8px">Looking up nearby landmark…</p>`;
  else if (wiki === "error") wikiBlock = `<p class="info-pop-near" style="margin-top:8px">Landmark lookup failed.</p>`;
  else if (wiki) wikiBlock = `<div class="info-pop-wiki-block">
      <div class="info-pop-name" style="font-size:13px">📖 ${esc(wiki.title)}</div>
      ${wiki.short ? `<p class="info-pop-text">${esc(wiki.short)}</p>` : ""}
      <a class="info-pop-wiki" href="${wiki.url}" target="_blank" rel="noopener">Wikipedia →</a>
      ${wiki.others ? `<span class="info-pop-near">Also nearby: ${wiki.others}</span>` : ""}
    </div>`;
  else wikiBlock = `<p class="info-pop-near" style="margin-top:8px">No Wikipedia landmark within 500 m.</p>`;
  return `<div class="info-pop">
    <div class="info-pop-name">${esc(hood)}</div>
    ${blurb ? `<p class="info-pop-text">${esc(blurb)}</p>` : ""}
    <div class="info-pop-foot">
      <span class="info-pop-count">${count} shoot location${count !== 1 ? "s" : ""}</span>
      <button class="btn ghost info-pop-add" onclick="__markHere(${lat},${lng})">+ Mark a spot here</button>
    </div>
    ${wikiBlock}
  </div>`;
}
window.__markHere = function(lat, lng) { map.closePopup(); markAt({ lat, lng }); };

/* ---------- mark mode: drop an auto-named pin you can fine-tune ---------- */
function clearTempMarker() { if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; } }
function showTempMarker(lat, lng) {
  clearTempMarker();
  tempMarker = L.marker([lat, lng], { draggable: true, zIndexOffset: 1000 }).addTo(map);
  tempMarker.bindTooltip("Drag to fine-tune, then Save", { permanent: false });
  tempMarker.on("dragend", () => {
    const ll = tempMarker.getLatLng();
    if (!editing) return;
    editing.lat = ll.lat; editing.lng = ll.lng;
    setHoodField(findHood(ll.lat, ll.lng));
    refreshGmapsLink();
    enrichEditing(ll.lat, ll.lng);
  });
}
function setHoodField(name) {
  if (editing) editing.neighbourhood = name;
  const el = document.querySelector('#detail [data-hood]');
  if (el) el.value = name;
}
function markAt(latlng) {
  const d = blankLoc();
  d.lat = latlng.lat; d.lng = latlng.lng;
  if (!openDetail(d, true)) return;          // user kept their unsaved edits — don't touch the open editor
  showTempMarker(latlng.lat, latlng.lng);    // visible, draggable pin
  enrichEditing(latlng.lat, latlng.lng);     // fills title + address + nearby chips
}
async function enrichEditing(lat, lng) {
  const token = ++enrichToken;
  const titleEl = document.getElementById("f-title");
  const chipsEl = document.getElementById("nearby-chips");
  if (chipsEl) chipsEl.innerHTML = `<span class="nearby-loading">Identifying…</span>`;
  const [geo, near] = await Promise.all([reverseGeocode(lat, lng), nearbyFeatures(lat, lng)]);
  if (token !== enrichToken || !editing) return;  // editor was closed or moved on
  if (!editing.title && geo.name) {               // don't clobber anything the user typed
    editing.title = geo.name;
    if (titleEl) titleEl.value = geo.name;
  }
  // never leave the title stuck on "Identifying…": settle to an actionable prompt
  if (titleEl && !titleEl.value) titleEl.placeholder = geo.failed ? "Couldn't auto-name — type a name" : "Name this location";
  if (geo.address) {
    editing.address = geo.address;
    const a = document.getElementById("f-address"); if (a) a.value = geo.address;
  }
  if (near === null) { if (chipsEl) chipsEl.innerHTML = `<span class="nearby-loading">Couldn't load nearby places (offline?)</span>`; }
  else renderNearbyChips(near);   // [] just clears it
}
function renderNearbyChips(list) {
  const el = document.getElementById("nearby-chips");
  if (!el) return;
  if (!list || !list.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<span class="nearby-label">Or mark:</span>` +
    list.map((f, i) => `<button class="nearby-chip" data-i="${i}">${esc(f.name)}</button>`).join("");
  el.querySelectorAll(".nearby-chip").forEach((btn) => {
    btn.onclick = () => {
      const f = list[+btn.dataset.i];
      if (!editing) return;
      dirtyEdit = true;   // picking a chip is deliberate work worth guarding
      editing.title = f.name;
      const t = document.getElementById("f-title"); if (t) t.value = f.name;
      editing.lat = f.lat; editing.lng = f.lng;          // snap pin to the chosen feature
      setHoodField(findHood(f.lat, f.lng));
      refreshGmapsLink();
      if (tempMarker) tempMarker.setLatLng([f.lat, f.lng]);
      reverseGeocode(f.lat, f.lng).then((g) => {
        if (!editing) return;
        editing.address = g.address;
        const a = document.getElementById("f-address"); if (a) a.value = g.address;
      });
    };
  });
}
function buildHoodFilter() {
  const sel = document.getElementById("filter-hood");
  hoods.map((f) => f.properties.name).sort().forEach((n) => { const o = document.createElement("option"); o.value = o.textContent = n; sel.appendChild(o); });
}

/* ---------- controls ---------- */
["filter-status", "filter-hood"].forEach((id) => document.getElementById(id).addEventListener("input", render));
// typing shouldn't rebuild the list + markers per keystroke — settle for 200 ms first
let searchTimer = null;
document.getElementById("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 200); });
document.getElementById("project-select").onchange = (e) => { db.activeProjectId = e.target.value; fitted = false; render(); };
document.getElementById("new-project").onclick = async () => {
  const name = prompt("New project (film / production) name:");
  if (!name) return;
  const p = await saveProject({ _isNew: true, name: name.trim() });
  if (!p) { alert("Couldn't create the project — check your connection and try again."); return; }
  db.projects.push(p); db.activeProjectId = p.id; render();
};
document.getElementById("rename-project").onclick = async () => {
  const p = activeProject();
  if (!p) return;
  const name = prompt("Rename project:", p.name);
  if (!name || !name.trim() || name.trim() === p.name) return;
  if (!(await renameProject(p.id, name.trim()))) { alert("Couldn't rename — check your connection and try again."); return; }
  p.name = name.trim();
  renderProjects();
};
document.getElementById("plan-day").onclick = () => {
  const locs = projectLocs();
  if (!locs.length) { alert("Add a location first, then plan a day around it."); return; }
  openPlanner(locs[locs.length - 1]);   // most recently added — and the picker lets you re-anchor
};
document.getElementById("use-location").onclick = () => {
  if (!navigator.geolocation) { alert("Geolocation not supported on this device."); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => { const { latitude: lat, longitude: lng } = pos.coords; map.flyTo([lat, lng], 15); markAt({ lat, lng }); },
    (err) => alert("Couldn't get your location: " + err.message),
    { enableHighAccuracy: true, timeout: 10000 }
  );
};
document.getElementById("export").onclick = () => download(JSON.stringify({ project: activeProject(), locations: projectLocs() }, null, 2), `${activeProject().name.replace(/\W+/g, "-").toLowerCase()}.json`, "application/json");

/* Markdown scene list — feeds script-writing: locations grouped by neighbourhood with
   logistics, people, interviews, footage and notes in one readable document */
function exportSceneList() {
  const locs = projectLocs();
  if (!locs.length) { alert("Add a location first — the scene list is built from your locations."); return; }
  const byHood = {};
  locs.forEach((l) => { const h = l.neighbourhood || "Unplaced"; (byHood[h] = byHood[h] || []).push(l); });
  const lines = [`# ${activeProject().name} — scene list`,
    `${locs.length} location${locs.length === 1 ? "" : "s"} · exported ${new Date().toLocaleDateString("en-CA")}`];
  Object.keys(byHood).sort().forEach((hood) => {
    lines.push("", `## ${hood}`);
    byHood[hood].slice().sort((a, b) => (a.title || "").localeCompare(b.title || "")).forEach((l) => {
      lines.push("", `### ${l.title} — ${STATUS[l.status].label}${l.shootDate ? ` · shoot ${l.shootDate}` : ""}`);
      const logistics = [l.category,
        l.bestTime && `best light: ${l.bestTime}`,
        l.permit && l.permit !== "n/a" && `permit: ${l.permit}`,
        l.parking && `parking: ${l.parking}`].filter(Boolean).join(" · ");
      if (logistics) lines.push(`- ${logistics}`);
      if (l.address) lines.push(`- 📍 ${l.address}`);
      (l.interviews || []).forEach((i) => lines.push(`- 🎤 ${i.subject}${i.role ? ` (${i.role})` : ""} — ${i.status}`));
      (l.contacts || []).forEach((c) => lines.push(`- 👤 ${c.name}${c.role ? ` (${c.role})` : ""}${c.detail ? ` — ${c.detail}` : ""}`));
      (l.footage || []).forEach((f) => lines.push(`- 🎬 ${f.label}${f.notes ? ` — ${f.notes}` : ""}`));
      if (l.notes) lines.push(`- 📝 ${l.notes}`);
    });
  });
  download(lines.join("\n"), `${activeProject().name.replace(/\W+/g, "-").toLowerCase()}-scene-list.md`, "text/markdown");
}
document.getElementById("export-scenes").onclick = exportSceneList;
document.getElementById("sidebar-toggle").onclick = () => document.getElementById("sidebar").classList.toggle("collapsed");
document.getElementById("explore-toggle").addEventListener("click", () => {
  exploreMode = !exploreMode;
  const btn = document.getElementById("explore-toggle");
  btn.classList.toggle("active", exploreMode);
  btn.textContent = exploreMode ? "✕ Exit explore" : "🔍 What's here?";
  document.getElementById("mode-pill").hidden = !exploreMode;   // on-map signal, visible on touch too (#4)
  map.getContainer().style.cursor = exploreMode ? "crosshair" : "";
  const tag = document.querySelector(".tagline");
  if (tag) tag.textContent = exploreMode
    ? "🔍 Explore mode — click the map for info. Exit to add locations."
    : "Click the map to add a location.";
});

/* satellite / street base-map toggle */
document.getElementById("sat-toggle").addEventListener("click", () => {
  satOn = !satOn;
  const btn = document.getElementById("sat-toggle");
  if (satOn) { map.removeLayer(osmLayer); satLayer.addTo(map); btn.textContent = "🗺 Street map"; }
  else { map.removeLayer(satLayer); osmLayer.addTo(map); btn.textContent = "🛰 Satellite"; }
  btn.classList.toggle("active", satOn);
  document.body.classList.toggle("sat-on", satOn);   // stronger label halo on imagery (#15)
});

/* keyboard: Esc closes the open slide-over; Tab is trapped within it */
document.addEventListener("keydown", (e) => {
  const detail = document.getElementById("detail"), planner = document.getElementById("planner");
  const suggestions = document.getElementById("suggestions");
  const panel = !detail.hidden ? detail : (!planner.hidden ? planner : (!suggestions.hidden ? suggestions : null));
  if (!panel) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (panel === detail) closeDetail();
    else if (panel === planner) closePlanner();
    else closeSuggestions();
    return;
  }
  if (e.key !== "Tab") return;
  const f = Array.from(panel.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* place search — type a name, jump there, drop a pre-named pin */
const placeQ = document.getElementById("place-q");
const placeResults = document.getElementById("place-results");
let placeTimer = null, placeList = [];
placeQ.addEventListener("input", () => {
  clearTimeout(placeTimer);
  const q = placeQ.value.trim();
  if (q.length < 3) { placeResults.hidden = true; return; }
  placeTimer = setTimeout(async () => {
    placeResults.hidden = false;
    placeResults.innerHTML = `<li class="pr-empty">Searching…</li>`;
    placeList = await searchPlaces(q);
    if (placeList === null) { placeResults.innerHTML = `<li class="pr-empty">Couldn't search — check your connection.</li>`; placeList = []; return; }
    if (!placeList.length) { placeResults.innerHTML = `<li class="pr-empty">No places found in Scarborough.</li>`; return; }
    placeResults.innerHTML = placeList.map((p, i) => {
      const sub = esc((p.label.split(",").slice(1, 3).join(",")).trim());
      return `<li data-i="${i}">${esc(p.name)}<small>${sub}</small></li>`;
    }).join("");
    placeResults.querySelectorAll("li[data-i]").forEach((li) => {
      li.onclick = () => {
        const p = placeList[+li.dataset.i];
        placeResults.hidden = true; placeQ.value = "";
        map.flyTo([p.lat, p.lng], 16, { duration: 0.6 });
        markAt({ lat: p.lat, lng: p.lng });
      };
    });
  }, 350);
});
document.addEventListener("click", (e) => {
  if (!document.getElementById("place-search").contains(e.target)) placeResults.hidden = true;
});

/* ---------- PWA: offline field use (see sw.js for the caching strategies) ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .catch((e) => console.error("SW registration failed:", e));
  });
}
