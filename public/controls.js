// Controls tab: pick a device, choose an effect, preview it live, save and apply.
const $ = (id) => document.getElementById(id);
const GRID = 25;

const els = {
  device: $('device'), effect: $('effect'), color: $('color'),
  brightness: $('brightness'), speed: $('speed'),
  brightnessVal: $('brightness-val'), speedVal: $('speed-val'),
  settings: $('settings'), preview: $('preview'), status: $('status'),
  addForm: $('add-device-form'), noDevices: $('no-devices'),
};

let devices = [];
let settings = null;      // current (possibly unsaved) settings
let savedJson = null;     // last saved settings, to detect unsaved changes

// ---------- API helpers ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { window.location.href = '/'; throw new Error('Signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
}

// ---------- Account ----------
api('/api/me').then((u) => { $('username').textContent = u.username; }).catch(() => {});
$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// ---------- Devices ----------
async function loadDevices(selectId) {
  devices = await api('/api/devices');
  els.device.innerHTML = '';
  for (const d of devices) {
    els.device.add(new Option(`${d.name} (${d.host})`, d.id));
  }
  const has = devices.length > 0;
  els.noDevices.hidden = has;
  els.device.disabled = !has;
  $('remove-device-btn').disabled = !has;
  if (!has) { els.settings.disabled = true; settings = null; setStatus(''); return; }
  if (selectId) els.device.value = selectId;
  await loadSettings();
}

async function loadSettings() {
  els.settings.disabled = true;
  const { settings: s, savedAt } = await api(`/api/devices/${els.device.value}/settings`);
  settings = s;
  savedJson = savedAt ? JSON.stringify(s) : null;
  syncInputs();
  els.settings.disabled = false;
  updateStatus(savedAt ? `Saved settings loaded (${savedAt} UTC).` : 'No saved settings yet: showing defaults.');
}

els.device.addEventListener('change', () => loadSettings().catch((e) => setStatus(e.message, 'error')));

$('add-device-btn').addEventListener('click', () => {
  els.addForm.hidden = false;
  els.addForm.name.focus();
});
$('cancel-add').addEventListener('click', () => { els.addForm.hidden = true; els.addForm.reset(); });

els.addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const d = await api('/api/devices', {
      method: 'POST',
      body: { name: els.addForm.name.value, host: els.addForm.host.value },
    });
    els.addForm.hidden = true;
    els.addForm.reset();
    await loadDevices(d.id);
  } catch (err) { setStatus(err.message, 'error'); }
});

$('remove-device-btn').addEventListener('click', async () => {
  const d = devices.find((x) => String(x.id) === els.device.value);
  if (!d || !confirm(`Remove "${d.name}"? Its saved settings will be deleted.`)) return;
  await api(`/api/devices/${d.id}`, { method: 'DELETE' });
  await loadDevices();
});

// ---------- Settings inputs ----------
function syncInputs() {
  els.effect.value = settings.effect;
  els.color.value = settings.color;
  els.brightness.value = settings.brightness;
  els.speed.value = settings.speed;
  updateVisibility();
}

function updateVisibility() {
  const e = settings.effect;
  els.brightnessVal.textContent = Math.round((settings.brightness / 255) * 100) + '%';
  els.speedVal.textContent = Math.round((settings.speed / 255) * 100) + '%';
  $('speed-field').hidden = e === 'solid' || e === 'individual';
  $('color-field').hidden = e === 'colorful';
  $('individual-tools').hidden = e !== 'individual';
  els.preview.classList.toggle('paintable', e === 'individual');
}

function updateStatus(prefix) {
  const dirty = JSON.stringify(settings) !== savedJson;
  setStatus(prefix || (dirty ? 'Unsaved changes.' : 'All changes saved.'));
}

function onChange() {
  settings.effect = els.effect.value;
  settings.color = els.color.value;
  settings.brightness = Number(els.brightness.value);
  settings.speed = Number(els.speed.value);
  updateVisibility();
  updateStatus();
}
['effect', 'color', 'brightness', 'speed'].forEach((k) => els[k].addEventListener('input', onChange));

$('fill-all').addEventListener('click', () => {
  settings.pixels = Array(GRID).fill(settings.color);
  updateStatus();
});

// ---------- Save / Apply ----------
$('save').addEventListener('click', async () => {
  try {
    const { settings: s, savedAt } = await api(`/api/devices/${els.device.value}/settings`, { method: 'PUT', body: settings });
    settings = s;
    savedJson = JSON.stringify(s);
    setStatus(`Saved (${savedAt} UTC).`, 'ok');
  } catch (e) { setStatus(e.message, 'error'); }
});

$('apply').addEventListener('click', async () => {
  const btn = $('apply');
  btn.disabled = true;
  setStatus('Sending to device…');
  try {
    await api(`/api/devices/${els.device.value}/apply`, { method: 'POST', body: settings });
    setStatus('Applied to the lights.', 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- Live preview ----------
const bulbs = [];
for (let i = 0; i < GRID; i++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bulb';
  b.setAttribute('aria-label', `Light ${i + 1}`);
  b.addEventListener('click', () => {
    if (!settings || settings.effect !== 'individual') return;
    settings.pixels[i] = settings.color;
    updateStatus();
  });
  els.preview.appendChild(b);
  bulbs.push(b);
}

// WLED's "Colorful" palette: red, amber, green, blue marching along the strip.
const COLORFUL = ['#ff2000', '#ffaa00', '#00ff40', '#0040ff'];
// Per-bulb random phase/rate so Twinkle looks organic.
const twinkle = Array.from({ length: GRID }, () => ({ phase: Math.random() * 10, rate: 0.6 + Math.random() * 0.8 }));

// speed 0–255 -> 0.25x … 4x
const speedFactor = (s) => 0.25 * Math.pow(16, s / 255);

function frame(t) {
  if (settings) {
    const { effect, color, speed, brightness, pixels } = settings;
    const sf = speedFactor(speed);
    const bri = 0.35 + 0.65 * (brightness / 255); // keep dim settings visible on screen

    for (let i = 0; i < GRID; i++) {
      let c = color;
      let level = 1;
      switch (effect) {
        case 'individual':
          c = pixels[i];
          break;
        case 'blink':
          level = Math.floor((t / 1000) * sf * 2) % 2 === 0 ? 1 : 0;
          break;
        case 'twinkle': {
          const tw = twinkle[i];
          const v = Math.sin((t / 1000) * sf * tw.rate * 2 + tw.phase);
          level = v > 0.3 ? (v - 0.3) / 0.7 : 0;
          break;
        }
        case 'colorful': {
          const step = Math.floor((t / 1000) * sf * 3);
          c = COLORFUL[(i + step) % COLORFUL.length];
          break;
        }
      }
      paintBulb(bulbs[i], c, level * bri);
    }
  }
  requestAnimationFrame(frame);
}

function paintBulb(el, color, level) {
  if (level <= 0.02) {
    el.style.background = '';
    el.style.boxShadow = '';
    el.style.opacity = '';
    return;
  }
  el.style.background = `radial-gradient(circle at 35% 35%, #fff 0%, ${color} 45%, ${color} 100%)`;
  el.style.boxShadow = `0 0 ${6 + 18 * level}px ${2 + 6 * level}px ${color}`;
  el.style.opacity = String(0.25 + 0.75 * level);
}

requestAnimationFrame(frame);
loadDevices().catch((e) => setStatus(e.message, 'error'));
