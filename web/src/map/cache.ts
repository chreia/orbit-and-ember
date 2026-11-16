// Per-series scales and medians, computed on first use and kept for the session: switching the
// record back and forth, or playing through the period, never recomputes them.
import type { Table } from '../bundle/table.ts';
import type { MonthAxis } from '../lib/months.ts';
import type { Observability } from '../lib/analytics.ts';
import type { ViewSeries } from '../lib/series.ts';
import { cellMonthMedians, cellMonthRange } from '../lib/cells.ts';

const ranges = new WeakMap<Table, Map<ViewSeries, { lo: number; hi: number }>>();
const medians = new WeakMap<Table, Map<ViewSeries, Float32Array>>();

export function seriesRange(table: Table, series: ViewSeries): { lo: number; hi: number } {
  let m = ranges.get(table);
  if (!m) ranges.set(table, (m = new Map()));
  let r = m.get(series);
  if (!r) {
    // averages over long periods fall well below one hotspot a month; classes start at 0.1
    const q = cellMonthRange(table, series);
    r = { lo: Math.max(0.1, q.lo), hi: Math.max(q.hi, 1) };
    m.set(series, r);
  }
  return r;
}

export function seriesMedians(table: Table, series: ViewSeries, axis: MonthAxis, obs: Observability, first: number, last: number): Float32Array {
  let m = medians.get(table);
  if (!m) medians.set(table, (m = new Map()));
  let r = m.get(series);
  if (!r) m.set(series, (r = cellMonthMedians(table, series, axis, obs, first, last)));
  return r;
}
