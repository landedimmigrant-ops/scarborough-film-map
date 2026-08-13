# Design brief — Scarborough Film Map

Instructions for a Claude session doing **design work** on this project. Read CLAUDE.md first for
architecture; this file is about how the thing should look and feel, what's weak today, and what a
redesign must not break. Written 2026-08-12, the day the site got its landing page, console, ideas
and shoot days.

## What this is, designed for whom

Three surfaces, one identity:

| Surface | Audience | Job |
|---|---|---|
| `/` landing (`index.html` + `landing.css`) | the public — people Prem hands the link to | say what the film is, invite a suggestion |
| `/suggest` (`suggest.css`) | one-visit contributors | a warm, low-friction form |
| `/app/` console (`app/styles.css`) | Prem only, daily, often in the field | organize locations, ideas, shoot days fast |

The film is a **landscape documentary about the whole of Scarborough** — its historical and
cultural place in the world, told through interviews and points of view. The design's job is to
feel like that film: patient, wide-frame, dusk-lit, specific to this place. Not a SaaS dashboard.

## The visual identity so far (keep and extend)

The landing page established the art direction; the app predates it and hasn't caught up:

- **Dusk over the Bluffs.** Deep blue-black sky (`#0f1419` base), an amber horizon glow
  (`#f0a93b`), flat-topped cliff silhouettes. The hero frame on the landing draws this in pure
  CSS at **2.39:1** — the letterbox ratio is the film's aspect and a recurring motif worth reusing
  (section dividers, empty states, the day sheet masthead could all letterbox).
- **The Bluffs are plateaus, not peaks.** The clip-path silhouette uses flat tops with sheer
  faces. Anyone redrawing it: no pointy mountains. Scarborough's cliffs are horizontal.
- **Palette** (shared by both stylesheets today, duplicated — see weakness #1):
  - `--bg #0f1419` · `--panel #161c24` · `--panel-2 #1d2630` · `--line #2a333f`
  - `--text #e6edf3` · `--muted #8a97a6` (≈6.2:1 on bg — passes AA, keep it passing)
  - `--accent #4ea1ff` (≈7:1 on bg) · status colours: idea `#8a97a6`, scouting/amber `#f0a93b`,
    confirmed `#4ea1ff`, shot `#46c98b`
- **Dark-only by intent.** The one light rendering is the printed day sheet (black on white).
  Don't add a light theme; do keep print pristine.
- **Type**: system stack (`-apple-system, …`) everywhere. Identity currently carried by weight,
  tracking and the uppercase-letterspaced kicker style (`.kicker`, section `h2`s at 12–13px,
  `.2em` tracking) — that kicker style is the closest thing to a house typographic voice.

## Honest critique — where design work is needed

Ranked. Fix the top ones first; they compound.

1. **Tokens are duplicated, not shared.** `landing.css` and `app/styles.css` each declare their
   own `:root`. They agree today by copy-paste. A `theme.css` (or a copied block with a loud
   KEEP-IN-SYNC comment — no build step exists to import) should be the first move of any serious
   pass. `suggest.css` has a third, older variant of the palette — bring it into line.
2. **The film's identity stops at the landing.** The console is competent generic-dark; nothing
   in it says Scarborough. Candidates: the amber dusk as the Ideas-lane accent is already there —
   extend the warmth deliberately (e.g. panel headers with a 1px amber-to-transparent hairline,
   the letterbox motif on empty states, a bluffs-silhouette footer on the day sheet). Subtlety
   over decoration: this is a working tool.
3. **Emoji do all the iconography** (🎬 🗺 💡 ⚡ 🖨 📍 ⠿…). Fast to ship, but they render
   differently per platform, fight the palette (full-colour glyphs in a monochrome UI), and cap
   the perceived quality. A designed pass would replace UI-chrome emoji with a tiny inline-SVG
   set (12–16 icons, single `currentColor` strokes, pasted as symbols into the HTML — **no icon
   font, no CDN**). Keep emoji where they're *content* (status of a real thing, e.g. chips like
   🗓 🎤 inside cards is fine and charming; buttons and toggles are chrome and deserve real icons).
4. **Sidebar hierarchy is flat.** My location / Plan a day / Suggestions / JSON / Scenes /
   Credits all read as equal-weight boxes. Frequency says: search + Plan a day + Suggestions are
   primary; exports are footer-tier. Consider: primary actions as filled/outlined pair, exports
   as quiet text links.
5. **The landing could carry one real image.** The CSS hero is good and loads nothing — but when
   Prem has stills from the shoot, a single graded still (self-hosted, ≤200KB, in the 2.39:1
   frame) would do more than any gradient. Leave the CSS frame as the no-image fallback.
6. **Typography has no display voice.** If a face is ever added: self-hosted woff2 only (no
   Google Fonts request — offline PWA + no external origins), subset it, one weight, used for
   the landing H1 + day-sheet masthead + maybe lane titles. Otherwise, lean harder on the
   existing kicker style for cohesion.
