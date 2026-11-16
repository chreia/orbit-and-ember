import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getWorldGrid } from './worldGrid.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const distanceKm = (a, b, c, d) => {
  const r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

// A within-day surge is a review candidate, not a historical fire anomaly or confirmed incident.
export function candidateSignals(feed, now = Date.now()) {
  if (!feed || !Array.isArray(feed.cells) || !Number.isFinite(feed.startHour)) return [];
  if (Date.parse(feed.fetchedAt) < now - 30 * 60_000) return [];
  return feed.cells.flatMap(cell => {
    if (!Array.isArray(cell.hours) || cell.hours.length !== 24 || !Number.isFinite(cell.latest) || cell.latest < now - 6 * 3_600_000 || cell.latest > now + 5 * 60_000) return [];
    const recent = cell.hours.slice(-6).reduce((a, b) => a + b, 0);
    const earlier = cell.hours.slice(0, -6).reduce((a, b) => a + b, 0);
    if (recent < 6 || recent < Math.max(6, earlier)) return [];
    return [{ id: `${cell.lat.toFixed(2)}:${cell.lon.toFixed(2)}`, lat: cell.lat, lon: cell.lon, recent, earlier, latest: cell.latest, fetchedAt: feed.fetchedAt }];
  }).sort((a, b) => b.recent - a.recent);
}

