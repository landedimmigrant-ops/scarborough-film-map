/* Scarborough Shoot Map — v2
   A documentary-organizing tool: projects -> locations -> footage / interviews / logistics,
   plus a proximity "plan a shoot day" generator.
   Base map: OpenStreetMap (ODbL). Boundaries: City of Toronto Open Data (158 neighbourhoods).
   Storage: localStorage. The DB shape maps 1:1 to Supabase/PostGIS (see README). */

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
    id: rid("loc_"), createdAt: Date.now(), projectId: null,
    title: "", neighbourhood: "", status: "idea", category: "Exterior",
    shootDate: "", bestTime: "", parking: "", permit: "n/a", lat: 0, lng: 0,
    contacts: [], interviews: [], footage: [], photos: [], notes: "",
  };
}
function loadDB() {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) { try { return JSON.parse(raw); } catch {} }
  const proj = { id: rid("prj_"), name: "Untitled film", createdAt: Date.now() };
  const db = { projects: [proj], activeProjectId: proj.id, locations: [] };
  const v1 = localStorage.getItem(V1_KEY);             // carry over prototype pins
  if (v1) { try { JSON.parse(v1).forEach((l) => db.locations.push(Object.assign(blankLoc(), l, { projectId: proj.id }))); } catch {} }
  return db;
}
let db = loadDB();
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
function activeProject() { return db.projects.find((p) => p.id === db.activeProjectId) || db.projects[0]; }
function projectLocs() { return db.locations.filter((l) => l.projectId === db.activeProjectId); }

let hoods = [];
const markers = new Map();
let editing = null, isNewLoc = false, plannerAnchor = null, planCircle = null;

