#!/usr/bin/env node
// Writes a synthetic, contract-conformant data bundle to web/public/data-mock/.
// It exists so the app can be built and tested before the pipeline bundle is ready.
// Everything here is invented: the regions are coarse rectangles clipped to a rough
// country outline, and the counts come from a seeded random model with plausible
// seasonality, a few anomalous events and the sensor step changes of the raw record.
//
//   node scripts/mock_bundle.mjs [outDir]

import { mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? join(here, '..', 'public', 'data-mock');

// ---------------------------------------------------------------- random numbers
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261115);
function gauss() {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function poisson(lambda) {
  if (lambda <= 0) return 0;
  if (lambda > 40) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

// ---------------------------------------------------------------- calendar
const START_YEAR = 2000;
const START_MONTH = 11; // 2000-11
const LAST = { year: 2026, month: 11 }; // partial month: data through mid-November
const N_MONTHS = (LAST.year - START_YEAR) * 12 + (LAST.month - START_MONTH) + 1;
const ym = (m) => {
  const t = START_MONTH - 1 + m;
  return { year: START_YEAR + Math.floor(t / 12), month: (t % 12) + 1 };
};
const mIndex = (year, month) => (year - START_YEAR) * 12 + (month - START_MONTH);
const label = (m) => {
  const { year, month } = ym(m);
  return `${year}-${String(month).padStart(2, '0')}`;
};
const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const dayOfYear = (year, month, day) =>
  Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000) + 1;

const AQUA_START = mIndex(2002, 7);
const SNPP_START = mIndex(2012, 1);
const N20_START = mIndex(2018, 4); // NOAA-20 archive starts 2018-04
const SNPP_GAP = mIndex(2022, 8);

// ---------------------------------------------------------------- availability
const avail = {
  modis_terra: new Array(N_MONTHS).fill(1),
  modis_aqua: new Array(N_MONTHS).fill(0),
  viirs_snpp: new Array(N_MONTHS).fill(0),
  viirs_noaa20: new Array(N_MONTHS).fill(0),
};
for (let m = 0; m < N_MONTHS; m++) {
  if (m >= AQUA_START) avail.modis_aqua[m] = 1;
  if (m >= SNPP_START) avail.viirs_snpp[m] = 1;
  if (m >= N20_START) avail.viirs_noaa20[m] = 1;
}
avail.modis_terra[mIndex(2001, 6)] = 0.5; // Terra outage, June 2001
avail.modis_terra[mIndex(2001, 7)] = 0.9;
avail.modis_aqua[AQUA_START] = 0.9; // from 4 July 2002
avail.viirs_snpp[SNPP_START] = 0.39; // from 20 January 2012
avail.viirs_snpp[mIndex(2022, 7)] = 0.9;
avail.viirs_snpp[SNPP_GAP] = 0.35; // S-NPP safe hold; NOAA-20 fills the gap
const partial = 14 / 30;
for (const k of Object.keys(avail)) avail[k][N_MONTHS - 1] *= partial;

const monthSource = new Array(N_MONTHS);
for (let m = 0; m < N_MONTHS; m++) {
  if (m < AQUA_START) monthSource[m] = 'model_terra';
  else if (m < SNPP_START) monthSource[m] = 'model';
  else if (m === SNPP_GAP) monthSource[m] = 'viirs_fill';
  else monthSource[m] = 'viirs';
}

// ---------------------------------------------------------------- geography
const GRID = { res: 0.1, lon0: -74.0, lat0: -55.2, nx: 210, ny: 340 };

// A rough outline, good enough to make the map read as the right country.
const MAINLAND = [
  [-67.2, -22.0], [-65.8, -22.1], [-64.4, -22.6], [-63.9, -22.0], [-62.8, -22.0], [-61.0, -23.6],
  [-59.5, -24.4], [-57.6, -25.3], [-58.6, -27.3], [-56.4, -27.4], [-55.6, -27.4], [-54.7, -26.6],
  [-54.6, -25.6], [-53.7, -26.1], [-53.8, -27.2], [-55.2, -27.9], [-56.0, -28.6], [-57.6, -30.2],
  [-58.2, -32.4], [-58.4, -34.0], [-58.4, -34.6], [-57.2, -35.4], [-56.7, -36.3], [-57.0, -37.3],
  [-57.5, -38.0], [-58.7, -38.6], [-60.0, -38.9], [-62.0, -38.9], [-62.3, -39.8], [-62.1, -40.6],
  [-62.8, -41.0], [-65.0, -41.0], [-65.1, -42.0], [-64.0, -42.3], [-63.6, -42.6], [-64.4, -42.9],
  [-65.0, -43.6], [-65.3, -44.6], [-66.6, -45.1], [-67.5, -46.0], [-67.6, -46.6], [-66.4, -47.1],
  [-65.8, -47.8], [-66.8, -48.6], [-67.7, -49.3], [-68.5, -50.2], [-69.1, -51.0], [-68.9, -51.6],
  [-68.4, -52.3], [-69.5, -52.2], [-71.9, -52.0], [-72.3, -51.6], [-73.3, -50.6], [-73.4, -50.0],
  [-72.9, -49.3], [-72.4, -48.4], [-72.0, -47.7], [-71.9, -46.8], [-71.7, -45.9], [-71.6, -44.9],
  [-71.8, -44.0], [-72.0, -42.9], [-71.8, -42.0], [-71.7, -41.0], [-71.7, -40.0], [-71.4, -39.2],
  [-71.0, -38.3], [-70.9, -37.0], [-70.4, -36.0], [-70.0, -34.9], [-69.9, -34.0], [-69.8, -33.0],
  [-70.0, -32.0], [-70.3, -31.0], [-69.9, -30.0], [-69.6, -29.0], [-69.0, -28.0], [-68.4, -27.0],
  [-68.5, -26.0], [-68.4, -25.0], [-68.5, -24.0], [-67.3, -23.2],
];
const FUEGO = [[-68.6, -52.6], [-67.0, -53.0], [-65.3, -54.6], [-65.1, -54.9], [-66.5, -55.0], [-68.6, -54.9]];

// Synthetic regions: latitude bands split by meridians. Each entry:
// [name, lonMin, lonMax, latMin, latMax, annual VIIRS-equivalent hotspots, season peak month,
//  season concentration, VIIRS-per-MODIS multiplier]
const REGIONS = [
  ['Puna and Yungas', -75, -64.6, -26, -21.5, 6000, 9.0, 2.4, 1.0],
  ['Western Chaco', -64.6, -60.5, -26, -21.5, 9000, 8.6, 2.2, 0.95],
  ['Eastern Chaco', -60.5, -56.4, -26, -21.5, 8000, 8.2, 2.0, 1.05],
  ['Misiones', -56.4, -50, -26, -21.5, 3000, 8.8, 2.0, 1.15],
  ['Sierras and Valleys', -75, -64.8, -30.3, -26, 3000, 9.2, 2.6, 0.9],
  ['Southern Chaco', -64.8, -60.5, -30.3, -26, 9000, 8.0, 2.0, 1.0],
  ['Corrientes Wetlands', -60.5, -50, -30.3, -26, 5000, 8.6, 1.4, 1.2],
  ['Cuyo', -75, -66.5, -35, -30.3, 500, 12.6, 2.4, 0.85],
  ['Central Sierras', -66.5, -61.8, -35, -30.3, 3000, 8.8, 2.4, 0.9],
  ['Delta and Littoral', -61.8, -50, -35, -30.3, 6000, 7.6, 1.8, 1.3],
  ['Southern Cuyo', -75, -66, -39, -35, 600, 1.0, 2.4, 0.85],
  ['Western Pampas', -66, -61, -39, -35, 2500, 12.6, 2.2, 0.8],
  ['Eastern Pampas', -61, -50, -39, -35, 2500, 10.0, 1.0, 1.1],
  ['Northern Andean Patagonia', -75, -68, -42, -39, 300, 1.6, 2.8, 0.75],
  ['Northern Patagonian Steppe', -68, -50, -42, -39, 400, 1.0, 2.6, 0.8],
  ['Andean Patagonia', -75, -68.5, -46, -42, 400, 2.0, 2.8, 0.75],
  ['Central Patagonian Steppe', -68.5, -50, -46, -42, 150, 1.2, 2.6, 0.8],
  ['Southern Patagonia', -75, -50, -52.4, -46, 150, 1.2, 2.6, 0.8],
  ['Tierra del Fuego', -75, -50, -56, -52.4, 40, 1.5, 3.0, 0.8],
];
const regionId = (name) => REGIONS.findIndex((r) => r[0] === name);

// Anomalous events: [region, year, month, multiplier]
const EVENTS = [
  ['Delta and Littoral', 2008, 4, 9], ['Delta and Littoral', 2008, 5, 4],
  ['Delta and Littoral', 2020, 6, 4], ['Delta and Littoral', 2020, 7, 6], ['Delta and Littoral', 2020, 8, 7],
  ['Delta and Littoral', 2020, 9, 5], ['Delta and Littoral', 2022, 8, 5],
  ['Corrientes Wetlands', 2022, 1, 9], ['Corrientes Wetlands', 2022, 2, 12], ['Corrientes Wetlands', 2022, 3, 4],
  ['Central Sierras', 2020, 9, 4], ['Central Sierras', 2020, 10, 4], ['Central Sierras', 2013, 9, 3],
  ['Western Pampas', 2016, 12, 8], ['Western Pampas', 2017, 1, 7],
  ['Andean Patagonia', 2015, 2, 10], ['Andean Patagonia', 2015, 3, 5], ['Andean Patagonia', 2021, 3, 7],
  ['Andean Patagonia', 2025, 1, 9], ['Andean Patagonia', 2025, 2, 8],
  ['Northern Andean Patagonia', 2025, 1, 6], ['Northern Andean Patagonia', 2021, 3, 4],
  ['Puna and Yungas', 2023, 9, 3], ['Western Chaco', 2009, 9, 2.5], ['Eastern Chaco', 2009, 8, 2.5],
  ['Tierra del Fuego', 2023, 1, 8],
];
const eventFactor = new Map();
for (const [name, year, month, f] of EVENTS) eventFactor.set(`${regionId(name)}:${mIndex(year, month)}`, f);

// National dry and wet years shift every region a little.
const NATIONAL_YEAR = { 2003: 1.2, 2008: 1.35, 2009: 1.4, 2012: 0.85, 2014: 0.8, 2016: 0.85, 2020: 1.5, 2022: 1.35, 2023: 1.1 };

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Clip any polygon to an axis-aligned rectangle (Sutherland-Hodgman).
function clipToRect(poly, [x0, x1, y0, y1]) {
  const edges = [
    (p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= y0, (p) => p[1] <= y1,
  ];
  const cut = [
    (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])],
    (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1],
  ];
  let out = poly;
  for (let e = 0; e < 4; e++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const inCur = edges[e](cur);
      const inPrev = edges[e](prev);
      if (inCur) {
        if (!inPrev) out.push(cut[e](prev, cur));
        out.push(cur);
      } else if (inPrev) out.push(cut[e](prev, cur));
    }
    if (out.length === 0) break;
  }
  return out.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

