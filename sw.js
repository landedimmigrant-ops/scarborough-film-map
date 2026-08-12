/* Scarborough Film Map — service worker (offline field use)
   Per-resource strategies:
   - same-origin app shell + data files: network-first → cache fallback (precached on install,
     so the whole app works with no signal; network-first keeps local dev + deploys fresh)
   - CDN libs (unpkg): stale-while-revalidate
   - map tiles (OSM / Esri): cache-first with an LRU cap — recently viewed areas work offline
   - GET /api/db: network-first → cached fallback (last-known locations offline). Since the
     Neon migration this is ONE entry holding the whole snapshot, so the offline copy can no
     longer be a half-set of five Supabase queries that disagree with each other.
     Writes are never intercepted — the app itself alerts honestly when a save fails.
   - GET /api/photo/<key>: cache-first under the tile cap — R2 keys are uuids, so a cached
     photo is never stale, and reference shots stay visible in the field with no signal
   - Nominatim / Overpass / Wikipedia: network only (usage policies + the app degrades gracefully) */
const VERSION = "sfm-v2";   // bumped by the Supabase→Neon migration: old caches hold dead API URLs
const SHELL = `${VERSION}-shell`;
const CDN = `${VERSION}-cdn`;
const TILES = `${VERSION}-tiles`;
const API = `${VERSION}-api`;
const PHOTOS = `${VERSION}-photos`;
const TILE_CAP = 400;
const PHOTO_CAP = 300;

const PRECACHE = [
  "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "data/scarborough.geojson", "data/scarborough-boundary.geojson", "data/neighbourhood-blurbs.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];
const CDN_PRECACHE = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(PRECACHE);
    const cdn = await caches.open(CDN);
    // a CDN hiccup shouldn't block install — these also fill in at runtime
    await Promise.all(CDN_PRECACHE.map((u) => cdn.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName, revalidate) {
  const cache = await caches.open(cacheName);
  try {
    let fetchReq = req;
    if (revalidate) {
      // bypass the browser's heuristic HTTP cache so local edits show on the next plain reload
      try { fetchReq = new Request(req, { cache: "no-cache" }); }
      catch (e) { fetchReq = new Request(req.url, { cache: "no-cache" }); }  // navigation requests can't be copied
    }
    const res = await fetch(fetchReq);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirstCapped(req, cacheName, cap) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) {
    await cache.put(req, res.clone());
    trimCache(cache, cap); // async, not awaited — pruning can lag a request
  }
  return res;
}

async function trimCache(cache, cap) {
  const keys = await cache.keys();
  if (keys.length > cap) await Promise.all(keys.slice(0, keys.length - cap).map((k) => cache.delete(k)));
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  if (hit) return hit;
  const res = await refresh;
  if (res) return res;
  throw new Error("offline and not cached: " + req.url);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // writes always hit the network
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // The public guest page is left entirely alone. It isn't part of Prem's app,
    // it's a one-visit page reached from a shared link, and a contributor must
    // never be served a cached copy of a form — nor should visiting it seed this
    // worker's caches. (It registers no worker itself; this guards the case where
    // Prem's own browser, which HAS the worker, opens the link to check it.)
    if (url.pathname === "/suggest" || url.pathname.startsWith("/suggest.")) return;

    // The API is same-origin now (it was supabase.co before the Neon migration), so
    // these two must be tested BEFORE the app-shell branch below — otherwise data
    // and photos land in the shell cache under shell rules.
    if (url.pathname.startsWith("/api/photo/")) { e.respondWith(cacheFirstCapped(req, PHOTOS, PHOTO_CAP)); return; }
    // Never cache the public write path or the review queue: a cached 429 or a
    // stale queue is worse than an honest network error.
    if (url.pathname.startsWith("/api/public/")) return;
    if (url.pathname.startsWith("/api/")) { e.respondWith(networkFirst(req, API)); return; }
    e.respondWith(networkFirst(req, SHELL, true)); return;
  }
  if (url.hostname === "unpkg.com") { e.respondWith(staleWhileRevalidate(req, CDN)); return; }
  if (url.hostname === "tile.openstreetmap.org" || url.hostname === "server.arcgisonline.com") {
    e.respondWith(cacheFirstCapped(req, TILES, TILE_CAP)); return;
  }
  // anything else (Nominatim, Wikipedia, …) falls through to the network untouched
});
