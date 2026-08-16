# Historical Timeline Application — Database Schema (Part 2, consolidated)

## Design Philosophy

Four principles drive every decision below:

1. **One core entity, typed, not five duplicate tables.** Events, wars, political changes, and cultural developments are all "things that happened at a time, in a place, involving people." They become one `historical_entries` table with an `entry_type` field, not `events`, `wars`, `political_changes` as separate tables.
2. **Many-to-many everywhere reality is many-to-many.** An entry can touch multiple civilizations/regions. A ruler can belong to multiple dynasties across a transition. Junction tables, not foreign key columns, model these.
3. **Dates are never a single INTEGER.** Historical dates need calendar system, precision/uncertainty, and BC/AD sign — a reusable structure, not bolted on per table.
4. **A person or entity is one row, not one row per timeline.** Rulers, scholars, entries, and coins each exist once. Every timeline they appear on is a separate *position* record pointing back at that one row — this is what makes styling (color, font) and identity consistent everywhere automatically, with no synchronization logic required.

---

## Handling Dates (used throughout)

Rather than a plain `year INT`, every dateable table uses this pattern:

```sql
year_start        INTEGER,        -- astronomical year numbering (see below)
year_end          INTEGER,        -- NULL if a single-point date
calendar_system    VARCHAR(20),    -- 'BC_AD', 'BCE_CE', 'AUC', 'BYZANTINE', etc.
date_precision     VARCHAR(20),    -- 'exact', 'circa', 'decade', 'century', 'disputed'
date_uncertainty_notes TEXT        -- e.g. "Some sources place this in 1219"
```

**Astronomical year numbering** solves BC/AD math: 1 BC = year `0`, 2 BC = year `-1`, 1 AD = year `1`. Date-range queries (`WHERE year_start BETWEEN -44 AND 1629`) work cleanly across the BC/AD boundary with no special-casing. `calendar_system` is kept separately so the UI can still *display* "45 BC" even though it's stored as `-44` internally.

`date_precision = 'circa'` combined with `date_uncertainty_notes` handles approximate dates without a fake exact year that misleads later queries.

---

## Core Tables

### `civilizations`
The high-level columns (Rome, Serbia, Greece, etc.), including Papacy as its own column, with room for successor civilizations (Byzantium) without hardcoding.

```sql
CREATE TABLE civilizations (
    civilization_id     SERIAL PRIMARY KEY,
    name                 VARCHAR(100) NOT NULL,        -- 'Roman Empire', 'Byzantine Empire', 'Papacy'
    short_code           VARCHAR(20) UNIQUE,            -- 'ROME', 'BYZ', 'SRB', 'PAPACY'
    parent_civilization_id INTEGER REFERENCES civilizations(civilization_id), -- succession link
    description           TEXT,
    default_column_order  INTEGER,                       -- for timeline lane ordering
    color_hex             VARCHAR(7),                     -- UI lane default color
    created_at, updated_at
);
```
`parent_civilization_id` is how **Rome → Byzantium** is modeled — see Special Cases.

### `regions`
Separate from civilizations because regions are geographic and outlive/precede the civilizations occupying them (e.g. "the Balkans" hosts Rome, then Byzantium, then Serbia, overlapping).

```sql
CREATE TABLE regions (
    region_id       SERIAL PRIMARY KEY,
    name             VARCHAR(100) NOT NULL,     -- 'Balkans', 'Anatolia', 'Gaul'
    modern_equivalent VARCHAR(200),
    parent_region_id INTEGER REFERENCES regions(region_id),
    created_at, updated_at
);
```

### `dynasties`
```sql
CREATE TABLE dynasties (
    dynasty_id          SERIAL PRIMARY KEY,
    name                  VARCHAR(150) NOT NULL,   -- 'Nemanjić dynasty'
    civilization_id       INTEGER REFERENCES civilizations(civilization_id),
    year_start, year_end  INTEGER,
    predecessor_dynasty_id INTEGER REFERENCES dynasties(dynasty_id),
    description            TEXT,
    created_at, updated_at
);
```

### `images`
Shared infrastructure, defined early since rulers, scholars, entries, and coins all reference it.