export async function sendRelayEmail({ to, subject, text, key = process.env.RESEND_API_KEY, from = process.env.FOCOS_ALERT_FROM, idempotencyKey }) {
  if (!key || !from) throw new Error('Email delivery is not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  const result = await response.json();
  return result.id;
}

export function createAlertRelay({ file = process.env.FOCOS_ALERT_STORE ?? join(homedir(), '.focos', 'alert-relay.json'), partnersFile = process.env.FOCOS_PARTNERS_FILE, feed = getWorldGrid, send = sendRelayEmail, emailReady = () => Boolean(process.env.RESEND_API_KEY && process.env.FOCOS_ALERT_FROM), publicUrl = () => process.env.FOCOS_PUBLIC_URL } = {}) {
  let state = { subscribers: [], deliveries: [], lastCheck: null };
  let loaded = false;
  let checking = null;
  let lastSignals = [];
  let writing = Promise.resolve();
  let partners = [];
  const attempts = new Map();
  async function load() {
    if (loaded) return;
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(saved.subscribers) && Array.isArray(saved.deliveries)) state = saved;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (partnersFile) {
      const listed = JSON.parse(await readFile(partnersFile, 'utf8'));
      if (!Array.isArray(listed)) throw new Error('Partner file must contain an array');
      partners = listed.filter(p => typeof p.email === 'string' && ['scientist', 'response', 'land-manager'].includes(p.role));
    }
    loaded = true;
  }
  function save() {
    const snapshot = JSON.stringify(state, null, 2);
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const next = `${file}.${process.pid}.tmp`;
      await writeFile(next, snapshot, { mode: 0o600 });
      await rename(next, file);
    });
    return writing;
  }
  function status(lat, lon) {
    const matched = state.subscribers.filter(s => s.active && Number.isFinite(lat) && Number.isFinite(lon) && distanceKm(lat, lon, s.lat, s.lon) <= s.radiusKm);
    return { emailReady: emailReady(), lastCheck: state.lastCheck, signal: lastSignals.find(s => distanceKm(lat, lon, s.lat, s.lon) < 40) ?? null, recipients: matched.map(s => {
      const partner = partners.find(p => p.email.toLowerCase() === s.email);
      return { role: partner?.role ?? 'watcher', name: partner && s.publicName ? s.name : null, organization: partner && s.publicName ? partner.organization : null, logoUrl: partner && s.publicName && typeof partner.logoUrl === 'string' && partner.logoUrl.startsWith('https://') ? partner.logoUrl : null, lastDelivery: state.deliveries.findLast(d => d.subscriberId === s.id)?.status ?? null };
    }), count: matched.length };
  }
  async function subscribe(input, origin) {
    await load();
    if (!emailReady()) throw Object.assign(new Error('Email sign-up is not configured yet'), { status: 503 });
    const email = String(input.email ?? '').trim().toLowerCase();
    const name = String(input.name ?? '').trim().slice(0, 80);
    const organization = String(input.organization ?? '').trim().slice(0, 100);
    const role = String(input.role ?? 'scientist');
    const lat = Number(input.lat), lon = Number(input.lon), radiusKm = Number(input.radiusKm);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !['scientist', 'response', 'land-manager'].includes(role) || !Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(radiusKm) || radiusKm < 5 || radiusKm > 150) throw Object.assign(new Error('Enter a name, valid email, role, location and radius from 5–150 km'), { status: 400 });
    const verifyToken = token(), unsubscribeToken = token();
    const id = token();
    const verifyUrl = `${publicUrl() ?? origin}/api/relay/verify?token=${verifyToken}`;
    state.subscribers = state.subscribers.filter(s => s.email !== email || s.active);
    state.subscribers.push({ id, email, name, organization, role, lat, lon, radiusKm, origin, publicName: Boolean(input.publicName), active: false, verifyHash: hash(verifyToken), unsubscribeHash: hash(unsubscribeToken), unsubscribeToken, createdAt: new Date().toISOString(), lastObservation: 0, lastSentAt: 0 });
    await save();
    try {
      await send({ to: email, subject: 'Confirm your Focos fire-signal watch', text: `Confirm your opt-in watch for satellite fire signals near ${lat.toFixed(2)}°, ${lon.toFixed(2)}° (${radiusKm} km):\n${verifyUrl}\n\nThese are candidate thermal clusters, not emergency dispatch alerts. If you did not request this, ignore this email.`, idempotencyKey: `focos-verify-${id}` });
    } catch (error) {
      state.subscribers = state.subscribers.filter(s => s.id !== id);
      await save();
      throw error;
    }
    return { pending: true };
  }
  async function verify(value) {
    await load();
    const subscriber = state.subscribers.find(s => !s.active && s.verifyHash === hash(value));
    if (!subscriber) return false;
    subscriber.active = true;
    subscriber.verifyHash = null;
    // First check establishes a baseline; a new observation must arrive before an alert is sent.
    const current = await feed().catch(() => null);
    subscriber.lastObservation = current?.latestObservation ?? Date.now() - 6 * 3_600_000;
    await save();
    return true;
  }
  async function unsubscribe(value) {
    await load();
    const subscriber = state.subscribers.find(s => s.unsubscribeHash === hash(value));
    if (!subscriber) return false;
    subscriber.active = false;
    await save();
    return true;
  }
  async function check() {
    if (checking) return checking;
    checking = (async () => {
      await load();
      const current = await feed();
      const signals = candidateSignals(current);
      lastSignals = signals;
      state.lastCheck = new Date().toISOString();
      for (const subscriber of state.subscribers.filter(s => s.active)) {
        for (const signal of signals) {
          if (signal.latest <= subscriber.lastObservation || Date.now() - subscriber.lastSentAt < 6 * 3_600_000 || distanceKm(signal.lat, signal.lon, subscriber.lat, subscriber.lon) > subscriber.radiusKm) continue;
          const unsubscribeUrl = `${publicUrl() ?? subscriber.origin}/api/relay/unsubscribe?token=${subscriber.unsubscribeToken}`;
          const idempotencyKey = `focos-signal-${subscriber.id}-${signal.id}-${signal.latest}`;
          const delivery = { id: idempotencyKey, subscriberId: subscriber.id, signalId: signal.id, observation: signal.latest, attemptedAt: new Date().toISOString(), status: 'attempted' };
          state.deliveries.push(delivery);
          await save();
          try {
            const providerId = await send({ to: subscriber.email, subject: `Focos: satellite cluster near ${signal.lat.toFixed(2)}°, ${signal.lon.toFixed(2)}°`, text: `NASA FIRMS observed ${signal.recent} thermal detections in a 0.5° cell during the latest 6 hours, compared with ${signal.earlier} in the preceding 18 hours.\n\nLocation: ${signal.lat.toFixed(4)}°, ${signal.lon.toFixed(4)}°\nLatest observation: ${new Date(signal.latest).toISOString()}\nSource: https://firms.modaps.eosdis.nasa.gov/\n\nThis is a candidate cluster, not a confirmed wildfire, fire perimeter, or emergency dispatch. Verify with local authorities and other sources before acting.\n\nStop alerts: ${unsubscribeUrl}`, idempotencyKey });
            delivery.status = 'accepted'; delivery.providerId = providerId;
            subscriber.lastObservation = signal.latest; subscriber.lastSentAt = Date.now();
          } catch (error) { delivery.status = 'failed'; delivery.error = String(error.message).slice(0, 120); }
          await save();
        }
      }
      state.deliveries = state.deliveries.slice(-1000);
      await save();
      return { signals: signals.length, lastCheck: state.lastCheck };
    })().finally(() => { checking = null; });
    return checking;
  }
  return { load, status, subscribe, verify, unsubscribe, check };
}

