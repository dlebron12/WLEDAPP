// Finding WLED controllers on the local network, so users don't have to look up IP addresses.
//
// 1. mDNS: every WLED controller announces a "_wled._tcp" service (with its MAC address),
//    the same way printers and smart speakers announce themselves.
// 2. Scan (fallback, for routers that block mDNS): ask every address on this computer's
//    local networks (up to 1,022 addresses each) for /json/info and keep the ones that answer as WLED.
//
// Both only work when this app runs on a computer on the same network as the controllers.
const os = require('os');
const { Bonjour } = require('bonjour-service');
const { looksLikeWled } = require('./wled');

const SCAN_PORT = Number(process.env.DISCOVERY_SCAN_PORT || 80); // tests use another port
const PROBE_TIMEOUT_MS = 1500;   // per address during the scan (most addresses never answer)
const ANNOUNCED_TIMEOUT_MS = 5000; // for controllers that announced themselves: they can be slow
const SCAN_CONCURRENCY = 128;

const normalizeMac = (mac) => (typeof mac === 'string' ? mac.toLowerCase().replace(/[^0-9a-f]/g, '') : '') || null;
const hostFor = (ip, port) => (port && Number(port) !== 80 ? `${ip}:${port}` : ip);

async function getJson(url, timeout = PROBE_TIMEOUT_MS) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Why a request failed, in words the app can show.
function failureReason(e, timeout) {
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return `no reply within ${timeout / 1000} seconds`;
  if (/^HTTP /.test(e.message)) return `it answered with an error (${e.message})`;
  const code = e.cause?.code || e.code;
  if (code === 'ECONNREFUSED') return 'it refused the connection';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'this computer has no route to it (different network?)';
  if (e instanceof SyntaxError) return 'it answered, but not with WLED data';
  return code ? `connection failed (${code})` : 'connection failed';
}

// Asks one address whether it is a WLED controller.
// Returns { device } with its details, or { reason } saying why not.
async function probeDetailed(host, timeout = PROBE_TIMEOUT_MS) {
  let info;
  try {
    info = await getJson(`http://${host}/json/info`, timeout);
  } catch (e) {
    return { reason: failureReason(e, timeout) };
  }
  if (!looksLikeWled(info)) return { reason: 'it answered, but not like a WLED controller' };

  // The config has the length of each LED output (data line) and the mDNS name.
  let cfg = {};
  try { cfg = await getJson(`http://${host}/json/cfg`, Math.max(timeout, 3000)); } catch { /* older firmware: skip */ }
  const outputs = (cfg?.hw?.led?.ins || []).map((o) => Number(o.len)).filter((n) => Number.isInteger(n) && n > 0);

  return {
    device: {
      name: info.name || 'WLED',
      host,
      mac: normalizeMac(info.mac),
      mdns: cfg?.id?.mdns || null,
      version: info.ver || null,
      ledCount: info.leds?.count ?? null,
      maxSegments: info.leds?.maxseg ?? null,
      outputs, // e.g. [300, 300, 250, 120]
    },
  };
}

// Returns the controller's details, or null.
async function probe(host, timeout = PROBE_TIMEOUT_MS) {
  return (await probeDetailed(host, timeout)).device || null;
}

// Listens for "_wled._tcp" announcements for `ms` milliseconds.
// Returns [{ host: "192.168.1.47", name, mdns, mac }] (one per controller heard).
function browseMdns(ms = 4000) {
  return new Promise((resolve) => {
    let bonjour;
    const heard = new Map();
    try {
      bonjour = new Bonjour();
      const browser = bonjour.find({ type: 'wled' }, (svc) => {
        const ip = (svc.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
        if (!ip) return;
        const host = hostFor(ip, svc.port);
        heard.set(host, {
          host,
          name: svc.name || 'WLED',
          mdns: typeof svc.host === 'string' ? svc.host.replace(/\.local\.?$/i, '') : null,
          mac: normalizeMac(svc.txt?.mac),
        });
      });
      setTimeout(() => {
        try { browser.stop(); bonjour.destroy(); } catch { /* ignore */ }
        resolve([...heard.values()]);
      }, ms);
    } catch {
      try { bonjour?.destroy(); } catch { /* ignore */ }
      resolve([]);
    }
  });
}

const ipToInt = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const intToIp = (n) => [24, 16, 8, 0].map((sh) => Math.floor(n / 2 ** sh) % 256).join('.');
const isPrivateIp = (ip) => {
  const [x, y] = ip.split('.').map(Number);
  return x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31);
};
const MAX_SCAN_PREFIX = 22; // scan at most a /22 (1,022 addresses) per network

