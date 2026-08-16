# Historical Timeline Application — Developer Handoff

**Version:** MVP, post-Phase-A stabilization pass (unreleased/v0.1.0 in package.json)
**Handoff date:** see git log / file timestamps in this export
**Status:** Working single-timeline MVP. Several structural expansions are designed but not yet built (see "Planned but not started" below).

---

## 1. What this project is

A personal historical research application — not a generic timeline viewer. Two things make it different from a standard "history timeline" app:

1. **It's built to support chronology research, including alternative/revisionist chronology comparison.** The long-term design (see `/docs/database-schema.md` and `/docs/ux-ui-design.md` in this export) calls for **multiple parallel timelines** — a "Nominal" (official/accepted) timeline, a "Real Medieval" timeline, an "AUC Structure" timeline, and others — all viewing the *same* underlying rulers, events, and coins, but with **independently, manually-entered year positions per timeline**. The point is to let the researcher visually compare where official chronology places a ruler/event against where an alternative chronology places it, including revealing cases where multiple "different" rulers in the official record may represent one real person (a "correspondence group" / duplicate-ruler concept).
2. **It's a structured research database first, a pretty timeline second.** Rulers, events, coins, civilizations, and sources are meant to be fully queryable/editable records with completeness tracking (has a portrait? has sources? has coins? verified?), not just visual markers.

The **currently built MVP only implements a single timeline** ("Nominal"). The multi-timeline architecture is fully designed on paper but not implemented in code — this is the single biggest piece of unbuilt work and the most important thing to understand before extending the app (see section 5).

---

## 2. Current tech stack (deliberately simple)

- **Backend:** Node.js + Express
- **Database:** SQLite via `better-sqlite3` — single file at `db/history.db`
- **Frontend:** Plain HTML/CSS/vanilla JavaScript served as static files — **no build step, no framework, no bundler.** This was a deliberate choice (the original stakeholder is not a developer and needed something they could run with two commands). If you introduce a framework/build step, update `README.md`'s setup instructions accordingly.
- **Image uploads:** `multer`, storing files in `uploads/coins/` (also used for ruler portraits — shared folder, not a bug)

Run with:
```
npm install
npm run init-db   # safe to re-run; uses guarded ALTER statements, won't wipe existing data
npm start
```

---

## 3. What's actually implemented and working

- **Civilizations**: CRUD, each with an optional "active range" (year_start/year_end) that dims its timeline lane outside that range, drag-to-reorder.
- **Rulers**: CRUD with portrait upload, bullet points, source linking, a "verified" flag, and a computed completeness checklist (portrait/sources/coins/verified).
- **Historical entries** (events/wars/political changes/cultural developments): CRUD, each can link to **multiple** civilizations simultaneously (via `entry_civilizations` junction table) — this is what lets you compare e.g. "did North Africa also have a plague when Rome did."
- **Coins**: CRUD with front/back image upload, linked to a ruler, a civilization (issuer), and optionally to one or more historical entries.
- **Sources**: basic CRUD, linkable to rulers.
- **69-year cycle markers**: user-defined (start year, end year, interval, color, label), rendered as vertical dashed lines with sequentially-numbered labels ("Cycle 1, Cycle 2..."), NOT year-numbered. Multiple independent cycles supported.
- **Timeline rendering**: single shared coordinate system (`scale` object + `yearToPx()`/`pxToYear()` in `public/app.js`) used by every renderer — axis, ruler bars, event pins, coin markers, cycle lines. This was a deliberate architectural fix after early bugs came from two different coordinate systems disagreeing (see section 6).
- **Drag-and-drop**: reposition rulers/events by dragging, resize by dragging the right edge, snaps to whole years, coordinate scale is snapshotted at drag-start (not read live) to avoid corruption from concurrent re-renders.
- **Zoom levels**: Overview/Medium/Detail — affects label verbosity and axis tick density (tick step is computed from available pixel width + a hard cap of 30 ticks maximum, see section 6).
- **Coin comparison mode**: multi-select coins from the timeline, compare panel with simultaneous front/back flip.
- **Unified create/edit workflow**: each of Ruler/Event/Coin has a dedicated tab with the form on the left and a live, searchable/sortable database list on the right. Clicking any database row, or any card on the timeline, or any search result loads that record directly into the edit form (same form, "New X" button resets it to create mode). There is intentionally **no modal/drawer** — this replaced an earlier drawer-based pattern that caused UI inconsistency bugs.
- **Print/PDF export**: currently just the browser's native Print-to-PDF via a print stylesheet. **Not a real poster generator.**