```sql
CREATE TABLE images (
    image_id       SERIAL PRIMARY KEY,
    file_path        TEXT NOT NULL,        -- object storage path/URL
    file_type          VARCHAR(20),
    width_px, height_px INTEGER,
    alt_text            VARCHAR(300),
    uploaded_by          VARCHAR(100),
    created_at
);
```

### `rulers`
One row per ruler profile — including "duplicate" profiles of the same real person, which get linked together via `ruler_correspondence_groups` further down, not merged into one row.

```sql
CREATE TABLE rulers (
    ruler_id                 SERIAL PRIMARY KEY,
    name                       VARCHAR(150) NOT NULL,     -- 'Stefan Nemanja'
    title                       VARCHAR(100),               -- 'Grand Prince', 'Emperor', 'Pope'
    dynasty_id                  INTEGER REFERENCES dynasties(dynasty_id),
    civilization_id             INTEGER REFERENCES civilizations(civilization_id),
    reign_start, reign_end        INTEGER,  -- Nominal-timeline years; other timelines use ruler_timeline_positions
    birth_year, death_year          INTEGER,
    predecessor_ruler_id             INTEGER REFERENCES rulers(ruler_id),
    biography                          TEXT,
    portrait_image_id                    INTEGER REFERENCES images(image_id),
    background_color_hex                   VARCHAR(7),  -- lives on the ruler itself, so a color set while
    font_family                              VARCHAR(50), -- viewing one timeline appears identically on
    font_color_hex                             VARCHAR(7), -- every other timeline this ruler is placed on
    regnal_timeline_reversed                     BOOLEAN DEFAULT false,  -- mirrors this ruler's own
                                                                            -- regnal-year (1...N) timeline:
                                                                            -- last year first, year 1 last
    created_at, updated_at
);

CREATE TABLE ruler_bullet_points (
    bullet_id     SERIAL PRIMARY KEY,
    ruler_id        INTEGER REFERENCES rulers(ruler_id) ON DELETE CASCADE,
    bullet_text      TEXT NOT NULL,
    sort_order       INTEGER DEFAULT 0
);
```

### `scholars`
Commentators/chronologists — Cicero, Seneca, Joseph Scaliger — kept distinct from `rulers` since they're not political figures tied to a civilization, but their dates and influence on chronology are tracked the same way.

```sql
CREATE TABLE scholars (
    scholar_id           SERIAL PRIMARY KEY,
    name                    VARCHAR(150) NOT NULL,
    birth_year, death_year   INTEGER,
    biography                  TEXT,
    portrait_image_id            INTEGER REFERENCES images(image_id),
    background_color_hex           VARCHAR(7),
    font_family                       VARCHAR(50),
    font_color_hex                       VARCHAR(7),
    created_at, updated_at
);

CREATE TABLE scholar_bullet_points (
    bullet_id     SERIAL PRIMARY KEY,
    scholar_id      INTEGER REFERENCES scholars(scholar_id) ON DELETE CASCADE,
    bullet_text       TEXT NOT NULL,
    sort_order          INTEGER DEFAULT 0
);
```

### `historical_entries`
The core table. Every event, war, political change, and cultural development is a row here.

```sql
CREATE TABLE historical_entries (
    entry_id                SERIAL PRIMARY KEY,
    entry_type                VARCHAR(30) NOT NULL,   -- 'event','war','political_change','cultural_development'
    title                       VARCHAR(300) NOT NULL,
    year_start, year_end          INTEGER,  -- Nominal-timeline years; other timelines use entry_timeline_positions
    calendar_system                  VARCHAR(20),
    date_precision                     VARCHAR(20),
    date_uncertainty_notes               TEXT,
    regnal_year                            INTEGER,   -- optional: position within a linked ruler's reign
                                                          -- (year 1, 2...) instead of/alongside an absolute
                                                          -- year. Absolute year, when both are known, always
                                                          -- takes precedence — regnal_year is a convenience
                                                          -- field for when only relative timing is known.
    description                                TEXT,
    cycle_marker_id                              INTEGER REFERENCES cycle_markers(cycle_marker_id),
    background_color_hex                           VARCHAR(7),  -- per-row override; falls back to
    font_family                                      VARCHAR(50), -- civilization.color_hex / app default
    font_color_hex                                     VARCHAR(7),
    created_by                                           VARCHAR(100),  -- 'manual','import','ai_assisted'
    created_at, updated_at
);

CREATE TABLE entry_bullet_points (
    bullet_id     SERIAL PRIMARY KEY,
    entry_id        INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    bullet_text      TEXT NOT NULL,
    sort_order       INTEGER DEFAULT 0
);
```
Styling is an *override*, not a required value — a row inherits its civilization's `color_hex` and the app's default font unless explicitly set. Bulk-imported data looks consistent by default while still allowing manual highlighting later, in both timeline cards and poster exports.

