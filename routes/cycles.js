const express = require('express');
const router = express.Router();
const db = require('../db/connection');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM cycle_definitions ORDER BY start_year').all());
});

router.post('/', (req, res) => {
  const { start_year, end_year, interval_years, color_hex, label_prefix, visible } = req.body;
  if (start_year === undefined || start_year === '') {
    return res.status(400).json({ error: 'start_year is required' });
  }
  const result = db.prepare(
    `INSERT INTO cycle_definitions (start_year, end_year, interval_years, color_hex, label_prefix, visible)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(start_year, end_year === '' ? null : (end_year ?? null), interval_years || 69,
        color_hex || '#999999', label_prefix || 'Cycle', visible === undefined ? 1 : (visible ? 1 : 0));
  res.status(201).json({ cycle_id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { start_year, end_year, interval_years, color_hex, label_prefix, visible } = req.body;
  db.prepare(
    `UPDATE cycle_definitions SET start_year=?, end_year=?, interval_years=?, color_hex=?, label_prefix=?, visible=?
     WHERE cycle_id=?`
  ).run(start_year, end_year === '' ? null : (end_year ?? null), interval_years, color_hex, label_prefix,
        visible ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM cycle_definitions WHERE cycle_id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
