// Per-cell values for the map: the mean per observed month of a series over the selected period,
// the difference from each cell's usual value for the same calendar months, and the fixed scales
// that keep colours and column heights comparable while the period moves.
import type { Table } from '../bundle/table.ts';
import { SENSORS } from '../bundle/types.ts';
import type { MonthAxis } from './months.ts';
import { indexOf, monthOf } from './months.ts';
import type { Observability } from './analytics.ts';
import type { ViewSeries } from './series.ts';
import { cellTotals } from './series.ts';

/** Month indices in [m0, m1] that the series observed. */
export function observedMonths(obs: Observability, m0: number, m1: number): number[] {
  const out: number[] = [];
  for (let m = m0; m <= m1; m++) if (obs.observed(m)) out.push(m);
  return out;
}

/** Per table cell: total over [m0, m1] divided by the number of observed months (0 when none). */
export function cellMeans(table: Table, series: ViewSeries, m0: number, m1: number, nObserved: number): Float32Array {
  const t = cellTotals(table, series, m0, m1);
  if (nObserved > 0) for (let i = 0; i < t.length; i++) t[i] /= nObserved;
  else t.fill(0);
  return t;
}

/** Value of one table entry for a series (naive = sum of the raw sensors). */
export function entryValue(table: Table, series: ViewSeries, e: number): number {
  if (series === 'harmonized') return table.harmonized[e];
  if (series === 'naive') {
    let s = 0;
    for (const k of SENSORS) s += table.raw[k][e];
    return s;
  }
  return table.raw[series][e];
}

/**
 * Low and high ends for a fixed per-cell scale: the 5th and 99.5th percentiles of the positive
 * single cell-month values over the whole record, from an evenly strided sample of the entries.
 */
export function cellMonthRange(table: Table, series: ViewSeries, maxSamples = 400_000): { lo: number; hi: number } {
  const stride = Math.max(1, Math.ceil(table.nEntries / maxSamples));
  const vals: number[] = [];
  for (let e = 0; e < table.nEntries; e += stride) {
    const v = entryValue(table, series, e);
    if (v > 0) vals.push(v);
  }
  if (!vals.length) return { lo: 1, hi: 1 };
  vals.sort((a, b) => a - b);
  const at = (q: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(q * (vals.length - 1))))];
  return { lo: at(0.05), hi: Math.max(at(0.995), at(0.05)) };
}

/**
 * Median of each cell for each calendar month over the baseline years, using only months the
 * series observed in full (the same months the region baselines use). Cell-months with no entry
 * count as zero. Returns nCells * 12 values, calendar month c at index cell * 12 + (c - 1).
 */
export function cellMonthMedians(
  table: Table,
  series: ViewSeries,
  axis: MonthAxis,
  obs: Observability,
  first: number,
  last: number,
): Float32Array {
  const byCal: number[][] = Array.from({ length: 12 }, () => []);
  for (let c = 1; c <= 12; c++) {
    for (let y = first; y <= last; y++) {
      const m = indexOf(axis, y, c);
      if (m >= 0 && m < axis.n && obs.observed(m) && !obs.partial(m)) byCal[c - 1].push(m);
    }
  }
  const out = new Float32Array(table.nCells * 12);
  const buf = new Float64Array(axis.n);
  const touched: number[] = [];
  const scratch: number[] = [];
  for (let i = 0; i < table.nCells; i++) {
    for (let e = table.cellStart[i]; e < table.cellStart[i + 1]; e++) {
      const m = table.month[e];
      if (m >= axis.n) continue;
      buf[m] = entryValue(table, series, e);
      touched.push(m);
    }
    for (let c = 0; c < 12; c++) {
      const ms = byCal[c];
      if (ms.length === 0) {
        out[i * 12 + c] = NaN;
        continue;
      }
      scratch.length = 0;
      for (const m of ms) scratch.push(buf[m]);
      scratch.sort((a, b) => a - b);
      const k = scratch.length;
      out[i * 12 + c] = k % 2 ? scratch[(k - 1) / 2] : (scratch[k / 2 - 1] + scratch[k / 2]) / 2;
    }
    for (const m of touched) buf[m] = 0;
    touched.length = 0;
  }
  return out;
}

/**
 * Per cell: (total over the observed months of the period minus the sum of the cell's medians for
 * those calendar months) divided by the number of observed months. Positive means more hotspots
 * than usual for that time of year.
 */
