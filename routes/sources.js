const express = require('express');
const router = express.Router();
const db = require('../db/connection');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM sources ORDER BY title').all());
});

router.post('/', (req, res) => {
  const { title, author, url } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const result = db.prepare('INSERT INTO sources (title, author, url) VALUES (?, ?, ?)')
    .run(title, author || null, url || null);
  res.status(201).json({ source_id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { title, author, url } = req.body;
  db.prepare('UPDATE sources SET title=?, author=?, url=? WHERE source_id=?')
    .run(title, author, url, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM sources WHERE source_id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
