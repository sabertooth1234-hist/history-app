# Historical Timeline Application — UX/UI Design (Part 3, consolidated)

## Overall Navigation Structure

A persistent top-level mode switcher, since Timeline, Civilizations, Coin Catalogue, and Poster are genuinely different *tools*, not sub-pages of one flow. Beneath it, a **timeline selector** — since the app now holds multiple parallel timelines (Nominal, Real Medieval, AUC Structure, Adjusted, and any Compressed Presentation timelines you build) — lets you choose which one you're currently viewing or editing.

```
┌────────────────────────────────────────────────────────────────┐
│  [Timeline]   [Civilizations]   [Coin Catalogue]   [Poster]     │  <- mode switcher (tabs)
├────────────────────────────────────────────────────────────────┤
│  Timeline: [Nominal ▾]   45 BC – 1629 AD                          │  <- timeline selector
├────────────────────────────────────────────────────────────────┤
│  🔍 Search        Filter: [Civilization ▾] [Year range ▾] [Type ▾] │  <- persistent across modes
├────────────────────────────────────────────────────────────────┤
│                                                                    │
│                    [ mode-specific canvas ]                       │
│                                                                    │
└────────────────────────────────────────────────────────────────┘
```

Search and filters stay visible and *consistent* across all four modes — filtering by "Serbia, 1200–1300" and switching modes keeps that filter applied. Switching the **timeline selector**, by contrast, changes what data is being viewed/edited (each timeline has its own manually-entered positions), while mode and filters stay put — so you can flip between Nominal and Real Medieval while staying in Timeline mode with the same civilization filter active.

---

## 1. Timeline Mode

### Layout
Horizontal time axis along the top, civilizations as **horizontal lanes** stacked below it.

```
                45BC      27BC   1AD        117AD              1629AD
   ─────────────┼──────────┼──────┼───────────┼───────────────────►
   69-yr cycle: |‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑| |‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑|
                                    ┆ Birth of Christ (vertical marker)
  ┌────────────────────────────────┆───────────────────────────────┐
  │ ROME     [Caesar]  [Augustus]   ┆   [Trajan]                     │
  ├────────────────────────────────┆───────────────────────────────┤
  │ SERBIA                          ┆         [Nemanja] [Kingdom]   │
  ├────────────────────────────────┆───────────────────────────────┤
  │ PAPACY   [Pope I] [Pope II]     ┆                                 │
  └────────────────────────────────┴───────────────────────────────┘
  [+ show more civilizations ▾]
```

### Components
- **Time axis (top, sticky)** — always visible while scrolling vertically through lanes; scrolls horizontally with the timeline itself
- **69-year cycle markers** — manually placed and manually draggable bands (not auto-generated), with an optional split into custom sub-periods (e.g. 44+25). Dragging a cycle's edge, or a sub-period divider inside it, updates its stored boundaries directly; a small "+" control on the axis adds a new cycle or sub-period at the clicked point
- **Vertical markers** — cross-cutting reference lines (Birth of Christ, Year of the Plague, Collapse of the Middle Ages) drawn through every lane at once, manually added per timeline, labeled at the top
- **Civilization lane** — one horizontal strip per civilization (including Papacy as its own lane), background tint from `civilizations.color_hex` by default
- **Entry/ruler card color** — resolved in priority order: **correspondence group color** (if the ruler belongs to one) → **individual override** → **civilization default**. This is what makes a color set once on a Real-timeline ruler automatically appear on every grouped duplicate elsewhere
- **Entry card** — a compact chip showing title + year; click expands into a detail panel without leaving the timeline
- **Lane visibility toggle** — collapse/hide lanes you're not focused on
- **Coin track (configurable display mode)** — coins are too numerous per ruler to render as peer cards in the main lane. A user-selectable mode near the lane controls:
  - **Off** — no coins shown
  - **Nested per ruler** — a compact coin-count badge on each ruler's card, expandable into a small strip beneath just that ruler
  - **Full horizontal track** — a dedicated lane beneath the civilization, every coin from every ruler plotted by year side by side — built for watching a ruler age or comparing across rulers
  - **Vertical rail** — coins listed top-to-bottom in a side panel, useful when horizontal space is tight (e.g. the denser 1198–1411 timeline)
  - **Coin type continuity band** — coins sharing a `coin_type_id`, when Full track or Vertical rail is active, are connected by a thin band spanning their full minting range, showing a recurring design as one continuous tradition rather than scattered points
