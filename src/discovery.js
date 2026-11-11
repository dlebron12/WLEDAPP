// Finding WLED controllers on the local network, so users don't have to look up IP addresses.
//
// 1. mDNS: every WLED controller announces a "_wled._tcp" service (with its MAC address),
//    the same way printers and smart speakers announce themselves.
// 2. Scan (fallback, for routers that block mDNS): ask every address on this computer's
//    local /24 networks for /json/info and keep the ones that answer as WLED.
//
// Both only work when this app runs on a computer on the same network as the controllers.
const os = require('os');
const { Bonjour } = require('bonjour-service');

const SCAN_PORT = Number(process.env.DISCOVERY_SCAN_PORT || 80); // tests use another port
const PROBE_TIMEOUT_MS = 1500;
const SCAN_CONCURRENCY = 64;

const normalizeMac = (mac) => (typeof mac === 'string' ? mac.toLowerCase().replace(/[^0-9a-f]/g, '') : '') || null;
const hostFor = (ip, port) => (port && Number(port) !== 80 ? `${ip}:${port}` : ip);

async function getJson(url, timeout = PROBE_TIMEOUT_MS) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Asks one address whether it is a WLED controller. Returns its details, or null.
async function probe(host, timeout = PROBE_TIMEOUT_MS) {
  let info;
  try {
    info = await getJson(`http://${host}/json/info`, timeout);
  } catch {
    return null;
  }
  if (!info || info.brand !== 'WLED') return null;

  // The config has the length of each LED output (data line) and the mDNS name.
  let cfg = {};
  try { cfg = await getJson(`http://${host}/json/cfg`, 3000); } catch { /* older firmware: skip */ }
  const outputs = (cfg?.hw?.led?.ins || []).map((o) => Number(o.len)).filter((n) => Number.isInteger(n) && n > 0);

  return {
    name: info.name || 'WLED',
    host,
    mac: normalizeMac(info.mac),
    mdns: cfg?.id?.mdns || null,
    version: info.ver || null,
    ledCount: info.leds?.count ?? null,
    maxSegments: info.leds?.maxseg ?? null,
    outputs, // e.g. [300, 300, 250, 120]
  };
}

// Listens for "_wled._tcp" announcements for `ms` milliseconds. Returns hosts like "192.168.1.47".
function browseMdns(ms = 2500) {
  return new Promise((resolve) => {
    let bonjour;
    const hosts = new Set();
    try {
      bonjour = new Bonjour();
      const browser = bonjour.find({ type: 'wled' }, (svc) => {
        const ip = (svc.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
        if (ip) hosts.add(hostFor(ip, svc.port));
      });
      setTimeout(() => {
        try { browser.stop(); bonjour.destroy(); } catch { /* ignore */ }
        resolve([...hosts]);
      }, ms);
    } catch {
      try { bonjour?.destroy(); } catch { /* ignore */ }
      resolve([]);
    }
  });
}

// This computer's private IPv4 networks, as "a.b.c" prefixes of their /24.
// DISCOVERY_SUBNETS (e.g. "192.168.1,10.0.0") overrides this, for unusual networks or testing.
function localPrefixes() {
  if (process.env.DISCOVERY_SUBNETS) {
    return process.env.DISCOVERY_SUBNETS.split(',').map((p) => p.trim()).filter((p) => /^\d+\.\d+\.\d+$/.test(p));
  }
  const prefixes = new Set();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [x, y] = a.address.split('.').map(Number);
      const isPrivate = x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31);
      if (isPrivate) prefixes.add(a.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...prefixes];
}

// Probes every address on the local /24 networks, a batch at a time.
async function scanSubnets() {
  const hosts = localPrefixes().flatMap((p) =>
    Array.from({ length: 254 }, (_, i) => hostFor(`${p}.${i + 1}`, SCAN_PORT)));
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
async function discover({ scan = true } = {}) {
  const mdnsHosts = await browseMdns();
  const results = (await Promise.all(mdnsHosts.map((h) => probe(h)))).filter(Boolean);
  if (scan) results.push(...(await scanSubnets()));

  const byKey = new Map();
  for (const r of results) {
    const key = r.mac || r.host;
    if (!byKey.has(key)) byKey.set(key, r);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Finds a controller by MAC address (used when its IP address has changed).
async function findByMac(mac) {
  const want = normalizeMac(mac);
  if (!want) return null;
  return (await discover()).find((r) => r.mac === want) || null;
}

module.exports = { discover, findByMac, probe, normalizeMac, localPrefixes };
