/* Scarborough Film Map — guest suggestion page.
   Standalone from app.js on purpose: a contributor arriving from a shared link
   should download a form, not a whole production workspace (no editor, no
   planner, no exports, no auth surface).

   It shows the neighbourhood boundaries but NOT Prem's existing locations —
   his scouting list, contacts and shoot dates are private working material, and
   the only endpoint this page can reach is POST /api/public/suggest. */

const SCARB_CENTRE = [43.773, -79.233];
const NOMINATIM = "https://nominatim.openstreetmap.org";

let pin = null, hoodLayer = null;
let picked = null;              // { lat, lng } — null until they place a pin
let searchTimer = null;

/* ---------- map ---------- */
// scrollWheelZoom off: the map sits mid-form, and hijacking the wheel while
// someone scrolls past it to reach the fields is a well-earned annoyance.
const map = L.map("map", { zoomControl: true, scrollWheelZoom: false }).setView(SCARB_CENTRE, 11);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Boundaries are decoration and orientation here, so they must never swallow a
// tap meant to drop a pin.
fetch("data/scarborough.geojson")
  .then((r) => r.json())
  .then((geo) => {
    hoodLayer = L.geoJSON(geo, {
      interactive: false,
      style: () => ({ color: "#4ea1ff", weight: 1, opacity: .45, fillColor: "#4ea1ff", fillOpacity: .04 }),
    }).addTo(map);
    fitScarborough();
  })
  .catch(() => { /* no boundaries is survivable — the form still works */ });

fetch("data/scarborough-boundary.geojson")
  .then((r) => r.json())
  .then((b) => L.geoJSON(b, { interactive: false, style: () => ({ color: "#4ea1ff", weight: 2.5, opacity: .9, fill: false }) }).addTo(map))
  .catch(() => {});

/* Frame Scarborough in the map box.
   invalidateSize() first, and maxZoom as a backstop: fitBounds derives its scale
   from the container's pixel size, and if it runs while the container still
   measures 0×0 (stylesheet not yet applied, box laid out mid-form) the scale
   calculation saturates and you land at zoom 19 looking at house numbers — with
   perfectly valid bounds, which makes it a confusing thing to debug. */
function fitScarborough() {
  if (!hoodLayer) return;
  map.invalidateSize();
  const b = hoodLayer.getBounds();
  if (b.isValid()) map.fitBounds(b, { padding: [10, 10], maxZoom: 13 });
}

// Fonts and late layout can change the box after first paint; one deferred refit
// costs nothing and covers the slow-CSS case.
window.addEventListener("load", () => { if (!picked) fitScarborough(); });

function setPin(lat, lng, { fly = false } = {}) {
  picked = { lat, lng };
  if (!pin) {
    pin = L.marker([lat, lng], { draggable: true }).addTo(map);
    pin.on("dragend", () => {
      const p = pin.getLatLng();
      picked = { lat: p.lat, lng: p.lng };
      describePin();
    });
  } else {
    pin.setLatLng([lat, lng]);
  }
  if (fly) map.setView([lat, lng], Math.max(map.getZoom(), 15));
  describePin();
}

// Reverse-geocode purely to reassure the contributor they pinned the right spot.
// Failure is silent: the coordinates are what actually get submitted.
async function describePin() {
  const el = document.getElementById("picked");
  el.hidden = false;
  el.textContent = "📍 Pin placed. Checking the address…";
  document.getElementById("map-hint").textContent = "Drag the pin if it isn't quite right.";
  const { lat, lng } = picked;
  try {
    const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
      headers: { Accept: "application/json" },
    });
    const j = await r.json();
    if (!picked || picked.lat !== lat || picked.lng !== lng) return;   // moved again mid-flight
    el.textContent = j && j.display_name ? `📍 ${j.display_name}` : "📍 Pin placed.";
    // Offer the place name as a title, but never overwrite what they typed.
    const t = document.getElementById("f-title");
    const nice = j && j.name;
    if (nice && !t.value.trim()) t.value = nice;
  } catch {
    el.textContent = "📍 Pin placed.";
  }
}

map.on("click", (e) => setPin(e.latlng.lat, e.latlng.lng));

/* ---------- place search ---------- */
const qEl = document.getElementById("place-q");
const resEl = document.getElementById("place-results");

qEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = qEl.value.trim();
  if (q.length < 3) { resEl.hidden = true; return; }
  // Debounced: Nominatim's usage policy asks for restraint, and a keystroke-per-
  // request search would be both rude and slower.
  searchTimer = setTimeout(() => runSearch(q), 350);
});