- **Stacking for overlapping rulers** — on any timeline (particularly a Compressed Presentation timeline), when two rulers' position ranges overlap, they render as stacked rows within the same lane rather than forced side by side, like a Gantt chart resolving overlaps — the visual mechanism for showing "these were co-rulers / decades apart, not centuries apart"

### Zoom levels
| Zoom | What's shown per entry | Typical use |
|---|---|---|
| **Century view** | Dots/ticks only, major events labeled | Orientation |
| **Decade view** | Compact cards: title + year | Browsing a period |
| **Year view** | Full cards: title, short description, thumbnail image/coin | Close reading, editing |

Zoom is a slider or +/- control near the time axis; scroll-wheel zoom is the natural interaction.

### Interactions
- **Click a card** → opens detail panel (side drawer, keeps timeline context visible)
- **Click a cycle band** → filters/highlights everything within that cycle
- **Drag horizontally** → pan through time
- **Drag a ruler/entry/coin card** → repositions it; a live tooltip and vertical guide line track the exact year it will snap to (snap increment adjustable: 1 year / 5 years / decade). Dragging a card into a *different timeline's* panel creates a new position for it there — the tooltip clarifies which timeline it's about to land on (e.g. "→ 1247 · Real Medieval") — without removing it from the timeline it was dragged from
- **Click "+ Add Entry" on a lane** → opens the entry form pre-filled with that civilization and a year guessed from the click position

---

## 2. Civilization Mode

Organized by *civilization* rather than time — a dedicated deep-dive view. Rulers, scholars, and popes all use the same profile pattern described below.

### Layout
```
┌───────────────┬────────────────────────────────────────────────┐
│ CIVILIZATIONS  │  ROME                                            │
│ ─────────────  │  ─────────────────────────────────────────────  │
│ ▸ Rome          │  [banner image]                                  │
│   Byzantium     │  Overview text...                                │
│   Serbia        │                                                  │
│   Papacy        │  Dynasties: [Julio-Claudian] [Flavian] ...       │
│   Greece        │                                                  │
│   ...           │  Rulers timeline: [Caesar]→[Augustus]→[Trajan]  │
│                 │                                                  │
│  SCHOLARS        │  Key events: (chronological list)                │
│  ─────────────    │                                                │
│  Cicero            │  Coins from this civilization: [grid of coins]│
│  Seneca              │                                              │
│  J. Scaliger            │                                            │
└───────────────┴────────────────────────────────────────────────┘
```

### Components
- **Civilization list (left sidebar)** — shows successor relationships visually (Byzantium nested under Rome) so the transition is visible in navigation, not just data
- **Scholars list** — a separate section in the same sidebar, since scholars (Cicero, Seneca, Scaliger) aren't tied to a civilization's political structure
- **Ruler succession strip** — horizontal mini-timeline of rulers in order, clickable, dynasty boundaries as dividers
- **Event list** — chronological, filterable by entry type
- **Coin gallery** — grid of coin thumbnails, click-through to Coin Catalogue mode

### Ruler / Scholar Profile Panel
Opened by clicking any ruler, pope, or scholar card, in any mode:

```
┌─────────────────────────────────────────────┐
│  Uroš I                                        │
│  ─────────────────────────────────────────    │
│  [portrait]   Biography text...                │
│                                                  │
│  Bullet points:                                 │
│   • ...                                          │
│   • ...                                           │
│                                                    │
│  Timeline positions                                │
│   Nominal            [1243] → [1276]    ✕           │
│   Real Medieval       [1247] → [1261]    ✕            │
│   AUC Structure        [ — not placed — ]  [+ Add]      │
│   [+ Add another timeline placement]                      │
│                                                              │
│  Correspondence group: [Real ruler behind cluster ▾]          │
│  Duplicate label: [younger version]                             │
│                                                                    │
│  Regnal-year view: [ View reign as years 1–N ]  [ Mirror ]         │
│                                                                       │
│  Appearance: Background [■] Font [Serif ▾] Font color [■]             │
│                                                                          │
│  Coins minted: [grid/strip]                                               │
└─────────────────────────────────────────────┘
```
- **Timeline positions list** is a direct, typed alternative to dragging — editing a year here writes to the same `*_timeline_positions` row that dragging on the Timeline canvas would produce, so either method works interchangeably
- **Correspondence group / duplicate label** — assign this profile to a real-identity group, and label which version it represents (free text, no fixed count)
- **Regnal-year view** — opens a secondary mini-timeline scaled to this ruler's own reign (year 1 to N), with entries plotted by `regnal_year`; the **Mirror** toggle reverses it, last regnal year first
- **Appearance** — background color, font, and font color; only ever shown/editable here, not cluttering the browse view elsewhere