// Smooth random field (bilinear value noise on a 1.5 degree lattice).
const LAT_STEP = 1.5;
const lattice = new Map();
const latticeValue = (i, j) => {
  const k = `${i},${j}`;
  if (!lattice.has(k)) lattice.set(k, gauss());
  return lattice.get(k);
};
function noise(lon, lat) {
  const u = (lon + 180) / LAT_STEP;
  const v = (lat + 90) / LAT_STEP;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const a = latticeValue(i, j) * (1 - fu) + latticeValue(i + 1, j) * fu;
  const b = latticeValue(i, j + 1) * (1 - fu) + latticeValue(i + 1, j + 1) * fu;
  return a * (1 - fv) + b * fv;
}

// ---------------------------------------------------------------- active cells
const cells = []; // { id, ix, iy, lon, lat, prov, w }
for (let iy = 0; iy < GRID.ny; iy++) {
  for (let ix = 0; ix < GRID.nx; ix++) {
    const lon = GRID.lon0 + (ix + 0.5) * GRID.res;
    const lat = GRID.lat0 + (iy + 0.5) * GRID.res;
    if (!pointInPolygon(lon, lat, MAINLAND) && !pointInPolygon(lon, lat, FUEGO)) continue;
    const prov = REGIONS.findIndex((r) => lon >= r[1] && lon < r[2] && lat >= r[3] && lat < r[4]);
    if (prov < 0) continue;
    const fine = noise(lon * 3.1, lat * 3.1) * 0.6;
    const w = Math.exp(1.25 * noise(lon, lat) + fine);
    cells.push({ id: iy * GRID.nx + ix, ix, iy, lon, lat, prov, w });
  }
}
// Normalise spatial weights so each region's weights sum to 1.
const wSum = new Array(REGIONS.length).fill(0);
for (const c of cells) wSum[c.prov] += c.w;
for (const c of cells) c.w /= wSum[c.prov];

