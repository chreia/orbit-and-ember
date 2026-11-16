// Unit tests for the analysis modules. Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAxis, yearOf, monthOf, indexOf, labelOf } from '../src/lib/months.ts';
import { median, mad, quantile } from '../src/lib/stats.ts';
import { spreadFor, interval80, aggregate, cellTotals } from '../src/lib/series.ts';
import { computeBaseline, zScore, classify, fireSeason, comparePeriod, stepRatio, annualTotals, latestMonth, readMonth, recordMonths, zForDisplay } from '../src/lib/analytics.ts';
import type { Observability } from '../src/lib/analytics.ts';
import { logBreaks, binIndex, inkOn } from '../src/lib/color.ts';
import { haversineKm, circleRing, cellIdAt, cellCentre, POINT_TOL } from '../src/lib/region.ts';
import { csvRow } from '../src/lib/csv.ts';
import type { Table } from '../src/bundle/table.ts';

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('month axis arithmetic', () => {
  const ax = makeAxis('2000-11', 302);
  assert.equal(yearOf(ax, 0), 2000);
  assert.equal(monthOf(ax, 0), 11);
  assert.equal(monthOf(ax, 2), 1);
  assert.equal(yearOf(ax, 2), 2001);
  assert.equal(labelOf(ax, 301), '2025-12');
  assert.equal(indexOf(ax, 2012, 1), 134);
  assert.equal(indexOf(ax, 2000, 1), -10);
});

test('median, quantile and MAD', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2);
  assert.equal(mad([1, 1, 2, 2, 4, 6, 9]), 1);
  assert.ok(Number.isNaN(median([])));
});

test('uncertainty spread interpolates in log10(x)', () => {
  const pts: [number, number][] = [[1, 0.9], [10, 0.6], [100, 0.35]];
  near(spreadFor(1, pts), 0.9);
  near(spreadFor(0.5, pts), 0.9);
  near(spreadFor(Math.sqrt(10), pts), 0.75);
  near(spreadFor(1000, pts), 0.35);
  const unc = { z80: 1.2816, points: pts };
  const [lo, hi] = interval80(10, 'model', unc);
  near(lo, 10.5 * Math.exp(-1.2816 * 0.6) - 0.5);
  near(hi, 10.5 * Math.exp(1.2816 * 0.6) - 0.5);
  assert.deepEqual(interval80(10, 'viirs', unc), [10, 10]);
  // a zero model total still has an upper bound, and lower bounds never go below zero
  const [lo0, hi0] = interval80(0, 'model', unc);
  assert.equal(lo0, 0);
  near(hi0, 0.5 * Math.exp(1.2816 * 0.9) - 0.5);
  assert.equal(interval80(0.2, 'model_terra', unc)[0], 0);
});

// A synthetic series: 26 years starting January 2000 with a fixed seasonal shape.
function seasonal(years: number, peakMonth: number) {
  const ax = makeAxis('2000-01', years * 12);
  const v = new Float64Array(ax.n);
  for (let m = 0; m < ax.n; m++) {
    const c = monthOf(ax, m);
    const d = (c - peakMonth + 12) % 12;
    v[m] = d === 0 ? 1000 : d === 1 || d === 11 ? 300 : 10;
  }
  return { ax, v };
}
const allObserved = (n: number, partialFrom = Infinity): Observability => ({
  observed: (m) => m >= 0 && m < n,
  availability: () => 1,
  partial: (m) => m >= partialFrom,
});

test('baseline, z score and classes', () => {
  const { ax, v } = seasonal(26, 9);
  // add variation so MAD is non-zero
  for (let m = 0; m < ax.n; m++) v[m] *= 1 + 0.1 * (yearOf(ax, m) % 3);
  const obs = allObserved(ax.n);
  const base = computeBaseline(v, ax, obs, 2001, 2025);
  assert.equal(base.months[8].values.length, 25);
  const b = base.months[8];
  const z = zScore(b.median, b);
  near(z, 0, 1e-6);
  assert.equal(classify(2), 'far_above');
  assert.equal(classify(1.5), 'above');
  assert.equal(classify(1), 'above');
  assert.equal(classify(0.99), 'normal');
  assert.equal(classify(-1), 'normal');
  assert.equal(classify(-1.01), 'below');
  assert.equal(classify(NaN), null);
  // a tenfold month is far above normal
  assert.equal(classify(zScore(b.median * 10, b)), 'far_above');
  // the spread has a floor of 0.3 on the log scale
  assert.ok(b.scale >= 0.3);
});

test('minimum excess keeps sparse months normal', () => {
  // a region with almost no fires: one hotspot in one January
  const ax = makeAxis('2000-01', 26 * 12);
  const v = new Float64Array(ax.n);
  v[indexOf(ax, 2020, 1)] = 1;
  v[indexOf(ax, 2021, 1)] = 12;
  const base = computeBaseline(v, ax, allObserved(ax.n), 2001, 2025);
  const one = readMonth(v, ax, base, indexOf(ax, 2020, 1));
  assert.ok(one.z > 2); // z alone would say far above
  assert.equal(one.cls, 'normal'); // but 1 hotspot is within 5 of the median (0)
  const twelve = readMonth(v, ax, base, indexOf(ax, 2021, 1));
  assert.equal(twelve.cls, 'far_above');
});

