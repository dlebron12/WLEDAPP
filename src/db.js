// SQLite database: a single file at data/wledapp.db, created on first run.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'wledapp.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    host       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Last saved light settings for each device.
  CREATE TABLE IF NOT EXISTS device_settings (
    device_id  INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    settings   TEXT    NOT NULL,  -- JSON: { effect, color, brightness, speed, pixels }
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = {
  db,
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserById: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
  findSession: db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  listDevices: db.prepare('SELECT id, name, host FROM devices WHERE user_id = ? ORDER BY name COLLATE NOCASE'),
  findDevice: db.prepare('SELECT id, name, host FROM devices WHERE id = ? AND user_id = ?'),
  insertDevice: db.prepare('INSERT INTO devices (user_id, name, host) VALUES (?, ?, ?)'),
  deleteDevice: db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?'),
  getSettings: db.prepare('SELECT settings, updated_at FROM device_settings WHERE device_id = ?'),
  upsertSettings: db.prepare(`
    INSERT INTO device_settings (device_id, settings, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(device_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at
  `),
};