// ---------------------------------------------------------------- seasonality
function seasonShape(peak, kappa, month) {
  const ang = ((month - peak) / 12) * 2 * Math.PI;
  return Math.exp(kappa * (Math.cos(ang) - 1)) + 0.04;
}
const seasonNorm = REGIONS.map((r) => {
  let s = 0;
  for (let mo = 1; mo <= 12; mo++) s += seasonShape(r[6], r[7], mo);
  return s;
});
const yearFactor = REGIONS.map(() => {
  const f = {};
  for (let y = START_YEAR; y <= LAST.year; y++) f[y] = Math.exp(0.3 * gauss()) * (NATIONAL_YEAR[y] ?? 1);
  return f;
});

// Detection ratios relative to an S-NPP-class VIIRS observer.
const R_TERRA = 0.13;
const R_AQUA = 0.17;
const R_N20 = 0.97;

// Expected VIIRS-equivalent count for a region-month.
function regionLambda(p, m) {
  const r = REGIONS[p];
  const { year, month } = ym(m);
  // Corrientes also has a summer burning season.
  let shape = seasonShape(r[6], r[7], month);
  if (r[0] === 'Corrientes Wetlands') shape += 0.35 * seasonShape(1.5, 2.5, month);
  return (r[5] * shape * yearFactor[p][year] * (eventFactor.get(`${p}:${m}`) ?? 1)) / seasonNorm[p];
}

