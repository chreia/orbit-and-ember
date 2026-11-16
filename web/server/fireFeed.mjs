import { parseFireCsv } from '../src/lib/fireFeed.ts';
export async function fetchFireFeed(scope = 'us') {
  const sources = await Promise.all(['J1','J2'].flatMap((sensor) => (scope === 'world' ? ['Global'] : ['USA_contiguous_and_Hawaii','Alaska']).map(async region => {
    const url = `https://firms.modaps.eosdis.nasa.gov/data/active_fire/viirs/csv/${sensor}_VIIRS_C2_${region}_${scope === 'world' ? '24h' : '7d'}.csv`;
    const satellite = sensor === 'J1' ? 'N20' : 'N21';
    try {
      const response = await fetch(url, {signal:AbortSignal.timeout(180000)});
      if (!response.ok) throw new Error(`NASA returned HTTP ${response.status}`);
      const points = parseFireCsv(await response.text());
      return {satellite,region,url,count:points.length,points};
    } catch(e) { return {satellite,region,url,count:0,points:[],error:e.message}; }
  })));
  if (sources.every(s => s.error)) throw new Error('NASA feeds unavailable. Please retry.');
  const seen = new Set();
  const points = sources.flatMap(s => s.points).filter(p => {
    const key = [p.lon,p.lat,p.timestamp,p.satellite].join('|');
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  return {fetchedAt:new Date().toISOString(),points,sources:sources.map(({points,...source})=>source)};
}
const caches = new Map(), pending = new Map();
export function recentFirePlugin() {
  const setup = server => {
    for (const scope of ['us','world']) server.middlewares.use(`/api/firms/${scope}`, async (req,res) => {
      if (req.method !== 'GET') {res.statusCode=405;res.end();return;}
      try {
        let cached=caches.get(scope);
        if (!cached || Date.now()-Date.parse(cached.fetchedAt)>300000) {
          if (!pending.has(scope)) pending.set(scope,fetchFireFeed(scope).then(data=>{caches.set(scope,data);return data;}).finally(()=>pending.delete(scope)));
          cached=await pending.get(scope);
        }
        res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(cached));
      } catch {res.statusCode=502;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'NASA FIRMS is currently unavailable. Retry shortly.'}));}
    });
  };
  return {name:'focos-global-fire-feed',configureServer:setup,configurePreviewServer:setup};
}
