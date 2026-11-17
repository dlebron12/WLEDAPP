// Setup tab: find controllers on the network, add / edit / remove them.
(() => {
  const form = $('device-form');
  let editingId = null;
  let discovered = { mdns: null, mac: null }; // from "Find controllers", sent with the form
  let lastFound = [];                          // last discovery results, re-rendered when devices change
  let lastNotResponding = [];                  // announced themselves but didn't answer

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
      li.innerHTML = `<div class="meta"><strong></strong><span></span><span></span><span class="setup-state"></span></div>
        <div class="row"><button type="button" class="primary inline" data-act="setup">Set up controller</button>
        <button type="button" class="secondary inline" data-act="edit">Edit</button>
        <button type="button" class="secondary inline" data-act="remove">Remove</button></div>`;
      const [name, addr, strips, state] = li.querySelector('.meta').children;
      name.textContent = d.name;
      addr.textContent = `${d.host}${d.mdns ? ` · ${d.mdns}.local` : ''}`;
      strips.textContent = stripSummary(d);
      if (d.setupCurrent) {
        state.textContent = `✓ Set up ${d.configuredAt.slice(0, 10)}`;
        state.classList.add('ok');
      } else {
        state.textContent = d.configuredAt
          ? 'Strips changed since the last setup: set it up again'
          : 'Not set up by this app yet';
        state.classList.add('todo');
      }
      li.querySelector('[data-act=setup]').addEventListener('click', () => openSetup(d));
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
      if (setupId === d.id) $('setup-panel').hidden = true;
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
    $('find-help').hidden = true;
    $('find-status').textContent = 'Searching your network… this can take up to 30 seconds.';
    try {
      const { controllers, notResponding, searched } = await api('/api/devices/discover');
      lastFound = controllers;
      lastNotResponding = notResponding || [];
      const where = searched.networks.length
        ? `checked ${fmt(searched.addressesScanned)} addresses on ${searched.networks.join(', ')}`
        : 'could not find a home network on the computer running the app';
      if (lastFound.length) {
        $('find-status').textContent = `Found ${plural(lastFound.length, 'controller')}.`;
      } else if (lastNotResponding.length) {
        $('find-status').textContent = `${plural(lastNotResponding.length, 'controller')} announced ` +
          `${lastNotResponding.length === 1 ? 'itself' : 'themselves'} on your network, but the app couldn't read its details:`;
      } else {
        $('find-status').textContent =
          `No controllers found. The app listened for WLED announcements (${searched.mdnsAnswers} answered) and ${where}.`;
        showHelp(searched);
      }
      renderFound();
    } catch (e) {
      $('find-status').textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  // Troubleshooting list shown when nothing is found.
  function showHelp(searched) {
    const tips = [
      'Is the controller powered on? Give it a minute after power-up or after saving the Wi-Fi settings.',
      'Did it join the home Wi-Fi? If the phone still lists a "WLED-AP" network, the controller did not connect ' +
        '(often a mistyped Wi-Fi password, or a 5 GHz-only network): join WLED-AP and enter the Wi-Fi details again.',
      `Is the computer running the app (address ${searched.computerAddresses.join(', ') || 'unknown'}) on the same ` +
        'Wi-Fi as the controller, not a guest network? Guest networks keep devices from seeing each other.',
      'Look for the controller in your router\'s app or device list (often named "WLED" or "esp32"). ' +
        'If it is there, use "+ Add by IP address" with the address the router shows.',
    ];
    const ul = $('find-help');
    ul.innerHTML = '';
    for (const t of tips) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
    ul.hidden = false;
  }

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
      addr.textContent = `IP address: ${c.host}${c.mdns ? ` · ${c.mdns}.local` : ''}`;
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
    for (const n of lastNotResponding) {
      const li = document.createElement('li');
      li.className = 'not-responding';
      li.innerHTML = '<div class="meta"><strong></strong><span></span><span></span></div>';
      const [name, addr, why] = li.querySelector('.meta').children;
      name.textContent = n.name;
      addr.textContent = `IP address: ${n.host}${n.mdns ? ` · ${n.mdns}.local` : ''}`;
      why.textContent = `Couldn't read it: ${n.reason}. You can still add it with this address.`;
      const added = App.devices.find((d) => (n.mac && d.mac === n.mac) || d.host === n.host);
      if (added) li.appendChild(note(`Added as "${added.name}"`));
      else {
        li.appendChild(button('Add with this address', 'secondary', () => openForm({
          found: { name: n.name, host: n.host, mdns: n.mdns, mac: n.mac, outputs: [], ledCount: null },
        })));
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
    $('device-form-source').textContent = !found ? ''
      : found.outputs.length || found.ledCount
        ? `Filled in from "${found.name}". Check the strip lengths, then add it.`
        : `Filled in from "${found.name}". Enter the number of lights on each strip, then add it.`;
    form.name.value = device ? device.name : found ? found.name.slice(0, 40) : '';
    form.host.value = device ? device.host : found ? found.host : '';
    const lengths = device ? device.stripLengths
      : found && found.outputs.length ? found.outputs
        : found && found.ledCount ? [found.ledCount] : [300];
    setStripInputs(lengths);
    formError('');
    setupStatus('');
    $('setup-panel').hidden = true;
    showHeardSuggestions(!device && !found);
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    form.name.focus({ preventScroll: true });
  }

  // For "+ Add by IP address": list the controllers the last search heard (with their IP
  // addresses) that aren't added yet; tapping one fills in the form.
  function showHeardSuggestions(show) {
    const box = $('heard-suggestions');
    const list = $('heard-list');
    list.innerHTML = '';
    const isAdded = (c) => App.devices.some((d) => (c.mac && d.mac === c.mac) || d.host === c.host);
    const heard = [...lastFound, ...lastNotResponding].filter((c) => !isAdded(c));
    box.hidden = !show || heard.length === 0;
    for (const c of heard) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = `${c.name} · ${c.host}`;
      b.addEventListener('click', () => {
        form.name.value = form.name.value || c.name.slice(0, 40);
        form.host.value = c.host;
        discovered = { mdns: c.mdns || null, mac: c.mac || null };
        if (c.outputs && c.outputs.length) setStripInputs(c.outputs);
        list.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
      });
      list.appendChild(b);
    }
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

  // ---------- Set up controller ----------
  const panel = $('setup-panel');
  let setupId = null;
  let profile = null; // { pins, summary } from the server

  async function openSetup(d) {
    if (!profile) {
      try { profile = await api('/api/devices/setup-profile'); } catch (e) { setupStatus(e.message, 'error'); return; }
    }
    setupId = d.id;
    form.hidden = true;
    setupStatus('');
    $('setup-title').textContent = `Set up ${d.name}`;
    $('setup-error').textContent = '';
    $('setup-result').hidden = true;
    $('setup-presets').value = '';

    const outputs = $('setup-outputs');
    outputs.innerHTML = '';
    d.stripLengths.forEach((len, i) => {
      const li = document.createElement('li');
      li.textContent = i < profile.pins.length
        ? `Output ${i + 1} (Data ${i + 1}): GPIO ${profile.pins[i]} · ${fmt(len)} lights`
        : `Strip ${i + 1}: no data pin available`;
      outputs.appendChild(li);
    });
    const summary = $('setup-summary');
    summary.innerHTML = '';
    for (const line of profile.summary) {
      const li = document.createElement('li');
      li.textContent = line;
      summary.appendChild(li);
    }
    const tooMany = d.stripCount > profile.pins.length;
    $('setup-submit').disabled = tooMany;
    if (tooMany) {
      $('setup-error').textContent = `The setup has ${profile.pins.length} data pins, one per strip. ` +
        `This controller has ${d.stripCount} strips: reduce them to ${profile.pins.length} with Edit.`;
    }
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('setup-cancel').addEventListener('click', () => { panel.hidden = true; });

  panel.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = App.devices.find((x) => x.id === setupId);
    if (!d) return;
    $('setup-error').textContent = '';
    $('setup-result').hidden = true;

    const file = $('setup-presets').files[0];
    let presets;
    if (file) {
      if (file.size > 1.5 * 1024 * 1024) { $('setup-error').textContent = 'The presets file is too large.'; return; }
      presets = await file.text();
      try { JSON.parse(presets); } catch { $('setup-error').textContent = `"${file.name}" is not a valid JSON file.`; return; }
    }
    const what = `${d.stripCount === 1 ? 'its LED output' : `its ${d.stripCount} LED outputs`}${file ? ` and upload "${file.name}"` : ''}`;
    if (!confirm(`Replace ${d.name}'s LED settings with ${what}?`)) return;

    const btn = $('setup-submit');
    btn.disabled = true;
    btn.textContent = 'Writing settings…';
    try {
      const r = await api(`/api/devices/${d.id}/setup`, { method: 'POST', body: presets ? { presets } : {} });
      showResult(r, file);
      await App.reloadDevices();
    } catch (err) {
      $('setup-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Write settings to controller';
    }
  });

  function showResult(r, file) {
    const box = $('setup-result');
    box.innerHTML = '';
    box.className = `result ${r.verified ? 'ok' : 'warn'}`;
    const head = document.createElement('div');
    head.textContent = r.verified
      ? `Done. ${plural(r.outputs.length, 'output')} written and checked (${fmt(r.totalLights)} lights).`
      : 'The settings were sent, but the controller reports something different:';
    box.appendChild(head);
    if (!r.verified) {
      const ul = document.createElement('ul');
      for (const p of r.problems) { const li = document.createElement('li'); li.textContent = p; ul.appendChild(li); }
      box.appendChild(ul);
    }
    if (r.presetsUploaded) {
      const p = document.createElement('div');
      p.textContent = `Presets "${file.name}" uploaded.`;
      box.appendChild(p);
    }
    box.hidden = false;
  }

  App.onDevicesChanged((devices) => {
    renderControllers(devices);
    if (lastFound.length || lastNotResponding.length) renderFound();
  });
})();