// ---------------------------------------------------------------- simulate
console.log(`cells ${cells.length}, months ${N_MONTHS}`);
const entryMonth = [];
const entryH = [];
const entryT = [];
const entryA = [];
const entryS = [];
const entryN = [];
const cellStart = [0];
const regionLam = REGIONS.map((_, p) => Array.from({ length: N_MONTHS }, (_, m) => regionLambda(p, m)));

for (const c of cells) {
  const ratioMul = REGIONS[c.prov][8];
  for (let m = 0; m < N_MONTHS; m++) {
    const lam = regionLam[c.prov][m] * c.w;
    if (lam < 1e-4) continue;
    // Latent activity with extra-Poisson variation.
    const active = lam * Math.exp(0.5 * gauss() - 0.125);
    const { year } = ym(m);
    const terraDrift = year >= 2023 ? 0.85 : 1;
    const rT = (R_TERRA / ratioMul) * terraDrift;
    const rA = R_AQUA / ratioMul;
    const t = poisson(active * rT * avail.modis_terra[m]);
    const a = poisson(active * rA * avail.modis_aqua[m]);
    const s = poisson(active * avail.viirs_snpp[m]);
    const n = poisson(active * R_N20 * avail.viirs_noaa20[m]);
    let h = 0;
    const src = monthSource[m];
    if (src === 'viirs') h = s;
    else if (src === 'viirs_fill') h = s + ((1 - avail.viirs_snpp[m]) * n) / R_N20;
    else if (src === 'model') h = (0.5 * t) / (R_TERRA / ratioMul) + (0.5 * a) / rA;
    else if (src === 'model_terra') h = t / (R_TERRA / ratioMul);
    if (t === 0 && a === 0 && s === 0 && n === 0 && h === 0) continue;
    entryMonth.push(m);
    entryH.push(Math.round(h * 100) / 100);
    entryT.push(t);
    entryA.push(a);
    entryS.push(s);
    entryN.push(n);
  }
  cellStart.push(entryMonth.length);
}
const nEntries = entryMonth.length;
console.log(`entries ${nEntries}`);

// ---------------------------------------------------------------- binary writer
function packArrays(specs) {
  // specs: [{ name, dtype, values }]; every array starts at a 4-byte boundary.
  const size = { uint8: 1, uint16: 2, uint32: 4, float32: 4 };
  let offset = 0;
  const layout = specs.map((s) => {
    const o = offset;
    offset += s.values.length * size[s.dtype];
    offset = Math.ceil(offset / 4) * 4;
    return { name: s.name, dtype: s.dtype, offset: o, length: s.values.length };
  });
  const buf = new ArrayBuffer(offset);
  specs.forEach((s, i) => {
    const { offset: o, length } = layout[i];
    const Ctor = { uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array, float32: Float32Array }[s.dtype];
    new Ctor(buf, o, length).set(s.values);
  });
  return { buf: Buffer.from(buf), layout };
}

// Clear the directory's contents but keep the directory, so a running dev server keeps serving it.
mkdirSync(join(OUT, 'points'), { recursive: true });
for (const f of readdirSync(OUT)) if (f !== 'points') rmSync(join(OUT, f), { recursive: true, force: true });
for (const f of readdirSync(join(OUT, 'points'))) rmSync(join(OUT, 'points', f), { force: true });