export function alertRelayPlugin(options = {}) {
  const relay = createAlertRelay(options);
  const install = server => {
    let timer;
    server.middlewares.use('/api/relay', async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://local');
      const json = (code, data) => { response.statusCode = code; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(data)); };
      try {
        await relay.load();
        if (request.method === 'GET' && url.pathname === '/status') return json(200, relay.status(Number(url.searchParams.get('lat')), Number(url.searchParams.get('lon'))));
        if ((request.method === 'GET' || request.method === 'POST') && (url.pathname === '/verify' || url.pathname === '/unsubscribe')) {
          let value = url.searchParams.get('token') ?? '';
          if (request.method === 'POST') {
            let body = '';
            for await (const chunk of request) { body += chunk; if (body.length > 1024) return json(413, { error: 'Request too large' }); }
            value = new URLSearchParams(body).get('token') ?? '';
          }
          const valid = /^[a-f0-9]{64}$/.test(value);
          const success = request.method === 'POST' && valid && (url.pathname === '/verify' ? await relay.verify(value) : await relay.unsubscribe(value));
          response.statusCode = request.method === 'GET' && valid ? 200 : success ? 200 : 400;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.setHeader('Referrer-Policy', 'no-referrer');
          const action = url.pathname === '/verify' ? 'Confirm watch' : 'Stop alerts';
          const heading = request.method === 'GET' && valid ? action : success ? url.pathname === '/verify' ? 'Watch confirmed' : 'Watch stopped' : 'Link invalid or expired';
          response.end(`<main style="font:16px system-ui;max-width:36rem;margin:12vh auto;padding:2rem"><h1>${heading}</h1><p>${success ? 'Your Focos fire-signal preference has been updated.' : request.method === 'GET' && valid ? 'This action changes your Focos fire-signal subscription.' : 'Request a new confirmation link from Focos.'}</p>${request.method === 'GET' && valid ? `<form method="post" action="/api/relay${url.pathname}"><input type="hidden" name="token" value="${value}"><button style="padding:12px 18px">${action}</button></form>` : ''}<p><a href="/">Return to Focos</a></p></main>`);
          return;
        }
        if (request.method === 'POST' && url.pathname === '/subscribe') {
          const ip = request.socket.remoteAddress ?? 'unknown';
          const previous = attempts.get(ip) ?? [];
          const recent = previous.filter(t => Date.now() - t < 3_600_000);
          if (recent.length >= 5) return json(429, { error: 'Too many sign-up attempts. Try again later.' });
          attempts.set(ip, [...recent, Date.now()]);
          let body = '';
          for await (const chunk of request) { body += chunk; if (body.length > 4096) return json(413, { error: 'Request too large' }); }
          const suppliedOrigin = process.env.FOCOS_PUBLIC_URL ?? (request.headers.host?.startsWith('127.0.0.1:') || request.headers.host?.startsWith('localhost:') ? `http://${request.headers.host}` : null);
          if (!suppliedOrigin) return json(503, { error: 'Public app URL is not configured' });
          return json(202, await relay.subscribe(JSON.parse(body), suppliedOrigin));
        }
        json(404, { error: 'Unknown relay endpoint' });
      } catch (error) { json(error.status ?? 500, { error: error.status ? error.message : 'Relay unavailable. Try again later.' }); }
    });
    timer = setInterval(() => { void relay.check().catch(error => console.warn('[focos] relay check:', error.message)); }, 10 * 60_000);
    timer.unref?.();
    void relay.check().catch(error => console.warn('[focos] relay check:', error.message));
    server.httpServer?.once('close', () => clearInterval(timer));
  };
  return { name: 'focos-alert-relay', configureServer: install, configurePreviewServer: install };
}
