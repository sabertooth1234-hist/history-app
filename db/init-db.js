// Run once with: npm run init-db
// Creates the SQLite database file and seeds the eight starter civilizations.
const fs = require('fs');
const path = require('path');
const db = require('./connection');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Safe, idempotent column addition — checks first, so running init-db
// multiple times (even after this column already exists) never crashes
// with a "duplicate column" error the way an unconditional ALTER would.
const rulerColumns = db.prepare("PRAGMA table_info(rulers)").all().map(c => c.name);
if (!rulerColumns.includes('verified')) {
  db.exec('ALTER TABLE rulers ADD COLUMN verified INTEGER DEFAULT 0');
  console.log('Added "verified" column to rulers.');
}

const starterCivilizations = [
  { name: 'Rome',            short_code: 'ROME', color_hex: '#c0553d', order: 1 },
  { name: 'Serbia',          short_code: 'SRB',  color_hex: '#3d8b8b', order: 2 },
  { name: 'Greece',          short_code: 'GRE',  color_hex: '#8b6fc0', order: 3 },
  { name: 'France',          short_code: 'FRA',  color_hex: '#4a6fa5', order: 4 },
  { name: 'Germany',         short_code: 'GER',  color_hex: '#5a5a5a', order: 5 },
  { name: 'United Kingdom',  short_code: 'UK',   color_hex: '#3d5c8b', order: 6 },
  { name: 'North Africa',    short_code: 'NAF',  color_hex: '#c0943d', order: 7 },
  { name: 'Anatolia',        short_code: 'ANA',  color_hex: '#a5583d', order: 8 },
  { name: 'Polish-Lithuanian Commonwealth', short_code: 'PLC', color_hex: '#b5453d', order: 9 },
  { name: 'Russia/Tartaria', short_code: 'RUT',  color_hex: '#6b7a4a', order: 10 }
];

const insert = db.prepare(
  `INSERT OR IGNORE INTO civilizations (name, short_code, color_hex, default_column_order)
   VALUES (@name, @short_code, @color_hex, @order)`
);

const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(row);
});
insertMany(starterCivilizations);

console.log(`Database initialized at ${path.join(__dirname, 'history.db')}`);
console.log(`Seeded ${starterCivilizations.length} starter civilizations.`);

const cycleColumns = db.prepare("PRAGMA table_info(cycle_definitions)").all().map(c => c.name);
if (!cycleColumns.includes('end_year')) {
  db.exec('ALTER TABLE cycle_definitions ADD COLUMN end_year INTEGER');
  console.log('Added "end_year" column to cycle_definitions.');
}

// Fix the missing ON DELETE behavior on coins.ruler_id (root cause of
// "deleting a ruler with coins fails silently"). SQLite can't ALTER an
// existing foreign key constraint, so for a database that already has
// the old coins table, this rebuilds it with the corrected constraint
// and copies the data across — a real migration, not just a fresh-install
// fix, so existing databases get the same reliability guarantee.
const coinsFks = db.prepare("PRAGMA foreign_key_list(coins)").all();
const rulerFk = coinsFks.find(fk => fk.table === 'rulers');
if (rulerFk && rulerFk.on_delete === 'NO ACTION') {
  console.log('Migrating coins table to fix ruler_id cascade behavior...');
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE coins_new (
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
    INSERT INTO coins_new SELECT * FROM coins;
    DROP TABLE coins;
    ALTER TABLE coins_new RENAME TO coins;
    CREATE INDEX IF NOT EXISTS idx_coins_years ON coins(year_start, year_end);
  `);
  db.pragma('foreign_keys = ON');
  console.log('coins table migrated successfully — deleting a ruler now unlinks their coins instead of failing.');
}