---

## 4. Current known bugs / open items

- **Cycle marker position — unconfirmed, possibly not a real bug.** The most recent live testing session traced this extensively (see conversation history if available). The underlying math (`yearToPx()`) was verified correct via direct calculation and code tracing multiple times. Current hypothesis: at wide zoom levels (e.g., viewing the full -45–1629 range), a cycle starting at year 30 sits only ~20px from the year-0 axis tick, which can look like "it's at 0" even though it isn't. **Last action taken:** asked the stakeholder to test with a narrow year range (e.g. 0–60) at Detail zoom, where the offset would be visually unambiguous. **No response received yet at time of handoff** — this needs to be either confirmed as resolved or investigated fresh if it turns out to be real.
- **A large fraction of "bugs" reported in recent testing rounds turned out to be a stale local build**, not code issues — the stakeholder was unknowingly running an old copy of the project (a nested/duplicate folder from a previous zip extraction) while believing they were testing new fixes. This was only discovered by inspecting the live DOM and finding a cache-busting query string was missing from the served HTML. **If the stakeholder reports a bug that contradicts something you've verified in the code, ask them to confirm which folder they're running from and check the browser's live DOM before assuming the code is wrong.** A cache-busting version string (`?v=...` on `app.js`/`style.css` in `public/index.html`) is now in place specifically to eliminate browser-cache as a variable going forward — bump that version string on every change you ship.
- **No automated tests exist.** All verification so far has been manual code tracing, Node syntax checks, SQL schema validation against a real SQLite instance, and (where possible) simulated reproduction of bugs with realistic input values. Consider adding a test suite (even a minimal one covering the coordinate math and the API routes) before further feature work — this codebase has had an unusually high rate of "looks right in code, still fails in practice" bugs, and tests would catch that class of problem faster than manual review.
- **Civilization editing and cycle-marker editing still use browser `prompt()` dialogs**, not proper inline forms — functional but visibly rougher than the Ruler/Event/Coin unified edit forms. Known, deliberately deprioritized.
- **Zoom levels don't change ruler-bar height**, only label verbosity/coin marker style — a partial implementation of the original "level of detail" request.

---

## 5. Planned but NOT started — read this before adding features

Two full design documents are included in this export (`docs/database-schema.md`, `docs/ux-ui-design.md`) covering a much larger vision than what's built. Key unbuilt pieces, roughly in dependency order:

1. **Timeline Manager / multi-timeline support.** A `timelines` table plus per-entity position tables (`ruler_timeline_positions`, `entry_timeline_positions`, `coin_timeline_positions`, each keyed by `(entity_id, timeline_id)`) so the same ruler/event/coin record can have a *different* year placement on each timeline, entered manually per timeline (no auto-conversion between chronologies — this is intentional, confirmed explicitly by the stakeholder). This is the single biggest piece of unbuilt architecture and nearly every other unbuilt feature depends on it.
2. **Regnal timelines.** Each ruler should have an internal "Year 1, Year 2...Year N of reign" timeline, with events attachable by regnal year (not just absolute year), a "reverse" transform (regnal year *n* of *L* total years maps to *L−n+1*), and projection onto any timeline via that timeline's `reign_start` for that ruler.
3. **Duplicate ruler / correspondence groups.** `ruler_correspondence_groups` + membership table (partially designed already — this generalizes the "same real person, several nominal-timeline profiles" concept). Should support a side-by-side or stacked comparison view of two rulers' regnal timelines, each independently reversible.
4. **AI research assistant.** Explicit requirement from the stakeholder: must suggest entries with citations and require human approval before writing anything — must never silently create facts. Not started.
5. **Historical map.** Explicitly deferred by the stakeholder pending an actual dataset of historical territorial boundaries — no boundary data exists in this project yet.
6. **Real poster generator** (paper sizes, column arrangement, high-DPI export) — current PDF export is just the browser's print dialog.