---

## Timelines & Per-Timeline Positioning

### `timelines`
A named, saved timeline configuration — "Nominal" (-45 to 1629), "Real Medieval" (1198–1411), "AUC Structure," and "Adjusted" are four rows here, not four databases. All query the same underlying entity tables, filtered to their own range and using their own manually-entered positions.

```sql
CREATE TABLE timelines (
    timeline_id             SERIAL PRIMARY KEY,
    name                       VARCHAR(150) NOT NULL,
    year_start, year_end         INTEGER,
    default_coin_track_mode        VARCHAR(20),   -- 'off','nested','full_track','vertical_rail'
    created_at, updated_at
);
```

### `timeline_anchors`
Reference points connecting timelines — informational only, never used for automatic calculation. Every year conversion in this app is entered by hand; anchors just document known correspondences for you to see them side by side.

```sql
CREATE TABLE timeline_anchors (
    anchor_id    SERIAL PRIMARY KEY,
    label          VARCHAR(200),   -- 'Julian calendar point', 'Birth of Christ (real chronology)'
    notes            TEXT
);

CREATE TABLE timeline_anchor_positions (
    anchor_id    INTEGER REFERENCES timeline_anchors(anchor_id) ON DELETE CASCADE,
    timeline_id    INTEGER REFERENCES timelines(timeline_id),
    year             INTEGER NOT NULL,
    PRIMARY KEY (anchor_id, timeline_id)
);
```

### Per-timeline positions
Every ruler, entry, coin, and scholar gets its own year entered separately for each timeline it appears on — manually, every time, with no interpolation. An entity simply has no row on a timeline it hasn't been placed on yet.

```sql
CREATE TABLE ruler_timeline_positions (
    ruler_id             INTEGER REFERENCES rulers(ruler_id) ON DELETE CASCADE,
    timeline_id             INTEGER REFERENCES timelines(timeline_id),
    reign_start, reign_end    INTEGER,
    PRIMARY KEY (ruler_id, timeline_id)
);

CREATE TABLE entry_timeline_positions (
    entry_id             INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    timeline_id             INTEGER REFERENCES timelines(timeline_id),
    year_start, year_end      INTEGER,
    PRIMARY KEY (entry_id, timeline_id)
);

CREATE TABLE coin_timeline_positions (
    coin_id              INTEGER REFERENCES coins(coin_id) ON DELETE CASCADE,
    timeline_id             INTEGER REFERENCES timelines(timeline_id),
    year_start, year_end      INTEGER,
    PRIMARY KEY (coin_id, timeline_id)
);

CREATE TABLE scholar_timeline_positions (
    scholar_id           INTEGER REFERENCES scholars(scholar_id) ON DELETE CASCADE,
    timeline_id             INTEGER REFERENCES timelines(timeline_id),
    year_start, year_end      INTEGER,
    PRIMARY KEY (scholar_id, timeline_id)
);
```
Convention: an entity's base table (`rulers.reign_start`, `historical_entries.year_start`, etc.) holds its **Nominal timeline** value; every other timeline's value lives exclusively in these position tables. One consistent place to look, per timeline.

### `cycle_markers`
The 69-year cycle is manually created and positioned, not auto-generated — it's a symbolic/thematic layer, never computed or enforced by the app. Each cycle belongs to one timeline, since different timelines can carry entirely different cycle grids.

