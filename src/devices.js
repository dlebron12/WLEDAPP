// /api/devices: a signed-in user's WLED controllers, their strips, and light settings.
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

// :strip is "all" or a strip number from 1 to the device's strip count.
router.param('strip', (req, res, next, strip) => {
  if (strip === 'all') {
    req.stripNumbers = Array.from({ length: req.device.strip_count }, (_, i) => i + 1);
    req.allStrips = true;
    return next();
  }
  const n = Number(strip);
  if (!Number.isInteger(n) || n < 1 || n > req.device.strip_count) {
    return res.status(404).json({ error: 'Strip not found.' });
  }
  req.stripNumbers = [n];
  next();
});

// Validates the device form: name, host, stripCount, stripLength.
function readDeviceBody(body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const host = typeof body.host === 'string' ? body.host.trim() : '';
  const stripCount = Number(body.stripCount ?? 1);
  const stripLength = Number(body.stripLength ?? 300);
  if (!name || name.length > 40) throw new Error('Name must be 1–40 characters.');
  if (!wled.isLocalHost(host)) throw new Error('Enter the controller\'s local IP address (e.g. 192.168.1.50) or a .local name.');
  if (!Number.isInteger(stripCount) || stripCount < 1 || stripCount > wled.MAX_STRIPS) {
    throw new Error(`Number of strips must be 1–${wled.MAX_STRIPS}.`);
  }
  if (!Number.isInteger(stripLength) || stripLength < 1 || stripLength > wled.MAX_STRIP_LENGTH) {
    throw new Error(`Lights per strip must be 1–${wled.MAX_STRIP_LENGTH}.`);
  }
  return { name, host, stripCount, stripLength };
}

router.get('/', (req, res) => {
  res.json(q.listDevices.all(req.user.id));
});

router.post('/', (req, res) => {
  let fields;
  try { fields = readDeviceBody(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  const { lastInsertRowid } = q.insertDevice.run({ userId: req.user.id, ...fields });
  res.status(201).json(q.findDevice.get(lastInsertRowid, req.user.id));
});

router.put('/:id', (req, res) => {
  let fields;
  try { fields = readDeviceBody(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  q.db.transaction(() => {
    q.updateDevice.run({ id: req.device.id, userId: req.user.id, ...fields });
    q.deleteStripsAbove.run(req.device.id, fields.stripCount); // forget settings of removed strips
  })();
  res.json(q.findDevice.get(req.device.id, req.user.id));
});

router.delete('/:id', (req, res) => {
  q.deleteDevice.run(req.device.id, req.user.id);
  res.json({ ok: true });
});

// Saved settings for a strip (for "all", strip 1's settings), or defaults.
router.get('/:id/strips/:strip/settings', (req, res) => {
  const row = q.getStripSettings.get(req.device.id, req.stripNumbers[0]);
  res.json({
    settings: row ? JSON.parse(row.settings) : wled.DEFAULT_SETTINGS,
    savedAt: row ? row.updated_at : null,
  });
});

router.put('/:id/strips/:strip/settings', (req, res) => {
  let settings;
  try { settings = wled.validateSettings(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  const json = JSON.stringify(settings);
  q.db.transaction(() => {
    for (const n of req.stripNumbers) q.upsertStripSettings.run(req.device.id, n, json);
  })();
  res.json({ settings, savedAt: q.getStripSettings.get(req.device.id, req.stripNumbers[0]).updated_at });
});

// Sends the given settings to the strip(s) on the WLED controller (doesn't save them).
router.post('/:id/strips/:strip/apply', async (req, res) => {
  let settings;
  try { settings = wled.validateSettings(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  const strips = req.stripNumbers.map((number) => ({ number, settings }));
  try {
    await wled.applyToDevice(req.device, strips, { removeExtraSegments: req.allStrips });
    res.json({ ok: true });
  } catch (e) {
    const reason = e.name === 'TimeoutError' ? 'it didn\'t respond within 5 seconds' : e.message;
    res.status(502).json({ error: `Couldn't reach ${req.device.name} (${req.device.host}): ${reason}` });
  }
});

module.exports = router;
