-- Phase 2 schema: adds per-civilization active ranges, multi-civilization
-- entries (junction table), and keeps everything from Phase 1 intact.

CREATE TABLE IF NOT EXISTS civilizations (
    civilization_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    short_code           TEXT UNIQUE,
    color_hex            TEXT DEFAULT '#8899aa',
    default_column_order INTEGER DEFAULT 0,
    year_start           INTEGER,  -- active range start; NULL = follows the global timeline range
    year_end             INTEGER,  -- active range end;   NULL = follows the global timeline range
    created_at           TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rulers (
    ruler_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    title                 TEXT,
    civilization_id       INTEGER REFERENCES civilizations(civilization_id),
    reign_start, reign_end INTEGER,
    birth_year, death_year  INTEGER,
    biography                TEXT,
    portrait_image_path        TEXT,
    background_color_hex         TEXT,
    created_at                     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ruler_bullet_points (
    bullet_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    ruler_id      INTEGER REFERENCES rulers(ruler_id) ON DELETE CASCADE,
    bullet_text     TEXT NOT NULL,
    sort_order        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS historical_entries (
    entry_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type            TEXT NOT NULL CHECK(entry_type IN ('event','war','political_change','cultural_development')),
    title                   TEXT NOT NULL,
    year_start, year_end      INTEGER,
    calendar_system              TEXT DEFAULT 'BC_AD',
    date_precision                 TEXT DEFAULT 'exact',
    description                      TEXT,
    background_color_hex               TEXT,
    created_at                           TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many: an entry (e.g. "Antonine Plague") can be tagged to
-- several civilizations at once, so it appears in every relevant lane
-- at the same shared-axis position for direct comparison.
CREATE TABLE IF NOT EXISTS entry_civilizations (
    entry_id         INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    civilization_id    INTEGER REFERENCES civilizations(civilization_id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, civilization_id)
);

CREATE TABLE IF NOT EXISTS entry_bullet_points (
    bullet_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id      INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    bullet_text     TEXT NOT NULL,
    sort_order        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS coins (
    coin_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT,
    ruler_id                INTEGER REFERENCES rulers(ruler_id) ON DELETE SET NULL,
    civilization_id           INTEGER REFERENCES civilizations(civilization_id),
    year_start, year_end        INTEGER,
    metal                         TEXT,
    weight_grams                    REAL,
    mint_location                     TEXT,
    front_image_path                    TEXT,
    back_image_path                       TEXT,
    description                             TEXT,
    historical_significance                   TEXT,
    created_at                                  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sources (
    source_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    title             TEXT NOT NULL,
    author              TEXT,
    url                   TEXT,
    created_at              TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entries_years ON historical_entries(year_start, year_end);
CREATE INDEX IF NOT EXISTS idx_rulers_years ON rulers(reign_start, reign_end);
CREATE INDEX IF NOT EXISTS idx_coins_years ON coins(year_start, year_end);
CREATE INDEX IF NOT EXISTS idx_entry_civs_civ ON entry_civilizations(civilization_id);

-- Custom 69-year cycle markers. A cycle is defined once (start year +
-- interval) and every subsequent marker is calculated on the fly by the
-- frontend for whatever year range is currently visible — nothing per-
-- marker is stored, so the range can extend indefinitely in either
-- direction without needing new rows.
CREATE TABLE IF NOT EXISTS cycle_definitions (
    cycle_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    start_year       INTEGER NOT NULL,
    interval_years     INTEGER NOT NULL DEFAULT 69,
    color_hex             TEXT DEFAULT '#999999',
    label_prefix            TEXT DEFAULT 'Cycle',
    visible                    INTEGER DEFAULT 1,
    created_at                   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Links a coin to the historical event(s) it relates to, so a coin
-- references civilization + ruler + event rather than duplicating
-- event information inside the coin record.
CREATE TABLE IF NOT EXISTS entry_coins (
    entry_id     INTEGER REFERENCES historical_entries(entry_id) ON DELETE CASCADE,
    coin_id        INTEGER REFERENCES coins(coin_id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, coin_id)
);

-- Research-progress tracking (item 7): a ruler's completeness is derived
-- from whether it has a portrait, linked sources, and linked coins, plus
-- an explicit verification flag the researcher sets manually.
-- (The `verified` column on rulers is added conditionally in init-db.js,
-- not here, since ALTER TABLE isn't safe to run unconditionally every
-- time this script executes.)

CREATE TABLE IF NOT EXISTS ruler_sources (
    ruler_id     INTEGER REFERENCES rulers(ruler_id) ON DELETE CASCADE,
    source_id      INTEGER REFERENCES sources(source_id) ON DELETE CASCADE,
    PRIMARY KEY (ruler_id, source_id)
);

-- Custom cycles now require an explicit end year (item 1) — a cycle only
-- generates markers between start_year and end_year, not indefinitely.
-- (Added conditionally in init-db.js, same reasoning as `verified` above.)