```sql
CREATE TABLE cycle_markers (
    cycle_marker_id  SERIAL PRIMARY KEY,
    timeline_id         INTEGER REFERENCES timelines(timeline_id),
    cycle_number          INTEGER,           -- display order, not a formula
    year_start, year_end  INTEGER,           -- manually set and manually draggable in the UI
    label                    VARCHAR(100),
    notes                     TEXT,
    created_at, updated_at
);

CREATE TABLE cycle_sub_periods (
    sub_period_id     SERIAL PRIMARY KEY,
    cycle_marker_id      INTEGER REFERENCES cycle_markers(cycle_marker_id) ON DELETE CASCADE,
    year_start, year_end  INTEGER,
    label                    VARCHAR(100),
    sort_order                INTEGER DEFAULT 0
);
```
Sub-periods split a cycle into custom, unequal segments (44+25, 46+23, or any other breakdown) and are **not required to sum to the parent cycle's span** — real calendar time can sit outside or between them, since the cycle is interpretive, not a strict unit of measure.

### `vertical_markers`
Cross-cutting reference lines (plague years, Birth of Christ, collapse points) that intersect every civilization lane at a given year — not tied to any single civilization or entry, manual and timeline-specific like everything above.

```sql
CREATE TABLE vertical_markers (
    marker_id    SERIAL PRIMARY KEY,
    timeline_id    INTEGER REFERENCES timelines(timeline_id),
    year             INTEGER,
    label              VARCHAR(200),   -- 'Year of the Plague', 'Collapse of the Middle Ages'
    description          TEXT,
    color_hex              VARCHAR(7),
    created_at, updated_at
);
```

---

## Correspondence Groups

### `ruler_correspondence_groups` and `ruler_group_memberships`
For revealing that multiple, widely-separated rulers on the Nominal timeline may correspond to one real ruler or a tight cluster of co-rulers on the Real Medieval timeline. Groups hold however many profiles you identify — commonly four or five per real person, not a fixed pair. Color is set once on the group (typically starting from the Real timeline); every ruler tagged into it shares that color, wherever they're displayed.

```sql
CREATE TABLE ruler_correspondence_groups (
    group_id      SERIAL PRIMARY KEY,
    label            VARCHAR(200),
    color_hex          VARCHAR(7),
    notes                TEXT,
    created_at, updated_at
);

CREATE TABLE ruler_group_memberships (
    ruler_id         INTEGER REFERENCES rulers(ruler_id) ON DELETE CASCADE,
    group_id           INTEGER REFERENCES ruler_correspondence_groups(group_id) ON DELETE CASCADE,
    duplicate_label       VARCHAR(100),   -- free text: 'younger version', 'older version',
                                            -- 'alternate identity 3', or blank — no fixed count assumed
    PRIMARY KEY (ruler_id, group_id)
);
```
Display color fallback order: **group color (if a member) → the ruler's own `background_color_hex` override → civilization default.**

---

## Junction (Many-to-Many) Tables

This is where "the same event belongs to multiple regions," "overlapping civilizations," and cross-references to rulers/scholars/coins/sources get solved properly — instead of single foreign key columns on `historical_entries`.

