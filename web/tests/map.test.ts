// Unit tests for the map engine's pure parts: scrubber windows, per-cell values and scales, terrain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playNext, playStart, runs, scrubKeyStep, windowEndingAt, windowOfLength } from '../src/lib/timeline.ts';
import { blockInRegion, blockSize, blockValues, cellBlocks, cellExcess, cellMeans, cellTotal, cellMonthMedians, cellMonthRange, cellUsual, columnHeight, excessBreaks, niceStep, observedMonths } from '../src/lib/cells.ts';
import { checkMeta, elevationAt, elevationBilinear, NODATA, parseTerrain, terrariumTile } from '../src/lib/terrain.ts';
import { makeAxis, indexOf } from '../src/lib/months.ts';
import type { Observability } from '../src/lib/analytics.ts';
import type { Table } from '../src/bundle/table.ts';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const allObs = (n: number): Observability => ({
  observed: (m) => m >= 0 && m < n,
  availability: () => 1,
  partial: () => false,
});

test('scrubber windows keep their length and stay inside the record', () => {
  assert.deepEqual(windowEndingAt([10, 10], 40, 100), [40, 40]);
  assert.deepEqual(windowEndingAt([0, 11], 50, 100), [39, 50]);
  assert.deepEqual(windowEndingAt([0, 11], 3, 100), [0, 11]); // cannot start before month 0
  assert.deepEqual(windowEndingAt([0, 11], 140, 100), [88, 99]);
  assert.deepEqual(windowEndingAt([0, 99], 37, 100), [37, 37]); // the full record becomes one month
  assert.deepEqual(windowOfLength([20, 30], 12, 100), [19, 30]);
  assert.deepEqual(windowOfLength([2, 3], 12, 100), [0, 11]);
  assert.deepEqual(windowOfLength([2, 3], 1, 100), [3, 3]);
});

test('play starts sensibly and stops at the end', () => {
  assert.deepEqual(playStart([0, 99], 100), [0, 0]);
  assert.deepEqual(playStart([88, 99], 100), [0, 11]);
  assert.deepEqual(playStart([5, 5], 100), [5, 5]);
  assert.deepEqual(playNext([5, 16], 100), [6, 17]);
  assert.equal(playNext([88, 99], 100), null);
  assert.equal(scrubKeyStep('PageUp'), 12);
  assert.equal(scrubKeyStep('ArrowLeft'), -1);
  assert.equal(scrubKeyStep('Home'), 'home');
  assert.equal(scrubKeyStep('x'), null);
});

test('runs group consecutive months by key', () => {
  const src = ['model', 'model', 'viirs', 'viirs', 'none', 'viirs'];
  assert.deepEqual(runs(src.length, (m) => src[m]), [
    { key: 'model', m0: 0, m1: 1 },
    { key: 'viirs', m0: 2, m1: 3 },
    { key: 'none', m0: 4, m1: 4 },
    { key: 'viirs', m0: 5, m1: 5 },
  ]);
});

// Two cells over 36 months (2001-01 .. 2003-12). Cell 0 burns 10 every January and 4 in July 2003;
// cell 1 burns 2 in every month of 2002 only.
function tinyTable(): { table: Table; ax: ReturnType<typeof makeAxis> } {
  const ax = makeAxis('2001-01', 36);
  const months: number[] = [];
  const harm: number[] = [];
  const starts = [0];
  for (const y of [2001, 2002, 2003]) {
    months.push(indexOf(ax, y, 1));
    harm.push(10);
  }
  months.push(indexOf(ax, 2003, 7));
  harm.push(4);
  starts.push(months.length);
  for (let c = 1; c <= 12; c++) {
    months.push(indexOf(ax, 2002, c));
    harm.push(2);
  }
  starts.push(months.length);
  const n = months.length;
  const u16 = (f: (i: number) => number) => Uint16Array.from({ length: n }, (_, i) => f(i));
  const table: Table = {
    nCells: 2,
    nEntries: n,
    cellId: Uint32Array.from([3, 8]),
    cellProvince: Uint8Array.from([0, 1]),
    cellStart: Uint32Array.from(starts),
    month: Uint16Array.from(months),
    harmonized: Float32Array.from(harm),
    raw: {
      modis_terra: u16((i) => Math.round(harm[i] / 2)),
      modis_aqua: u16(() => 0),
      viirs_snpp: u16((i) => Math.round(harm[i])),
      viirs_noaa20: u16(() => 1),
    },
  };
  return { table, ax };
}

