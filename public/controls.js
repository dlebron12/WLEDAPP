// Controls tab: pick a controller (remembered), choose a strip and effect, preview it live, save and apply.
const GRID = 25;

const els = {
  device: $('device'), effect: $('effect'), color: $('color'),
  brightness: $('brightness'), speed: $('speed'),
  brightnessVal: $('brightness-val'), speedVal: $('speed-val'),
  settings: $('settings'), preview: $('preview'), status: $('status'),
  noDevices: $('no-devices'), strip: $('strip'),
};

let settings = null;      // current (possibly unsaved) settings
let savedJson = null;     // settings as last loaded/saved, to detect unsaved changes

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
}

// ---------- Controller selection ----------
const currentDevice = () => App.devices.find((d) => String(d.id) === els.device.value);
const settingsUrl = (suffix = 'settings') => `/api/devices/${els.device.value}/strips/${els.strip.value}/${suffix}`;

// Saves the selection so Controls opens on this controller next time (on any browser).
function rememberSelection() {
  const id = Number(els.device.value);
  if (!id || App.me.selectedDeviceId === id) return;
  App.me.selectedDeviceId = id;
  api('/api/me/selected-device', { method: 'PUT', body: { deviceId: id } }).catch(() => {});
}

// Called whenever the list of controllers changes (page load, or added/edited/removed in Setup).
let shownDevice = null; // JSON of the device the controls were last loaded for
function onDevicesChanged(devices) {
  const previous = els.device.value;
  els.device.innerHTML = '';
  for (const d of devices) els.device.add(new Option(`${d.name} (${d.host})`, d.id));

  const has = devices.length > 0;
  els.noDevices.hidden = has;
  $('device-field').hidden = !has;
  els.settings.hidden = !has;
  if (!has) {
    els.settings.disabled = true; settings = null; shownDevice = null;
    setStatus('');
    return;
  }

  // Keep the current choice; otherwise the remembered one; otherwise the first controller.
  const ids = devices.map((d) => String(d.id));
  const remembered = String(App.me.selectedDeviceId);
  els.device.value = ids.includes(previous) ? previous : ids.includes(remembered) ? remembered : ids[0];
  rememberSelection();

  // Only reload the controls if the selected controller itself changed (e.g. its strips were
  // edited in Setup); renaming another controller shouldn't throw away unsaved edits here.
  const d = currentDevice();
  const key = JSON.stringify({ id: d.id, stripLengths: d.stripLengths });
  showDeviceInfo();
  if (key === shownDevice) return;
  shownDevice = key;
  showStrips();
  loadSettings().catch((e) => setStatus(e.message, 'error'));
}
App.onDevicesChanged(onDevicesChanged);

function showDeviceInfo() {
  $('device-info').textContent = `${stripSummary(currentDevice())} total`;
}

// Fills the Strip dropdown for the selected controller.
function showStrips() {
  const d = currentDevice();
  els.strip.innerHTML = '';
  if (d.stripCount > 1) els.strip.add(new Option('All strips', 'all'));
  let first = 1;
  d.stripLengths.forEach((len, i) => {
    els.strip.add(new Option(`Strip ${i + 1}: ${fmt(len)} lights (${fmt(first)}–${fmt(first + len - 1)})`, i + 1));
    first += len;
  });
  els.strip.value = '1';
  $('strip-field').hidden = d.stripCount === 1;
}

// "each bulb ≈ 12 lights" for the selected strip (or the range across all strips).
function updateScale() {
  const d = currentDevice();
  const lens = els.strip.value === 'all' ? d.stripLengths : [d.stripLengths[els.strip.value - 1]];
  const per = (len) => { const v = len / GRID; return Number.isInteger(v) ? v : Number(v.toFixed(1)); };
  const lo = per(Math.min(...lens));
  const hi = per(Math.max(...lens));
  $('preview-scale').textContent = hi <= 1 ? '' : `· each bulb ≈ ${lo === hi ? lo : `${lo}–${hi}`} lights`;
}

async function loadSettings() {
  els.settings.disabled = true;
  updateScale();
  const { settings: s, savedAt } = await api(settingsUrl());
  settings = s;
  savedJson = JSON.stringify(s); // baseline for detecting unsaved edits
  syncInputs();
  els.settings.disabled = false;
  const which = els.strip.value === 'all' ? 'Strip 1 settings shown; Save/Apply will set every strip.' : '';
  updateStatus([savedAt ? `Saved settings loaded (${savedAt} UTC).` : 'No saved settings yet: showing defaults.', which].join(' ').trim());
}

const isDirty = () => settings && JSON.stringify(settings) !== savedJson;

// Switching controller/strip discards unsaved edits, so confirm first.
let lastDevice = null;
let lastStrip = null;
els.device.addEventListener('focus', () => { lastDevice = els.device.value; });
els.strip.addEventListener('focus', () => { lastStrip = els.strip.value; });

els.device.addEventListener('change', () => {
  if (isDirty() && !confirm('Discard unsaved changes?')) { els.device.value = lastDevice; return; }
  rememberSelection();
  const d = currentDevice();
  shownDevice = JSON.stringify({ id: d.id, stripLengths: d.stripLengths });
  showDeviceInfo();
  showStrips();
  loadSettings().catch((e) => setStatus(e.message, 'error'));
});
els.strip.addEventListener('change', () => {
  if (isDirty() && !confirm('Discard unsaved changes?')) { els.strip.value = lastStrip; return; }
  loadSettings().catch((e) => setStatus(e.message, 'error'));
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
  setStatus(prefix || (isDirty() ? 'Unsaved changes.' : 'All changes saved.'));
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
    const { settings: s, savedAt } = await api(settingsUrl(), { method: 'PUT', body: settings });
    settings = s;
    savedJson = JSON.stringify(s);
    setStatus(`Saved${els.strip.value === 'all' ? ' to all strips' : ''} (${savedAt} UTC).`, 'ok');
  } catch (e) { setStatus(e.message, 'error'); }
});

$('apply').addEventListener('click', async () => {
  const btn = $('apply');
  btn.disabled = true;
  setStatus('Sending to the controller…');
  try {
    const r = await api(settingsUrl('apply'), { method: 'POST', body: settings });
    let msg = els.strip.value === 'all' ? 'Applied to all strips.' : `Applied to strip ${els.strip.value}.`;
    if (r.movedTo) {
      // The router gave the controller a new IP address: we found it and saved the new one.
      msg += ` The controller had moved to ${r.movedTo}; the app updated it.`;
      const d = currentDevice();
      d.host = r.movedTo;
      els.device.selectedOptions[0].textContent = `${d.name} (${d.host})`;
    }
    if (r.warning) setStatus(`${msg} Warning: ${r.warning}`, 'warn');
    else setStatus(msg, 'ok');
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
