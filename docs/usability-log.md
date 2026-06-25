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
| 4 | **Strengthen mode feedback on the map (esp. touch).** Explore mode is signalled only by a far bottom-right button + crosshair cursor; its explanation is a hover tooltip (invisible on touch) and on mobile the button is detached from the map. Add a small on-map "Explore mode" pill while active. | Visibility of system status; help & docs | Med | Low–Med | proposed | C2 |
| 2 | 🔴 **Fix two-column field labels.** `Status / Type / Shoot date / Best light / Permit / Parking` don't get the small-uppercase label style (the `.field > label` direct-child selector skips nested labels), so they look like a different, louder heading than `TITLE / ADDRESS`. | Consistency & standards | Med | Low | ✅ done (2026-06-25) | C1 |
| 14 | **Visible focus indicators.** Inputs/selects use `outline:none` and signal focus only by a faint accent border; buttons/cards/chips/toggles define no focus style at all. Add a clear `:focus-visible` ring across interactive elements. | Accessibility (WCAG 2.4.7 focus visible) | Med | Low | ✅ done (2026-06-25, with #13) | C7 |
| 11 | 🔴 **Graceful failure for auto-naming.** On reverse-geocode/Overpass failure or hang the title stays stuck on "📍 Identifying this spot…" with no error and no nudge to type — and there's no fetch timeout, so a hung request never resolves. On failure swap to a "Name this location" placeholder (or a subtle "couldn't auto-name") and add a timeout. | Visibility of system status; error recovery | Med | Low–Med | proposed | C6 |
| 6 | **Clarify the two search boxes.** Map "Find a place to mark" (geocode) vs sidebar "Search locations, people, notes" (filter) differ only by placeholder + position; once you type, the placeholder is gone and nothing says which scope you're in. Add small persistent labels/distinct icons (🔎 place vs filter-funnel) and a clear-on-type affordance. | Recognition rather than recall | Med–Low | Low | ✅ done (2026-06-25) | C3 |
| 12 | **Distinguish "offline/failed" from "no results."** Place-search shows "No places found in Scarborough" and the nearby chips silently empty on a network failure — indistinguishable from a genuine empty result. Show a retry/offline hint on fetch error. | Help users recognise & recover from errors | Low–Med | Low | proposed | C6 |
| 15 | **Hood labels need cross-basemap legibility.** `.hood-label` is light text + a thin dark text-shadow tuned for the dark street map; over satellite it holds up in dark/treed areas but loses contrast on bright imagery (rooftops, concrete, water glare), and 30 at once clutter the aerial view. Add a subtle semi-opaque dark pill behind labels (and/or thin by zoom when satellite is on). Status pins are fine — dark ring + saturated fill. | Legibility; aesthetic & minimalist | Low–Med | Low | proposed | C8 |
| 8 | **Optionally collapse logistics in the editor.** Date / best-light / permit / parking sit above the richer narrative sections; a disclosure ("Logistics ▸") or reorder would shorten data-rich editors and surface title/people faster. Lower priority — sparse editors are only ~1 screen. | Aesthetic & minimalist; progressive disclosure | Low–Med | Med | proposed | C4 |

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

**Remaining (none High-impact):** #4 on-map mode pill · #11 graceful lookup-failure / timeout ·
#12 offline-vs-empty messaging · #15 hood-label legibility on satellite · #8 collapse editor logistics.

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

**Update — 2026-06-25:** the High cluster (#10, #3, #9, #1, #13) + #14 were implemented and
verified in preview on desktop and mobile (see the ✅ Shipped note under the backlog). 9 lower-
priority items remain, none High-impact. Suggested next pass when ready: the remaining Low-effort
batch (#5 empty-state, #7 sticky action bar, #2 field labels, #6 search clarity).
