// "Set up controller": writes the Light Ops standard LED configuration to a WLED controller
// (steps 13–23 of the setup guide) and optionally uploads a presets file (steps 28–31).
// Wi-Fi setup (steps 1–8) still happens on the WLED network first.
//
// WLED reads the config from POST /json/cfg and re-creates its LED outputs without a restart.
// Field names and values come from WLED's source (wled00/cfg.cpp, const.h).
const wled = require('./wled');

const PROFILE = {
  pins: [18, 5, 17, 16], // Data 1–4 GPIOs, one per output / strip
  type: 30,              // SK6812/WS2814 RGBW (TYPE_SK6812_RGBW)
  order: 1,              // Color: RGB (COL_ORDER_RGB); white swap "None" = 0 in the upper bits
  rev: false,            // Reverse: unchecked
  skip: 0,               // Skip first LEDs: 0
  ref: true,             // Off refresh: checked
  rgbwm: 1,              // Auto-calculate W channel from RGB: Brighter (RGBW_MODE_AUTO_BRIGHTER)
  maxpwr: 0,             // 0 = automatic brightness limiter disabled
};

// Human-readable list of what gets written, shown in the app before writing.
const PROFILE_SUMMARY = [
  'Automatic brightness limiter: off',
  'LED type: SK6812/WS2814 RGBW',
  'Color order: RGB · Swap: none',
  'Reverse: off · Skip first LEDs: 0 · Off refresh: on',
  'Auto-calculate W channel from RGB: Brighter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The /json/cfg body for a controller with these strip lengths (one output per strip).
function buildLedConfig(stripLengths) {
  if (stripLengths.length > PROFILE.pins.length) {
    throw new wled.DeviceError(
      `the setup uses ${PROFILE.pins.length} data pins (GPIO ${PROFILE.pins.join(', ')}), one per strip, ` +
      `but this controller has ${stripLengths.length} strips. Reduce the strips to ${PROFILE.pins.length} or fewer with Edit`
    );
  }
  let start = 0;
  const ins = stripLengths.map((len, i) => {
    const out = {
      start, len, pin: [PROFILE.pins[i]], type: PROFILE.type, order: PROFILE.order,
      rev: PROFILE.rev, skip: PROFILE.skip, ref: PROFILE.ref, rgbwm: PROFILE.rgbwm,
      freq: 0, maxpwr: PROFILE.maxpwr,
    };
    start += len;
    return out;
  });
  return { hw: { led: { total: start, maxpwr: PROFILE.maxpwr, ins } } };
}

// Compares the controller's config with what was written. Returns a list of differences.
function compareConfig(cfg, expected) {
  const want = expected.hw.led;
  const have = cfg?.hw?.led || {};
  const problems = [];
  if ((have.maxpwr ?? 0) !== 0) problems.push(`brightness limiter is still on (${have.maxpwr} mA)`);
  const ins = have.ins || [];
  if (ins.length !== want.ins.length) problems.push(`controller has ${ins.length} output${ins.length === 1 ? "" : "s"}, expected ${want.ins.length}`);
  want.ins.forEach((w, i) => {
    const h = ins[i];
    if (!h) return;
    const n = `output ${i + 1}`;
    if (h.len !== w.len) problems.push(`${n}: ${h.len} lights, expected ${w.len}`);
    if ((h.pin || [])[0] !== w.pin[0]) problems.push(`${n}: GPIO ${(h.pin || [])[0]}, expected ${w.pin[0]}`);
    if ((h.type & 0x7f) !== w.type) problems.push(`${n}: LED type ${h.type}, expected ${w.type}`);
    if (h.order !== w.order) problems.push(`${n}: color order ${h.order}, expected ${w.order} (RGB)`);
    if (h.rgbwm !== w.rgbwm) problems.push(`${n}: white channel mode ${h.rgbwm}, expected ${w.rgbwm} (Brighter)`);
    if (Boolean(h.ref) !== w.ref) problems.push(`${n}: off refresh is ${h.ref ? 'on' : 'off'}`);
    if (Boolean(h.rev) !== w.rev) problems.push(`${n}: reverse is on`);
    if ((h.skip || 0) !== w.skip) problems.push(`${n}: skips ${h.skip} LEDs`);
  });
  return problems;
}

// Uploads a presets file the way WLED's "Backup & Restore → Restore presets" does.
async function uploadPresets(host, presetsText) {
  const form = new FormData();
  form.append('data', new Blob([presetsText], { type: 'application/json' }), 'presets.json');
  let res;
  try {
    res = await fetch(`http://${host}/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new wled.DeviceUnreachableError('it stopped responding while uploading the presets');
  }
  if (res.status === 401) throw new wled.DeviceError('its settings are locked with a PIN. Unlock them in WLED (Config → Security & Updates) and try again');
  if (!res.ok) throw new wled.DeviceError(`it refused the presets file (HTTP ${res.status})`);
}

// Runs the setup. presetsText is the presets file's contents, or null to skip that step.
async function setupController(device, { presetsText = null } = {}) {
  const config = buildLedConfig(device.stripLengths);

  const info = await wled.request(device.host, '/json/info');
  if (!wled.looksLikeWled(info)) throw new wled.DeviceError('the device at this address is not a WLED controller');

  try {
    await wled.request(device.host, '/json/cfg', config);
  } catch (e) {
    if (/HTTP 401/.test(e.message)) {
      throw new wled.DeviceError('its settings are locked with a PIN. Unlock them in WLED (Config → Security & Updates) and try again');
    }
    throw e;
  }

  // The controller rebuilds its outputs in its main loop; read the config back to check.
  let problems = ['the controller did not report its configuration'];
  for (let attempt = 0; attempt < 4 && problems.length; attempt++) {
    await sleep(attempt === 0 ? 800 : 1500);
    try { problems = compareConfig(await wled.request(device.host, '/json/cfg'), config); } catch { /* retry */ }
  }

  let presetsUploaded = false;
  if (presetsText) {
    await uploadPresets(device.host, presetsText);
    presetsUploaded = true;
  }

  return {
    verified: problems.length === 0,
    problems,
    presetsUploaded,
    outputs: config.hw.led.ins.map((o) => ({ pin: o.pin[0], lights: o.len })),
    totalLights: config.hw.led.total,
  };
}

module.exports = { PROFILE, PROFILE_SUMMARY, buildLedConfig, compareConfig, setupController };
