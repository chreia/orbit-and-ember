import { parseFireCsv } from '../src/lib/fireFeed.ts';
const URLS = [
  ['NOAA-20', 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/viirs/csv/J1_VIIRS_C2_Global_24h.csv'],
  ['NOAA-21', 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/viirs/csv/J2_VIIRS_C2_Global_24h.csv'],
];
const STEP = 0.5;

export function aggregateWorld(points, fetchedAt = new Date().toISOString(), sources = []) {
  const cells = new Map();
  let detections = 0;
  let latestObservation = 0;
  const hourMs = 3_600_000;
  const endHour = Math.ceil(Date.parse(fetchedAt) / hourMs) * hourMs;
  const startHour = endHour - 24 * hourMs;
  const hourlyDetections = Array(24).fill(0);
  for (const point of points) {
    const lon = Number(point.lon), lat = Number(point.lat);
    const timestamp = Number(point.timestamp);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(timestamp) || timestamp < startHour || timestamp >= endHour || lon < -180 || lon > 180 || lat < -85 || lat > 85) continue;
    if (!['nominal', 'high', 'n', 'h'].includes(String(point.confidence).toLowerCase())) continue;
    const x = Math.min(719, Math.max(0, Math.floor((lon + 180) / STEP)));
    const y = Math.min(339, Math.max(0, Math.floor((lat + 85) / STEP)));
    const key = `${x}:${y}`;
    const cell = cells.get(key) ?? { lon: -180 + (x + .5) * STEP, lat: -85 + (y + .5) * STEP, count: 0, latest: 0, hours: Array(24).fill(0) };
    const hour = Math.floor((timestamp - startHour) / hourMs);
    cell.count++;
    cell.hours[hour]++;
    cell.latest = Math.max(cell.latest, timestamp);
    cells.set(key, cell);
    detections++;
    hourlyDetections[hour]++;
    latestObservation = Math.max(latestObservation, timestamp);
  }
  return { fetchedAt, windowHours: 24, startHour, hourlyDetections, resolutionDegrees: STEP, detections, latestObservation, cells: [...cells.values()], sources };
}

function readCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(',') ?? [];
  const index = (name) => header.indexOf(name);
  for (const field of ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence']) if (index(field) < 0) throw new Error(`NASA CSV missing ${field}`);
  return lines.flatMap((line) => {
    const row = line.split(',');
    const lat = Number(row[index('latitude')]), lon = Number(row[index('longitude')]);
    const date = row[index('acq_date')], time = row[index('acq_time')]?.padStart(4, '0');
    const timestamp = Date.parse(`${date}T${time?.slice(0, 2)}:${time?.slice(2)}:00Z`);
    return Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(timestamp)
      ? [{ lat, lon, timestamp, confidence: row[index('confidence')] }]
      : [];
  });
}

export async function fetchWorldGrid() {
  const results = await Promise.all(URLS.map(async ([sensor, url]) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`NASA ${sensor} returned HTTP ${response.status}`);
    const points = parseFireCsv(await response.text());
    return { sensor, url, points };
  }));
  return {points: results.flatMap(result => result.points), ...aggregateWorld(results.flatMap((result) => result.points), new Date().toISOString(), results.map(({ sensor, url, points }) => ({ sensor, url, count: points.length })))};
}

let cache = null;
let pending = null;
export async function getWorldGrid() {
  if (!cache || Date.now() - Date.parse(cache.fetchedAt) > 10 * 60_000) {
    pending ??= fetchWorldGrid().then((result) => { cache = result; return result; }).finally(() => { pending = null; });
    await pending;
  }
  return cache;
}
export function worldGridPlugin() {
  const install = (server) => { server.middlewares.use('/api/world-grid', async (request, response) => {
    if (request.method !== 'GET') { response.statusCode = 405; response.end(); return; }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    try {
      response.end(JSON.stringify(await getWorldGrid()));
    } catch {
      response.statusCode = 502;
      response.end(JSON.stringify({ error: 'NASA FIRMS global feed unavailable; saved snapshot can be used.' }));
    }
  }); };
  return { name: 'focos-world-grid', configureServer: install, configurePreviewServer: install };
}