---

## 6. Architecture notes worth knowing before you touch rendering code

- **Single coordinate system.** All position math lives in `scale` (module-level object) + `yearToPx()`/`pxToYear()` in `public/app.js`. This replaced an earlier version that had two separate systems (percentage-based static positioning vs. pixel-based drag math) that could silently disagree — that was the root cause of a "rulers jump to impossible years when dragged" bug. **Do not introduce a second way of computing screen position from a year — route everything through these functions.**
- **Drag coordinate snapshotting.** `attachDrag()` captures `scale.pixelsPerYear` once at `pointerdown`, not read live during the gesture — this was a deliberate fix for a bug where an unrelated re-render mid-drag (e.g. `window.resize`) could corrupt an in-progress drag's math.
- **Axis tick generation has a hard cap.** `fixedTicks()` in `public/app.js` computes a "nice" step size from available pixel width, but *unconditionally* caps the result at no more than 30 labels regardless of what that calculation produces. This was added defensively after a rendering bug that was never fully root-caused (see section 4) — if you refactor tick generation, keep an equivalent hard ceiling; it costs nothing and prevents an entire class of "wall of unreadable text" failure.
- **Every mutation goes through `apiRequest()`**, a small wrapper that checks `response.ok` and surfaces failures via a toast. This exists because an earlier version had `fetch()` calls that never checked success/failure, causing silent failures (e.g. a delete blocked by a foreign-key constraint looked like "nothing happened" instead of showing an error). **Do not add a raw `fetch()` call for a mutation — use `apiRequest()`.**
- **`refreshAfterChange(type)`** is the single place that decides what to re-render after any successful mutation (timeline + relevant database list + dropdowns). This exists because forgetting to call the right combination of render functions after a save was a recurring bug (e.g. "ruler color doesn't update until I refresh"). **Add new entity types to this function rather than hand-picking refresh calls at each call site.**
- **Foreign key cascade behavior was audited once and should be kept intentional going forward.** `coins.ruler_id` is `ON DELETE SET NULL` (deleting a ruler unlinks their coins rather than destroying coin data or blocking the delete). Other FKs are deliberately `NO ACTION` with app-level guard checks (e.g. civilizations can't be deleted while rulers/coins reference them — checked and reported with a clear error, not a silent DB failure). If you add new foreign keys, decide the cascade behavior deliberately and document why, rather than leaving SQLite's default.
- **Schema migrations use guarded checks, not blind `ALTER TABLE`.** See `db/init-db.js` — every schema change added after the initial version checks `PRAGMA table_info`/`PRAGMA foreign_key_list` first, so `npm run init-db` is always safe to re-run against an existing database without wiping data or crashing on already-applied changes. Keep this pattern for any future schema change.

---

## 7. File structure

```
history-app/
  server.js              # Express app entry point, mounts all routes
  package.json
  db/
    schema.sql            # CREATE TABLE statements (fresh-install baseline)
    init-db.js             # Runs schema.sql + guarded migrations; safe to re-run
    connection.js            # Shared better-sqlite3 connection
  routes/                     # One file per entity, REST-ish endpoints
    civilizations.js, rulers.js, entries.js, coins.js,
    cycles.js, sources.js, search.js
  public/                        # Static frontend, no build step
    index.html
    style.css
    app.js                        # ~1200 lines — all rendering, state, and interaction logic
  uploads/coins/                    # Uploaded images (ruler portraits + coin fronts/backs)
```

---

## 8. Recommended next steps for whoever picks this up

1. Resolve the open cycle-marker-position question (section 4) with the stakeholder before assuming it's fixed or broken.
2. Introduce at least minimal automated testing — the coordinate math (`yearToPx`, `computeTickStep`) and the API validation logic are both good, cheap first targets given their bug history.
3. Read `docs/database-schema.md` and `docs/ux-ui-design.md` in full before starting the multi-timeline work — they contain considerable already-resolved design discussion (calendar systems, historical uncertainty, the Rome→Byzantium succession pattern, etc.) that would otherwise need to be re-derived.
4. Confirm with the stakeholder whether the "civilization/cycle editing via `prompt()`" gap (section 4) is worth closing before or after multi-timeline work — it's cosmetic, not blocking.