```sql
CREATE TABLE entry_civilizations (
    entry_id          INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    civilization_id     INTEGER REFERENCES civilizations(civilization_id),
    relevance_note       VARCHAR(200),   -- 'primary actor' / 'affected party'
    PRIMARY KEY (entry_id, civilization_id)
);

CREATE TABLE entry_regions (
    entry_id     INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    region_id      INTEGER REFERENCES regions(region_id),
    PRIMARY KEY (entry_id, region_id)
);

CREATE TABLE entry_rulers (
    entry_id     INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    ruler_id       INTEGER REFERENCES rulers(ruler_id),
    role_note       VARCHAR(200),    -- 'ordered the event', 'died in this event'
    PRIMARY KEY (entry_id, ruler_id)
);

CREATE TABLE entry_scholars (
    entry_id     INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    scholar_id     INTEGER REFERENCES scholars(scholar_id),
    role_note        VARCHAR(200),  -- 'established this date', 'disputed this chronology'
    PRIMARY KEY (entry_id, scholar_id)
);

CREATE TABLE entry_related_entries (
    entry_id           INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    related_entry_id     INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    relationship_type     VARCHAR(50),  -- 'cause','consequence','parallel','part_of'
    PRIMARY KEY (entry_id, related_entry_id)
);

CREATE TABLE entry_coins (
    entry_id   INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    coin_id      INTEGER REFERENCES coins(coin_id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, coin_id)
);

CREATE TABLE entry_sources (
    entry_id     INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    source_id      INTEGER REFERENCES sources(source_id),
    page_reference   VARCHAR(50),
    PRIMARY KEY (entry_id, source_id)
);

CREATE TABLE entry_images (
    entry_id     INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    image_id       INTEGER REFERENCES images(image_id) ON DELETE CASCADE,
    caption          VARCHAR(300),
    sort_order       INTEGER DEFAULT 0,
    PRIMARY KEY (entry_id, image_id)
);
```

---

## Coins

### `coin_types`
Represents a *design*, independent of any single minted coin — what lets the timeline show that a design reappearing across multiple rulers/decades is one continuous minting tradition rather than scattered unrelated coins.

```sql
CREATE TABLE coin_types (
    coin_type_id       SERIAL PRIMARY KEY,
    name                  VARCHAR(150),      -- 'Nemanjić Grosh, standard type'
    design_description      TEXT,
    first_minted_year         INTEGER,       -- earliest known instance, astronomical year
    last_minted_year           INTEGER,       -- latest known instance
    created_at, updated_at
);
```

### `coins`
```sql
CREATE TABLE coins (
    coin_id             SERIAL PRIMARY KEY,
    name                  VARCHAR(150),         -- 'Denarius of Augustus'
    coin_type_id            INTEGER REFERENCES coin_types(coin_type_id),
    issuing_authority_id      INTEGER REFERENCES civilizations(civilization_id),
    ruler_id                    INTEGER REFERENCES rulers(ruler_id),
    year_start, year_end          INTEGER,  -- Nominal-timeline years; others use coin_timeline_positions
    calendar_system                 VARCHAR(20),
    date_precision                    VARCHAR(20),
    metal                               VARCHAR(50),        -- 'silver','bronze','gold'
    weight_grams                          DECIMAL(6,2),
    mint_location                           VARCHAR(150),
    front_image_id                            INTEGER REFERENCES images(image_id),
    back_image_id                               INTEGER REFERENCES images(image_id),
    description                                   TEXT,
    historical_significance                         TEXT,
    created_at, updated_at
);
```
Front/back are two distinct FK columns rather than relying on image sort order — coins always have exactly two canonical faces, modeled explicitly.

---

## Sources

```sql
CREATE TABLE sources (
    source_id       SERIAL PRIMARY KEY,
    title             VARCHAR(300) NOT NULL,
    author              VARCHAR(200),
    scholar_id            INTEGER REFERENCES scholars(scholar_id),  -- optional structured link, nullable
    publication_year     INTEGER,
    source_type           VARCHAR(50),   -- 'book','academic_paper','museum_record','website'
    url                     TEXT,
    isbn_or_identifier       VARCHAR(100),
    reliability_note          TEXT,        -- e.g. "primary source" vs "secondary/disputed"
    created_at, updated_at
);
```
A source can link directly to a cataloged scholar for structured attribution, while uncataloged authors still work fine as plain text in `author`.

---

## Edit History (maintainability requirement)

Since historical data gets revised as research improves, one polymorphic audit log covers every table at this scale:

```sql
CREATE TABLE edit_history (
    edit_id       SERIAL PRIMARY KEY,
    table_name      VARCHAR(50) NOT NULL,   -- 'historical_entries','coins','rulers', etc.
    record_id         INTEGER NOT NULL,
    field_changed       VARCHAR(100),
    old_value             TEXT,
    new_value             TEXT,
    changed_by             VARCHAR(100),
    change_source            VARCHAR(30),    -- 'manual','ai_suggested','import'
    changed_at
);
```
This also gives the AI assistant (Part 5) a place to log suggested changes for human review before they're committed.

