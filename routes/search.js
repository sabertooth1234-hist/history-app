const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// Simple LIKE-based search for Phase 1. Upgrades to Postgres full-text
// search (per the full schema doc) in a later phase if this gets slow
// or the search needs get more advanced.
router.get('/', (req, res) => {
  const q = `%${req.query.q || ''}%`;

  const entries = db.prepare(
    `SELECT entry_id AS id, title, year_start, 'entry' AS result_type
     FROM historical_entries WHERE title LIKE ? OR description LIKE ?`
  ).all(q, q);

  const rulers = db.prepare(
    `SELECT ruler_id AS id, name AS title, reign_start AS year_start, 'ruler' AS result_type
     FROM rulers WHERE name LIKE ? OR biography LIKE ?`
  ).all(q, q);

  const coins = db.prepare(
    `SELECT coin_id AS id, name AS title, year_start, 'coin' AS result_type
     FROM coins WHERE name LIKE ? OR description LIKE ?`
  ).all(q, q);

  res.json([...entries, ...rulers, ...coins].sort((a, b) => (a.year_start ?? 0) - (b.year_start ?? 0)));
});

module.exports = router;
