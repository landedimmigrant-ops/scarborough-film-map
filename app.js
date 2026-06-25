/* Scarborough Film Map — v3 (Supabase + PostGIS)
   A documentary-organizing tool: projects -> locations -> footage / interviews / logistics,
   plus a proximity "plan a shoot day" generator.
   Base map: OpenStreetMap (ODbL). Boundaries: City of Toronto Open Data (158 neighbourhoods).
   Storage: Supabase (PostGIS geography). Auto-migrates localStorage data on first load. */

const SUPABASE_URL = "https://hflalatfowksnggygulz.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmbGFsYXRmb3drc25nZ3lndWx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMjE1NzQsImV4cCI6MjA5Nzg5NzU3NH0.KFYSPtb5Ri3BgIS3I3Ne-tZxPuZPT43P6GKdWl44OAE";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

/* --- Supabase ↔ in-memory shape helpers --- */
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
    contacts: (contacts || []).map((c) => ({ id: c.id, name: c.name || "", role: c.role || "", detail: c.detail || "" })),
    interviews: (interviews || []).map((i) => ({ id: i.id, subject: i.subject || "", role: i.role || "", status: i.status || "idea" })),
    footage: (media || []).filter((m) => m.kind === "footage").map((m) => ({ id: m.id, label: m.label || "", notes: m.notes || "" })),
    photos: (media || []).filter((m) => m.kind === "photo").map((m) => m.url || ""),
  };
}

async function loadDB() {
  // Load projects
  const { data: projects, error: pErr } = await sb.from("projects").select("*").order("created_at");
  if (pErr) { console.error("loadDB projects:", pErr); return null; }

  if (!projects.length) {
    // First run — create a default project
    const { data: newP, error: npErr } = await sb.from("projects").insert({ name: "Untitled film" }).select().single();
    if (npErr) { console.error("create default project:", npErr); return null; }
    return { projects: [{ id: newP.id, name: newP.name, createdAt: new Date(newP.created_at).getTime() }], activeProjectId: newP.id, locations: [] };
  }

  // Load locations via the view that exposes lat/lng from the geography column
  const { data: locs, error: lErr } = await sb.from("locations_view")
    .select("*")
    .order("created_at");
  if (lErr) { console.error("loadDB locations:", lErr); return null; }

  // Load child records
  const locIds = locs.map((l) => l.id);
  const [ivRes, coRes, meRes] = await Promise.all([
    sb.from("interviews").select("*").in("location_id", locIds.length ? locIds : [""]),
    sb.from("contacts").select("*").in("location_id", locIds.length ? locIds : [""]),
    sb.from("media").select("*").in("location_id", locIds.length ? locIds : [""]),
  ]);

  const byLoc = (rows, lid) => (rows || []).filter((r) => r.location_id === lid);
  const locations = locs.map((row) => {
    row.lat = parseFloat(row.lat);
    row.lng = parseFloat(row.lng);
    return rowToLoc(row, byLoc(ivRes.data, row.id), byLoc(coRes.data, row.id), byLoc(meRes.data, row.id));
  });

  const dbObj = {
    projects: projects.map((p) => ({ id: p.id, name: p.name, createdAt: new Date(p.created_at).getTime() })),
    activeProjectId: projects[0].id,
    locations,
  };
  return dbObj;
}

