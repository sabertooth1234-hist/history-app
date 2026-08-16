const express = require('express');
const router = express.Router();
const db = require('../db/connection');

function attachCivilizations(entries) {
  const civLookup = db.prepare(
    'SELECT civilization_id FROM entry_civilizations WHERE entry_id = ?'
  );
  entries.forEach(e => {
    e.civilization_ids = civLookup.all(e.entry_id).map(r => r.civilization_id);
  });
  return entries;
}

// List entries in a year range. Returns each entry once, with a
// civilization_ids array — the frontend places a copy of the card into
// every lane it's tagged to, so the same event (e.g. a plague) can be
// compared across civilizations at the same shared-axis position.
router.get('/', (req, res) => {
  const { entry_type, year_min, year_max, civilization_id } = req.query;
  let query = `SELECT DISTINCT he.* FROM historical_entries he`;
  const params = [];

  if (civilization_id) {
    query += ` JOIN entry_civilizations ec ON ec.entry_id = he.entry_id AND ec.civilization_id = ?`;
    params.push(civilization_id);
  }
  query += ' WHERE 1=1';

  if (entry_type) { query += ' AND he.entry_type = ?'; params.push(entry_type); }
  if (year_min && year_max) {
    query += ' AND he.year_start <= ? AND (he.year_end IS NULL OR he.year_end >= ?)';
    params.push(year_max, year_min);
  }
  query += ' ORDER BY he.year_start';

  res.json(attachCivilizations(db.prepare(query).all(...params)));
});

router.get('/:id', (req, res) => {
  const entry = db.prepare('SELECT * FROM historical_entries WHERE entry_id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });

  entry.bullet_points = db.prepare(
    'SELECT * FROM entry_bullet_points WHERE entry_id = ? ORDER BY sort_order'
  ).all(req.params.id);
  entry.civilization_ids = db.prepare(
    'SELECT civilization_id FROM entry_civilizations WHERE entry_id = ?'
  ).all(req.params.id).map(r => r.civilization_id);

  res.json(entry);
});

function saveCivilizationLinks(entryId, civilizationIds) {
  db.prepare('DELETE FROM entry_civilizations WHERE entry_id = ?').run(entryId);
  const insert = db.prepare('INSERT OR IGNORE INTO entry_civilizations (entry_id, civilization_id) VALUES (?, ?)');
  (civilizationIds || []).forEach(cid => insert.run(entryId, cid));
}

router.post('/', (req, res) => {
  const { entry_type, title, year_start, year_end, calendar_system, date_precision,
          description, background_color_hex, bullet_points, civilization_ids } = req.body;

  if (!entry_type || !title) {
    return res.status(400).json({ error: 'entry_type and title are required' });
  }
  if (!Array.isArray(civilization_ids) || civilization_ids.length === 0) {
    return res.status(400).json({ error: 'at least one civilization must be selected' });
  }

  const result = db.prepare(
    `INSERT INTO historical_entries
       (entry_type, title, year_start, year_end, calendar_system, date_precision,
        description, background_color_hex)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(entry_type, title, year_start ?? null, year_end ?? null,
        calendar_system || 'BC_AD', date_precision || 'exact',
        description || null, background_color_hex || null);

  const entryId = result.lastInsertRowid;
  saveCivilizationLinks(entryId, civilization_ids.map(Number));

  if (Array.isArray(bullet_points)) {
    const insertBullet = db.prepare(
      'INSERT INTO entry_bullet_points (entry_id, bullet_text, sort_order) VALUES (?, ?, ?)'
    );
    bullet_points.forEach((text, i) => insertBullet.run(entryId, text, i));
  }

  res.status(201).json({ entry_id: entryId });
});

router.put('/:id', (req, res) => {
  const { entry_type, title, year_start, year_end, calendar_system, date_precision,
          description, background_color_hex, civilization_ids } = req.body;

  db.prepare(
    `UPDATE historical_entries
     SET entry_type=?, title=?, year_start=?, year_end=?, calendar_system=?, date_precision=?,
         description=?, background_color_hex=?
     WHERE entry_id = ?`
  ).run(entry_type, title, year_start, year_end, calendar_system, date_precision,
        description, background_color_hex, req.params.id);

  if (Array.isArray(civilization_ids)) {
    saveCivilizationLinks(req.params.id, civilization_ids.map(Number));
  }

  res.json({ ok: true });
});

// Lightweight position-only update for drag-and-drop / resize
const YEAR_SANITY_MIN = -5000, YEAR_SANITY_MAX = 5000;
function isSaneYear(y) { return y === null || (Number.isFinite(y) && y >= YEAR_SANITY_MIN && y <= YEAR_SANITY_MAX); }

router.patch('/:id/position', (req, res) => {
  const year_start = Number(req.body.year_start);
  const year_end = req.body.year_end === null || req.body.year_end === undefined ? null : Number(req.body.year_end);
  if (!isSaneYear(year_start) || !isSaneYear(year_end)) {
    return res.status(400).json({ error: `Rejected: years must be between ${YEAR_SANITY_MIN} and ${YEAR_SANITY_MAX}.` });
  }
  if (year_end !== null && year_end < year_start) {
    return res.status(400).json({ error: 'Rejected: end year cannot be before start year.' });
  }
  db.prepare('UPDATE historical_entries SET year_start = ?, year_end = ? WHERE entry_id = ?')
    .run(year_start, year_end, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM historical_entries WHERE entry_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Duplicate an entry (including bullet points and civilization tags)
router.post('/:id/duplicate', (req, res) => {
  const e = db.prepare('SELECT * FROM historical_entries WHERE entry_id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'not found' });

  const result = db.prepare(
    `INSERT INTO historical_entries
       (entry_type, title, year_start, year_end, calendar_system, date_precision,
        description, background_color_hex)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(e.entry_type, e.title + ' (copy)', e.year_start, e.year_end, e.calendar_system,
        e.date_precision, e.description, e.background_color_hex);

  const newId = result.lastInsertRowid;

  const civs = db.prepare('SELECT civilization_id FROM entry_civilizations WHERE entry_id = ?').all(req.params.id);
  saveCivilizationLinks(newId, civs.map(c => c.civilization_id));

  const bullets = db.prepare('SELECT * FROM entry_bullet_points WHERE entry_id = ? ORDER BY sort_order').all(req.params.id);
  const insertBullet = db.prepare('INSERT INTO entry_bullet_points (entry_id, bullet_text, sort_order) VALUES (?, ?, ?)');
  bullets.forEach(b => insertBullet.run(newId, b.bullet_text, b.sort_order));

  res.status(201).json({ entry_id: newId });
});

module.exports = router;