const table = packArrays([
  { name: 'cell_id', dtype: 'uint32', values: cells.map((c) => c.id) },
  { name: 'cell_province', dtype: 'uint8', values: cells.map((c) => c.prov) },
  { name: 'cell_start', dtype: 'uint32', values: cellStart },
  { name: 'month', dtype: 'uint16', values: entryMonth },
  { name: 'harmonized', dtype: 'float32', values: entryH },
  { name: 'modis_terra', dtype: 'uint16', values: entryT },
  { name: 'modis_aqua', dtype: 'uint16', values: entryA },
  { name: 'viirs_snpp', dtype: 'uint16', values: entryS },
  { name: 'viirs_noaa20', dtype: 'uint16', values: entryN },
]);
writeFileSync(join(OUT, 'table.bin.gz'), gzipSync(table.buf, { level: 6 }));

// ---------------------------------------------------------------- raw points
const VERSIONS = ['2', '6.03', '6.2', '61.03'];
const modisVersion = (year) => (year <= 2017 ? 2 : year <= 2022 ? 1 : 3);
const pointsIndex = { versions: VERSIONS, sensors: { 0: 'Terra', 1: 'Aqua', 2: 'N', 3: 'N20' }, years: {} };
const OVERPASS = {
  // local solar hours of day and night passes
  0: [10.5, 22.5], 1: [13.5, 1.5], 2: [13.4, 1.4], 3: [12.6, 0.6],
};

const byYear = new Map();
const pushPoint = (year, rec) => {
  if (!byYear.has(year)) byYear.set(year, []);
  byYear.get(year).push(rec);
};
for (let i = 0; i < cells.length; i++) {
  const c = cells[i];
  for (let e = cellStart[i]; e < cellStart[i + 1]; e++) {
    const m = entryMonth[e];
    const { year, month } = ym(m);
    const counts = [entryT[e], entryA[e], entryS[e], entryN[e]];
    for (let sensor = 0; sensor < 4; sensor++) {
      const n = counts[sensor];
      const extra = poisson(n * 0.12); // low-confidence detections, kept in the CSV but not counted
      for (let k = 0; k < n + extra; k++) {
        const used = k < n;
        const isViirs = sensor >= 2;
        const night = rand() < (sensor === 0 ? 0.18 : 0.12);
        // keep 1e-4 degrees inside the cell so float32 storage cannot move a point across an edge
        const lon = c.lon - GRID.res / 2 + 1e-4 + rand() * (GRID.res - 2e-4);
        const lat = c.lat - GRID.res / 2 + 1e-4 + rand() * (GRID.res - 2e-4);
        const lst = OVERPASS[sensor][night ? 1 : 0] + (rand() - 0.5) * 1.2;
        const utc = (((lst - lon / 15) % 24) + 24) % 24;
        const hh = Math.floor(utc);
        const mm = Math.floor((utc - hh) * 60);
        const maxDay = m === N_MONTHS - 1 ? 14 : daysIn(year, month);
        const day = dayOfYear(year, month, 1 + Math.floor(rand() * maxDay));
        const conf = isViirs
          ? used ? (rand() < 0.75 ? 2 : 3) : 1
          : used ? 30 + Math.floor(rand() * 71) : Math.floor(rand() * 30);
        const frp = Math.exp((isViirs ? 1.6 : 2.9) + 1.0 * gauss());
        const bright = isViirs ? 300 + rand() * 67 : 305 + Math.abs(gauss()) * 25;
        const version = isViirs ? 0 : modisVersion(year);
        pushPoint(year, [lon, lat, day, hh * 100 + mm, sensor, conf, frp, bright, (night ? 1 : 0) | (used ? 2 : 0), version]);
      }
    }
  }
}
let totalPoints = 0;
const years = [...byYear.keys()].sort((a, b) => a - b);
for (const year of years) {
  const recs = byYear.get(year);
  // Sort by day then time, like an archive download.
  recs.sort((a, b) => a[2] - b[2] || a[3] - b[3]);
  const col = (j) => recs.map((r) => r[j]);
  const packed = packArrays([
    { name: 'lon', dtype: 'float32', values: col(0) },
    { name: 'lat', dtype: 'float32', values: col(1) },
    { name: 'day', dtype: 'uint16', values: col(2) },
    { name: 'hhmm', dtype: 'uint16', values: col(3) },
    { name: 'sensor', dtype: 'uint8', values: col(4) },
    { name: 'conf', dtype: 'uint8', values: col(5) },
    { name: 'frp', dtype: 'float32', values: col(6) },
    { name: 'bright', dtype: 'float32', values: col(7) },
    { name: 'flags', dtype: 'uint8', values: col(8) },
    { name: 'version', dtype: 'uint8', values: col(9) },
  ]);
  const gz = gzipSync(packed.buf, { level: 6 });
  writeFileSync(join(OUT, 'points', `${year}.bin.gz`), gz);
  pointsIndex.years[String(year)] = { n: recs.length, bytes: gz.length, arrays: packed.layout };
  totalPoints += recs.length;
}
writeFileSync(join(OUT, 'points', 'index.json'), JSON.stringify(pointsIndex));
console.log(`points ${totalPoints}`);