async function saveLocation(loc) {
  // Upsert the location row
  const row = {
    title: loc.title,
    project_id: loc.projectId,
    neighbourhood: loc.neighbourhood,
    status: loc.status,
    category: loc.category,
    shoot_date: loc.shootDate || null,
    best_time: loc.bestTime || null,
    parking: loc.parking || null,
    permit: loc.permit,
    notes: loc.notes || null,
    address: loc.address || null,
    geom: `SRID=4326;POINT(${loc.lng} ${loc.lat})`,
  };

  let locId = loc.id;
  if (locId) {
    // Update existing
    const { error } = await sb.from("locations").update(row).eq("id", locId);
    if (error) { console.error("update location:", error); return null; }
  } else {
    // Insert new
    const { data, error } = await sb.from("locations").insert(row).select().single();
    if (error) { console.error("insert location:", error); return null; }
    locId = data.id;
    loc.id = locId;
    loc.createdAt = new Date(data.created_at).getTime();
  }

  // Sync child records: delete all then re-insert (simple for a single-user app)
  await Promise.all([
    sb.from("interviews").delete().eq("location_id", locId),
    sb.from("contacts").delete().eq("location_id", locId),
    sb.from("media").delete().eq("location_id", locId),
  ]);

  const childInserts = [];
  if (loc.contacts.length) {
    childInserts.push(sb.from("contacts").insert(loc.contacts.map((c) => ({ location_id: locId, name: c.name, role: c.role, detail: c.detail }))));
  }
  if (loc.interviews.length) {
    childInserts.push(sb.from("interviews").insert(loc.interviews.map((i) => ({ location_id: locId, subject: i.subject, role: i.role, status: i.status }))));
  }
  const mediaRows = [];
  (loc.footage || []).forEach((f) => mediaRows.push({ location_id: locId, kind: "footage", label: f.label, notes: f.notes }));
  (loc.photos || []).filter(Boolean).forEach((url) => mediaRows.push({ location_id: locId, kind: "photo", url }));
  if (mediaRows.length) childInserts.push(sb.from("media").insert(mediaRows));

  await Promise.all(childInserts);
  return locId;
}

async function deleteLocation(id) {
  const { error } = await sb.from("locations").delete().eq("id", id);
  if (error) console.error("delete location:", error);
}

async function saveProject(proj) {
  if (proj._isNew) {
    const { data, error } = await sb.from("projects").insert({ name: proj.name }).select().single();
    if (error) { console.error("insert project:", error); return null; }
    return { id: data.id, name: data.name, createdAt: new Date(data.created_at).getTime() };
  }
  return proj;
}

// Legacy save() kept as a no-op so existing event handlers don't break during init
function save() {}

let db = { projects: [], activeProjectId: null, locations: [] };
function activeProject() { return db.projects.find((p) => p.id === db.activeProjectId) || db.projects[0]; }
function projectLocs() { return db.locations.filter((l) => l.projectId === db.activeProjectId); }

/* ---------- migrate localStorage → Supabase ---------- */
async function migrateLocalStorage() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return;
  let old;
  try { old = JSON.parse(raw); } catch { return; }
  if (!old.locations || !old.locations.length) { localStorage.removeItem(STORE_KEY); return; }

  console.log(`Migrating ${old.locations.length} location(s) from localStorage → Supabase…`);
  const projMap = {};

  // Create any localStorage projects that don't already exist in Supabase
  for (const op of (old.projects || [])) {
    const existing = db.projects.find((p) => p.name === op.name);
    if (existing) {
      projMap[op.id] = existing.id;
    } else {
      const { data, error } = await sb.from("projects").insert({ name: op.name }).select().single();
      if (error) { console.error("migrate project:", error); continue; }
      const p = { id: data.id, name: data.name, createdAt: new Date(data.created_at).getTime() };
      db.projects.push(p);
      projMap[op.id] = p.id;
    }
  }

  // Migrate locations
  for (const loc of old.locations) {
    loc.projectId = projMap[loc.projectId] || db.activeProjectId;
    loc.id = null; // force insert
    await saveLocation(loc);
    db.locations.push(loc);
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

// Boot: load geojson + Supabase data in parallel, then render
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
    L.marker([lat, lng], { interactive: false, icon: L.divIcon({ className: "hood-label", html: f.properties.name }) }).addTo(map);
  });
  fitWhenReady();
  buildHoodFilter();

  // Set up Supabase data
  if (dbRes) { db = dbRes; }

  // Migrate any existing localStorage data
  await migrateLocalStorage();

  render();
})().catch((e) => console.error("Boot failed:", e));

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
// Focus management for the slide-over panels (keyboard a11y)
function captureFocus() { const ae = document.activeElement; if (ae && ae !== document.body && !ae.closest(".panel")) lastFocused = ae; }
function restoreFocus() { if (lastFocused && document.body.contains(lastFocused)) { try { lastFocused.focus(); } catch (e) {} } }

