const path = require('path');
const express = require('express');
const q = require('./db');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_PASSWORD = 8;

app.use(express.json());
app.use(auth.loadUser);

// ---- Pages ----
app.get('/', (req, res) => {
  if (req.user) return res.redirect('/home');
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

app.get('/home', (req, res) => {
  if (!req.user) return res.redirect('/');
  res.sendFile(path.join(PUBLIC, 'home.html'));
});

app.use(express.static(PUBLIC, { index: false }));

// ---- API ----
app.post('/api/signup', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–32 characters: letters, numbers, _ . -' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }
  if (q.findUserByUsername.get(username)) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }
  const { lastInsertRowid } = q.insertUser.run(username, auth.hashPassword(password));
  auth.createSession(res, lastInsertRowid);
  res.status(201).json({ username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const user = q.findUserByUsername.get(username);
  const ok = auth.verifyPassword(password, user ? user.password_hash : auth.DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  auth.createSession(res, user.id);
  res.json({ username: user.username });
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  const { id, username, created_at: createdAt, selected_device_id: selectedDeviceId } = req.user;
  res.json({ id, username, createdAt, selectedDeviceId });
});

// Remembers which controller the user picked on the Controls tab.
app.put('/api/me/selected-device', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  const deviceId = Number(req.body?.deviceId);
  if (!q.findDevice(deviceId, req.user.id)) return res.status(404).json({ error: 'Device not found.' });
  q.setSelectedDevice.run(deviceId, req.user.id);
  res.json({ selectedDeviceId: deviceId });
});

app.use('/api/devices', require('./devices'));

// Clean up expired sessions hourly.
setInterval(() => q.deleteExpiredSessions.run(Date.now()), 60 * 60 * 1000).unref();

app.listen(PORT, () => console.log(`WLED App running at http://localhost:${PORT}`));
