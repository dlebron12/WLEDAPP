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

function buildPayload(s) {
  const seg = { id: 0 };
  if (s.effect === 'individual') {
    seg.fx = EFFECTS.solid;
    seg.i = s.pixels.map((c) => c.slice(1).toUpperCase());
  } else {
    seg.fx = EFFECTS[s.effect];
    seg.frz = false; // un-freeze in case Individual Light was used before
    seg.sx = s.speed;
    seg.col = [hexToRgb(s.color)];
  }
  return { on: true, bri: s.brightness, seg: [seg] };
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

async function applyToDevice(host, settings) {
  const res = await fetch(`http://${host}/json/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPayload(settings)),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Device responded with HTTP ${res.status}.`);
  return res.json().catch(() => ({}));
}

module.exports = { EFFECTS, DEFAULT_SETTINGS, validateSettings, buildPayload, isLocalHost, applyToDevice };
