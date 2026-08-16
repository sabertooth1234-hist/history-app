const express = require('express');
const router = express.Router();
const db = require('../db/connection');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM civilizations ORDER BY default_column_order, name').all());
});

router.post('/', (req, res) => {
  const { name, short_code, color_hex, default_column_order, year_start, year_end } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare(
    `INSERT INTO civilizations (name, short_code, color_hex, default_column_order, year_start, year_end)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name, short_code || null, color_hex || '#8899aa', default_column_order || 0,
        year_start ?? null, year_end ?? null);

  res.status(201).json({ civilization_id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { name, short_code, color_hex, default_column_order, year_start, year_end } = req.body;
  db.prepare(
    `UPDATE civilizations SET name=?, short_code=?, color_hex=?, default_column_order=?,
                               year_start=?, year_end=? WHERE civilization_id=?`
  ).run(name, short_code, color_hex, default_column_order, year_start ?? null, year_end ?? null, req.params.id);
  res.json({ ok: true });
});

// Duplicate a civilization definition (not its rulers/entries/coins)
router.post('/:id/duplicate', (req, res) => {
  const civ = db.prepare('SELECT * FROM civilizations WHERE civilization_id = ?').get(req.params.id);
  if (!civ) return res.status(404).json({ error: 'not found' });

  const result = db.prepare(
    `INSERT INTO civilizations (name, short_code, color_hex, default_column_order, year_start, year_end)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(civ.name + ' (copy)', null, civ.color_hex, civ.default_column_order, civ.year_start, civ.year_end);

  res.status(201).json({ civilization_id: result.lastInsertRowid });
});

// Delete, with a clear error instead of a silent SQLite constraint failure
// if rulers/coins still reference this civilization.
router.delete('/:id', (req, res) => {
  const rulerCount = db.prepare('SELECT COUNT(*) c FROM rulers WHERE civilization_id = ?').get(req.params.id).c;
  const coinCount = db.prepare('SELECT COUNT(*) c FROM coins WHERE civilization_id = ?').get(req.params.id).c;

  if (rulerCount > 0 || coinCount > 0) {
    return res.status(409).json({
      error: `Cannot delete: still referenced by ${rulerCount} ruler(s) and ${coinCount} coin(s). Reassign or delete those first.`
    });
  }

  db.prepare('DELETE FROM civilizations WHERE civilization_id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
