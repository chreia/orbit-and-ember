// Region time series: sums over the selected cells, per month.
import type { Manifest, MonthSource, SensorId } from '../bundle/types.ts';
import { SENSORS } from '../bundle/types.ts';
import type { Table } from '../bundle/table.ts';

/** Series the app can display. naive = sum of every raw sensor. */
export type ViewSeries = 'harmonized' | 'naive' | SensorId;
export const VIEW_SERIES: readonly ViewSeries[] = ['harmonized', 'naive', ...SENSORS];

export interface RegionSeries {
  n: number;
  nCells: number;
  harmonized: Float64Array;
  naive: Float64Array;
  raw: Record<SensorId, Float64Array>;
}

export function aggregate(table: Table, cells: ArrayLike<number>, nMonths: number): RegionSeries {
  const harmonized = new Float64Array(nMonths);
  const raw = {} as Record<SensorId, Float64Array>;
  for (const s of SENSORS) raw[s] = new Float64Array(nMonths);
  const { cellStart, month, harmonized: h } = table;
  const t = table.raw.modis_terra;
  const a = table.raw.modis_aqua;
  const sn = table.raw.viirs_snpp;
  const n2 = table.raw.viirs_noaa20;
  const rt = raw.modis_terra;
  const ra = raw.modis_aqua;
  const rs = raw.viirs_snpp;
  const rn = raw.viirs_noaa20;
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k];
    const end = cellStart[i + 1];
    for (let e = cellStart[i]; e < end; e++) {
      const m = month[e];
      if (m >= nMonths) continue;
      harmonized[m] += h[e];
      rt[m] += t[e];
      ra[m] += a[e];
      rs[m] += sn[e];
      rn[m] += n2[e];
    }
  }
  const naive = new Float64Array(nMonths);
  for (let m = 0; m < nMonths; m++) naive[m] = rt[m] + ra[m] + rs[m] + rn[m];
  return { n: nMonths, nCells: cells.length, harmonized, naive, raw };
}

export function pick(series: RegionSeries, id: ViewSeries): Float64Array {
  if (id === 'harmonized') return series.harmonized;
  if (id === 'naive') return series.naive;
  return series.raw[id];
}

/** Per-cell sum of one series over months [m0, m1]. Returns one value per table cell. */
export function cellTotals(table: Table, id: ViewSeries, m0: number, m1: number): Float32Array {
  const out = new Float32Array(table.nCells);
  const { cellStart, month } = table;
  const cols: ArrayLike<number>[] =
    id === 'harmonized' ? [table.harmonized] : id === 'naive' ? SENSORS.map((s) => table.raw[s]) : [table.raw[id]];
  for (let i = 0; i < table.nCells; i++) {
    let acc = 0;
    const end = cellStart[i + 1];
    // entries are sorted by month: binary-search the first entry at or after m0
    let lo = cellStart[i];
    let hi = end;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (month[mid] < m0) lo = mid + 1;
      else hi = mid;
    }
    for (let e = lo; e < end; e++) {
      const m = month[e];
      if (m > m1) break;
      for (let c = 0; c < cols.length; c++) acc += cols[c][e];
    }
    out[i] = acc;
  }
  return out;
}

export const isModelSource = (s: MonthSource): boolean => s === 'model' || s === 'model_terra';

/** Log-scale spread s for a model-month estimate x, interpolated linearly in log10(x). */
export function spreadFor(x: number, points: [number, number][]): number {
  if (points.length === 0) return 0;
  if (!(x > points[0][0])) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  const lx = Math.log10(x);
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const a = Math.log10(points[i - 1][0]);
      const b = Math.log10(points[i][0]);
      return points[i - 1][1] + ((points[i][1] - points[i - 1][1]) * (lx - a)) / (b - a);
    }
  }
  return last[1];
}

/**
 * 80% interval for a harmonized month value (docs/DATA_CONTRACT.md):
 *   [max(0, (x + 0.5) * exp(-z * s) - 0.5), (x + 0.5) * exp(z * s) - 0.5]
 * with s interpolated in log10(x) and clamped to the table ends. The +0.5 offset matches how the
 * errors were measured, so a small model total, even zero, has an interval that can reach zero.
 * Observed months have zero width.
 */
export function interval80(x: number, source: MonthSource, unc: Manifest['uncertainty']): [number, number] {
  if (!isModelSource(source) || !Number.isFinite(x)) return [x, x];
  // Terra-only months (before Aqua) have their own, wider table when the bundle provides one.
  const pts = source === 'model_terra' && unc.points_terra_only?.length ? unc.points_terra_only : unc.points;
  const s = spreadFor(x, pts);
  const z = unc.z80 ?? 1.2816;
  return [Math.max(0, (x + 0.5) * Math.exp(-z * s) - 0.5), (x + 0.5) * Math.exp(z * s) - 0.5];
}

/** Monthly 80% bounds for a whole series. */
export function intervals(series: Float64Array, manifest: Manifest): { lo: Float64Array; hi: Float64Array } {
  const lo = new Float64Array(series.length);
  const hi = new Float64Array(series.length);
  for (let m = 0; m < series.length; m++) {
    const [a, b] = interval80(series[m], manifest.month_source[m] ?? 'none', manifest.uncertainty);
    lo[m] = a;
    hi[m] = b;
  }
  return { lo, hi };
}