### Interactions
- Selecting a civilization or scholar in the sidebar updates the whole right panel without a page reload
- "View on Timeline" button — jumps back to Timeline mode, filtered to just this profile, at the correct time position on whichever timeline is currently selected

---

## 3. Coin Catalogue Mode

A **grid/gallery**, not a timeline, since coins are physical objects best browsed visually first.

### Layout
```
┌────────────────────────────────────────────────────────────────┐
│ Sort: [Chronological ▾]   View: [Grid] [List]                    │
├────────────┬────────────┬────────────┬────────────┬─────────────┤
│ [front img] │ [front img] │ [front img] │ [front img] │ [front img] │
│ Denarius     │ Follis        │ Grosh          │ ...            │ ...           │
│ Augustus     │ Justinian     │ Uroš I          │                │                │
│ 27 BC        │ 540 AD        │ 1253 AD        │                │                │
└────────────┴────────────┴────────────┴────────────┴─────────────┘
```

### Components
- **Coin card** — front image primary, name/ruler/date as caption
- **Coin detail view (on click)** — flip-style front/back toggle, full metadata, linked entries/rulers/coin type
- **Filters specific to coins** — metal type, mint location, weight range, coin type — layered on the persistent civilization/year filters

### Interactions
- **Click front image** → flips to back image
- **"View minting context"** → jumps to the ruler or entry this coin is linked to
- **"View coin type"** → shows every coin sharing this design across its full minting range, regardless of ruler

---

## 4. Poster Creation Mode

A **configuration + preview tool**, since the output is a fixed print artifact.

### Layout
```
┌───────────────┬────────────────────────────────────────────────┐
│ SETTINGS        │                                                  │
│ ─────────────   │              [ LIVE PREVIEW ]                    │
│ Timeline:         │        (scaled-down poster render,               │
│  [Nominal ▾]        │         updates as settings change)              │
│ Date range:           │                                                  │
│  [45 BC]─[1629]         │                                                  │
│                            │                                                  │
│ Civilizations:               │                                                  │
│  ☑ Rome                        │                                                  │
│  ☑ Serbia                         │                                                  │
│  ...                                 │                                                  │
│                                          │                                                  │
│ Paper size:                                │                                                  │
│  ( ) A1  (•) A0  ( ) Custom                   │                                            │
│                                                   │                                                  │
│ Column arrangement:                                 │                                                  │
│  [drag to reorder lanes]                               │                                                  │
│                                                            │                                                  │
│ [ Export PDF ]  [ Export PNG (hi-res) ]                       │                                    │
└───────────────┴────────────────────────────────────────────────┘
```

### Components
- **Timeline selector** — choose which timeline (Nominal, Real Medieval, or a Compressed Presentation timeline) the poster draws from
- **Settings panel** — date range slider, civilization checklist, paper size selector, orientation toggle
- **Column arranger** — drag-and-drop reordering of civilization lanes for the poster, independent of Timeline mode's order
- **Live preview** — a scaled-down, layout-accurate render from the print rendering pipeline, debounced on setting changes
- **Export buttons** — PDF (vector, print-ready) and high-res PNG/JPEG

### Interactions
- Every settings change updates the live preview (debounced)
- Toggling a civilization off removes its column and reflows the rest
- Export runs as a background job with a progress indicator for large posters

---

## Cross-Mode Design Principles

- **Detail panels, not page navigation.** Clicking any entry/coin/ruler/scholar opens a side drawer, in every mode.
- **Filters persist across modes and survive timeline switches.**
- **Appearance controls live only in the profile/detail panel**, never cluttering the browse view.
- **Every mode has a path back to Timeline mode**, on whichever timeline was last selected.
- **A "Compressed Presentation" timeline is just another entry in the timeline selector** — no separate mode needed. You build it the same way as any other timeline (manual positions, informed by correspondence groups you've already set up), and stacking/overlap rendering makes the compression visually obvious when you present it.

---

Next: **Part 4 — MVP build plan and code**, structured as Phase 1–4, using the plain local web app approach we agreed on. Say go when ready.