export function cellExcess(
  table: Table,
  series: ViewSeries,
  axis: MonthAxis,
  medians: Float32Array,
  months: number[],
): Float32Array {
  const out = new Float32Array(table.nCells);
  if (!months.length) return out;
  const perCal = new Float64Array(12);
  for (const m of months) perCal[monthOf(axis, m) - 1]++;
  const m0 = months[0];
  const m1 = months[months.length - 1];
  const totals = cellTotals(table, series, m0, m1);
  const n = months.length;
  for (let i = 0; i < table.nCells; i++) {
    let usual = 0;
    for (let c = 0; c < 12; c++) {
      if (perCal[c] === 0) continue;
      const med = medians[i * 12 + c];
      if (Number.isFinite(med)) usual += perCal[c] * med;
    }
    out[i] = (totals[i] - usual) / n;
  }
  return out;
}

/** The usual per-month value of one cell for the calendar months in `months`. */
export function cellUsual(medians: Float32Array, cell: number, axis: MonthAxis, months: number[]): number {
  if (!months.length || cell < 0) return NaN;
  let s = 0;
  for (const m of months) {
    const v = medians[cell * 12 + monthOf(axis, m) - 1];
    if (!Number.isFinite(v)) return NaN;
    s += v;
  }
  return s / months.length;
}

/** A round step near x: 1, 2 or 5 times a power of ten. */
export function niceStep(x: number): number {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/**
 * Symmetric class edges for the difference map, from the high end of the cell scale: six edges
 * -b3 -b2 -b1 b1 b2 b3 with round steps, so seven classes and a neutral middle class (-b1, b1).
 */
export function excessBreaks(hi: number): number[] {
  const k = niceStep(Math.max(hi, 1) / 25);
  const b = [k, niceStep(k * 4), niceStep(k * 16)];
  return [-b[2], -b[1], -b[0], b[0], b[1], b[2]];
}

/** Column height in metres: grows with the square root of the value, `full` metres at `ref`. */
export function columnHeight(v: number, ref: number, full: number): number {
  if (!(v > 0) || !(ref > 0)) return 0;
  return Math.sqrt(v / ref) * full;
}

/** Total of one series for one table cell over [m0, m1] (entries are sorted by month). */
export function cellTotal(table: Table, series: ViewSeries, cell: number, m0: number, m1: number): number {
  if (cell < 0) return 0;
  let s = 0;
  for (let e = table.cellStart[cell]; e < table.cellStart[cell + 1]; e++) {
    const m = table.month[e];
    if (m < m0) continue;
    if (m > m1) break;
    s += entryValue(table, series, e);
  }
  return s;
}

/**
 * Coarser columns for wide views: k x k grid cells per block. A block's value is the mean over all
 * k * k cells (cells with no hotspots in the whole record count as 0), so it keeps the unit "hotspots
 * per cell per month" and the same colour scale applies.
 */
export interface Blocks {
  k: number;
  n: number;
  /** block centres */
  lon: Float32Array;
  lat: Float32Array;
  /** table index -> block index */
  cellBlock: Int32Array;
}

export function cellBlocks(cellId: ArrayLike<number>, grid: { lon0: number; lat0: number; res: number; nx: number }, k: number): Blocks {
  const n = cellId.length;
  const cellBlock = new Int32Array(n);
  const index = new Map<number, number>();
  const lon: number[] = [];
  const lat: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = cellId[i];
    const ix = id % grid.nx;
    const iy = Math.floor(id / grid.nx);
    const bx = Math.floor(ix / k);
    const by = Math.floor(iy / k);
    const key = by * 1_000_000 + bx;
    let b = index.get(key);
    if (b === undefined) {
      b = lon.length;
      index.set(key, b);
      lon.push(grid.lon0 + (bx * k + k / 2) * grid.res);
      lat.push(grid.lat0 + (by * k + k / 2) * grid.res);
    }
    cellBlock[i] = b;
  }
  return { k, n: lon.length, lon: Float32Array.from(lon), lat: Float32Array.from(lat), cellBlock };
}

export function blockValues(values: ArrayLike<number>, b: Blocks): Float32Array {
  const out = new Float32Array(b.n);
  for (let i = 0; i < values.length; i++) out[b.cellBlock[i]] += values[i];
  const area = b.k * b.k;
  for (let j = 0; j < b.n; j++) out[j] /= area;
  return out;
}

/** A block belongs to the selected area when any of its cells does. */
export function blockInRegion(inRegion: Uint8Array | null, b: Blocks): Uint8Array | null {
  if (!inRegion) return null;
  const out = new Uint8Array(b.n);
  for (let i = 0; i < inRegion.length; i++) if (inRegion[i]) out[b.cellBlock[i]] = 1;
  return out;
}

/** Cells per block side for a camera zoom: coarse for the whole country, single cells up close. */
export function blockSize(zoom: number): number {
  return zoom < 5.2 ? 2 : 1;
}
