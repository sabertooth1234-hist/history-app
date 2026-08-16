const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../db/connection');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'coins'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

function attachEvents(coin) {
  coin.event_ids = db.prepare('SELECT entry_id FROM entry_coins WHERE coin_id = ?')
    .all(coin.coin_id).map(r => r.entry_id);
  return coin;
}

function saveEventLinks(coinId, eventIds) {
  db.prepare('DELETE FROM entry_coins WHERE coin_id = ?').run(coinId);
  const insert = db.prepare('INSERT OR IGNORE INTO entry_coins (coin_id, entry_id) VALUES (?, ?)');
  (eventIds || []).forEach(eid => insert.run(coinId, eid));
}

router.get('/', (req, res) => {
  const { ruler_id, civilization_id } = req.query;
  let query = 'SELECT * FROM coins WHERE 1=1';
  const params = [];
  if (ruler_id)        { query += ' AND ruler_id = ?';        params.push(ruler_id); }
  if (civilization_id) { query += ' AND civilization_id = ?'; params.push(civilization_id); }
  query += ' ORDER BY year_start';
  res.json(db.prepare(query).all(...params));
});

router.get('/:id', (req, res) => {
  const coin = db.prepare('SELECT * FROM coins WHERE coin_id = ?').get(req.params.id);
  if (!coin) return res.status(404).json({ error: 'not found' });
  res.json(attachEvents(coin));
});

// Create a coin with optional front/back image upload and linked events,
// all in the same multipart request.
router.post('/', upload.fields([{ name: 'front_image' }, { name: 'back_image' }]), (req, res) => {
  const { name, ruler_id, civilization_id, year_start, year_end, metal,
          weight_grams, mint_location, description, historical_significance } = req.body;

  const frontPath = req.files?.front_image?.[0]
    ? '/uploads/coins/' + req.files.front_image[0].filename : null;
  const backPath = req.files?.back_image?.[0]
    ? '/uploads/coins/' + req.files.back_image[0].filename : null;

  const result = db.prepare(
    `INSERT INTO coins (name, ruler_id, civilization_id, year_start, year_end, metal,
                         weight_grams, mint_location, front_image_path, back_image_path,
                         description, historical_significance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name || null, ruler_id || null, civilization_id || null, year_start || null, year_end || null,
        metal || null, weight_grams || null, mint_location || null, frontPath, backPath,
        description || null, historical_significance || null);

  const coinId = result.lastInsertRowid;
  let eventIds = req.body.event_ids;
  if (eventIds && !Array.isArray(eventIds)) eventIds = [eventIds];
  saveEventLinks(coinId, (eventIds || []).map(Number));

  res.status(201).json({ coin_id: coinId });
});

// Edit an existing coin. Images are optional on edit — if a new file
// isn't provided, the existing image path is kept rather than cleared.
router.put('/:id', upload.fields([{ name: 'front_image' }, { name: 'back_image' }]), (req, res) => {
  const existing = db.prepare('SELECT * FROM coins WHERE coin_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { name, ruler_id, civilization_id, year_start, year_end, metal,
          weight_grams, mint_location, description, historical_significance } = req.body;

  const frontPath = req.files?.front_image?.[0]
    ? '/uploads/coins/' + req.files.front_image[0].filename : existing.front_image_path;
  const backPath = req.files?.back_image?.[0]
    ? '/uploads/coins/' + req.files.back_image[0].filename : existing.back_image_path;

  db.prepare(
    `UPDATE coins SET name=?, ruler_id=?, civilization_id=?, year_start=?, year_end=?, metal=?,
                       weight_grams=?, mint_location=?, front_image_path=?, back_image_path=?,
                       description=?, historical_significance=?
     WHERE coin_id = ?`
  ).run(name || null, ruler_id || null, civilization_id || null, year_start || null, year_end || null,
        metal || null, weight_grams || null, mint_location || null, frontPath, backPath,
        description || null, historical_significance || null, req.params.id);

  let eventIds = req.body.event_ids;
  if (eventIds && !Array.isArray(eventIds)) eventIds = [eventIds];
  saveEventLinks(req.params.id, (eventIds || []).map(Number));

  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM coins WHERE coin_id = ?').run(req.params.id);
  res.json({ ok: true });
});

const YEAR_SANITY_MIN = -5000, YEAR_SANITY_MAX = 5000;
function isSaneYear(y) { return y === null || (Number.isFinite(y) && y >= YEAR_SANITY_MIN && y <= YEAR_SANITY_MAX); }

router.patch('/:id/position', (req, res) => {
  const year_start = Number(req.body.year_start);
  const year_end = req.body.year_end === null || req.body.year_end === undefined ? null : Number(req.body.year_end);
  if (!isSaneYear(year_start) || !isSaneYear(year_end)) {
    return res.status(400).json({ error: `Rejected: years must be between ${YEAR_SANITY_MIN} and ${YEAR_SANITY_MAX}.` });
  }
  db.prepare('UPDATE coins SET year_start = ?, year_end = ? WHERE coin_id = ?')
    .run(year_start, year_end, req.params.id);
  res.json({ ok: true });
});

router.post('/:id/duplicate', (req, res) => {
  const c = db.prepare('SELECT * FROM coins WHERE coin_id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });

  const result = db.prepare(
    `INSERT INTO coins (name, ruler_id, civilization_id, year_start, year_end, metal,
                         weight_grams, mint_location, description, historical_significance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(c.name + ' (copy)', c.ruler_id, c.civilization_id, c.year_start, c.year_end,
        c.metal, c.weight_grams, c.mint_location, c.description, c.historical_significance);

  res.status(201).json({ coin_id: result.lastInsertRowid });
});

module.exports = router;
