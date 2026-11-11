// SQLite database: a single file at data/wledapp.db, created on first run.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'wledapp.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Base tables (as first released).
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
    host       TEXT    NOT NULL,          -- controller IP address (or .local name)
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Schema changes, applied once each, in order. PRAGMA user_version records how many have run.
const MIGRATIONS = [
  // 1: strips per controller, and light settings saved per strip.
  `
  ALTER TABLE devices ADD COLUMN strip_count  INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE devices ADD COLUMN strip_length INTEGER NOT NULL DEFAULT 300;
  ALTER TABLE devices ADD COLUMN total_lights INTEGER GENERATED ALWAYS AS (strip_count * strip_length) VIRTUAL;

  CREATE TABLE strip_settings (
    device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    strip_number INTEGER NOT NULL,        -- 1-based; WLED segment id = strip_number - 1
    settings     TEXT    NOT NULL,        -- JSON: { effect, color, brightness, speed, pixels }
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (device_id, strip_number)
  );

  -- Earlier versions saved one set of settings per device: keep them as strip 1.
  CREATE TABLE IF NOT EXISTS device_settings (device_id INTEGER PRIMARY KEY, settings TEXT NOT NULL, updated_at TEXT NOT NULL);
  INSERT INTO strip_settings (device_id, strip_number, settings, updated_at)
    SELECT device_id, 1, settings, updated_at FROM device_settings;
  DROP TABLE device_settings;
  `,
];

const version = db.pragma('user_version', { simple: true });
for (let v = version; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    db.exec(MIGRATIONS[v]);
    db.pragma(`user_version = ${v + 1}`);
  })();
}

const DEVICE_COLS = 'id, name, host, strip_count, strip_length, total_lights';

module.exports = {
  db,
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserById: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
  findSession: db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  listDevices: db.prepare(`SELECT ${DEVICE_COLS} FROM devices WHERE user_id = ? ORDER BY name COLLATE NOCASE`),
  findDevice: db.prepare(`SELECT ${DEVICE_COLS} FROM devices WHERE id = ? AND user_id = ?`),
  insertDevice: db.prepare(
    'INSERT INTO devices (user_id, name, host, strip_count, strip_length) VALUES (@userId, @name, @host, @stripCount, @stripLength)'
  ),
  updateDevice: db.prepare(
    'UPDATE devices SET name = @name, host = @host, strip_count = @stripCount, strip_length = @stripLength WHERE id = @id AND user_id = @userId'
  ),
  deleteDevice: db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?'),

  getStripSettings: db.prepare('SELECT settings, updated_at FROM strip_settings WHERE device_id = ? AND strip_number = ?'),
  upsertStripSettings: db.prepare(`
    INSERT INTO strip_settings (device_id, strip_number, settings, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(device_id, strip_number) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at
  `),
  deleteStripsAbove: db.prepare('DELETE FROM strip_settings WHERE device_id = ? AND strip_number > ?'),
};