7. **Console cards don't adapt to lane width.** Tripdeck (the pattern source —
   `~/Documents/Dev/travel_planner`) sheds card metadata via **container queries** on the lane
   (`@container (max-width: …)` hiding meta/chips progressively). Port that: `.lane-body` gets
   `container-type: inline-size`, chips collapse first, then meta. No JS.
8. **Empty states are plain sentences.** Tripdeck's discipline: say the instruction once, then a
   quiet dashed marker; never confuse "nothing yet" with "all done". The lanes partially follow
   this; the sidebar list, suggestions panel and days list don't.
9. **The day sheet screen view could look like a designed call sheet.** Print is correct; on
   screen it's cards-in-a-column. A masthead (day title, date, letterboxed rule), tabular time
   column, and a footer strip would make it feel like a production document on the iPad too.
10. **`/suggest` predates the landing.** Same palette family but different rhythm (its own step
    numbers, spacing, button styles). Align it with the landing's section style so the handoff
    from landing → suggest feels like one site.

## Load-bearing constraints — a redesign must not break these

- **No build step, no npm, no external origins.** All CSS/JS hand-written; the only CDN is
  Leaflet (already there). New fonts/images must be self-hosted and added to BOTH `deploy.sh`'s
  copy list AND `sw.js` PRECACHE (and bump the SW `VERSION`) or they 404 in prod / vanish offline.
- **`#daysheet` lives OUTSIDE `#app` in `app/index.html`.** The print CSS hides `#app`
  wholesale; nesting the sheet back inside prints blank pages. This bit once already.
- **Print rules** (`@media print` in `app/styles.css`): only the day sheet prints, black on
  white, `.sh-stop { break-inside: avoid }`. Verify by opening a day sheet → Print preview.
- **The JS ⇄ CSS contract.** Behaviour hangs off these selectors — restyle freely, but renaming
  or restructuring them means editing `app/app.js` in the same commit:
  - View plumbing: `#map`, `#console`, `body.view-console`, `.viewtoggle`, `#view-map`,
    `#view-console`, `.tagline`, `#mode-pill`
  - Console: `.lane[data-lane]`, `.lane-body`, `.lane--droppable`, `.lane--ok`, `.lane--hot`,
    `.lane-foot`, `.cg-tab`, `[data-act]` buttons, `.capture`, `#capture-input`
  - Cards: `.ccard[data-drag]`, `.ccard-grip` (the ONLY element with `touch-action:none` —
    putting that on whole cards makes phones unscrollable), `.ccard--dragging`, `.ccard--arming`,
    `.ccard-ghost`, `.drop-indicator`, `data-src-lane`, `data-kind`
  - Days panel: `#day-title`, `#day-date`, `#day-notes`, `#day-save-state`, `.stop-row` (+
    `.stop-time/.stop-note/.stop-up/.stop-down/.stop-rm`), `#stop-search`, `#stop-candidates`
  - Sheet: `#daysheet`, `#daysheet-body`, `body.sheet-open`, `.sheet-toolbar`
- **Escaping discipline.** Every user string in template literals goes through `esc()` —
  including attribute positions and Leaflet tooltips/popups (HTML sinks). Don't lose one while
  reshaping markup.
- **Touch targets ≥44px on mobile** (`@media (max-width: 720px)` block adds `min-height`), and
  `:focus-visible` rings stay visible. The 720px breakpoint is the mobile line everywhere.
- **Contrast floors:** body text ≥7:1, muted/secondary ≥4.5:1, never ship a chip below AA on
  `--panel-2`. Current palette passes; check any new tint against its actual background.
- **Landing must stay near-instant.** It's the public face on phone data: no blocking requests
  beyond `landing.css`, hero stays CSS (or one ≤200KB image), inline the standalone-redirect
  script exactly where it is (before paint).

## Working method

1. `./dev.sh` → preview at `http://localhost:8138` (wrangler; needs `.dev.vars`).
2. Screenshot passes at desktop (1280×800) and mobile (375×812) for every surface touched:
   landing top + bottom, console in all four groupings, a day editor, the day sheet, `/suggest`.
   **Give the preview pane a concrete size first — geometry tests in a hidden pane lie.**
3. After ANY change to card/lane markup: re-test a drag (mouse from card body, touch from the
   grip), Esc-cancel, and drop-persistence (check the API wrote it).
4. After any print-adjacent change: day sheet → Print preview.
5. The design-critique and accessibility-review plugin skills are available for structured
   passes; run them on screenshots of the changed surfaces before calling it done.
6. Commit style and everything else: per CLAUDE.md.

## Where the good patterns are

Tripdeck (`~/Documents/Dev/travel_planner`, `public/styles.css`, 2633 lines) is the taste
reference this console was built from. Worth stealing next: the container-query collapse ladder
(`.card--chip` section), the `--accent`/`--leg`/`--mc` per-instance CSS-variable theming, the
dark-mode shadow inversion (soft shadows → 1px light rims + hard blacks on dark), `color-mix()`
tinted pills with AA-safe ink, and its empty-state copywriting. Its drag ghost/landing animations
(`card-settle`, FLIP flight) are the model if drag ever needs more polish.