test('cell means divide by the observed months only', () => {
  const { table, ax } = tinyTable();
  const jan = indexOf(ax, 2002, 1);
  const dec = indexOf(ax, 2002, 12);
  const means = cellMeans(table, 'harmonized', jan, dec, 12);
  near(means[0], 10 / 12);
  near(means[1], 2);
  assert.deepEqual([...cellMeans(table, 'harmonized', jan, dec, 0)], [0, 0]);
  const obs: Observability = { observed: (m) => m >= jan, availability: () => 1, partial: () => false };
  assert.equal(observedMonths(obs, jan - 2, jan + 1).length, 2);
  assert.equal(cellTotal(table, 'harmonized', 0, jan, dec), 10);
  assert.equal(cellTotal(table, 'harmonized', 1, jan, jan + 2), 6);
  assert.equal(cellTotal(table, 'harmonized', -1, jan, dec), 0);
  // naive merge adds every raw sensor
  assert.deepEqual([...cellMeans(table, 'naive', jan, jan, 1)], [5 + 10 + 1, 1 + 2 + 1]);
});

test('cell medians and the difference from usual', () => {
  const { table, ax } = tinyTable();
  const med = cellMonthMedians(table, 'harmonized', ax, allObs(ax.n), 2001, 2003);
  near(med[0 * 12 + 0], 10); // cell 0, January: 10, 10, 10
  near(med[0 * 12 + 6], 0); // cell 0, July: 0, 0, 4
  near(med[1 * 12 + 4], 0); // cell 1, May: 0, 2, 0
  const jul03 = indexOf(ax, 2003, 7);
  const ex = cellExcess(table, 'harmonized', ax, med, [jul03]);
  near(ex[0], 4);
  near(ex[1], 0);
  const year02 = Array.from({ length: 12 }, (_, i) => indexOf(ax, 2002, i + 1));
  const ex02 = cellExcess(table, 'harmonized', ax, med, year02);
  near(ex02[0], 0); // January 10 against a median of 10, other months 0 against 0
  near(ex02[1], 2); // 2 a month against a median of 0
  near(cellUsual(med, 0, ax, [indexOf(ax, 2002, 1), indexOf(ax, 2002, 2)]), 5);
});

test('partial months stay out of cell medians', () => {
  const { table, ax } = tinyTable();
  const jan03 = indexOf(ax, 2003, 1);
  const obs: Observability = { observed: (m) => m >= 0 && m < ax.n, availability: () => 1, partial: (m) => m === jan03 };
  const med = cellMonthMedians(table, 'harmonized', ax, obs, 2001, 2003);
  near(med[0], 10); // two complete Januaries
  near(med[12 + 0], 1); // cell 1: January 2001 = 0, 2002 = 2
});

test('fixed scales: range of cell-month values, round breaks, square-root heights', () => {
  const { table } = tinyTable();
  const r = cellMonthRange(table, 'harmonized');
  assert.ok(r.lo > 0 && r.hi >= r.lo);
  assert.equal(r.hi, 10);
  assert.equal(niceStep(0.37), 0.5);
  assert.equal(niceStep(3), 2);
  assert.equal(niceStep(80), 100);
  const b = excessBreaks(50);
  assert.equal(b.length, 6);
  for (let i = 0; i < 3; i++) assert.equal(b[i], -b[5 - i]);
  assert.ok(b[3] > 0 && b[3] < b[4] && b[4] < b[5]);
  assert.equal(columnHeight(0, 10, 1000), 0);
  near(columnHeight(10, 10, 1000), 1000);
  near(columnHeight(40, 10, 1000), 2000);
});