// This computer's private IPv4 networks to scan, e.g. [{ cidr: '192.168.4.0/22', hosts: [...] }].
// Uses each network's real size (mesh routers often use /22 or larger), capped at a /22
// around this computer's own address. DISCOVERY_SUBNETS (e.g. "192.168.1,10.0.0") overrides
// this with /24s, for unusual networks or testing.
function localNetworks() {
  const nets = new Map();
  const add = (base, prefix) => {
    const size = 2 ** (32 - prefix);
    const start = Math.floor(ipToInt(base) / size) * size;
    const cidr = `${intToIp(start)}/${prefix}`;
    if (nets.has(cidr)) return;
    const hosts = [];
    for (let n = start + 1; n < start + size - 1; n++) hosts.push(intToIp(n)); // skip network/broadcast
    nets.set(cidr, { cidr, hosts });
  };
  if (process.env.DISCOVERY_SUBNETS) {
    for (const p of process.env.DISCOVERY_SUBNETS.split(',').map((x) => x.trim())) {
      if (/^\d+\.\d+\.\d+$/.test(p)) add(`${p}.0`, 24);
    }
    return [...nets.values()];
  }
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || !isPrivateIp(a.address)) continue;
      const prefix = Number((a.cidr || '').split('/')[1]) || 24;
      add(a.address, Math.max(prefix, MAX_SCAN_PREFIX));
    }
  }
  return [...nets.values()];
}

// Probes every address on the local networks, a batch at a time.
async function scanNetworks(networks) {
  const hosts = networks.flatMap((n) => n.hosts.map((ip) => hostFor(ip, SCAN_PORT)));
  const found = [];
  let next = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const result = await probe(hosts[next++]);
      if (result) found.push(result);
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
  return found;
}

// Finds controllers with mDNS, then (if asked) a scan. One entry per controller (by MAC).
// Returns { controllers, notResponding, searched }:
//  - notResponding: controllers that announced themselves but didn't answer, with the reason,
//    so the app can offer to add them by address anyway;
//  - searched: what was tried, so the app can explain an empty result.
async function discover({ scan = true } = {}) {
  const started = Date.now();
  const heard = await browseMdns();
  const results = [];
  const notResponding = [];
  await Promise.all(heard.map(async (h) => {
    let r = await probeDetailed(h.host, ANNOUNCED_TIMEOUT_MS);
    if (!r.device && /no reply/.test(r.reason)) r = await probeDetailed(h.host, ANNOUNCED_TIMEOUT_MS); // one retry
    if (r.device) results.push({ ...r.device, mac: r.device.mac || h.mac, mdns: r.device.mdns || h.mdns });
    else notResponding.push({ ...h, reason: r.reason });
  }));
  const networks = scan ? localNetworks() : [];
  if (scan) results.push(...(await scanNetworks(networks)));

  const byKey = new Map();
  for (const r of results) {
    const key = r.mac || r.host;
    if (!byKey.has(key)) byKey.set(key, r);
  }
  const controllers = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  // The scan may still have reached one that didn't answer the first time.
  const stillMissing = notResponding.filter((n) => !controllers.some((c) => c.host === n.host || (n.mac && c.mac === n.mac)));

  const searched = {
    mdnsAnswers: heard.length,
    networks: networks.map((n) => n.cidr),
    addressesScanned: networks.reduce((sum, n) => sum + n.hosts.length, 0),
    computerAddresses: Object.values(os.networkInterfaces()).flat()
      .filter((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal).map((a) => a.address),
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
  console.log(`[discovery] ${controllers.length} found · mDNS answers: ${searched.mdnsAnswers}` +
    `${heard.length ? ` (${heard.map((h) => `${h.name} @ ${h.host}`).join(', ')})` : ''} · ` +
    `scanned ${searched.addressesScanned} addresses in ${searched.networks.join(', ') || 'no networks'} · ` +
    `this computer: ${searched.computerAddresses.join(', ') || 'no network'} · ${searched.seconds}s`);
  for (const n of stillMissing) console.log(`[discovery] heard ${n.name} @ ${n.host} but it didn't answer: ${n.reason}`);
  return { controllers, notResponding: stillMissing, searched };
}

// Finds a controller by MAC address (used when its IP address has changed).
async function findByMac(mac) {
  const want = normalizeMac(mac);
  if (!want) return null;
  return (await discover()).controllers.find((r) => r.mac === want) || null;
}

module.exports = { discover, findByMac, probe, normalizeMac, localNetworks };
