// /api/devices: a signed-in user's WLED controllers, their strips, and light settings.
const express = require('express');
const q = require('./db');
const wled = require('./wled');
const discovery = require('./discovery');

const router = express.Router();

router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  next();
});

// Finds WLED controllers on the local network. Marks ones this user already added.
router.get('/discover', async (req, res) => {
  const found = await discovery.discover({ scan: req.query.scan !== '0' });
  const mine = q.listDevices(req.user.id);
  res.json(found.map((d) => {
    const existing = mine.find((m) => (d.mac && m.mac === d.mac) || m.host === d.host);
    return { ...d, addedAs: existing ? { id: existing.id, name: existing.name } : null };
  }));
});

// Loads the device for :id if it belongs to the signed-in user.
router.param('id', (req, res, next, id) => {
  req.device = q.findDevice(Number(id), req.user.id);
  if (!req.device) return res.status(404).json({ error: 'Device not found.' });
  next();
});

// :strip is "all" or a strip number from 1 to the device's strip count.
router.param('strip', (req, res, next, strip) => {
  if (strip === 'all') {
    req.stripNumbers = req.device.stripLengths.map((_, i) => i + 1);
    req.allStrips = true;
    return next();
  }
  const n = Number(strip);
  if (!Number.isInteger(n) || n < 1 || n > req.device.stripCount) {
    return res.status(404).json({ error: 'Strip not found.' });
  }
  req.stripNumbers = [n];
  next();
});

// Validates the device form: name, host, stripLengths, and optional mdns / mac from discovery.
function readDeviceBody(body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const host = typeof body.host === 'string' ? body.host.trim() : '';
  const stripLengths = Array.isArray(body.stripLengths) ? body.stripLengths.map(Number) : [300];
  const mdns = typeof body.mdns === 'string' && /^[a-z0-9-]{1,32}$/i.test(body.mdns) ? body.mdns.toLowerCase() : null;
  const mac = discovery.normalizeMac(body.mac);
  if (!name || name.length > 40) throw new Error('Name must be 1–40 characters.');
  if (!wled.isLocalHost(host)) throw new Error('Enter the controller\'s local IP address (e.g. 192.168.1.50) or a .local name.');
  if (stripLengths.length < 1 || stripLengths.length > wled.MAX_STRIPS) {
    throw new Error(`Add between 1 and ${wled.MAX_STRIPS} strips.`);
  }
  stripLengths.forEach((len, i) => {
    if (!Number.isInteger(len) || len < 1 || len > wled.MAX_STRIP_LENGTH) {
      throw new Error(`Strip ${i + 1}: lights must be a whole number from 1 to ${wled.MAX_STRIP_LENGTH}.`);
    }
  });
  if (mac && mac.length !== 12) throw new Error('Invalid MAC address.');
  return { name, host, stripLengths, mdns, mac };
}

router.get('/', (req, res) => {
  res.json(q.listDevices(req.user.id));
});

router.post('/', (req, res) => {
  let fields;
  try { fields = readDeviceBody(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (fields.mac && q.findDevicesByMac.get(req.user.id, fields.mac)) {
    return res.status(409).json({ error: 'You already added this controller.' });
  }
  const id = q.saveDevice({ userId: req.user.id, ...fields });
  res.status(201).json(q.findDevice(id, req.user.id));
});

router.put('/:id', (req, res) => {
  let fields;
  try { fields = readDeviceBody(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  // Keep the MAC / mDNS name learned from discovery unless the form sends new ones.
  fields.mac = fields.mac || req.device.mac;
  fields.mdns = fields.mdns || req.device.mdns;
  q.saveDevice({ id: req.device.id, userId: req.user.id, ...fields });
  res.json(q.findDevice(req.device.id, req.user.id));
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
    for (const n of req.stripNumbers) q.saveStripSettings.run(json, req.device.id, n);
  })();
  res.json({ settings, savedAt: q.getStripSettings.get(req.device.id, req.stripNumbers[0]).updated_at });
});

// Sends the given settings to the strip(s) on the WLED controller (doesn't save them).
// If the controller can't be reached and we know its MAC address, look for it on the network:
// routers sometimes give devices a new IP address. If found, remember the new address and retry.
router.post('/:id/strips/:strip/apply', async (req, res) => {
  let settings;
  try { settings = wled.validateSettings(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  const strips = req.stripNumbers.map((number) => ({ number, settings }));
  const options = { removeExtraSegments: req.allStrips };
  const device = req.device;

  try {
    const { warning } = await wled.applyToDevice(device, strips, options);
    return res.json({ ok: true, warning });
  } catch (e) {
    if (!(e instanceof wled.DeviceUnreachableError) || !device.mac) {
      return res.status(502).json({ error: `Couldn't apply to ${device.name} (${device.host}): ${e.message.replace(/\.$/, '')}.` });
    }
    const found = await discovery.findByMac(device.mac);
    if (!found || found.host === device.host) {
      return res.status(502).json({
        error: `Couldn't reach ${device.name} (${device.host}): ${e.message}, and it wasn't found elsewhere on the network. ` +
          'Check that it is powered on and that this computer is on the same Wi-Fi.',
      });
    }
    q.updateHost.run(found.host, device.id);
    try {
      const { warning } = await wled.applyToDevice({ ...device, host: found.host }, strips, options);
      return res.json({ ok: true, movedTo: found.host, warning });
    } catch (e2) {
      return res.status(502).json({ error: `Found ${device.name} at its new address ${found.host}, but couldn't apply: ${e2.message}.` });
    }
  }
});

module.exports = router;
