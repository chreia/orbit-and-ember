export interface FirePoint {
  lon: number; lat: number; timestamp: number; date: string; time: string;
  satellite: string; confidence: string; frp: number | null; scan: number; track: number;
}
export interface FireFeed {
  fetchedAt: string; points: FirePoint[];
  sources: { satellite: string; region: string; url: string; count: number; error?: string }[];
}
export function parseFireCsv(csv: string): FirePoint[] {
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const split = (s: string) => (s.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) ?? []).filter(Boolean).map(x => x.replace(/,$/, '').replace(/^"|"$/g, '').trim());
  const headers = split(lines.shift() ?? '');
  for (const key of ['latitude', 'longitude', 'acq_date', 'acq_time', 'satellite']) if (!headers.includes(key)) throw new Error(`Invalid NASA CSV: missing ${key}`);
  const out: FirePoint[] = []; const seen = new Set<string>();
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = split(line); const get = (key: string) => row[headers.indexOf(key)] ?? '';
    const lat = Number(get('latitude')), lon = Number(get('longitude'));
    const date = get('acq_date'), time = get('acq_time').padStart(4, '0');
    const timestamp = Date.parse(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);
    if (!get('latitude') || !get('longitude') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(timestamp) || !/^\d{4}$/.test(time)) throw new Error('Invalid observation in NASA CSV');
    const satellite = get('satellite'); const key = [lon,lat,timestamp,satellite].join('|');
    if (seen.has(key)) continue; seen.add(key);
    const frp = get('frp') === '' ? NaN : Number(get('frp'));
    out.push({lat,lon,date,time,timestamp,satellite,confidence:get('confidence'),frp:Number.isFinite(frp) ? frp : null,scan:Math.max(0.1,Number(get('scan')) || 0.375),track:Math.max(0.1,Number(get('track')) || 0.375)});
  }
  return out;
}
export function filterFires(points: FirePoint[], hours: number, now: number, satellite: string, minimum: boolean, day = '') {
  return points.filter(p => p.timestamp >= now - hours * 3600000 && p.timestamp <= now && (!day || p.date === day) && (satellite === 'all' || p.satellite === satellite) && (!minimum || ['nominal','high','n','h'].includes(p.confidence.toLowerCase())));
}
// Ground-draped geographic rectangles approximate the reported scan/track dimensions.
// They are satellite detection pixels, never inferred fire perimeters.
export function fireFootprints(points: FirePoint[]): GeoJSON.FeatureCollection {
  return {type:'FeatureCollection',features:points.map(p => {
    const dy=p.track/111.32/2, dx=p.scan/(111.32*Math.cos(p.lat*Math.PI/180))/2;
    return {type:'Feature',properties:{...p},geometry:{type:'Polygon',coordinates:[[[p.lon-dx,p.lat-dy],[p.lon+dx,p.lat-dy],[p.lon+dx,p.lat+dy],[p.lon-dx,p.lat+dy],[p.lon-dx,p.lat-dy]]]}};
  })};
}
