# Scarborough Film Map — Usability Experiment Log

An hourly self-running loop (session cron `40705515`). Each cycle picks **one** usability
hypothesis, evaluates it on desktop **and** mobile, records the outcome, and updates the
backlog below. **Goal: easy to navigate and use on desktop and mobile.**

> **Method note — these are *predictions*, not measurements.** There are no live users in this
> loop, so every finding is **expert/heuristic evaluation** (Nielsen's 10 heuristics + Fitts's
> law / Gestalt proximity) done by driving the real app in the preview at desktop (~1200px) and
> mobile (375×812). Treat the backlog as "high-confidence hypotheses to validate with real users
> later," not proven wins. Anything marked 🔴 was directly observed in a screenshot.

---

## Ongoing changes backlog (prioritized)

Ranked by impact ÷ effort. Status: `proposed` → `accepted` → `done` / `rejected`.

| # | Change | Heuristic | Impact | Effort | Status | From |
|---|---|---|---|---|---|---|
| 10 | 🔴 **Guard destructive delete.** The card ✕ and the editor Delete button remove a location immediately — no confirm, no undo — and on mobile that card ✕ is a **9×15px** target, so accidental permanent deletes are likely. Add a confirm step (or an undo toast). | Error prevention | **High** | Low | ✅ done (2026-06-25) | C5 |
| 3 | 🔴 **Make the active mode self-evident.** The sidebar guidance always reads "Click the map to add a location" even in explore mode, where a click shows info instead — directly contradicting behaviour. Update the guidance to reflect the live mode (and/or restore mark-mode copy when explore turns off). | Visibility of system status; prevent mode errors | **High** | Low | ✅ done (2026-06-25) | C2 |
| 9 | 🔴 **Enlarge mobile tap targets to ≥44px.** Every interactive control is 15–37px tall at 375px (card ✕ 9×15, row-remove ✕ 26×29, +Add 53×21, close ✕ 36×21, toggles 32–37, selects/inputs 34–36). Grow hit areas via min-height/padding — the visible glyph can stay small. | Accessibility; Fitts's law (touch) | **High** | Low–Med | ✅ done (2026-06-25) | C5 |
| 1 | 🔴 **Mobile: dock the map controls to the map pane.** Satellite, "What's here?", and the place-search must sit *on the map*, not pinned to the viewport bottom where they cover the list. | Proximity / Fitts's law — a control belongs on the surface it affects | **High** | Low–Med | ✅ done (2026-06-25) | C1 |
| 13 | 🔴 **Keyboard-operable list + panels.** List cards are `<div>` (tabIndex −1, no role) so keyboard users can't open a location; the card-delete is a `<span>`; opening the editor leaves focus on `<body>` (no move, no trap); and **Esc doesn't close** the editor/planner. Make cards real buttons, move/trap/restore focus on open/close, add Esc-to-close. | Accessibility; flexibility & efficiency | **High** | Med | ✅ done (2026-06-25) | C7 |
| 5 | 🔴 **Context-aware empty-list message.** The list shows "No locations in this project yet — add your first one" whenever a filter/search excludes everything, even though the stats bar + footer still say "5 locations". Looks like data loss. Show "No locations match your search/filters" + a **Clear** button instead, and only show the true empty state when the project really is empty. | Visibility of system status; error recovery | Med–High | Low | ✅ done (2026-06-25) | C3 |
| 7 | 🔴 **Sticky editor action bar.** Save / Delete / Plan-day sit at the bottom of a ~1.1-screen panel (offset ~877px vs 762–810px visible), so the primary action is below the fold even for a one-field edit — and further as contacts/interviews/footage grow. Pin the action bar to the bottom of the panel. | Efficiency of use; primary action always reachable | Med–High | Low | ✅ done (2026-06-25) | C4 |
| 4 | **Strengthen mode feedback on the map (esp. touch).** Explore mode is signalled only by a far bottom-right button + crosshair cursor; its explanation is a hover tooltip (invisible on touch) and on mobile the button is detached from the map. Add a small on-map "Explore mode" pill while active. | Visibility of system status; help & docs | Med | Low–Med | ✅ done (2026-07-01) | C2 |
| 2 | 🔴 **Fix two-column field labels.** `Status / Type / Shoot date / Best light / Permit / Parking` don't get the small-uppercase label style (the `.field > label` direct-child selector skips nested labels), so they look like a different, louder heading than `TITLE / ADDRESS`. | Consistency & standards | Med | Low | ✅ done (2026-06-25) | C1 |
| 14 | **Visible focus indicators.** Inputs/selects use `outline:none` and signal focus only by a faint accent border; buttons/cards/chips/toggles define no focus style at all. Add a clear `:focus-visible` ring across interactive elements. | Accessibility (WCAG 2.4.7 focus visible) | Med | Low | ✅ done (2026-06-25, with #13) | C7 |
| 11 | 🔴 **Graceful failure for auto-naming.** On reverse-geocode/Overpass failure or hang the title stays stuck on "📍 Identifying this spot…" with no error and no nudge to type — and there's no fetch timeout, so a hung request never resolves. On failure swap to a "Name this location" placeholder (or a subtle "couldn't auto-name") and add a timeout. | Visibility of system status; error recovery | Med | Low–Med | ✅ done (2026-06-25) | C6 |
| 6 | **Clarify the two search boxes.** Map "Find a place to mark" (geocode) vs sidebar "Search locations, people, notes" (filter) differ only by placeholder + position; once you type, the placeholder is gone and nothing says which scope you're in. Add small persistent labels/distinct icons (🔎 place vs filter-funnel) and a clear-on-type affordance. | Recognition rather than recall | Med–Low | Low | ✅ done (2026-06-25) | C3 |
| 12 | **Distinguish "offline/failed" from "no results."** Place-search shows "No places found in Scarborough" and the nearby chips silently empty on a network failure — indistinguishable from a genuine empty result. Show a retry/offline hint on fetch error. | Help users recognise & recover from errors | Low–Med | Low | ✅ done (2026-06-25) | C6 |
| 15 | **Hood labels need cross-basemap legibility.** `.hood-label` is light text + a thin dark text-shadow tuned for the dark street map; over satellite it holds up in dark/treed areas but loses contrast on bright imagery (rooftops, concrete, water glare), and 30 at once clutter the aerial view. Add a subtle semi-opaque dark pill behind labels (and/or thin by zoom when satellite is on). Status pins are fine — dark ring + saturated fill. | Legibility; aesthetic & minimalist | Low–Med | Low | ✅ done (2026-06-25) | C8 |
| 8 | **Optionally collapse logistics in the editor.** Date / best-light / permit / parking sit above the richer narrative sections; a disclosure ("Logistics ▸") or reorder would shorten data-rich editors and surface title/people faster. Lower priority — sparse editors are only ~1 screen. | Aesthetic & minimalist; progressive disclosure | Low–Med | Med | proposed | C4 |
| 16 | 🔴 **Boot failure masquerades as an empty project.** If Supabase fails to load, the list shows "No locations in this project yet — add your first one" (the same illusion #5 fixed for filters), and there's no loading state at all during boot. Show "Loading your locations…" at startup and an error + Retry on load failure; footer count shows "—" instead of a false "0 locations". | Visibility of system status; error recovery | **High** | Low | ✅ done (2026-07-01) | C9 |
| 17 | 🔴 **Save/delete failures are silent (cloud data loss).** `saveDetail` ignored `saveLocation` returning null: the panel closed, the pin appeared locally, and the edit vanished on reload. Double-clicking Save could insert duplicates, and "Plan day" raced the save (broken for brand-new pins). Now: Save disables to "Saving…" while in flight, failure alerts and keeps the editor open with edits intact, delete failure alerts and keeps the location, Plan-day awaits the save and works from new pins. | Error prevention; honest system status | **High** | Low–Med | ✅ done (2026-07-01) | C9 |
| 18 | 🔴 **Unsaved edits discard silently.** Esc, the ✕ close, opening another card, opening the planner, or clicking the map to mark a new pin all threw away typed edits with no warning. Now the editor tracks real user input (typed fields, added/removed rows, chip picks — not programmatic auto-fill) and asks "Discard unsaved changes?" before closing; declining keeps the editor open and blocks the new action. | Error prevention (data loss) | **High** | Med | ✅ done (2026-07-01) | C9 |
| 19 | **Shoot-date chip on list cards.** Cards showed people/footage/permit chips but not the shoot date — the single most scheduling-relevant fact for a scouting list. Cards now show 🗓 YYYY-MM-DD when a date is set. | Recognition rather than recall; use-case fit | Med | Low | ✅ done (2026-07-01) | C9 |
| 20 | 🔴 **Planner anchor was arbitrary and unchangeable.** Sidebar "Plan a day" silently anchored on the *oldest* location with no way to re-anchor inside the planner (you had to know to go through a location's editor). Now: a "Plan around" select lists every location, the sidebar default is the most recently added, and changing it re-renders list + map circle. | User control & freedom; recognition rather than recall | **High** | Low | ✅ done (2026-07-01) | C10 |
| 21 | **Plan items hid shoot dates; export was too thin for the field.** Stops showed hood + status but not 🗓 date (can't tell scheduled/shot stops from open candidates); the exported list had no dates or street addresses. Both added. | Use-case fit (shoot-day batching) | Med | Low | ✅ done (2026-07-01) | C10 |
| 22 | **Sparse default radius gave a bare "1 stop" with no guidance.** At the 2 km default a lone anchor rendered with no nudge. Now an inline hint says "No other locations within X km — widen the radius." | Help & guidance | Low–Med | Low | ✅ done (2026-07-01) | C10 |
| 23 | **Render pipeline didn't scale (100+ pin readiness).** Every keystroke in the sidebar search rebuilt the full list *and* removed/re-added every Leaflet marker. Search input now debounces 200 ms and `drawMarkers` diffs (prune missing, add new, restyle survivors — verified same marker object survives a filter). Marker click handlers now resolve the record by id at click time, fixing a stale-closure risk after save. | Performance; efficiency | Med | Low–Med | ✅ done (2026-07-01) | C10 |
| 24 | 🔴 **Projects can't be renamed.** The live project is literally still called "Untitled film" — the only project operation was *create* (via `prompt()`); no rename anywhere. Added a ✎ button beside the project picker (prompt pre-filled with the current name; failure alerts and leaves the name unchanged). | User control & freedom; use-case fit | Med–High | Low | ✅ done (2026-07-01) | C11 |
| 25 | **No script-writing export (stated roadmap gap).** The only export was raw JSON — unreadable as production material. Added "📝 Scenes": a Markdown scene list grouped by neighbourhood with status, shoot date, logistics (type/light/permit/parking), address, interviews, contacts, footage and notes per location. Footer now offers ⭳ JSON + 📝 Scenes side by side. | Use-case fit (locations → scene list) | **High** | Low–Med | ✅ done (2026-07-01) | C11 |
| 26 | **No offline capability (top roadmap item — field use).** With no signal the app was a blank error. Now a PWA: manifest + icons + service worker with per-resource strategies — app shell & data precached (network-first keeps dev fresh), CDN libs stale-while-revalidate, map tiles cache-first with a 400-entry LRU cap, and Supabase REST GETs network-first with cached fallback, so the field phone shows **last-known locations** offline. Writes are never intercepted — the app's own honest save/delete alerts still apply. | Use-case fit (field scouting); reliability | **High** | Med | ✅ done (2026-07-02) | C12 |
| 27 | **Reference photos required pasted URLs (roadmap gap — useless in the field).** Standing at a location with photos on your phone, there was nowhere to "paste a URL" from. Now 📤 Upload (multi-select, camera roll): images are downscaled client-side to 1600px JPEG (74 KB test → 17.7 KB) and uploaded to a Supabase Storage `photos` bucket; the public URL flows into the existing media-row persistence unchanged. Failures alert honestly; thumbnails click through to full size. | Use-case fit (field scouting) | **High** | Med | ✅ done (2026-07-02) | C13 |
| 28 | **DB hygiene from the advisor run.** `locations_view` was SECURITY DEFINER (ERROR-level advisor) — now `security_invoker = true`, verified anon reads still work. Storage policies are scoped to the `photos` bucket (insert/select/delete for anon — consistent with the app's documented single-user anon-key posture; the pre-existing allow-all table policies remain a known, accepted trade-off). | Security hygiene | Med | Low | ✅ done (2026-07-02) | C13 |

_Table ordered by impact ÷ effort; the `#` column is a stable id, not the rank._

**✅ Shipped 2026-06-25 — verified in preview (desktop + mobile):** the whole **High cluster** —
#10 delete-confirm · #3 mode-aware tagline · #9 mobile tap-targets ≥44px · #1 map controls docked
into the map band on mobile · #13 keyboard access (cards operable via Enter/Space, focus moved into
+ trapped in + restored from the slide-overs, **Esc closes**, dialog roles) — plus **#14**
focus-visible rings, which landed with #13. Desktop layout unchanged.

**✅ Also shipped 2026-06-25 (Low-effort batch) — verified desktop + mobile:** #5 context-aware
empty-state ("No locations match…" + **Clear search & filters** button that restores the list) ·
#7 **sticky editor action bar** (Save/Delete/Plan stay pinned, no scroll needed) · #2 two-column
field labels now match the small-uppercase style · #6 persistent scope labels on both search boxes
("🔍 Filter saved locations" vs "📍 Find a place on the map") + aria-labels.

**✅ Also shipped 2026-06-25 (robustness + legibility):** #11 graceful lookup-failure — `fetchJSON`
adds an 8 s timeout (no more stuck "Identifying…"); on failure the title settles to "Couldn't
auto-name — type a name" and chips show an offline note · #12 search/nearby now distinguish
offline failure ("Couldn't search — check your connection") from genuine empty results · #15 hood
labels get a strong dark halo on satellite (`.sat-on`) so they stay legible over bright imagery.

**✅ Shipped 2026-07-01 (Cycle 9 — data honesty & edit safety, verified desktop + mobile):**
#16 boot honesty (startup "Loading your locations…", load-failure error + ↻ Retry, honest footer
count) · #17 save/delete failure honesty (Save → "Saving…" with double-submit guard; failures
alert and keep the editor open with edits intact; "Plan day" now awaits the save so it works from
brand-new pins) · #18 unsaved-edits guard ("Discard unsaved changes?" on Esc/✕/card-switch/planner/
map-click; only real user input marks the editor dirty, so auto-named pins still close silently) ·
#4 on-map "Explore mode" pill (docked above the map toggles on both layouts) · #19 🗓 shoot-date
chips on list cards.

**Remaining (optional polish, none High-impact):** #8 collapse editor logistics behind a
disclosure. Deferred — sparse editors are ~1 screen.

---

## Backlog of experiments to run next (queue)

So each cycle has a focused target. Pulled from here, newest findings push new ideas on.

- [x] **C2 — First-run clarity.** ✅ done (Cycle 2) — found the guidance contradicts explore mode → backlog #3, #4.
- [x] **C3 — Discoverability of place search vs. list search.** ✅ done (Cycle 3) — distinguishable by position/placeholder, but cross-confusion surfaces a misleading empty state → backlog #5, #6.
- [x] **C4 — Editor density & scroll.** ✅ done (Cycle 4) — editor is only ~1.1 screens when sparse, but Save is below the fold regardless → sticky action bar (#7) beats collapsing fields (#8).
- [x] **C5 — Touch target sizes.** ✅ done (Cycle 5) — all controls 15–37px tall (card ✕ just 9×15); plus delete has no confirm → backlog #9, #10.
- [x] **C6 — Empty/slow states.** ✅ done (Cycle 6) — explore degrades gracefully (local blurb), but auto-naming fails silently (stuck "Identifying…", no timeout) and search/chips can't tell offline from empty → backlog #11, #12.
- [x] **C7 — Keyboard / focus order (desktop a11y).** ✅ done (Cycle 7) — list cards aren't keyboard-operable, no focus move/trap into panels, Esc doesn't close, weak focus rings → backlog #13, #14.
- [x] **C8 — Colour/status legibility on satellite.** ✅ done (Cycle 8) — pins hold up (dark ring), but hood labels lose contrast on bright imagery + clutter → backlog #15.
- [x] **C9 — Data honesty & edit safety (code-path audit).** ✅ done (Cycle 9) — boot failure looked like an empty project, save/delete failed silently (+ double-save duplicates, Plan-day race), and unsaved edits discarded without warning → backlog #16–#18, all fixed same cycle; #4 pill + #19 date chips shipped alongside.
- [x] **C10 — Shoot-day planner ergonomics + render scalability.** ✅ done (Cycle 10) — driven with the real 18-location dataset: sidebar "Plan a day" anchored on the *oldest* location with no re-anchor control, plan stops hid shoot dates, the sparse default radius gave an unexplained "1 stop", and every search keystroke rebuilt all markers → backlog #20–#23, all fixed same cycle.
- [x] **C11 — Project management + script-writing export.** ✅ done (Cycle 11) — the live project was still un-renameable "Untitled film" (#24) and the roadmap's "locations → scene list" export didn't exist (#25); both shipped same cycle (rename ✎ with honest failure handling; Markdown scene list grouped by neighbourhood, verified against real data — 123 lines incl. interviews, footage IDs and story notes).
- [x] **C12 — Offline field-readiness (PWA).** ✅ done (Cycle 12) — top roadmap item: manifest + pin icons + `sw.js` (#26). Verified in preview: SW activates, all 11 shell entries + 3 CDN libs precache, and after one controlled reload the API cache holds exactly the 5 Supabase queries the app boots from, tiles accumulate on pan. **Caveat:** true offline + phone install need the app served over HTTPS (localhost-only today) — hosting (GitHub Pages / Netlify) is the follow-up decision, and a real airplane-mode test on the phone should confirm.
- [x] **C13 — Photo upload to Supabase Storage.** ✅ done (Cycle 13) — last "field workflow" roadmap item (#27): 📤 Upload with client-side 1600px JPEG compression into a new public `photos` bucket (scoped anon insert/select/delete policies); verified E2E in preview (real upload → public URL 200 → API cleanup). Advisor run surfaced the SECURITY DEFINER view → fixed with `security_invoker` (#28). Follow-up idea: garbage-collect storage objects when a photo is removed from a record (today only the URL reference is dropped).
- [x] **C14 — Full regression sweep + loop wind-down.** ✅ done (Cycle 14) — one residual fix: the SW's same-origin network-first fetches now send `cache: "no-cache"` so local edits appear on a plain reload (the heuristic-HTTP-cache staleness hit twice during dev). Then a single-pass regression of every flow shipped in C9–C13: boot (18 cards, SW-controlled), mark flow (auto-hood, temp marker, clean Esc), dirty-guard (exactly one prompt), planner (re-anchor, dated stops, 15-line export), JSON + 123-line scene exports, explore pill/popup/tagline, satellite round-trip, marker-diff filtering (18→7→18), all 4 SW caches present, zero console errors. **The improvement loop ends here** — remaining work is decision-gated (HTTPS hosting for phone install; public website export scope) or intentionally deferred (#8).

**⚠️ Queue exhausted after C8.** The discovery phase has covered: mobile layout, mode clarity,
search scoping, editor density, touch targets, error/empty states, keyboard a11y, and satellite
legibility. Next cycles should **pivot from "find" to "fix + re-test"**: implement a backlog item
(start with the High cluster — #10, #3, #9, #1, #13), then the following cycle re-runs the
relevant experiment to confirm the fix and mark the item `done`. New discovery angles to open only
if fixes surface them (candidates: onboarding/first-pin flow, multi-project switching, export
formats, undo/history, performance with 100+ pins).

---

## Experiments

### Cycle 1 — 2026-06-25 — Mobile placement of new controls + editor layout

**Hypothesis:** the controls shipped today (place search, 🛰 Satellite toggle, 🔍 What's here?
toggle) and the location editor stay usable when the layout stacks at 375px.

**Method:** reloaded the app at 375×812, measured control bounding boxes against the map pane,
screenshotted the map view and the open editor.

**Findings:**
1. 🔴 **Map controls detach from the map and cover the list (HIGH).** The map pane is the top
   55vh (height ≈ 447px), but the toggles are `position:absolute; bottom:N` relative to `#app`
   (full viewport), so they land at y≈690–762 — the *bottom* of the screen, floating over the
   sidebar's stats row and the first location card ("STC interior atrium"). Result: the
   satellite/explore controls are nowhere near the map they control, and they obscure list
   content. Confirmed in screenshot.
2. 🔴 **Inconsistent field labels (MED).** In the editor, two-column rows render their labels
   (`Status`, `Type`, `Shoot date`, `Best light / time`, `Permit`, `Parking`) in the browser
   default (larger, title-case) instead of the intended small-uppercase muted style, because the
   `.field > label` rule uses a direct-child combinator and these labels are nested one level
   deeper. Visible on desktop too; more jarring on the narrow mobile column.

**What worked well:** place-search sits correctly over the top of the map; Leaflet zoom is
clear top-left; the editor is a clean full-screen slide-over; the "Or mark:" nearby chips wrap
nicely; the two-column input rows themselves fit at 375px without horizontal scroll.

**Outcome:** hypothesis **partially refuted** — the editor passes, but the map-mode controls do
not adapt to the stacked mobile layout. Added backlog items #1 (high) and #2 (med).

**Next cycle:** C2 — first-run clarity of the two click modes.

### Cycle 2 — 2026-06-25 — First-run clarity & click-mode visibility

**Hypothesis:** a brand-new user can tell what clicking the map does, and can discover +
understand the two modes (default *mark* vs. *🔍 What's here?* explore).

**Method:** read the first-run copy/affordances (tagline, button labels + tooltips, both search
placeholders), then toggled explore mode on and re-measured what the UI communicates; desktop
screenshot in explore mode; mobile dimension carried over from C1's control-geometry findings.

**Findings:**
1. 🔴 **The persistent guidance contradicts explore mode (HIGH).** The sidebar tagline always
   says *"Click the map to add a location."* Toggling explore on flips only the button
   (→ "✕ Exit explore", blue) and the cursor (→ crosshair); the tagline stays put. So while in
   explore mode the prominent instruction tells you to do the one thing a click *won't* do — a
   textbook mode-error trap (user clicks expecting a new pin, gets an info popup, is confused).
2. **Mode feedback is peripheral and partly invisible (MED).** The only signals are a
   bottom-right button and the crosshair cursor. The cursor cue doesn't exist on touch; the
   button's explanatory tooltip only appears on hover (so it's invisible on mobile); and per C1
   that button is detached from the map on mobile. A user can be in a mode with no nearby/visible
   confirmation of it.
3. **Default (mark) mode reads well.** For the common first action, *"Click the map to add a
   location"* is accurate and clear; place-search ("🔎 Find a place to mark…") and list-search
   ("Search locations, people, notes…") placeholders are distinct enough to tell apart.

**Outcome:** hypothesis **partially refuted** — the default path is clear, but explore mode is a
discoverability + mode-visibility weak spot, worst on touch. Added backlog #3 (high) and #4 (med).

**Next cycle:** C3 — discoverability of place-search vs. list-search (confirm finding 3 holds up
under a focused look, and check for cross-confusion).

### Cycle 3 — 2026-06-25 — Two search boxes: scope clarity & cross-confusion

**Hypothesis:** users can tell the map place-search (geocode → drop a pin) apart from the sidebar
list-search (filter saved locations), and won't mix them up.

**Method:** compared both inputs' placeholders/positions/behaviours, then simulated the confusion
case — typed a real place ("Toronto Zoo") into the *sidebar* filter and inspected the resulting
list, footer count, and stats bar. Desktop screenshot of the end state.

**Findings:**
1. 🔴 **Misleading empty state makes a no-match look like data loss (MED–HIGH).** When a
   filter/search excludes every location, the list renders *"No locations in this project yet.
   Click anywhere on the map to add your first one."* — the **same message as a truly empty
   project** — while the stats bar still shows `1 Idea / 2 Scouting / 1 Confirmed / 1 Shot` and
   the footer still says `5 locations`. So a user who types a place name into the sidebar filter
   (a natural cross-confusion with the map's "Find a place" box) sees "no locations, add your
   first one" and reasonably thinks their data vanished. Confirmed in screenshot.
2. **Scope is recallable, not recognizable (MED–LOW).** The two boxes differ only by placeholder
   text and position (map top-right vs sidebar top). Neither has a persistent label, so the
   moment you start typing, nothing on screen says which scope you're in. Their *behaviours* do
   differ clearly once learned (filter = live list narrowing; place-search = debounced dropdown
   of OSM results), so this is a first-use risk more than an ongoing one.

**What worked well:** the two placeholders are meaningfully different ("🔎 Find a place to mark…"
vs "Search locations, people, notes…"); spatial separation (map vs sidebar, far apart on mobile)
reduces simultaneous confusion; the place-search dropdown behaviour is distinct from live filtering.

**Outcome:** hypothesis **partially refuted** — the boxes are distinguishable, but the failure
mode of confusing them is amplified by the misleading empty-list copy. Added backlog #5 (med–high)
and #6 (med–low). Note #5 is independently worth fixing — it misfires for *any* zero-match filter
(status/neighbourhood too), not just the search.

**Next cycle:** C4 — editor density & scroll (is the location editor too long; should logistics
collapse behind a disclosure?).

### Cycle 4 — 2026-06-25 — Editor density, scroll & primary-action reach

**Hypothesis:** the location editor is too long, forcing scrolling; logistics should collapse so
the most-used fields (title / neighbourhood / people) and the **Save** action are reachable fast.

**Method:** opened a representative existing location (Guild Park sculpture lawn — 1 contact,
1 interview) and measured the editor body's `scrollHeight` vs. visible height, and the offset of
the Save action bar, on desktop (1200×860) and mobile (375×812). (Measurement is the right tool
for a scroll/length question; visual layout already documented in C1's editor screenshots.)

**Findings:**
1. 🔴 **The primary action sits below the fold even for trivial edits (MED–HIGH).** Body
   `scrollHeight` ≈ 872px vs. ~810 visible (desktop) / ~762 (mobile) → ~1.08–1.14 screens. The
   Save / Delete / Plan-day bar is at offset ~877px, so it's off-screen on open; changing one
   field (e.g. status) still requires a scroll to commit. It only moves further down as
   contacts/interviews/footage/photos accumulate (each adds a row). → backlog #7: **sticky
   action bar** pinned to the panel bottom.
2. **Editor length is unbounded but the disclosure idea is lower-value than expected (LOW–MED).**
   The original C4 premise (collapse logistics) helps only data-rich records; a sparse editor is
   ~1 screen, so collapsing buys little for the common case. Kept as #8 but deprioritized below
   the sticky-action fix.

**What worked well:** the field grouping (two-column logistics rows) is compact; no horizontal
overflow at 375px; sparse editors stay close to a single screen.

**Outcome:** hypothesis **reframed, not simply confirmed** — the problem isn't overall length so
much as the **primary action being unreachable without scrolling**. Sticky actions (#7, low
effort) is the high-value fix; collapsing logistics (#8) is optional polish. 

**Next cycle:** C5 — touch-target sizes on mobile (chips, ✕ remove buttons, toggles vs the 44px
guideline).

### Cycle 5 — 2026-06-25 — Mobile touch-target sizes (44px guideline)

**Hypothesis:** interactive controls meet the ~44px minimum tap target (Apple HIG) at 375px.

**Method:** measured `getBoundingClientRect()` height of representative controls at 375×812 —
list-card delete ✕, the three map toggles, new-project +, status select, My-location, list
search, and (with the editor open) the close ✕, +Add, a contact row's remove ✕, and Save.

**Findings:**
1. 🔴 **Every measured control is under 44px tall — most well under (HIGH, a11y/mobile).**
   Card delete **✕ = 9×15px**, sidebar-toggle 89×22, +Add 53×21, editor close ✕ 36×21,
   row-remove ✕ 26×29, Save 109×31, satellite 94×32, list search 347×34, status select 170×36,
   new-project + 36×36, My-location 170×37, explore 125×37. Not one hits 44px. Hardest hit are
   the small ✕ glyphs and the icon buttons. → backlog #9 (grow hit areas to ≥44px).
2. 🔴 **Destructive delete is unguarded *and* tiny (HIGH, data-loss).** The card ✕ calls
   `removeLoc` immediately — no confirm, no undo — and at 9×15px it's trivially mis-tapped on a
   phone (and sits right next to the card's own tap-to-open area). The editor's Delete button is
   also one-tap. A documentary scout could lose a scouted location by a fat-finger. → backlog #10
   (confirm or undo).

**What worked well:** nothing to celebrate on target size; the only mitigation today is that the
big list **cards** themselves are large, easy tap targets for the common "open a location" action.

**Outcome:** hypothesis **refuted** — mobile tap targets are systematically too small, and the
most dangerous control (delete) is also the smallest and unguarded. #9 and #10 are both High; #10
is the cheapest data-safety win on the board.

**Next cycle:** C6 — empty/slow/error states for the network lookups (reverse-geocode, Overpass,
Wikipedia): is "Identifying…" clear, and what happens offline or on failure?

### Cycle 6 — 2026-06-25 — Empty / slow / error states for network lookups

**Hypothesis:** the network-dependent flows (reverse-geocode on mark, Overpass nearby chips,
Wikipedia explore, place-search) give clear feedback when slow, failed, or empty.

**Method:** monkeypatched `window.fetch` to reject (simulated offline), then triggered each flow
and read the resulting UI state; restored `fetch` afterward. Error-state behaviour is
viewport-independent, so the simulation covers desktop + mobile equally.

**Findings:**
1. 🔴 **Auto-naming fails silently and can hang forever (MED).** With lookups failing, the title
   field keeps its **"📍 Identifying this spot…"** placeholder, the address stays empty, and the
   "Identifying…" chip loader just disappears — no error, no prompt to type a name. Because
   `reverseGeocode`/`nearbyFeatures` swallow errors and there's **no fetch timeout**, a *hung*
   (not rejected) request would leave "Identifying…" up indefinitely, implying work is still
   happening after it has effectively given up. → backlog #11.
2. **Failures masquerade as "no results" (LOW–MED).** Place-search returned 0 → the dropdown
   says *"No places found in Scarborough"*; nearby chips just render empty. Neither distinguishes
   an offline/failed lookup from a genuine empty result, so the user can't tell to retry. → #12.
3. ✅ **Explore mode degrades gracefully (positive).** Under total fetch failure the popup still
   rendered **"West Hill" + its full neighbourhood blurb** (local data) and failed only the
   Wikipedia section ("Landmark lookup failed."). This local-first pattern is the model the mark
   and search flows should copy.

**Outcome:** hypothesis **partially refuted** — explore is resilient, but mark/search are
silent-fail. Added #11 (med) and #12 (low–med). Neither is urgent vs. the standing High cluster,
but #11 matters offline — relevant given the planned field-use / PWA direction in CLAUDE.md.

**Next cycle:** C7 — keyboard & focus order on desktop (tab order, focus rings, Esc-to-close
panels), an accessibility angle not yet covered.

### Cycle 7 — 2026-06-25 — Keyboard & focus accessibility (desktop)

**Hypothesis:** a keyboard-only user can reach and operate the core flows — open a location from
the list, fill the editor, dismiss panels — with logical focus order and visible focus.

**Method:** DOM/inspection probe — checked `document.activeElement` after opening the editor,
dispatched `Escape`, and read the tag/`tabIndex`/`role` of list cards + card-delete and the
computed focus outline of a styled button. (Keyboard semantics are structural, so this is the
apt method; behaviour is the same desktop/mobile, though keyboard mainly matters on desktop.)

**Findings:**
1. 🔴 **The core navigation action is keyboard-dead (HIGH).** List cards are `<div onclick>` with
   `tabIndex −1` and no `role`, so Tab never lands on them and Enter/Space can't open a location —
   the primary way into a record is unreachable by keyboard. The card-delete is a `<span>` (also
   unreachable). → backlog #13.
2. 🔴 **Panels ignore the keyboard (HIGH, same item).** Opening the editor leaves
   `document.activeElement` on `<body>` — focus isn't moved into the panel, there's no focus
   trap, and **Esc does not close** it (no key handler). A keyboard user must Tab through the
   whole sidebar to reach editor fields and can only close via the mouse. → #13.
3. **Focus visibility is weak (MED).** Inputs/selects set `outline:none`, signalling focus only
   with a faint accent border; buttons, cards, chips, and toggles define no focus style, leaning
   entirely on UA defaults. No `:focus-visible` ring anywhere. → backlog #14.

**What worked well:** native controls (selects, inputs, real `<button>` chips and +Add/remove ✕,
project picker) are in the tab order with sensible DOM ordering; the nearby-chips and repeat-row
removes are real `<button>`s (focusable/activatable).

**Outcome:** hypothesis **refuted for the core flow** — keyboard users cannot open a location
from the list nor Esc-dismiss panels. Added #13 (high) and #14 (med). #13 raises the High-impact
count to five (#10, #3, #9, #1, #13).

**Next cycle:** C8 — status-pin & hood-label legibility over bright satellite imagery (the last
queued angle); after that the queue is empty → consolidate / re-test after fixes, or open new angles.

### Cycle 8 — 2026-06-25 — Pin & label legibility over satellite imagery

**Hypothesis:** the status-coloured location pins and the 30 neighbourhood labels stay legible
when the base map is switched to bright Esri satellite imagery.

**Method:** toggled satellite on, framed the Guildwood/Bluffs area (mix of bright water glare,
rooftops, and dark tree cover), screenshotted; checked `.hood-label` styling.

**Findings:**
1. **Hood labels are tuned for the dark map and weaken on bright imagery (LOW–MED).**
   `.hood-label` is light text (`#cdd9e5`) with only a thin double text-shadow and
   `background:none`. Over dark/treed satellite areas it reads fine, but over bright rooftops,
   concrete, or water glare the contrast drops, and 30 simultaneous labels add clutter on the
   detailed imagery. → backlog #15 (semi-opaque pill behind labels; optionally thin by zoom).
2. ✅ **Status pins hold up (positive).** The circle markers pair a dark stroke ring
   (`#0c1117`, weight 2) with a saturated fill, so they stay distinct on satellite — the orange
   "scouting" pin at Guild Park read clearly against residential imagery. No change needed.

**What worked well:** the satellite toggle itself is clean (button flips to "🗺 Street map"), the
blue Scarborough boundary stays visible over imagery, and the pin styling is genuinely
basemap-robust — a good pattern the labels should borrow.

**Outcome:** hypothesis **mostly holds** — pins are robust; only the labels need a legibility
tweak (#15, low/low). This is the lowest-severity finding of the series, which fits: **the
discovery phase is complete** (see the ⚠️ note in the queue above). Recommend the loop now pivots
to **implement + re-test** the High cluster rather than continue enumerating.

---

## Series summary (after 8 cycles)

15 backlog items found; **5 are High-impact** (#10 guard delete · #3 mode-tagline · #9 tap-targets
· #1 mobile controls · #13 keyboard access). Two clear themes:
- **Mobile**: controls detach from the map (#1), tap targets 9–37px (#9), Save below the fold (#7).
- **Honesty / safety**: unguarded delete (#10), contradicting tagline (#3), misleading empty state
  (#5), silent lookup failures (#11), keyboard lock-out (#13).

Most fixes are **Low effort**. The audit has reached diminishing returns; the highest-value next
step is shipping the High cluster and re-testing, not more discovery.

**Update — 2026-06-25:** implemented and verified (desktop + mobile) in three passes —
**High cluster** (#10, #3, #9, #1, #13) + #14; **Low-effort batch** (#5, #7, #2, #6); and
**robustness + legibility** (#11, #12, #15). **13 of 15 items shipped.** Only #4 (mode pill) and
#8 (collapse logistics) remain — optional polish, intentionally deferred. The app handles offline /
slow / failed lookups gracefully, is keyboard- and touch-accessible, and reads on both base maps.

**Update — 2026-07-01 (Cycle 9):** discovery reopened on the recommended "data honesty" angle, this
time by auditing code paths rather than screens — and it found the three biggest remaining data-loss
traps: boot failure masquerading as an empty project (#16), silent save/delete failures against
Supabase (#17), and unsaved edits discarding without warning (#18). All three fixed and verified the
same cycle (simulated failure/decline/accept paths in the preview, desktop + mobile), plus #4 (explore
pill) and #19 (date chips). **18 of 19 items shipped; only #8 remains.** Next discovery candidates:
multi-project switching, export formats (shot-list/CSV), performance with 100+ pins, first-run
onboarding.

**Update — 2026-07-01 (Cycle 10):** planner + performance pass, driven with the real 18-location
dataset. The planner's biggest flaw was structural: the sidebar entry point picked the *oldest*
location as anchor with no way to change it (#20 — now a "Plan around" select, defaulting to the
most recent). Stops and exports now carry 🗓 shoot dates (+ addresses in export) (#21), the sparse
default radius explains itself (#22), and rendering scales: 200 ms search debounce + marker diffing
instead of clear-and-redraw, with click handlers resolving records by id (fixes a stale-closure bug
after save) (#23). Verified desktop + mobile with a captured export ("shoot-day-cliffcrest.txt", 8
dated stops around Bluffers Park). **22 of 23 items shipped; only #8 remains.** Next candidates:
multi-project management (rename/delete), CSV/scene-list export, first-run onboarding, marker
clustering past ~150 pins.

**Update — 2026-07-01 (Cycle 11):** project management + the roadmap's script-writing export.
Projects gained rename (✎ beside the picker — the live project had been stuck as "Untitled film"
with no way to change it) with Cycle-9-style honest failure handling, and the footer now offers
**⭳ JSON + 📝 Scenes**: a Markdown scene list grouped by neighbourhood carrying status, shoot
dates, logistics, addresses, interviews, contacts, footage and notes — verified against the real
dataset (123 lines) and all layouts desktop + mobile (all targets ≥44px, no overflow).
**24 of 25 items shipped; only #8 remains.** Next candidates: project delete/archive, first-run
onboarding, marker clustering past ~150 pins, PWA groundwork (the top "What's next" item).

**Update — 2026-07-02 (Cycle 12):** the top roadmap item — **offline PWA** (#26). Manifest +
app-palette pin icons + `sw.js` with per-resource strategies: shell/data network-first with
precache, CDN stale-while-revalidate, tiles cache-first (LRU 400), Supabase GETs network-first
with cached fallback → the app boots offline with last-known locations instead of the error
state; writes stay honest and uncached. Verified: SW activated, 11 shell + 3 CDN entries
precached, API cache = the exact 5 boot queries, tile cache fills on pan, zero console errors.
**25 of 26 shipped; only #8 remains.** Follow-ups: host over HTTPS (GitHub Pages/Netlify) so the
phone can install it, then an airplane-mode field test; also still queued — project
delete/archive, marker clustering past ~150 pins.