test('terra-only months use their own uncertainty table', () => {
  const unc = { z80: 1.2816, points: [[1, 0.5], [100, 0.2]] as [number, number][], points_terra_only: [[1, 0.9], [100, 0.4]] as [number, number][] };
  const [loM] = interval80(100, 'model', unc);
  const [loT] = interval80(100, 'model_terra', unc);
  assert.ok(loT < loM);
  near(loT, 100.5 * Math.exp(-1.2816 * 0.4) - 0.5);
});

test('raw detections use the pipeline cell rule on float32 coordinates', () => {
  const grid = { res: 0.1, lon0: -73.6, lat0: -55.0, nx: 200, ny: 333 };
  // the pipeline: ix = floor((lon32 - lon0) / res + 1e-9) in float64
  for (const [lon, lat] of [[-60.2, -30.0], [-58.45678, -27.12345], [-73.6, -55.0], [-64.3, -31.4]]) {
    const lon32 = Math.fround(lon);
    const lat32 = Math.fround(lat);
    const ix = Math.floor((lon32 - grid.lon0) / grid.res + 1e-9);
    const iy = Math.floor((lat32 - grid.lat0) / grid.res + 1e-9);
    assert.equal(cellIdAt(lon32, lat32, grid, POINT_TOL), iy * grid.nx + ix);
  }
});

test('partial months stay out of the baseline', () => {
  const { ax, v } = seasonal(26, 9);
  const obs = allObserved(ax.n, indexOf(ax, 2010, 1));
  const base = computeBaseline(v, ax, obs, 2001, 2025);
  assert.equal(base.months[0].values.length, 9); // 2001..2009
});

test('fire season finds the shortest run holding 80 percent', () => {
  const { ax, v } = seasonal(26, 9); // Aug 300, Sep 1000, Oct 300, others 10
  const base = computeBaseline(v, ax, allObserved(ax.n), 2001, 2025);
  const s = fireSeason(base);
  assert.ok(s);
  // total = 1600 + 9*10 = 1690; Sep alone = 59%, Aug-Sep 77%, Aug-Oct 95%
  assert.equal(s.start, 8);
  assert.equal(s.length, 3);
  assert.equal(s.peak, 9);
  // wrapping season (peak in January)
  const w = seasonal(26, 1);
  const bw = computeBaseline(w.v, w.ax, allObserved(w.ax.n), 2001, 2025);
  const sw = fireSeason(bw);
  assert.ok(sw);
  assert.equal(sw.length, 1 + 2); // Dec, Jan, Feb
  assert.equal(sw.start, 12);
});

test('period comparison against the same window in baseline years', () => {
  const { ax, v } = seasonal(26, 9);
  const obs = allObserved(ax.n);
  const base = computeBaseline(v, ax, obs, 2001, 2025);
  const m0 = indexOf(ax, 2020, 8);
  const m1 = indexOf(ax, 2020, 10);
  v[indexOf(ax, 2020, 9)] = 3000;
  const c = comparePeriod(v, ax, obs, base, m0, m1);
  assert.equal(c.kind, 'window');
  assert.equal(c.total, 3600);
  assert.equal(c.typical, 1600);
  near(c.pct, 225);
  const long = comparePeriod(v, ax, obs, base, indexOf(ax, 2019, 1), indexOf(ax, 2020, 12));
  assert.equal(long.kind, 'annualized');
});

test('step ratio across a sensor change', () => {
  const ax = makeAxis('2006-01', 12 * 12);
  const v = new Float64Array(ax.n);
  for (let m = 0; m < ax.n; m++) v[m] = yearOf(ax, m) >= 2012 ? 30 : 10;
  const annual = annualTotals(v, ax, allObserved(ax.n));
  const r = stepRatio(annual, 2012);
  assert.ok(r);
  near(r.ratio, 3);
  assert.equal(stepRatio(annual, 2007), null); // not enough years before
});

test('latest month skips a trailing partial month', () => {
  const ax = makeAxis('2020-01', 24);
  const l = latestMonth(ax, allObserved(ax.n, 23));
  assert.deepEqual(l, { m: 22, partialM: 23 });
});