// ---------------------------------------------------------------- boundaries
const features = REGIONS.map((r, id) => {
  const rect = [r[1], r[2], r[3], r[4]];
  const parts = [MAINLAND, FUEGO]
    .map((poly) => clipToRect(poly, rect))
    .filter((ring) => ring.length >= 3)
    .map((ring) => [[...ring, ring[0]]]);
  return {
    type: 'Feature',
    properties: { id, name: r[0] },
    geometry: { type: 'MultiPolygon', coordinates: parts },
  };
});
writeFileSync(join(OUT, 'provinces.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));

// ---------------------------------------------------------------- national aggregates
const nat = { h: new Float64Array(N_MONTHS), t: new Float64Array(N_MONTHS), a: new Float64Array(N_MONTHS), s: new Float64Array(N_MONTHS), n: new Float64Array(N_MONTHS) };
const provMod = REGIONS.map(() => ({ modis: 0, viirs: 0 }));
for (let i = 0; i < cells.length; i++) {
  for (let e = cellStart[i]; e < cellStart[i + 1]; e++) {
    const m = entryMonth[e];
    nat.h[m] += entryH[e];
    nat.t[m] += entryT[e];
    nat.a[m] += entryA[e];
    nat.s[m] += entryS[e];
    nat.n[m] += entryN[e];
    const { year } = ym(m);
    if (year >= 2012 && year <= 2021 && monthSource[m] === 'viirs') {
      provMod[cells[i].prov].modis += entryT[e] + entryA[e];
      provMod[cells[i].prov].viirs += entryS[e];
    }
  }
}

const UNC = {
  z80: 1.2816,
  points: [[1, 0.9], [10, 0.6], [100, 0.35], [1000, 0.2], [10000, 0.12]],
  points_terra_only: [[1, 1.1], [10, 0.75], [100, 0.45], [1000, 0.27], [10000, 0.17]],
};
function sOf(x, pts = UNC.points) {
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  const lx = Math.log10(x);
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const a = Math.log10(pts[i - 1][0]);
      const b = Math.log10(pts[i][0]);
      return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (lx - a)) / (b - a);
    }
  }
  return pts[pts.length - 1][1];
}

const overlapMonths = [];
for (let m = SNPP_START; m < N_MONTHS; m++) if (ym(m).year <= 2025) overlapMonths.push(m);
const round1 = (x) => Math.round(x * 10) / 10;
const ratioGlobal =
  overlapMonths.reduce((s, m) => s + nat.s[m], 0) / overlapMonths.reduce((s, m) => s + nat.t[m] + nat.a[m], 0);

const annualYears = [];
for (let y = 2001; y <= 2025; y++) annualYears.push(y);
const sumYear = (arr, y) => {
  let s = 0;
  for (let mo = 1; mo <= 12; mo++) s += arr[mIndex(y, mo)];
  return s;
};
const annual = { years: annualYears, naive_merge: [], modis_only: [], harmonized: [], harmonized_lo: [], harmonized_hi: [], viirs_snpp: [] };
for (const y of annualYears) {
  annual.naive_merge.push(Math.round(sumYear(nat.t, y) + sumYear(nat.a, y) + sumYear(nat.s, y) + sumYear(nat.n, y)));
  annual.modis_only.push(Math.round(sumYear(nat.t, y) + sumYear(nat.a, y)));
  annual.harmonized.push(Math.round(sumYear(nat.h, y)));
  let lo = 0;
  let hi = 0;
  for (let mo = 1; mo <= 12; mo++) {
    const m = mIndex(y, mo);
    const x = nat.h[m];
    const s = monthSource[m].startsWith('model') ? sOf(x, monthSource[m] === 'model_terra' ? UNC.points_terra_only : UNC.points) : 0;
    lo += s > 0 ? Math.max(0, (x + 0.5) * Math.exp(-UNC.z80 * s) - 0.5) : x;
    hi += s > 0 ? (x + 0.5) * Math.exp(UNC.z80 * s) - 0.5 : x;
  }
  annual.harmonized_lo.push(Math.round(lo));
  annual.harmonized_hi.push(Math.round(hi));
  annual.viirs_snpp.push(y >= 2012 ? Math.round(sumYear(nat.s, y)) : null);
}

