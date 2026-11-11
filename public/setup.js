// Setup tab: find controllers on the network, add / edit / remove them.
(() => {
  const form = $('device-form');
  let editingId = null;
  let discovered = { mdns: null, mac: null }; // from "Find controllers", sent with the form
  let lastFound = [];                          // last discovery results, re-rendered when devices change

  const formError = (text) => { $('device-form-error').textContent = text || ''; };
  const setupStatus = (text, kind = '') => {
    $('setup-status').textContent = text || '';
    $('setup-status').className = `status ${kind}`;
  };

  // ---------- Your controllers ----------
  function renderControllers(devices) {
    const list = $('controller-list');
    list.innerHTML = '';
    $('controller-empty').hidden = devices.length > 0;
    for (const d of devices) {
      const li = document.createElement('li');
      li.innerHTML = `<div class="meta"><strong></strong><span></span><span></span></div>
        <div class="row"><button type="button" class="secondary inline" data-act="edit">Edit</button>
        <button type="button" class="secondary inline" data-act="remove">Remove</button></div>`;
      const [name, addr, strips] = li.querySelector('.meta').children;
      name.textContent = d.name;
      addr.textContent = `${d.host}${d.mdns ? ` · ${d.mdns}.local` : ''}`;
      strips.textContent = stripSummary(d);
      li.querySelector('[data-act=edit]').addEventListener('click', () => openForm({ device: d }));
      li.querySelector('[data-act=remove]').addEventListener('click', () => removeDevice(d));
      list.appendChild(li);
    }
  }

  async function removeDevice(d) {
    if (!confirm(`Remove "${d.name}"? Its saved light settings will be deleted.`)) return;
    try {
      await api(`/api/devices/${d.id}`, { method: 'DELETE' });
      if (editingId === d.id) form.hidden = true;
      await App.reloadDevices();
      setupStatus(`Removed "${d.name}".`);
    } catch (e) { setupStatus(e.message, 'error'); }
  }

  // ---------- Find controllers ----------
  $('find-status').textContent = 'This computer must be on the same Wi-Fi as the controllers.';

  $('find-btn').addEventListener('click', async () => {
    const btn = $('find-btn');
    btn.disabled = true;
    $('find-results').innerHTML = '';
    $('find-status').textContent = 'Searching your network… this can take up to 15 seconds.';
    try {
      lastFound = await api('/api/devices/discover');
      $('find-status').textContent = lastFound.length
        ? `Found ${plural(lastFound.length, 'controller')}.`
        : 'No controllers found. Check that the controller is powered on and connected to the home Wi-Fi, ' +
          'and that this computer is on the same Wi-Fi. You can also add it by IP address below.';
      renderFound();
    } catch (e) {
      $('find-status').textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  // Shows the discovery results, matched against the controllers already added.
  function renderFound() {
    const results = $('find-results');
    results.innerHTML = '';
    for (const c of lastFound) {
      const added = App.devices.find((d) => (c.mac && d.mac === c.mac) || d.host === c.host);
      const li = document.createElement('li');
      const outputs = c.outputs.length
        ? `${plural(c.outputs.length, 'output')}: ${c.outputs.map(fmt).join(' + ')} lights`
        : `${fmt(c.ledCount || 0)} lights`;
      li.innerHTML = '<div class="meta"><strong></strong><span></span><span></span></div>';
      const [name, addr, info] = li.querySelector('.meta').children;
      name.textContent = c.name;
      addr.textContent = `${c.host}${c.mdns ? ` · ${c.mdns}.local` : ''}`;
      info.textContent = `${outputs}${c.version ? ` · WLED ${c.version}` : ''}`;

      if (!added) {
        li.appendChild(button('Add', 'primary', () => openForm({ found: c })));
      } else if (added.host !== c.host) {
        // Same controller (same MAC), but the router gave it a new IP address.
        const box = document.createElement('div');
        box.className = 'row';
        box.appendChild(note(`Added as "${added.name}" at ${added.host}`));
        box.appendChild(button('Update address', 'secondary', () => updateAddress(added, c)));
        li.appendChild(box);
      } else {
        li.appendChild(note(`Added as "${added.name}"`));
      }
      results.appendChild(li);
    }
  }

  async function updateAddress(device, found) {
    try {
      await api(`/api/devices/${device.id}`, {
        method: 'PUT',
        body: { name: device.name, host: found.host, stripLengths: device.stripLengths, mdns: found.mdns, mac: found.mac },
      });
      await App.reloadDevices();
      setupStatus(`Updated "${device.name}" to ${found.host}.`, 'ok');
    } catch (e) { setupStatus(e.message, 'error'); }
  }

  const button = (text, kind, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `${kind} inline`;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };
  const note = (text) => {
    const s = document.createElement('span');
    s.className = 'hint';
    s.textContent = text;
    return s;
  };

  // ---------- Add / edit form ----------
  // openForm({ device }) edits; openForm({ found }) adds a discovered controller; openForm({}) adds by IP.
  function openForm({ device = null, found = null } = {}) {
    editingId = device ? device.id : null;
    discovered = found ? { mdns: found.mdns, mac: found.mac } : { mdns: null, mac: null };
    $('device-form-title').textContent = device ? `Edit ${device.name}` : 'Add controller';
    $('device-form-submit').textContent = device ? 'Save changes' : 'Add controller';
    $('device-form-source').textContent = found
      ? `Filled in from "${found.name}". Check the strip lengths, then add it.`
      : '';
    form.name.value = device ? device.name : found ? found.name.slice(0, 40) : '';
    form.host.value = device ? device.host : found ? found.host : '';
    const lengths = device ? device.stripLengths
      : found && found.outputs.length ? found.outputs
        : found && found.ledCount ? [found.ledCount] : [300];
    setStripInputs(lengths);
    formError('');
    setupStatus('');
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    form.name.focus({ preventScroll: true });
  }

  function setStripInputs(lengths) {
    $('strip-list').innerHTML = '';
    lengths.forEach((len) => addStripInput(len));
    updateFormTotal();
  }

  function addStripInput(len = 300) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="strip-name"></span>
      <input type="number" min="1" max="5000" step="1" required aria-label="Lights on strip">
      <span class="unit">lights</span>
      <button type="button" class="remove" title="Remove strip" aria-label="Remove strip">×</button>`;
    li.querySelector('input').value = len;
    li.querySelector('input').addEventListener('input', updateFormTotal);
    li.querySelector('.remove').addEventListener('click', () => { li.remove(); updateFormTotal(); });
    $('strip-list').appendChild(li);
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
  $('add-manual-btn').addEventListener('click', () => openForm({}));
  $('cancel-device').addEventListener('click', () => { form.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError('');
    const body = { name: form.name.value, host: form.host.value, stripLengths: stripInputValues(), ...discovered };
    const old = editingId && App.devices.find((d) => d.id === editingId);
    if (old && body.stripLengths.length < old.stripCount) {
      const gone = old.stripCount - body.stripLengths.length === 1
        ? `strip ${old.stripCount}` : `strips ${body.stripLengths.length + 1}–${old.stripCount}`;
      if (!confirm(`Saved settings for ${gone} will be deleted. Continue?`)) return;
    }
    try {
      const d = editingId
        ? await api(`/api/devices/${editingId}`, { method: 'PUT', body })
        : await api('/api/devices', { method: 'POST', body });
      form.hidden = true;
      await App.reloadDevices();
      setupStatus(editingId ? `Saved "${d.name}".` : `Added "${d.name}". Select it on the Controls tab to change its lights.`, 'ok');
    } catch (err) { formError(err.message); }
  });

  App.onDevicesChanged((devices) => {
    renderControllers(devices);
    if (lastFound.length) renderFound();
  });
})();
