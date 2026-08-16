const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'history.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

module.exports = db;
