// /api/devices: a signed-in user's WLED controllers and their light settings.
const express = require('express');
const q = require('./db');
const wled = require('./wled');

const router = express.Router();

router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  next();
});

// Loads the device for :id if it belongs to the signed-in user.
router.param('id', (req, res, next, id) => {
  req.device = q.findDevice.get(Number(id), req.user.id);
  if (!req.device) return res.status(404).json({ error: 'Device not found.' });
  next();
});

router.get('/', (req, res) => {
  res.json(q.listDevices.all(req.user.id));
});

router.post('/', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const host = typeof req.body?.host === 'string' ? req.body.host.trim() : '';
  if (!name || name.length > 40) return res.status(400).json({ error: 'Name must be 1–40 characters.' });
  if (!wled.isLocalHost(host)) {
    return res.status(400).json({ error: 'Enter the device\'s local IP address (e.g. 192.168.1.50) or a .local name.' });
  }
  const { lastInsertRowid } = q.insertDevice.run(req.user.id, name, host);
  res.status(201).json(q.findDevice.get(lastInsertRowid, req.user.id));
});

router.delete('/:id', (req, res) => {
  q.deleteDevice.run(req.device.id, req.user.id);
  res.json({ ok: true });
});

router.get('/:id/settings', (req, res) => {
  const row = q.getSettings.get(req.device.id);
  res.json({
    settings: row ? JSON.parse(row.settings) : wled.DEFAULT_SETTINGS,
    savedAt: row ? row.updated_at : null,
  });
});

router.put('/:id/settings', (req, res) => {
  let settings;
  try { settings = wled.validateSettings(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  q.upsertSettings.run(req.device.id, JSON.stringify(settings));
  res.json({ settings, savedAt: q.getSettings.get(req.device.id).updated_at });
});

// Sends the given settings to the WLED controller (doesn't save them).
router.post('/:id/apply', async (req, res) => {
  let settings;
  try { settings = wled.validateSettings(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    await wled.applyToDevice(req.device.host, settings);
    res.json({ ok: true });
  } catch (e) {
    const reason = e.name === 'TimeoutError' ? 'it didn\'t respond within 5 seconds' : e.message;
    res.status(502).json({ error: `Couldn't reach ${req.device.name} (${req.device.host}): ${reason}` });
  }
});

module.exports = router;
