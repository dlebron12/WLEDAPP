// Shared by the Setup and Controls tabs: API calls, the list of controllers, tabs, account.
const $ = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmt = (n) => n.toLocaleString();

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

// "4 strips: 300 + 300 + 250 + 120 = 970 lights"
function stripSummary(d) {
  const sum = d.stripCount > 1 ? `: ${d.stripLengths.map(fmt).join(' + ')}` : '';
  return `${plural(d.stripCount, 'strip')}${sum} = ${fmt(d.totalLights)} lights`;
}

// The signed-in user's controllers. Tabs subscribe with App.onDevicesChanged.
const App = {
  me: null,
  devices: [],
  listeners: [],
  onDevicesChanged(fn) { this.listeners.push(fn); },
  async reloadDevices() {
    this.devices = await api('/api/devices');
    this.listeners.forEach((fn) => fn(this.devices));
    return this.devices;
  },
};

// ---------- Tabs ----------
function showTab(name) {
  if (!['controls', 'setup'].includes(name)) name = 'controls';
  document.querySelectorAll('[data-tab]').forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  $('tab-controls').hidden = name !== 'controls';
  $('tab-setup').hidden = name !== 'setup';
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
}
document.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

// ---------- Account ----------
$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// ---------- Start ----------
// DOMContentLoaded fires after all three scripts have run, so both tabs have subscribed by then.
window.addEventListener('DOMContentLoaded', async () => {
  App.me = await api('/api/me');
  $('username').textContent = App.me.username;
  await App.reloadDevices();
  // Open the tab from the URL, or Setup when there's nothing to control yet.
  showTab(location.hash.slice(1) || (App.devices.length ? 'controls' : 'setup'));
});
