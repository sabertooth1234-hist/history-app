const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../db/connection');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'coins'), // shared uploads folder
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

function saveSourceLinks(rulerId, sourceIds) {
  db.prepare('DELETE FROM ruler_sources WHERE ruler_id = ?').run(rulerId);
  const insert = db.prepare('INSERT OR IGNORE INTO ruler_sources (ruler_id, source_id) VALUES (?, ?)');
  (sourceIds || []).forEach(sid => insert.run(rulerId, sid));
}

function normalizeArray(v) {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

router.get('/', (req, res) => {
  const { civilization_id, year_min, year_max } = req.query;
  let query = 'SELECT * FROM rulers WHERE 1=1';
  const params = [];
  if (civilization_id) { query += ' AND civilization_id = ?'; params.push(civilization_id); }
  if (year_min && year_max) {
    query += ' AND reign_start <= ? AND reign_end >= ?';
    params.push(year_max, year_min);
  }
  query += ' ORDER BY reign_start';
  res.json(db.prepare(query).all(...params));
});

router.get('/:id', (req, res) => {
  const ruler = db.prepare('SELECT * FROM rulers WHERE ruler_id = ?').get(req.params.id);
  if (!ruler) return res.status(404).json({ error: 'not found' });

  ruler.bullet_points = db.prepare(
    'SELECT * FROM ruler_bullet_points WHERE ruler_id = ? ORDER BY sort_order'
  ).all(req.params.id);
  ruler.coins = db.prepare('SELECT * FROM coins WHERE ruler_id = ? ORDER BY year_start').all(req.params.id);
  ruler.sources = db.prepare(
    `SELECT s.* FROM sources s JOIN ruler_sources rs ON rs.source_id = s.source_id WHERE rs.ruler_id = ?`
  ).all(req.params.id);
  ruler.completeness = {
    added: true,
    has_portrait: !!ruler.portrait_image_path,
    has_sources: ruler.sources.length > 0,
    has_coin: ruler.coins.length > 0,
    verified: !!ruler.verified
  };
  res.json(ruler);
});

// Create — now multipart, so a portrait can be attached in the same
// request as everything else instead of a separate awkward step.
router.post('/', upload.single('portrait'), (req, res) => {
  const { name, title, civilization_id, reign_start, reign_end,
          birth_year, death_year, biography, background_color_hex, bullet_points_json } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!civilization_id) return res.status(400).json({ error: 'civilization is required' });
  if (reign_start === undefined || reign_start === '' || reign_end === undefined || reign_end === '') {
    return res.status(400).json({ error: 'reign start and end years are required' });
  }

  const portraitPath = req.file ? '/uploads/coins/' + req.file.filename : null;
  const verified = req.body.verified === 'true' || req.body.verified === 'on' ? 1 : 0;

  const result = db.prepare(
    `INSERT INTO rulers (name, title, civilization_id, reign_start, reign_end,
                          birth_year, death_year, biography, background_color_hex, verified, portrait_image_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, title || null, civilization_id || null, reign_start || null, reign_end || null,
        birth_year || null, death_year || null, biography || null, background_color_hex || null,
        verified, portraitPath);

  const rulerId = result.lastInsertRowid;

  let bulletPoints = [];
  try { bulletPoints = JSON.parse(bullet_points_json || '[]'); } catch (e) { /* ignore malformed */ }
  if (bulletPoints.length) {
    const insertBullet = db.prepare('INSERT INTO ruler_bullet_points (ruler_id, bullet_text, sort_order) VALUES (?, ?, ?)');
    bulletPoints.forEach((text, i) => insertBullet.run(rulerId, text, i));
  }

  const sourceIds = normalizeArray(req.body.source_ids).map(Number);
  if (sourceIds.length) saveSourceLinks(rulerId, sourceIds);

  res.status(201).json({ ruler_id: rulerId, portrait_image_path: portraitPath });
});

// Edit — also multipart now. If no new file is chosen, the existing
// portrait is kept (not cleared).
router.put('/:id', upload.single('portrait'), (req, res) => {
  const existing = db.prepare('SELECT * FROM rulers WHERE ruler_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { name, title, civilization_id, reign_start, reign_end,
          birth_year, death_year, biography, background_color_hex } = req.body;

  const portraitPath = req.file ? '/uploads/coins/' + req.file.filename : existing.portrait_image_path;
  const verified = req.body.verified === 'true' || req.body.verified === 'on' ? 1 : 0;

  db.prepare(
    `UPDATE rulers SET name=?, title=?, civilization_id=?, reign_start=?, reign_end=?,
                        birth_year=?, death_year=?, biography=?, background_color_hex=?, verified=?,
                        portrait_image_path=?
     WHERE ruler_id = ?`
  ).run(name, title, civilization_id, reign_start, reign_end,
        birth_year, death_year, biography, background_color_hex, verified, portraitPath, req.params.id);

  const sourceIds = normalizeArray(req.body.source_ids).map(Number);
  saveSourceLinks(req.params.id, sourceIds);

  res.json({ ok: true, portrait_image_path: portraitPath });
});

// A generous but real sanity bound — nothing in this app's scope should
// ever legitimately fall outside it. This is a backstop, not the primary
// fix: it exists so that even if a client-side bug ever computes a wild
// value again, it physically cannot be written to the database.
const YEAR_SANITY_MIN = -5000, YEAR_SANITY_MAX = 5000;
function isSaneYear(y) { return Number.isFinite(y) && y >= YEAR_SANITY_MIN && y <= YEAR_SANITY_MAX; }

router.patch('/:id/position', (req, res) => {
  const reign_start = Number(req.body.reign_start), reign_end = Number(req.body.reign_end);
  if (!isSaneYear(reign_start) || !isSaneYear(reign_end)) {
    return res.status(400).json({ error: `Rejected: years must be between ${YEAR_SANITY_MIN} and ${YEAR_SANITY_MAX}.` });
  }
  if (reign_end < reign_start) {
    return res.status(400).json({ error: 'Rejected: end year cannot be before start year.' });
  }
  db.prepare('UPDATE rulers SET reign_start = ?, reign_end = ? WHERE ruler_id = ?')
    .run(reign_start, reign_end, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM rulers WHERE ruler_id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/duplicate', (req, res) => {
  const r = db.prepare('SELECT * FROM rulers WHERE ruler_id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });

  const result = db.prepare(
    `INSERT INTO rulers (name, title, civilization_id, reign_start, reign_end,
                          birth_year, death_year, biography, background_color_hex)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(r.name + ' (copy)', r.title, r.civilization_id, r.reign_start, r.reign_end,
        r.birth_year, r.death_year, r.biography, r.background_color_hex);

  const newId = result.lastInsertRowid;
  const bullets = db.prepare('SELECT * FROM ruler_bullet_points WHERE ruler_id = ? ORDER BY sort_order').all(req.params.id);
  const insertBullet = db.prepare('INSERT INTO ruler_bullet_points (ruler_id, bullet_text, sort_order) VALUES (?, ?, ?)');
  bullets.forEach(b => insertBullet.run(newId, b.bullet_text, b.sort_order));

  res.status(201).json({ ruler_id: newId });
});

module.exports = router;