function openDetail(source, isNew) {
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
    <div class="subhead">📷 Reference photos <button class="btn ghost" id="add-photo">＋ URL</button></div>
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

  document.getElementById("add-contact").onclick = () => { editing.contacts.push({ name: "", role: "", detail: "" }); renderContacts(); };
  document.getElementById("add-interview").onclick = () => { editing.interviews.push({ subject: "", role: "", status: "idea" }); renderInterviews(); };
  document.getElementById("add-footage").onclick = () => { editing.footage.push({ label: "", notes: "" }); renderFootage(); };
  document.getElementById("add-photo").onclick = () => { editing.photos.push(""); renderPhotos(); };
  document.getElementById("d-save").onclick = saveDetail;
  document.getElementById("d-plan").onclick = () => { saveDetail(); openPlanner(db.locations.find((l) => l.id === editing.id)); };
  const del = document.getElementById("d-delete");
  if (del) del.onclick = () => removeLoc(editing.id);

  const panel = document.getElementById("detail");
  panel.hidden = false;
  panel.focus();   // move focus into the dialog for keyboard/screen-reader users
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
  arr.forEach((item, i) => wrap.appendChild(repeatRow(fields, item, () => { arr.splice(i, 1); fillRepeat(containerId, arr, emptyMsg, fields); })));
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
    const rm = document.createElement("button"); rm.className = "rm"; rm.textContent = "✕"; rm.onclick = () => { editing.photos.splice(i, 1); renderPhotos(); };
    row.append(inp, rm); wrap.appendChild(row);
  });
  const grid = document.createElement("div"); grid.className = "photo-grid";
  editing.photos.filter(Boolean).forEach((u) => { const img = document.createElement("img"); img.src = u; img.onerror = () => (img.style.display = "none"); grid.appendChild(img); });
  wrap.appendChild(grid);
}
async function saveDetail() {
  editing.title = (editing.title || "").trim() || "Untitled";
  // drop empty repeatable rows so blank entries don't count toward chips/exports
  editing.contacts = editing.contacts.filter((c) => c.name || c.role || c.detail);
  editing.interviews = editing.interviews.filter((i) => i.subject || i.role);
  editing.footage = editing.footage.filter((f) => f.label || f.notes);
  editing.photos = editing.photos.filter(Boolean);
  if (isNewLoc) { editing.projectId = db.activeProjectId; }
  await saveLocation(editing);
  if (isNewLoc) { db.locations.push(editing); isNewLoc = false; }
  else { const i = db.locations.findIndex((l) => l.id === editing.id); if (i >= 0) db.locations[i] = editing; }
  closeDetail(); render();
}
async function removeLoc(id) {
  const loc = db.locations.find((l) => l.id === id);
  if (!confirm(`Delete ${loc && loc.title ? `“${loc.title}”` : "this location"}? This can't be undone.`)) return;
  await deleteLocation(id); db.locations = db.locations.filter((l) => l.id !== id); closeDetail(); render();
}
function closeDetail() { document.getElementById("detail").hidden = true; editing = null; clearTempMarker(); restoreFocus(); }
document.getElementById("detail-close").onclick = closeDetail;

