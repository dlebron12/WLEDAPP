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

const MAX_STRIPS = 16;          // WLED's usual segment limit
const MAX_STRIP_LENGTH = 1500;

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
// { number, settings } strips. Strip N is WLED segment N-1, covering lights
// (N-1)*strip_length up to N*strip_length.
// WLED ignores per-LED colors sent in the same request that turns the lights on,
// so Individual Light colors go in a second request.
function buildRequests(device, strips, { removeExtraSegments = false } = {}) {
  const len = device.strip_length;
  const segs = strips.map(({ number, settings: s }) => {
    const seg = {
      id: number - 1,
      start: (number - 1) * len,
      stop: number * len,
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
    for (let id = device.strip_count; id < MAX_STRIPS; id++) segs.push({ id, stop: 0 });
  }

  const requests = [{ on: true, bri: 255, seg: segs }];
  const individual = strips
    .filter(({ settings }) => settings.effect === 'individual')
    .map(({ number, settings }) => ({ id: number - 1, i: pixelRanges(settings.pixels, len) }));
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

// Sends the requests one after another (WLED handles sequential calls best).
async function applyToDevice(device, strips, options) {
  for (const body of buildRequests(device, strips, options)) {
    const res = await fetch(`http://${device.host}/json/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Device responded with HTTP ${res.status}.`);
  }
}

module.exports = {
  EFFECTS, DEFAULT_SETTINGS, MAX_STRIPS, MAX_STRIP_LENGTH,
  validateSettings, pixelRanges, buildRequests, isLocalHost, applyToDevice,
};
