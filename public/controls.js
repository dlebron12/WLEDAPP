// Controls tab: pick a device, choose an effect, preview it live, save and apply.
const $ = (id) => document.getElementById(id);
const GRID = 25;

const els = {
  device: $('device'), effect: $('effect'), color: $('color'),
  brightness: $('brightness'), speed: $('speed'),
  brightnessVal: $('brightness-val'), speedVal: $('speed-val'),
  settings: $('settings'), preview: $('preview'), status: $('status'),
  form: $('device-form'), noDevices: $('no-devices'), strip: $('strip'),
};

let devices = [];
let settings = null;      // current (possibly unsaved) settings
let savedJson = null;     // settings as last loaded/saved, to detect unsaved changes

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
const currentDevice = () => devices.find((d) => String(d.id) === els.device.value);
const settingsUrl = (suffix = 'settings') => `/api/devices/${els.device.value}/strips/${els.strip.value}/${suffix}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmt = (n) => n.toLocaleString();

async function loadDevices(selectId) {
  devices = await api('/api/devices');
  els.device.innerHTML = '';
  for (const d of devices) els.device.add(new Option(`${d.name} (${d.host})`, d.id));
  const has = devices.length > 0;
  els.noDevices.hidden = has;
  els.settings.hidden = !has;
  els.device.disabled = !has;
  $('edit-device-btn').disabled = !has;
  $('remove-device-btn').disabled = !has;
  if (!has) {
    els.settings.disabled = true; settings = null;
    $('device-info').textContent = ''; setStatus('');
    return;
  }
  if (selectId) els.device.value = selectId;
  showDevice();
  await loadSettings();
}

// Fills in the strip info line and the Strip dropdown for the selected device.
function showDevice() {
  const d = currentDevice();
  const sum = d.stripCount > 1 ? `: ${d.stripLengths.map(fmt).join(' + ')}` : '';
  $('device-info').textContent = `${plural(d.stripCount, 'strip')}${sum} = ${fmt(d.totalLights)} lights total`;
  els.strip.innerHTML = '';
  if (d.stripCount > 1) els.strip.add(new Option('All strips', 'all'));
  let first = 1;
  d.stripLengths.forEach((len, i) => {
    els.strip.add(new Option(`Strip ${i + 1}: ${fmt(len)} lights (${fmt(first)}–${fmt(first + len - 1)})`, i + 1));
    first += len;
  });
  els.strip.value = '1';
  $('strip-field').hidden = d.stripCount === 1;
  updateScale();
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

// Switching device/strip discards unsaved edits, so confirm first.
let lastDevice = null;
let lastStrip = null;
els.device.addEventListener('focus', () => { lastDevice = els.device.value; });
els.strip.addEventListener('focus', () => { lastStrip = els.strip.value; });

els.device.addEventListener('change', () => {
  if (isDirty() && !confirm('Discard unsaved changes?')) { els.device.value = lastDevice; return; }
  showDevice();
  loadSettings().catch((e) => setStatus(e.message, 'error'));
});
els.strip.addEventListener('change', () => {
  if (isDirty() && !confirm('Discard unsaved changes?')) { els.strip.value = lastStrip; return; }
  loadSettings().catch((e) => setStatus(e.message, 'error'));
});

// ---------- Add / edit device form ----------
let editingId = null;
let discovered = { mdns: null, mac: null }; // from "Find controllers", sent with the form
const formError = (text) => { $('device-form-error').textContent = text || ''; };

function openForm(device) {
  editingId = device ? device.id : null;
  discovered = { mdns: null, mac: null };
  $('device-form-title').textContent = device ? `Edit ${device.name}` : 'Add device';
  $('device-form-submit').textContent = device ? 'Save device' : 'Add device';
  els.form.name.value = device ? device.name : '';
  els.form.host.value = device ? device.host : '';
  setStripInputs(device ? device.stripLengths : [300]);
  $('find-results').innerHTML = '';
  $('find-status').textContent = 'Your computer must be on the same Wi-Fi as the controller.';
  formError('');
  els.form.hidden = false;
  els.form.name.focus();
}

// The strips list: one number input per strip.
function setStripInputs(lengths) {
  const list = $('strip-list');
  list.innerHTML = '';
  lengths.forEach((len) => addStripInput(len));
  updateFormTotal();
}

function addStripInput(len = 300) {
  const list = $('strip-list');
  const li = document.createElement('li');
  li.innerHTML = `<span class="strip-name"></span>
    <input type="number" min="1" max="5000" step="1" required aria-label="Lights on strip">
    <span class="unit">lights</span>
    <button type="button" class="remove" title="Remove strip" aria-label="Remove strip">×</button>`;
  li.querySelector('input').value = len;
  li.querySelector('input').addEventListener('input', updateFormTotal);
  li.querySelector('.remove').addEventListener('click', () => { li.remove(); updateFormTotal(); });
  list.appendChild(li);
  updateFormTotal();
}

const stripInputValues = () => [...$('strip-list').querySelectorAll('input')].map((i) => Number(i.value));

function updateFormTotal() {
  const rows = [...$('strip-list').children];
  rows.forEach((li, i) => {
    li.querySelector('.strip-name').textContent = `Strip ${i + 1}`;
    li.querySelector('.remove').disabled = rows.length === 1;
  });
  const total = stripInputValues().reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  $('device-form-total').textContent = `Total: ${fmt(total)} lights on ${plural(rows.length, 'strip')}`;
}

$('add-strip').addEventListener('click', () => {
  const vals = stripInputValues();
  addStripInput(vals[vals.length - 1] || 300);
  $('strip-list').lastElementChild.querySelector('input').focus();
});

$('add-device-btn').addEventListener('click', () => openForm(null));
$('edit-device-btn').addEventListener('click', () => openForm(currentDevice()));
$('cancel-device').addEventListener('click', () => { els.form.hidden = true; });

// "Find controllers on my network"
$('find-btn').addEventListener('click', async () => {
  const btn = $('find-btn');
  const results = $('find-results');
  btn.disabled = true;
  results.innerHTML = '';
  $('find-status').textContent = 'Searching your network… this can take up to 15 seconds.';
  try {
    const found = await api('/api/devices/discover');
    $('find-status').textContent = found.length
      ? `Found ${plural(found.length, 'controller')}.`
      : 'No controllers found. Check that the controller is powered on and connected to your Wi-Fi, ' +
        'and that this computer is on the same Wi-Fi. You can still type the IP address below.';
    for (const c of found) results.appendChild(foundItem(c));
  } catch (e) {
    $('find-status').textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

function foundItem(c) {
  const li = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'meta';
  const strips = c.outputs.length
    ? `${plural(c.outputs.length, 'output')}: ${c.outputs.map(fmt).join(' + ')} lights`
    : `${fmt(c.ledCount || 0)} lights`;
  meta.innerHTML = '<strong></strong><span></span><span></span>';
  meta.children[0].textContent = c.name;
  meta.children[1].textContent = `${c.host}${c.mdns ? ` · ${c.mdns}.local` : ''}`;
  meta.children[2].textContent = `${strips}${c.version ? ` · WLED ${c.version}` : ''}`;
  li.appendChild(meta);

  const isThisDevice = editingId && c.addedAs && c.addedAs.id === editingId;
  if (c.addedAs && !isThisDevice) {
    const note = document.createElement('span');
    note.className = 'hint';
    note.textContent = `Already added as "${c.addedAs.name}"`;
    li.appendChild(note);
  } else {
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'primary inline';
    use.textContent = 'Use';
    use.addEventListener('click', () => {
      if (!editingId || !els.form.name.value) els.form.name.value = c.name.slice(0, 40);
      els.form.host.value = c.host;
      if (c.outputs.length) setStripInputs(c.outputs);
      else if (c.ledCount) setStripInputs([c.ledCount]);
      discovered = { mdns: c.mdns, mac: c.mac };
      $('find-status').textContent = `Filled in from "${c.name}". Check the strips, then ${editingId ? 'save' : 'add'} the device.`;
      $('find-results').innerHTML = '';
    });
    li.appendChild(use);
  }
  return li;
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError('');
  const body = {
    name: els.form.name.value,
    host: els.form.host.value,
    stripLengths: stripInputValues(),
    ...discovered,
  };
  const old = editingId && devices.find((d) => d.id === editingId);
  if (old && body.stripLengths.length < old.stripCount &&
      !confirm(`Saved settings for ${old.stripCount - body.stripLengths.length === 1 ? `strip ${old.stripCount}` : `strips ${body.stripLengths.length + 1}–${old.stripCount}`} will be deleted. Continue?`)) return;
  try {
    const d = editingId
      ? await api(`/api/devices/${editingId}`, { method: 'PUT', body })
      : await api('/api/devices', { method: 'POST', body });
    els.form.hidden = true;
    await loadDevices(d.id);
  } catch (err) { formError(err.message); }
});

$('remove-device-btn').addEventListener('click', async () => {
  const d = currentDevice();
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
loadDevices().catch((e) => setStatus(e.message, 'error'));