function mockMetrics() {
  const rows = [];
  const base = { none: [1.38, -78.2, 0.86, 0.71, 0.82, 0.55], ratio: [0.62, 3.1, 0.86, 0.71, 0.82, 0.55], ratio_local: [0.5, 2.0, 0.89, 0.76, 0.86, 0.62], gbm: [0.41, 1.2, 0.91, 0.82, 0.9, 0.7] };
  const tests = { loyo: 1, backcast: 1.06, loro: 1.15, forward: 1.1 };
  const levels = { 'cell-month': 1.6, 'block-month': 1.25, 'province-month': 1, 'national-month': 0.6 };
  for (const variant of ['terra_aqua', 'terra_only']) {
    for (const [test, tf] of Object.entries(tests)) {
      for (const [level, lf] of Object.entries(levels)) {
        for (const [method, b] of Object.entries(base)) {
          const vf = variant === 'terra_only' ? 1.12 : 1;
          const r = { variant, method, test, level, log_rmse: Math.round(b[0] * tf * lf * vf * 100) / 100, bias_pct: Math.round(b[1] * tf * 10) / 10, spearman: Math.round(Math.min(0.99, b[2] / Math.sqrt(lf)) * 100) / 100, anomaly_agreement: Math.round((b[3] / tf) * 100) / 100, n: level === 'cell-month' ? 412000 : level === 'block-month' ? 18200 : level === 'province-month' ? 1728 : 72 };
          if (level === 'province-month' || level === 'national-month') {
            r.season_r = Math.round((b[4] / tf) * 100) / 100;
            r.peak_match = Math.round((b[5] / tf) * 100) / 100;
          }
          rows.push(r);
        }
      }
    }
  }
  return rows;
}

const validation = {
  synthetic: true,
  protocol: [
    'Synthetic demonstration values. The real evaluation replaces this file when the pipeline runs.',
    'Each method predicts the VIIRS S-NPP count of a province-month from the MODIS counts of the same province-month. Years in the VIIRS era are held out one at a time, so every prediction is made by a model that never saw that year.',
  ],
  methods: [
    { id: 'none', label: 'No harmonization', description: 'MODIS counts used as they are.' },
    { id: 'ratio', label: 'Single ratio', description: 'MODIS counts multiplied by one national VIIRS-to-MODIS ratio.' },
    { id: 'ratio_local', label: 'Local ratio', description: 'A ratio for each cell, pulled toward its block and the national value when the cell has few detections.' },
    { id: 'gbm', label: 'Transfer model', description: 'Gradient-boosted trees using MODIS counts, fire radiative power, neighbouring cells, season and position.' },
  ],
  tests: [
    { id: 'loyo', label: 'Leave one year out, 2012-2017', description: 'Train on five overlap years, predict the sixth.' },
    { id: 'backcast', label: 'Backcast, 2012-2014', description: 'Train on 2015-2017, predict 2012-2014.' },
    { id: 'loro', label: 'Leave one region out', description: 'Train without one macro-region, predict it.' },
    { id: 'forward', label: 'Forward, 2018-2021', description: 'Train on 2012-2017, predict across the MODIS version change.' },
  ],
  metrics: mockMetrics(),
  metric_defs: {
    log_rmse: 'Root mean square error of log(1 + count). 0.4 means a typical error of about 50 percent.',
    bias_pct: 'Total predicted minus total observed, as a percent of observed.',
    spearman: 'Rank correlation between predicted and observed counts.',
    anomaly_agreement: 'Share of months where predicted and observed counts fall in the same anomaly class.',
    season_r: 'Rank correlation of the twelve monthly values within each region and year.',
    peak_match: 'Share of region-years where the method picks the same peak month as VIIRS.',
  },
  chosen_method: 'gbm',
  national_series: {
    months: overlapMonths.map(label),
    viirs_snpp: overlapMonths.map((m) => nat.s[m]),
    modis_terra: overlapMonths.map((m) => nat.t[m]),
    modis_aqua: overlapMonths.map((m) => nat.a[m]),
    predicted: {
      ratio: overlapMonths.map((m) => Math.round((nat.t[m] + nat.a[m]) * ratioGlobal * Math.exp(0.25 * gauss()))),
      gbm: overlapMonths.map((m) => Math.round(nat.s[m] * Math.exp(0.12 * gauss()))),
    },
  },
  annual_national: annual,
  ratio_by_year: {
    years: annualYears.filter((y) => y >= 2012),
    viirs_per_modis: annualYears
      .filter((y) => y >= 2012)
      .map((y) => round1(sumYear(nat.s, y) / Math.max(1, sumYear(nat.t, y) + sumYear(nat.a, y)))),
  },
  uncertainty: { points: UNC.points, points_terra_only: UNC.points_terra_only, coverage80: { backcast: 0.81, loyo: 0.79 } },
  noaa20_per_snpp: 0.96,
  outages: { Terra: [['2001-06-15', '2001-07-02']], Aqua: [], 'S-NPP': [['2022-07-27', '2022-08-10']], 'NOAA-20': [] },
  feature_gain: { modis_count: 5120.4, frp_mean: 1630.2, small_share: 1210.7, neigh_3x3: 980.1, neigh_7x7: 760.5, month: 540.3, lat: 410.9, lon: 380.2, longrun_modis: 300.4, past_ratio: 290.1, night_share: 150.6 },
  ratio_by_province: REGIONS.map((r, id) => ({
    province: id,
    name: r[0],
    viirs_per_modis: round1(provMod[id].viirs / Math.max(1, provMod[id].modis)),
    n_modis: provMod[id].modis,
  })),
};
writeFileSync(join(OUT, 'validation.json'), JSON.stringify(validation));