---

## Example Records

**civilizations**
| civilization_id | name | short_code | parent_civilization_id |
|---|---|---|---|
| 1 | Roman Empire | ROME | NULL |
| 2 | Byzantine Empire | BYZ | 1 |
| 3 | Serbia (Medieval) | SRB | NULL |

**historical_entries**
| entry_id | entry_type | title | year_start | year_end | calendar_system | date_precision |
|---|---|---|---|---|---|---|
| 101 | political_change | Diocletian splits the Empire (Tetrarchy) | 293 | NULL | BC_AD | exact |
| 102 | event | Fall of Constantinople | 1453 | NULL | BC_AD | exact |
| 103 | political_change | Stefan Nemanja founds the Nemanjić dynasty | 1166 | NULL | BC_AD | circa |

**entry_civilizations**
| entry_id | civilization_id | relevance_note |
|---|---|---|
| 101 | 1 | primary actor |
| 102 | 2 | primary actor |
| 103 | 3 | primary actor |

**coins**
| coin_id | name | ruler_id | metal | weight_grams | mint_location |
|---|---|---|---|---|---|
| 501 | Denarius of Augustus | 12 | silver | 3.80 | Rome |

**ruler_timeline_positions**
| ruler_id | timeline_id | reign_start | reign_end |
|---|---|---|---|
| 12 | 1 (Nominal) | 27 | 14 (spans BC/AD) |
| 12 | 2 (Real Medieval) | 1247 | 1261 |

---

## Special Cases — As Requested

### 1. Roman Empire → Byzantine Empire
Modeled via `civilizations.parent_civilization_id`. Byzantium is its own row but linked back to Rome as a successor — queryable together, still visually distinct lanes. The transition point itself is a `historical_entries` row of type `political_change`, linked to both civilization rows via `entry_civilizations`.

### 2. Serbian medieval dynasties
Modeled via `dynasties.predecessor_dynasty_id`, mirroring the civilization pattern at a finer grain (Vojislavljević → Nemanjić → Lazarević → Branković). Each ruler points to its `dynasty_id`, so successions are queryable independent of civilization-level changes.

### 3. Overlapping civilizations
`entry_civilizations` and `entry_regions` are junction tables specifically so one entry (e.g. a battle) can link to Byzantium, Serbia, and Bulgaria simultaneously, each with its own `relevance_note`.

### 4. Different calendars (BC/AD, BCE/CE)
Solved at storage (astronomical year integer, calendar-agnostic) and display (`calendar_system` tells the UI which label convention to render) levels. Additional calendars (Hijri, Byzantine indiction) become new `calendar_system` values without schema changes.

### 5. Historical uncertainty
`date_precision` + `date_uncertainty_notes` on every dateable table. A century-level entry still sorts and filters correctly, and renders visually distinct (dashed line, "c." prefix) rather than implying false precision.

### 6. Multiple parallel timelines with independently-set years (Nominal, Real Medieval, AUC Structure, Adjusted)
Solved by the per-timeline position tables above. No formula converts between timelines — every year on every timeline is entered by hand, deliberately, since the whole point is documenting where the official chronology and your researched chronology diverge.

### 7. Rulers/popes with several duplicate profiles representing one real person
Solved by `ruler_correspondence_groups` — a group can hold as many member profiles as identified, each optionally labeled via `duplicate_label`, all sharing one display color to make the correspondence visible at a glance.

---

## Indexing Notes (for scale/performance)
- B-tree index on `historical_entries(year_start, year_end)` and each `*_timeline_positions(timeline_id, year_start, year_end)` — the core date-range filtering queries
- Index on all junction table foreign keys
- Postgres full-text search (`tsvector`) column on `historical_entries.title || description` for search
- Partial index on `entry_type` if types like `war` are frequently filtered alone

This schema stays comfortably performant into the tens of thousands of rows without special scaling work.

---

Next: **Part 3 — UX/UI Design**, consolidated with everything added this session (drag-and-drop with year snapping, coin track modes, correspondence-group coloring, vertical markers, stacked/compressed presentation view).
