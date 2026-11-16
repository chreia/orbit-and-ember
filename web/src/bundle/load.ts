// Fetch the static bundle. The base comes from VITE_DATA_BASE; when it is not set the app tries
// ./data and falls back to ./data-mock (the synthetic bundle) if no manifest is found there.
import type { Manifest, PointsIndex, PointsYearInfo, Validation } from './types.ts';
import { parseTable, viewArray } from './table.ts';
import { gunzipIfNeeded } from './gunzip.ts';
import { normalisePointsIndex } from './pointsIndex.ts';
export { normalisePointsIndex };
import type { Table } from './table.ts';
import type { GeoCollection } from '../lib/region.ts';

const BASE_URL = import.meta.env.BASE_URL ?? './';
const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

export interface Bundle {
  base: string;
  manifest: Manifest;
  synthetic: boolean;
}

async function tryManifest(base: string): Promise<Manifest | null> {
  try {
    const res = await fetch(join(base, 'manifest.json'), { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    // Dev servers answer unknown paths with index.html; only accept JSON.
    if (!text.trimStart().startsWith('{')) return null;
    return JSON.parse(text) as Manifest;
  } catch {
    return null;
  }
}

export async function loadBundle(): Promise<Bundle> {
  const configured = import.meta.env.VITE_DATA_BASE as string | undefined;
  const candidates = configured ? [configured] : [join(BASE_URL, 'data'), join(BASE_URL, 'data-mock')];
  for (const base of candidates) {
    const manifest = await tryManifest(base);
    if (manifest) {
      checkManifest(manifest);
      return { base, manifest, synthetic: Boolean(manifest.synthetic) || base.endsWith('data-mock') };
    }
  }
  throw new Error(`No manifest.json found at ${candidates.join(' or ')}`);
}

function checkManifest(m: Manifest): void {
  const problems: string[] = [];
  if (!m.grid || !(m.grid.res > 0)) problems.push('grid');
  if (!m.months || m.months.n <= 0) problems.push('months');
  if (!Array.isArray(m.month_source) || m.month_source.length !== m.months.n) problems.push('month_source length');
  for (const s of ['modis_terra', 'modis_aqua', 'viirs_snpp', 'viirs_noaa20'] as const) {
    if (!m.availability?.[s] || m.availability[s].length !== m.months.n) problems.push(`availability.${s}`);
  }
  if (!m.table?.arrays?.length) problems.push('table');
  if (problems.length) throw new Error(`manifest.json is missing or malformed: ${problems.join(', ')}`);
}

/** Fetch a binary file (gzip or plain), reporting progress as a 0..1 fraction when the size is known. */
export async function fetchBinary(url: string, onProgress?: (f: number) => void): Promise<ArrayBuffer> {
  return gunzipIfNeeded(await fetchRaw(url, onProgress));
}

async function fetchRaw(url: string, onProgress?: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress || !total) {
    const buf = await res.arrayBuffer();
    onProgress?.(1);
    return buf;
  }
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  let chunks: Uint8Array[] | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (chunks) chunks.push(value);
    else if (got + value.length > total) {
      // Content-Length was the compressed size; switch to collecting chunks.
      chunks = [out.slice(0, got), value];
    } else out.set(value, got);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  if (chunks) {
    const all = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) {
      all.set(c, o);
      o += c.length;
    }
    return all.buffer;
  }
  return got === total ? out.buffer : out.slice(0, got).buffer;
}

export async function loadTable(b: Bundle, onProgress?: (f: number) => void): Promise<Table> {
  const buf = await fetchBinary(join(b.base, b.manifest.table.file), onProgress);
  return parseTable(buf, b.manifest);
}

export async function loadBoundaries(b: Bundle): Promise<GeoCollection | null> {
  try {
    const res = await fetch(join(b.base, b.manifest.boundaries));
    if (!res.ok) return null;
    return (await res.json()) as GeoCollection;
  } catch {
    return null;
  }
}

export async function loadValidation(b: Bundle): Promise<Validation | null> {
  try {
    const res = await fetch(join(b.base, b.manifest.validation), { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trimStart().startsWith('{')) return null;
    return JSON.parse(text) as Validation;
  } catch {
    return null;
  }
}

let pointsIndexCache: Promise<PointsIndex> | null = null;

export function loadPointsIndex(b: Bundle): Promise<PointsIndex> {
  if (!pointsIndexCache) {
    pointsIndexCache = fetch(join(b.base, b.manifest.points.index))
      .then((r) => {
        if (!r.ok) throw new Error(`points index: HTTP ${r.status}`);
        return r.json();
      })
      .then((raw: Record<string, unknown>) => normalisePointsIndex(raw));
    pointsIndexCache.catch(() => {
      pointsIndexCache = null;
    });
  }
  return pointsIndexCache;
}

export interface PointsYear {
  year: number;
  n: number;
  lon: Float32Array;
  lat: Float32Array;
  day: Uint16Array;
  hhmm: Uint16Array;
  sensor: Uint8Array;
  conf: Uint8Array;
  frp: Float32Array;
  bright: Float32Array;
  flags: Uint8Array;
  version: Uint8Array;
}

export async function loadPointsYear(b: Bundle, info: PointsYearInfo, year: number, onProgress?: (f: number) => void): Promise<PointsYear> {
  const url = join(b.base, b.manifest.points.file_pattern.replace('{year}', String(year)));
  const buf = await fetchBinary(url, onProgress);
  const spec = new Map(info.arrays.map((a) => [a.name, a]));
  const get = <T>(name: string): T => {
    const s = spec.get(name);
    if (!s) throw new Error(`points/${year}.bin is missing array "${name}"`);
    return viewArray(buf, s) as T;
  };
  return {
    year,
    n: info.n,
    lon: get('lon'),
    lat: get('lat'),
    day: get('day'),
    hhmm: get('hhmm'),
    sensor: get('sensor'),
    conf: get('conf'),
    frp: get('frp'),
    bright: get('bright'),
    flags: get('flags'),
    version: get('version'),
  };
}