test('aggregate and cellTotals over a tiny CSR table', () => {
  const table: Table = {
    nCells: 2,
    nEntries: 3,
    cellId: Uint32Array.from([5, 9]),
    cellProvince: Uint8Array.from([0, 1]),
    cellStart: Uint32Array.from([0, 2, 3]),
    month: Uint16Array.from([0, 2, 2]),
    harmonized: Float32Array.from([1.5, 2, 4]),
    raw: {
      modis_terra: Uint16Array.from([1, 0, 2]),
      modis_aqua: Uint16Array.from([0, 1, 0]),
      viirs_snpp: Uint16Array.from([0, 3, 5]),
      viirs_noaa20: Uint16Array.from([0, 0, 1]),
    },
  };
  const s = aggregate(table, [0, 1], 3);
  assert.deepEqual([...s.harmonized], [1.5, 0, 6]);
  assert.deepEqual([...s.naive], [1, 0, 12]);
  const one = aggregate(table, [1], 3);
  assert.deepEqual([...one.raw.viirs_snpp], [0, 0, 5]);
  assert.deepEqual([...cellTotals(table, 'harmonized', 1, 2)], [2, 4]);
  assert.deepEqual([...cellTotals(table, 'naive', 0, 0)], [1, 0]);
});

test('log breaks and bins', () => {
  assert.deepEqual(logBreaks(40), [2, 3, 5, 10, 20, 30]);
  assert.deepEqual(logBreaks(73000, 2400), [3000, 5000, 10000, 20000, 30000, 50000]);
  assert.deepEqual(logBreaks(2000, 3), [10, 30, 100, 300, 1000]);
  const fine = logBreaks(4000, 1500);
  assert.ok(fine.length + 1 >= 4, `too few classes: ${fine}`);
  const b = logBreaks(250000);
  assert.ok(b.length <= 7);
  assert.ok(b[0] > 1);
  assert.equal(binIndex(0.5, [1, 10]), 0);
  assert.equal(binIndex(1, [1, 10]), 1);
  assert.equal(binIndex(50, [1, 10]), 2);
  assert.equal(inkOn('#ffeda0'), '#07173F');
  assert.equal(inkOn('#800026'), '#ffffff');
});

test('geometry helpers', () => {
  near(haversineKm(0, 0, 1, 0), 111.195, 0.01);
  const ring = circleRing(-60, -30, 50);
  for (const [lon, lat] of ring.slice(0, -1)) near(haversineKm(-60, -30, lon, lat), 50, 0.05);
  const grid = { res: 0.1, lon0: -74, lat0: -55.2, nx: 210, ny: 340 };
  const id = cellIdAt(-60.05, -30.05, grid);
  const [cx, cy] = cellCentre(id, grid);
  near(cx, -60.05, 1e-9);
  near(cy, -30.05, 1e-9);
  assert.equal(cellIdAt(-80, -30, grid), -1);
});

test('csv quoting', () => {
  assert.equal(csvRow(['a', 'b,c', 'say "hi"', 1.5, null, NaN]), 'a,"b,c","say ""hi""",1.5,,');
});

test('gzip payloads are decompressed only when the magic bytes are present', async () => {
  const { gzipSync } = await import('node:zlib');
  const { gunzipIfNeeded } = await import('../src/bundle/gunzip.ts');
  const raw = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const gz = gzipSync(raw);
  const out1 = new Uint8Array(await gunzipIfNeeded(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)));
  assert.deepEqual([...out1], [...raw]);
  const out2 = new Uint8Array(await gunzipIfNeeded(raw.buffer));
  assert.deepEqual([...out2], [...raw]);
});

test('record months are the strict maximum of their calendar month', () => {
  const ax = makeAxis('2000-01', 5 * 12);
  const v = new Float64Array(ax.n).fill(10);
  v[indexOf(ax, 2003, 2)] = 99; // record February
  v[indexOf(ax, 2001, 3)] = 3; // March: all 10 except one low -> ties at 10, no record
  const rec = recordMonths(v, ax, allObserved(ax.n));
  assert.ok(rec.has(indexOf(ax, 2003, 2)));
  assert.equal(rec.size, 1);
});

test('z for display never crosses a class threshold', () => {
  assert.equal(zForDisplay(1.96), 1.9);
  assert.equal(classify(1.96), 'above');
  assert.equal(zForDisplay(2), 2);
  assert.equal(zForDisplay(-1.04), -1.1);
  assert.equal(classify(-1.04), 'below');
  assert.equal(zForDisplay(-0.96), -1);
  assert.equal(classify(-0.96), 'normal');
});

import { acceptClick, guardConsumed, guardDown, newClickGuard } from '../src/lib/gesture.ts';

test('map clicks after a drag or a drawn rectangle are ignored', () => {
  const g = newClickGuard();
  guardDown(g, { x: 100, y: 100 });
  assert.equal(acceptClick(g, { x: 102, y: 101 }), true); // a plain click
  guardDown(g, { x: 100, y: 100 });
  assert.equal(acceptClick(g, { x: 160, y: 150 }), false); // the click that ends a drag
  guardDown(g, { x: 100, y: 100 });
  guardConsumed(g); // a tiny rectangle was drawn
  assert.equal(acceptClick(g, { x: 101, y: 100 }), false);
  assert.equal(acceptClick(g, { x: 101, y: 100 }), true); // consumed once only
});
