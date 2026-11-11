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

  // 2: each strip has its own length; remember the controller's mDNS name and MAC so it can be
  //    found again if its IP address changes.
  `
  CREATE TABLE strips (
    device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    strip_number INTEGER NOT NULL,        -- 1-based; WLED segment id = strip_number - 1
    length       INTEGER NOT NULL,        -- number of lights on this strip / data line
    settings     TEXT,                    -- JSON { effect, color, brightness, speed, pixels }; NULL until saved
    updated_at   TEXT,
    PRIMARY KEY (device_id, strip_number)
  );

  -- Expand every device's equal-length strips into rows, keeping saved settings.
  INSERT INTO strips (device_id, strip_number, length, settings, updated_at)
    WITH RECURSIVE n(device_id, k, count, length) AS (
      SELECT id, 1, strip_count, strip_length FROM devices
      UNION ALL SELECT device_id, k + 1, count, length FROM n WHERE k < count
    )
    SELECT n.device_id, n.k, n.length, ss.settings, ss.updated_at
    FROM n LEFT JOIN strip_settings ss ON ss.device_id = n.device_id AND ss.strip_number = n.k;
  DROP TABLE strip_settings;

  ALTER TABLE devices DROP COLUMN total_lights;
  ALTER TABLE devices DROP COLUMN strip_count;
  ALTER TABLE devices DROP COLUMN strip_length;
  ALTER TABLE devices ADD COLUMN mdns TEXT;  -- e.g. wled-ab12cd (reachable as wled-ab12cd.local)
  ALTER TABLE devices ADD COLUMN mac  TEXT;  -- lowercase hex without separators, e.g. a4cf12ab12cd
  `,
];

const version = db.pragma('user_version', { simple: true });
for (let v = version; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    db.exec(MIGRATIONS[v]);
    db.pragma(`user_version = ${v + 1}`);
  })();
}

// Devices with their strips. strip_lengths is a JSON array in strip order, e.g. [300, 250].
const DEVICE_SELECT = `
  SELECT d.id, d.name, d.host, d.mdns, d.mac,
         (SELECT json_group_array(length) FROM (
            SELECT length FROM strips WHERE device_id = d.id ORDER BY strip_number)) AS strip_lengths
  FROM devices d`;

// Turns a row into the shape the API returns.
function toDevice(row) {
  if (!row) return undefined;
  const stripLengths = JSON.parse(row.strip_lengths);
  return {
    id: row.id, name: row.name, host: row.host, mdns: row.mdns, mac: row.mac,
    stripLengths,
    stripCount: stripLengths.length,
    totalLights: stripLengths.reduce((a, b) => a + b, 0),
  };
}

const stmt = {
  listDevices: db.prepare(`${DEVICE_SELECT} WHERE d.user_id = ? ORDER BY d.name COLLATE NOCASE`),
  findDevice: db.prepare(`${DEVICE_SELECT} WHERE d.id = ? AND d.user_id = ?`),
  insertDevice: db.prepare('INSERT INTO devices (user_id, name, host, mdns, mac) VALUES (@userId, @name, @host, @mdns, @mac)'),
  updateDevice: db.prepare('UPDATE devices SET name = @name, host = @host, mdns = @mdns, mac = @mac WHERE id = @id AND user_id = @userId'),
  upsertStripLength: db.prepare(`
    INSERT INTO strips (device_id, strip_number, length) VALUES (?, ?, ?)
    ON CONFLICT(device_id, strip_number) DO UPDATE SET length = excluded.length
  `),
  deleteStripsAbove: db.prepare('DELETE FROM strips WHERE device_id = ? AND strip_number > ?'),
};

// Creates or updates a device and its strip lengths together. Returns the device id.
const saveDevice = db.transaction(({ id, userId, name, host, mdns, mac, stripLengths }) => {
  let deviceId = id;
  if (id) stmt.updateDevice.run({ id, userId, name, host, mdns, mac });
  else deviceId = stmt.insertDevice.run({ userId, name, host, mdns, mac }).lastInsertRowid;
  stripLengths.forEach((len, i) => stmt.upsertStripLength.run(deviceId, i + 1, len));
  stmt.deleteStripsAbove.run(deviceId, stripLengths.length); // forget removed strips
  return deviceId;
});

module.exports = {
  db,
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserById: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
  findSession: db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  listDevices: (userId) => stmt.listDevices.all(userId).map(toDevice),
  findDevice: (id, userId) => toDevice(stmt.findDevice.get(id, userId)),
  findDevicesByMac: db.prepare('SELECT id FROM devices WHERE user_id = ? AND mac = ?'),
  saveDevice,
  updateHost: db.prepare('UPDATE devices SET host = ? WHERE id = ?'),
  deleteDevice: db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?'),

  getStripSettings: db.prepare(
    'SELECT settings, updated_at FROM strips WHERE device_id = ? AND strip_number = ? AND settings IS NOT NULL'
  ),
  saveStripSettings: db.prepare(
    "UPDATE strips SET settings = ?, updated_at = datetime('now') WHERE device_id = ? AND strip_number = ?"
  ),
};