/* ---------- map ---------- */
const map = L.map("map", { zoomControl: true }).setView([43.773, -79.233], 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

let hoodLayer, fitted = false;
function fitWhenReady() {
  const el = map.getContainer();
  if (el.clientHeight > 0 && el.clientWidth > 0) {
    map.invalidateSize();
    if (!fitted && hoodLayer) { map.fitBounds(hoodLayer.getBounds(), { padding: [20, 20] }); fitted = true; }
  }
}
new ResizeObserver(fitWhenReady).observe(map.getContainer());

fetch("data/scarborough.geojson")
  .then((r) => r.json())
  .then((geo) => {
    hoods = geo.features;
    hoodLayer = L.geoJSON(geo, {
      style: () => ({ color: "#4ea1ff", weight: 1, fillColor: "#4ea1ff", fillOpacity: 0.05 }),
      onEachFeature: (f, layer) => {
        layer.on("mouseover", () => layer.setStyle({ fillOpacity: 0.18, weight: 2 }));
        layer.on("mouseout", () => hoodLayer.resetStyle(layer));
        layer.bindTooltip(() => hoodTooltip(f.properties.name), { sticky: true });
      },
    }).addTo(map);
    geo.features.forEach((f) => {
      const [lng, lat] = f.properties.centroid;
      L.marker([lat, lng], { interactive: false, icon: L.divIcon({ className: "hood-label", html: f.properties.name }) }).addTo(map);
    });
    fitWhenReady();
    buildHoodFilter();
    render();
  })
  .catch((e) => console.error("Failed to load neighbourhoods:", e));

map.on("click", (e) => { const d = blankLoc(); d.lat = e.latlng.lat; d.lng = e.latlng.lng; openDetail(d, true); });

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
function openDetail(source, isNew) {
  closePlanner();
  editing = JSON.parse(JSON.stringify(source));
  isNewLoc = !!isNew;
  if (isNewLoc) editing.neighbourhood = findHood(editing.lat, editing.lng);
  document.getElementById("detail-h").textContent = isNewLoc ? "New location" : "Edit location";
  document.getElementById("detail-body").innerHTML = `
    <div class="field"><label>Title</label><input id="f-title" value="${esc(editing.title)}" placeholder="e.g. Bluffs cliff edge"></div>
    <div class="field"><label>Neighbourhood (auto)</label><input value="${esc(editing.neighbourhood)}" readonly></div>
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

  document.getElementById("detail").hidden = false;
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
function saveDetail() {
  editing.title = (editing.title || "").trim() || "Untitled";
  // drop empty repeatable rows so blank entries don't count toward chips/exports
  editing.contacts = editing.contacts.filter((c) => c.name || c.role || c.detail);
  editing.interviews = editing.interviews.filter((i) => i.subject || i.role);
  editing.footage = editing.footage.filter((f) => f.label || f.notes);
  editing.photos = editing.photos.filter(Boolean);
  if (isNewLoc) { editing.projectId = db.activeProjectId; db.locations.push(editing); isNewLoc = false; }
  else { const i = db.locations.findIndex((l) => l.id === editing.id); if (i >= 0) db.locations[i] = editing; }
  save(); closeDetail(); render();
}
function removeLoc(id) { db.locations = db.locations.filter((l) => l.id !== id); save(); closeDetail(); render(); }
function closeDetail() { document.getElementById("detail").hidden = true; editing = null; }
document.getElementById("detail-close").onclick = closeDetail;

/* ---------- shoot-day planner ---------- */
function openPlanner(anchor) {
  if (!anchor) return;
  closeDetail(); plannerAnchor = anchor;
  document.getElementById("planner").hidden = false;
  renderPlanner(2);
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
function renderList(list) {
  const el = document.getElementById("list");
  if (!list.length) { el.innerHTML = `<div class="empty">No locations in this project yet.<br>Click anywhere on the map to add your first one.</div>`; return; }
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
    card.innerHTML = `
      <div class="t">${esc(loc.title)} <span class="badge ${loc.status}">${STATUS[loc.status].label}</span></div>
      <div class="meta">📍 ${esc(loc.neighbourhood)} · ${esc(loc.category)} <span class="del" title="Delete">✕</span></div>
      ${chips.length ? `<div class="chips">${chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div>` : ""}`;
    card.onclick = (e) => {
      if (e.target.classList.contains("del")) { removeLoc(loc.id); return; }
      map.flyTo([loc.lat, loc.lng], 15, { duration: 0.6 });
      openDetail(loc, false);
    };
    el.appendChild(card);
  });
}
function hoodTooltip(name) { const n = projectLocs().filter((l) => l.neighbourhood === name).length; return `<b>${name}</b><br>${n} shoot location${n === 1 ? "" : "s"}`; }
function buildHoodFilter() {
  const sel = document.getElementById("filter-hood");
  hoods.map((f) => f.properties.name).sort().forEach((n) => { const o = document.createElement("option"); o.value = o.textContent = n; sel.appendChild(o); });
}

/* ---------- controls ---------- */
["search", "filter-status", "filter-hood"].forEach((id) => document.getElementById(id).addEventListener("input", render));
document.getElementById("project-select").onchange = (e) => { db.activeProjectId = e.target.value; save(); fitted = false; render(); };
document.getElementById("new-project").onclick = () => {
  const name = prompt("New project (film / production) name:");
  if (!name) return;
  const p = { id: rid("prj_"), name: name.trim(), createdAt: Date.now() };
  db.projects.push(p); db.activeProjectId = p.id; save(); render();
};
document.getElementById("plan-day").onclick = () => {
  const locs = projectLocs();
  if (!locs.length) { alert("Add a location first, then plan a day around it."); return; }
  openPlanner(locs[0]);
};
document.getElementById("use-location").onclick = () => {
  if (!navigator.geolocation) { alert("Geolocation not supported on this device."); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => { const { latitude: lat, longitude: lng } = pos.coords; map.flyTo([lat, lng], 15); const d = blankLoc(); d.lat = lat; d.lng = lng; openDetail(d, true); },
    (err) => alert("Couldn't get your location: " + err.message),
    { enableHighAccuracy: true, timeout: 10000 }
  );
};
document.getElementById("export").onclick = () => download(JSON.stringify({ project: activeProject(), locations: projectLocs() }, null, 2), `${activeProject().name.replace(/\W+/g, "-").toLowerCase()}.json`, "application/json");
document.getElementById("sidebar-toggle").onclick = () => document.getElementById("sidebar").classList.toggle("collapsed");