// A 4 x 3 grid: west edge -70, south edge -40, 0.5 degree cells. Row 0 is the north edge.
const META = { lon0: -70, lat0: -40, step: 0.5, nx: 4, ny: 3 };
function grid(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 2);
  const dv = new DataView(buf);
  values.forEach((v, i) => dv.setInt16(i * 2, v, true));
  return buf;
}
test('blocks average k x k cells and keep the per-cell unit', () => {
  // 4 x 4 grid, cells listed by id = iy * nx + ix
  const grid = { lon0: -70, lat0: -40, res: 0.5, nx: 4 };
  const ids = [0, 1, 5, 10, 15];
  const b = cellBlocks(ids, grid, 2);
  assert.equal(b.n, 2); // ids 0, 1, 5 fall in block (0,0); 10 and 15 in block (1,1)
  assert.deepEqual(Array.from(b.cellBlock), [0, 0, 0, 1, 1]);
  near(b.lon[0], -69.5);
  near(b.lat[0], -39.5);
  near(b.lon[1], -68.5);
  near(b.lat[1], -38.5);
  const v = blockValues([4, 4, 8, 2, 6], b);
  near(v[0], (4 + 4 + 8) / 4);
  near(v[1], (2 + 6) / 4);
  const inside = blockInRegion(Uint8Array.from([0, 0, 1, 0, 0]), b)!;
  assert.deepEqual(Array.from(inside), [1, 0]);
  assert.equal(blockSize(3.5), 2);
  assert.equal(blockSize(5), 2);
  assert.equal(blockSize(7), 1);
});

test('terrain grid parsing and lookup follow the contract orientation', () => {
  // north row rises eastward; the south-east corner is nodata
  const t = parseTerrain(grid([100, 200, 300, 400, 50, 60, 70, 80, 5, 10, 20, NODATA]), META);
  assert.equal(t.min, 5);
  assert.equal(t.max, 400);
  assert.equal(elevationAt(t, -69.9, -38.6), 100); // north-west cell
  assert.equal(elevationAt(t, -68.1, -38.6), 400); // north-east cell
  assert.equal(elevationAt(t, -69.9, -39.9), 5); // south-west cell
  assert.equal(elevationAt(t, -68.1, -39.9), null); // nodata
  assert.equal(elevationAt(t, -71, -39), null); // outside
  assert.throws(() => parseTerrain(new ArrayBuffer(10), META));
  assert.throws(() => checkMeta({ lon0: -70, lat0: -40, step: 0, nx: 4, ny: 3 }));
  assert.deepEqual(checkMeta({ ...META, source: 'x' }), { ...META, source: 'x' });
  // sea (0) does not count toward the elevation range
  const coast = parseTerrain(grid([0, 200, 300, 400, 50, 60, 70, 80, 5, 10, 20, 30]), META);
  assert.equal(coast.min, 5);
  assert.equal(elevationAt(coast, -69.9, -38.6), 0);
});

test('terrain: bilinear height between cell centres, 0 outside the grid', () => {
  // 4 x 3 grid at 0.5 degrees from (-70, -40); row 0 is the north row
  const t = parseTerrain(grid([100, 200, 300, 400, 50, 60, 70, 80, 5, 10, 20, NODATA]), META);
  // the centre of the north-west cell is exactly its value
  near(elevationBilinear(t, -69.75, -38.75), 100);
  // halfway between the two western cells of the north row
  near(elevationBilinear(t, -69.5, -38.75), 150);
  // halfway between the north-west cell and the one below it
  near(elevationBilinear(t, -69.75, -39.0), 75);
  // nodata counts as 0
  near(elevationBilinear(t, -68.25, -39.75), 0);
  assert.equal(elevationBilinear(t, -80, -39), 0);
});

test('terrain: a Terrarium tile decodes back to the grid height', () => {
  const t = parseTerrain(grid([100, 200, 300, 400, 50, 60, 70, 80, 5, 10, 20, 30]), META);
  // zoom 6 tile that contains (-69.75, -38.75)
  const z = 6;
  const n = 2 ** z;
  const lon = -69.75;
  const lat = -38.75;
  const xf = ((lon + 180) / 360) * n;
  const yf = ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * n;
  const size = 64;
  const tile = terrariumTile(t, z, Math.floor(xf), Math.floor(yf), size);
  const px = Math.min(size - 1, Math.floor((xf - Math.floor(xf)) * size));
  const py = Math.min(size - 1, Math.floor((yf - Math.floor(yf)) * size));
  const i = (py * size + px) * 4;
  const h = tile[i] * 256 + tile[i + 1] + tile[i + 2] / 256 - 32768;
  assert.ok(Math.abs(h - elevationBilinear(t, lon, lat)) < 15, `decoded ${h}`);
  assert.equal(tile[i + 3], 255);
});
