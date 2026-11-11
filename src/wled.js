// Talking to WLED controllers through their JSON API (POST http://<host>/json/state).
// Docs: https://kno.wled.ge/interfaces/json-api/

const GRID_SIZE = 25; // 5 x 5 preview = first 25 LEDs on the strip

// App effect name -> WLED effect ID (see wled00/FX.h). "individual" uses per-LED control instead.
const EFFECTS = {
  individual: null,
  solid: 0,
  blink: 1,
  twinkle: 17,
  colorful: 34,
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

const DEFAULT_SETTINGS = {
  effect: 'solid',
  color: '#ffaa33',
  brightness: 200,
  speed: 128,
  pixels: Array(GRID_SIZE).fill('#ffaa33'),
};

// Returns cleaned settings, or throws an Error with a user-facing message.
function validateSettings(s) {
  if (!s || typeof s !== 'object') throw new Error('Settings are missing.');
  if (!Object.hasOwn(EFFECTS, s.effect)) throw new Error('Unknown effect.');
  if (!HEX_RE.test(s.color)) throw new Error('Color must look like #RRGGBB.');
  const brightness = Number(s.brightness);
  const speed = Number(s.speed);
  if (!Number.isInteger(brightness) || brightness < 1 || brightness > 255) throw new Error('Brightness must be 1–255.');
  if (!Number.isInteger(speed) || speed < 0 || speed > 255) throw new Error('Speed must be 0–255.');
  if (!Array.isArray(s.pixels) || s.pixels.length !== GRID_SIZE || !s.pixels.every((c) => HEX_RE.test(c))) {
    throw new Error(`Individual lights must be ${GRID_SIZE} colors like #RRGGBB.`);
  }
  return {
    effect: s.effect,
    color: s.color.toLowerCase(),
    brightness,
    speed,
    pixels: s.pixels.map((c) => c.toLowerCase()),
  };
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Sanity limits only. The real limit on strips is the controller's own segment limit
// (info.leds.maxseg, usually 16 or 32), which is checked when applying.
const MAX_STRIPS = 256;
const MAX_STRIP_LENGTH = 5000;

// Thrown when the controller can't be reached at all (wrong/changed IP, powered off, timeout).
class DeviceUnreachableError extends Error {}
// Thrown when the controller answered but refused or can't do what was asked.
class DeviceError extends Error {}

// Where each strip starts: strip N begins right after strip N-1 ends.
function stripOffsets(lengths) {
  const offsets = [];
  let total = 0;
  for (const len of lengths) { offsets.push(total); total += len; }
  return offsets;
}

// Spreads the 25 preview colors across a strip of `length` lights as WLED ranges:
// [start, stop, "RRGGBB", ...] (stop is exclusive; indexes are relative to the segment).
// Neighboring bulbs with the same color are merged into one range.
function pixelRanges(pixels, length) {
  const out = [];
  for (let b = 0; b < GRID_SIZE; b++) {
    const start = Math.floor((b * length) / GRID_SIZE);
    const stop = Math.floor(((b + 1) * length) / GRID_SIZE);
    if (stop <= start) continue;
    const hex = pixels[b].slice(1).toUpperCase();
    const n = out.length;
    if (n && out[n - 1] === hex && out[n - 2] === start) out[n - 2] = stop;
    else out.push(start, stop, hex);
  }
  return out;
}

// Builds the JSON bodies to POST to /json/state, in order, for a device and a list of
// { number, settings } strips. Strip N is WLED segment N-1; it starts where strip N-1 ends.
// WLED ignores per-LED colors sent in the same request that turns the lights on,
// so Individual Light colors go in a second request.
function buildRequests(device, strips, { removeExtraSegments = false, maxSegments = 16 } = {}) {
  const lengths = device.stripLengths;
  const offsets = stripOffsets(lengths);
  const segs = strips.map(({ number, settings: s }) => {
    const seg = {
      id: number - 1,
      start: offsets[number - 1],
      stop: offsets[number - 1] + lengths[number - 1],
      on: true,
      bri: s.brightness,
    };
    if (s.effect === 'individual') {
      seg.fx = EFFECTS.solid;
    } else {
      seg.fx = EFFECTS[s.effect];
      seg.frz = false; // un-freeze in case Individual Light was used before
      seg.sx = s.speed;
      seg.col = [hexToRgb(s.color)];
    }
    return seg;
  });
  if (removeExtraSegments) {
    // Delete leftover segments beyond the configured strips (stop: 0 deletes a segment).
    for (let id = lengths.length; id < maxSegments; id++) segs.push({ id, stop: 0 });
  }

  const requests = [{ on: true, bri: 255, seg: segs }];
  const individual = strips
    .filter(({ settings }) => settings.effect === 'individual')
    .map(({ number, settings }) => ({ id: number - 1, i: pixelRanges(settings.pixels, lengths[number - 1]) }));
  if (individual.length) requests.push({ seg: individual });
  return requests;
}

// Only local-network addresses: an IPv4 address in a private/loopback range,
// a single-word hostname, or a name ending in .local — each with an optional port.
function isLocalHost(host) {
  const m = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(host || '');
  if (!m) return false;
  const [, name, port] = m;
  if (port && (Number(port) < 1 || Number(port) > 65535)) return false;
  const ip = name.split('.').map(Number);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
    if (ip.some((n) => n > 255)) return false;
    return ip[0] === 10 || ip[0] === 127 ||
      (ip[0] === 192 && ip[1] === 168) ||
      (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
      (ip[0] === 169 && ip[1] === 254);
  }
  return /^[a-z0-9-]+$/i.test(name) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/i.test(name);
}

async function request(host, path, body) {
  let res;
  try {
    res = await fetch(`http://${host}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    throw new DeviceUnreachableError(e.name === 'TimeoutError' ? 'it didn\'t respond within 5 seconds' : 'it couldn\'t be reached');
  }
  if (!res.ok) throw new DeviceError(`it responded with HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

// Checks the controller's segment limit, then sends the requests one after another
// (WLED handles sequential calls best).
async function applyToDevice(device, strips, options = {}) {
  const info = await request(device.host, '/json/info');
  const maxSegments = info?.leds?.maxseg || 16;
  if (device.stripCount > maxSegments) {
    throw new DeviceError(
      `this controller supports at most ${maxSegments} separately controlled ${maxSegments === 1 ? 'strip' : 'strips'}, ` +
      `but ${device.stripCount} are set up. Reduce the number of strips with Edit`
    );
  }
  for (const body of buildRequests(device, strips, { ...options, maxSegments })) {
    await request(device.host, '/json/state', body);
  }
  // Lights beyond the controller's configured LED count are ignored by WLED: tell the user.
  const ledCount = info?.leds?.count;
  const warning = Number.isInteger(ledCount) && ledCount !== device.totalLights
    ? `The app has ${device.totalLights.toLocaleString('en-US')} lights set up, but the controller is configured for ` +
      `${ledCount.toLocaleString('en-US')}. Make them match (Edit here, or LED Preferences in WLED).`
    : null;
  return { warning };
}

module.exports = {
  EFFECTS, DEFAULT_SETTINGS, MAX_STRIPS, MAX_STRIP_LENGTH, DeviceUnreachableError, DeviceError,
  validateSettings, stripOffsets, pixelRanges, buildRequests, isLocalHost, applyToDevice,
};