async function runSearch(q) {
  try {
    const url = `${NOMINATIM}/search?format=jsonv2&limit=6&countrycodes=ca` +
      `&viewbox=-79.45,44.00,-78.95,43.55&bounded=1&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const list = await r.json();
    resEl.innerHTML = "";
    if (!Array.isArray(list) || !list.length) {
      resEl.innerHTML = `<li aria-disabled="true" style="color:var(--muted);cursor:default">No match in Scarborough — try tapping the map instead.</li>`;
      resEl.hidden = false;
      return;
    }
    list.forEach((p) => {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.textContent = p.display_name;
      const go = () => {
        setPin(parseFloat(p.lat), parseFloat(p.lon), { fly: true });
        const t = document.getElementById("f-title");
        if (!t.value.trim()) t.value = p.name || p.display_name.split(",")[0];
        resEl.hidden = true;
        qEl.value = "";
      };
      li.onclick = go;
      li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
      resEl.appendChild(li);
    });
    resEl.hidden = false;
  } catch {
    resEl.hidden = true;
  }
}

// Enter in the search box shouldn't submit the whole form.
qEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchTimer); runSearch(qEl.value.trim()); }
});

/* ---------- my location ---------- */
document.getElementById("locate").onclick = () => {
  const btn = document.getElementById("locate");
  if (!navigator.geolocation) { showErr("This browser can't share your location — tap the map instead."); return; }
  btn.disabled = true; btn.textContent = "…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false; btn.textContent = "📍";
      setPin(pos.coords.latitude, pos.coords.longitude, { fly: true });
    },
    () => {
      btn.disabled = false; btn.textContent = "📍";
      showErr("Couldn't get your location — tap the map instead.");
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
};

/* ---------- submit ---------- */
function showErr(msg) {
  const el = document.getElementById("err");
  el.textContent = msg;
  el.hidden = false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}
function clearErr() { document.getElementById("err").hidden = true; }

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErr();

  const title = document.getElementById("f-title").value.trim();
  const name = document.getElementById("f-name").value.trim();

  // Validate in the order the form reads, and focus what's missing — a generic
  // "fill in the form" makes someone hunt.
  if (!picked) { showErr("Please pick the spot on the map first."); document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  if (!title) { showErr("What's this place called?"); document.getElementById("f-title").focus(); return; }
  if (!name) { showErr("Please add your name so I can credit you."); document.getElementById("f-name").focus(); return; }

  const btn = document.getElementById("submit");
  btn.disabled = true; btn.textContent = "Sending…";

  const body = {
    lat: picked.lat, lng: picked.lng, title,
    note: document.getElementById("f-note").value.trim(),
    name,
    email: document.getElementById("f-email").value.trim(),
    creditName: document.getElementById("f-credit").value.trim(),
    creditConsent: document.getElementById("f-consent").checked,
  };

  try {
    const r = await fetch("api/public/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && data.error) || `Something went wrong (${r.status}).`);

    document.getElementById("form").hidden = true;
    document.getElementById("intro").hidden = true;
    const t = document.getElementById("thanks");
    document.getElementById("thanks-body").textContent = body.creditConsent
      ? `“${title}” is on its way to Prem. If it makes the film you'll be credited as ${body.creditName || name}.`
      : `“${title}” is on its way to Prem. You asked not to be credited, so you won't be named.`;
    t.hidden = false;
    t.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (err) {
    // Show the server's actual message — the API returns human-readable reasons
    // ("That spot is outside the Scarborough area…") worth passing through.
    showErr(err.message || "Couldn't send that — check your connection and try again.");
    btn.disabled = false; btn.textContent = "Send suggestion";
  }
});

// "Suggest another" keeps their identity fields — most people who send one send two.
document.getElementById("again").onclick = () => {
  document.getElementById("thanks").hidden = true;
  document.getElementById("intro").hidden = false;
  document.getElementById("form").hidden = false;
  document.getElementById("f-title").value = "";
  document.getElementById("f-note").value = "";
  if (pin) { map.removeLayer(pin); pin = null; }
  picked = null;
  document.getElementById("picked").hidden = true;
  document.getElementById("map-hint").textContent = "Tap the map to drop a pin. Drag it to fine-tune.";
  const btn = document.getElementById("submit");
  btn.disabled = false; btn.textContent = "Send suggestion";
  document.getElementById("intro").scrollIntoView({ behavior: "smooth", block: "start" });
};