/* ---------- shoot-day planner ---------- */
function openPlanner(anchor) {
  if (!anchor) return;
  captureFocus();
  closeDetail(); plannerAnchor = anchor;
  const panel = document.getElementById("planner");
  panel.hidden = false;
  renderPlanner(2);
  panel.focus();
}
function renderPlanner(km) {
  const a = plannerAnchor;
  const near = projectLocs().filter((l) => l.id !== a.id).map((l) => ({ l, d: distKm(a, l) })).filter((x) => x.d <= km).sort((x, y) => x.d - y.d);
  document.getElementById("planner-body").innerHTML = `
    <div class="field"><label>Anchor</label><b>${esc(a.title)}</b> · ${esc(a.neighbourhood)}</div>
    <div class="field"><label>Radius: <span class="dist">${km.toFixed(1)} km</span></label>
      <input id="r-range" type="range" min="0.5" max="10" step="0.5" value="${km}"></div>
    <div class="field"><label>${near.length + 1} stop${near.length ? "s" : ""} this day</label></div>
    <div class="plan-item"><b>${esc(a.title)}</b> <span class="dist">0.0 km</span><div class="pm">${esc(a.neighbourhood)} · ${STATUS[a.status].label}</div></div>
    ${near.map((x) => `<div class="plan-item"><b>${esc(x.l.title)}</b> <span class="dist">${x.d.toFixed(1)} km</span><div class="pm">${esc(x.l.neighbourhood)} · ${STATUS[x.l.status].label}</div></div>`).join("")}
    <div class="panel-actions"><button class="btn primary" id="plan-export">⭳ Export shoot list</button></div>`;
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
function exportShootList(a, km, near) {
  const L = [`SHOOT DAY — ${activeProject().name}`, `Anchor: ${a.title} (${a.neighbourhood})`, `Within ${km.toFixed(1)} km — ${near.length + 1} locations`, "",
    `1. ${a.title} — ${a.neighbourhood} — 0.0 km — ${STATUS[a.status].label}`];
  near.forEach((x, i) => L.push(`${i + 2}. ${x.l.title} — ${x.l.neighbourhood} — ${x.d.toFixed(1)} km — ${STATUS[x.l.status].label}`));
  download(L.join("\n"), `shoot-day-${(a.neighbourhood || "scarborough").replace(/\W+/g, "-").toLowerCase()}.txt`, "text/plain");
}
function download(content, name, type) { const b = new Blob([content], { type }); const u = document.createElement("a"); u.href = URL.createObjectURL(b); u.download = name; u.click(); }

/* ---------- markers + sidebar ---------- */
function drawMarkers(list) {
  markers.forEach((m) => map.removeLayer(m)); markers.clear();
  list.forEach((loc) => {
    const m = L.circleMarker([loc.lat, loc.lng], { radius: 7, weight: 2, color: "#0c1117", fillColor: STATUS[loc.status].color, fillOpacity: 1 }).addTo(map);
    m.bindTooltip(loc.title || "Untitled");
    m.on("click", () => openDetail(loc, false));
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
  document.getElementById("count").textContent = `${n} location${n === 1 ? "" : "s"}`;
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
    if (loc.interviews?.length) chips.push(`🎤 ${loc.interviews.length}`);
    if (loc.footage?.length) chips.push(`🎬 ${loc.footage.length}`);
    if (loc.contacts?.length) chips.push(`👤 ${loc.contacts.length}`);
    if (loc.photos?.filter(Boolean).length) chips.push(`📷 ${loc.photos.filter(Boolean).length}`);
    if (loc.permit && loc.permit !== "n/a") chips.push(`📋 ${loc.permit}`);
    const card = document.createElement("div");
    card.className = `card s-${loc.status}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open ${loc.title || "Untitled"}`);
    card.innerHTML = `
      <div class="t">${esc(loc.title)} <span class="badge ${loc.status}">${STATUS[loc.status].label}</span></div>
      <div class="meta">📍 ${esc(loc.neighbourhood)} · ${esc(loc.category)} <button type="button" class="del" title="Delete" aria-label="Delete ${esc(loc.title)}">✕</button></div>
      ${chips.length ? `<div class="chips">${chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div>` : ""}`;
    const open = () => { map.flyTo([loc.lat, loc.lng], 15, { duration: 0.6 }); openDetail(loc, false); };
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
async function reverseGeocode(lat, lng) {
  try {
    const d = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { "Accept-Language": "en" } }
    ).then((r) => r.json());
    const a = d.address || {};
    // prefer the feature's own name (park, building, landmark); else build a street address
    const name = (d.name && d.name.trim())
      || [a.house_number, a.road].filter(Boolean).join(" ")
      || a.neighbourhood || a.suburb || "";
    // keep the local part of display_name (drop the city/province/country tail)
    const address = (d.display_name || "").split(",").slice(0, 4).join(",").trim();
    return { name, address };
  } catch (e) { console.error("reverseGeocode:", e); return { name: "", address: "" }; }
}
async function searchPlaces(q) {
  // viewbox biases results toward Scarborough: W,N,E,S
  const viewbox = "-79.32,43.86,-79.10,43.68";
  try {
    const rows = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${viewbox}&bounded=1&limit=6&addressdetails=1`,
      { headers: { "Accept-Language": "en" } }
    ).then((r) => r.json());
    return (rows || []).map((r) => ({
      name: r.name || (r.display_name || "").split(",")[0],
      label: r.display_name || "",
      lat: parseFloat(r.lat), lng: parseFloat(r.lon),
    }));
  } catch (e) { console.error("searchPlaces:", e); return []; }
}
async function nearbyFeatures(lat, lng) {
  // every named building / park / amenity within ~60 m of the click, nearest first
  const q = `[out:json][timeout:10];(nwr(around:60,${lat},${lng})[name];);out tags center 40;`;
  try {
    const data = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q),
    }).then((r) => r.json());
    const seen = new Set();
    return (data.elements || [])
      .map((el) => { const c = el.center || el; return { name: el.tags && el.tags.name, lat: c.lat, lng: c.lon }; })
      .filter((e) => e.name && e.lat != null && !seen.has(e.name) && seen.add(e.name))
      .map((e) => ({ ...e, d: distKm({ lat, lng }, e) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
  } catch (e) { console.error("nearbyFeatures:", e); return []; }
}
async function fetchNearestWiki(lat, lng) {
  const geoData = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=500&gslimit=5&format=json&origin=*`
  ).then((r) => r.json());
  const pages = (geoData?.query?.geosearch) || [];
  if (!pages.length) return null;
  const title = pages[0].title;
  const sum = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`).then((r) => r.json());
  const extract = sum.extract || "";
  const short = extract.length > 240 ? extract.slice(0, 240).replace(/\s\S*$/, "") + "…" : extract;
  const url = sum.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
  const others = pages.slice(1, 3).map((p) => esc(p.title)).join(", ");
  return { title, short, url, others };
}

/* ---------- explore mode: neighbourhood blurb + nearest Wikipedia landmark ---------- */
async function exploreAt(latlng) {
  const { lat, lng } = latlng;
  const hood = findHood(lat, lng);
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
  openDetail(d, true);                       // opens immediately so it feels instant
  showTempMarker(latlng.lat, latlng.lng);    // visible, draggable pin
  enrichEditing(latlng.lat, latlng.lng);     // fills title + address + nearby chips
}
async function enrichEditing(lat, lng) {
  const token = ++enrichToken;
  const chipsEl = document.getElementById("nearby-chips");
  if (chipsEl) chipsEl.innerHTML = `<span class="nearby-loading">Identifying…</span>`;
  const [geo, near] = await Promise.all([reverseGeocode(lat, lng), nearbyFeatures(lat, lng)]);
  if (token !== enrichToken || !editing) return;  // editor was closed or moved on
  if (!editing.title && geo.name) {               // don't clobber anything the user typed
    editing.title = geo.name;
    const t = document.getElementById("f-title"); if (t) t.value = geo.name;
  }
  if (geo.address) {
    editing.address = geo.address;
    const a = document.getElementById("f-address"); if (a) a.value = geo.address;
  }
  renderNearbyChips(near);
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
      editing.title = f.name;
      const t = document.getElementById("f-title"); if (t) t.value = f.name;
      editing.lat = f.lat; editing.lng = f.lng;          // snap pin to the chosen feature
      setHoodField(findHood(f.lat, f.lng));
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
["search", "filter-status", "filter-hood"].forEach((id) => document.getElementById(id).addEventListener("input", render));
document.getElementById("project-select").onchange = (e) => { db.activeProjectId = e.target.value; fitted = false; render(); };
document.getElementById("new-project").onclick = async () => {
  const name = prompt("New project (film / production) name:");
  if (!name) return;
  const p = await saveProject({ _isNew: true, name: name.trim() });
  if (!p) return;
  db.projects.push(p); db.activeProjectId = p.id; render();
};
document.getElementById("plan-day").onclick = () => {
  const locs = projectLocs();
  if (!locs.length) { alert("Add a location first, then plan a day around it."); return; }
  openPlanner(locs[0]);
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
document.getElementById("sidebar-toggle").onclick = () => document.getElementById("sidebar").classList.toggle("collapsed");
document.getElementById("explore-toggle").addEventListener("click", () => {
  exploreMode = !exploreMode;
  const btn = document.getElementById("explore-toggle");
  btn.classList.toggle("active", exploreMode);
  btn.textContent = exploreMode ? "✕ Exit explore" : "🔍 What's here?";
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
});

/* keyboard: Esc closes the open slide-over; Tab is trapped within it */
document.addEventListener("keydown", (e) => {
  const detail = document.getElementById("detail"), planner = document.getElementById("planner");
  const panel = !detail.hidden ? detail : (!planner.hidden ? planner : null);
  if (!panel) return;
  if (e.key === "Escape") { e.preventDefault(); panel === detail ? closeDetail() : closePlanner(); return; }
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