// ---------------------------------------------------------------- manifest
const labels = Array.from({ length: N_MONTHS }, (_, m) => label(m));
const manifest = {
  version: 1,
  generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  synthetic: true,
  country: 'Argentina',
  bbox: [-73.6, -55.1, -53.6, -21.8],
  grid: GRID,
  months: { start: labels[0], n: N_MONTHS, labels, last_complete: labels[N_MONTHS - 2] },
  series: [
    { id: 'harmonized', label: 'Harmonized (VIIRS-equivalent)', dtype: 'float32' },
    { id: 'modis_terra', label: 'MODIS Terra', dtype: 'uint16', first: labels[0], last: labels[N_MONTHS - 1] },
    { id: 'modis_aqua', label: 'MODIS Aqua', dtype: 'uint16', first: label(AQUA_START), last: labels[N_MONTHS - 1] },
    { id: 'viirs_snpp', label: 'VIIRS S-NPP', dtype: 'uint16', first: label(SNPP_START), last: labels[N_MONTHS - 1] },
    { id: 'viirs_noaa20', label: 'VIIRS NOAA-20', dtype: 'uint16', first: label(N20_START), last: labels[N_MONTHS - 1] },
  ],
  availability: avail,
  month_source: monthSource,
  uncertainty: UNC,
  provinces: REGIONS.map((r, id) => ({ id, name: r[0] })),
  presets: [
    { id: 'country', name: 'All of Argentina', name_es: 'Toda la Argentina', kind: 'all' },
    { id: 'delta', name: 'Paraná Delta', name_es: 'Delta del Paraná', kind: 'bbox', bbox: [-60.9, -34.4, -58.4, -32.0] },
    { id: 'corrientes', name: 'Corrientes Wetlands', kind: 'province', province: regionId('Corrientes Wetlands') },
    { id: 'andean', name: 'Andean Patagonia', kind: 'bbox', bbox: [-72.2, -46.0, -70.8, -40.5] },
  ],
  baseline: { first_year: 2001, last_year: 2025 },
  table: { file: 'table.bin.gz', n_cells: cells.length, n_entries: nEntries, arrays: table.layout },
  points: { years: [years[0], years[years.length - 1]], file_pattern: 'points/{year}.bin.gz', index: 'points/index.json' },
  boundaries: 'provinces.geojson',
  validation: 'validation.json',
  sources: [
    { name: 'Synthetic demonstration data (not real observations)', url: '' },
    { name: 'NASA FIRMS MODIS C6.1 (MCD14ML)', doi: '10.5067/FIRMS/MODIS/MCD14ML', url: 'https://firms.modaps.eosdis.nasa.gov/' },
    { name: 'NASA FIRMS VIIRS S-NPP 375 m (VNP14IMGT)', doi: '10.5067/FIRMS/VIIRS/VNP14IMGT.002', url: 'https://firms.modaps.eosdis.nasa.gov/' },
    { name: 'NASA FIRMS VIIRS NOAA-20 375 m (VJ114IMGT)', doi: '10.5067/FIRMS/VIIRS/VJ114IMGT.002', url: 'https://firms.modaps.eosdis.nasa.gov/' },
  ],
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));
console.log(`wrote ${OUT} (table ${(table.buf.length / 1e6).toFixed(1)} MB)`);
