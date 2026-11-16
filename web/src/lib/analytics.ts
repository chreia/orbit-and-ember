// Baselines, anomalies, fire season and period comparisons for one region series.
//
// Anomaly definition (docs/METHODS.md section 7): for calendar month c,
//   z = (log1p(x) - median_c) / max(1.4826 * MAD_c, 0.3)
// where median_c and MAD_c are taken over log1p of the baseline years' values for month c.
// A month is classed unusual only if its count also differs from the month's median count by at
// least MIN_EXCESS hotspots, so one hotspot where there are usually none is not an extreme month.
import type { Manifest } from '../bundle/types.ts';
import type { MonthAxis } from './months.ts';
import { indexOf, indexOfLabel, monthOf, yearOf } from './months.ts';
import { mad, median, quantile } from './stats.ts';
import type { ViewSeries } from './series.ts';

export type AnomalyClass = 'far_above' | 'above' | 'normal' | 'below';

/** Floor on the robust spread of log1p counts. */
export const Z_SCALE_FLOOR = 0.3;
/** Minimum difference from the median count, in hotspots, for a month to be classed unusual. */
export const MIN_EXCESS = 5;
/** Minimum number of baseline years needed before a z score is reported. */
export const MIN_BASELINE_YEARS = 5;
/** A month with less than this share of days delivered counts as partial coverage. */
export const PARTIAL_THRESHOLD = 0.9;

export interface Observability {
  /** False before the record starts or when no sensor delivered data. */
  observed: (m: number) => boolean;
  /** Fraction of days with data for the series' source sensor(s), 0..1. */
  availability: (m: number) => number;
  /** Observed, but incomplete (current month, or an outage). Kept out of baselines. */
  partial: (m: number) => boolean;
}

export function observability(manifest: Manifest, axis: MonthAxis, series: ViewSeries): Observability {
  const av = manifest.availability;
  const at = (s: keyof typeof av, m: number) => av[s]?.[m] ?? 0;
  const lastComplete = manifest.months.last_complete ? indexOfLabel(axis, manifest.months.last_complete) : axis.n - 1;
  let availability: (m: number) => number;
  let observed: (m: number) => boolean;
  if (series === 'harmonized') {
    // The harmonized value is complete on any day some sensor observed: S-NPP gaps are filled from
    // NOAA-20 and days without VIIRS from the MODIS transfer model (docs/METHODS.md section 4).
    availability = (m) => {
      switch (manifest.month_source[m]) {
        case 'model_terra':
          return at('modis_terra', m);
        case 'model':
          return Math.max(at('modis_terra', m), at('modis_aqua', m));
        case 'viirs':
        case 'viirs_fill':
          return Math.max(at('viirs_snpp', m), at('viirs_noaa20', m), at('modis_terra', m), at('modis_aqua', m));
        default:
          return 0;
      }
    };
    observed = (m) => m >= 0 && m < axis.n && (manifest.month_source[m] ?? 'none') !== 'none';
  } else if (series === 'naive') {
    availability = (m) => Math.max(at('modis_terra', m), at('modis_aqua', m), at('viirs_snpp', m), at('viirs_noaa20', m));
    observed = (m) => m >= 0 && m < axis.n && availability(m) > 0;
  } else {
    availability = (m) => at(series, m);
    observed = (m) => m >= 0 && m < axis.n && at(series, m) > 0;
  }
  const partial = (m: number) => observed(m) && (m > lastComplete || availability(m) < PARTIAL_THRESHOLD);
  return { observed, availability, partial };
}

export interface MonthBaseline {
  /** calendar month 1..12 */
  month: number;
  years: number[];
  values: number[];
  median: number;
  q25: number;
  q75: number;
  logMedian: number;
  /** max(1.4826 * MAD(log1p), 0.3) */
  scale: number;
}

export interface Baseline {
  first: number;
  last: number;
  months: MonthBaseline[]; // index 0 = January
  annual: { year: number; total: number }[];
  medianAnnual: number;
}

export function computeBaseline(values: ArrayLike<number>, axis: MonthAxis, obs: Observability, first: number, last: number): Baseline {
  const months: MonthBaseline[] = [];
  for (let c = 1; c <= 12; c++) {
    const years: number[] = [];
    const vals: number[] = [];
    for (let y = first; y <= last; y++) {
      const m = indexOf(axis, y, c);
      if (m < 0 || m >= axis.n || !obs.observed(m) || obs.partial(m)) continue;
      years.push(y);
      vals.push(values[m]);
    }
    const logs = vals.map((v) => Math.log1p(v));
    const ok = vals.length >= MIN_BASELINE_YEARS;
    months.push({
      month: c,
      years,
      values: vals,
      median: ok ? median(vals) : NaN,
      q25: ok ? quantile(vals, 0.25) : NaN,
      q75: ok ? quantile(vals, 0.75) : NaN,
      logMedian: ok ? median(logs) : NaN,
      scale: ok ? Math.max(1.4826 * mad(logs), Z_SCALE_FLOOR) : NaN,
    });
  }
  const annual: { year: number; total: number }[] = [];
  for (let y = first; y <= last; y++) {
    let total = 0;
    let complete = true;
    for (let c = 1; c <= 12; c++) {
      const m = indexOf(axis, y, c);
      if (m < 0 || m >= axis.n || !obs.observed(m) || obs.partial(m)) {
        complete = false;
        break;
      }
      total += values[m];
    }
    if (complete) annual.push({ year: y, total });
  }
  const medianAnnual = annual.length >= MIN_BASELINE_YEARS ? median(annual.map((a) => a.total)) : NaN;
  return { first, last, months, annual, medianAnnual };
}

export function zScore(x: number, b: MonthBaseline): number {
  if (!Number.isFinite(b.logMedian) || !Number.isFinite(x)) return NaN;
  return (Math.log1p(x) - b.logMedian) / b.scale;
}

/**
 * Anomaly class from z. When the count and the month's median count are given, a month within
 * MIN_EXCESS hotspots of the median is normal whatever its z.
 */
/**
 * z rounded down to one decimal for display. The class thresholds are "z >= k", so rounding down
 * never shows a value on the far side of a threshold the month did not reach (1.96 shows as 1.9).
 */
export function zForDisplay(z: number): number {
  return Math.floor(z * 10 + 1e-6) / 10;
}

export function classify(z: number, x?: number, medianCount?: number): AnomalyClass | null {
  if (!Number.isFinite(z)) return null;
  if (x !== undefined && medianCount !== undefined && Number.isFinite(medianCount) && Math.abs(x - medianCount) < MIN_EXCESS) {
    return 'normal';
  }
  if (z >= 2) return 'far_above';
  if (z >= 1) return 'above';
  if (z >= -1) return 'normal';
  return 'below';
}

export interface MonthReading {
  m: number;
  x: number;
  median: number;
  pct: number; // percent of median (NaN when the median is zero or missing)
  z: number;
  cls: AnomalyClass | null;
}

export function readMonth(values: ArrayLike<number>, axis: MonthAxis, base: Baseline, m: number): MonthReading {
  const b = base.months[monthOf(axis, m) - 1];
  const x = values[m];
  const z = zScore(x, b);
  const pct = b.median > 0 ? (100 * x) / b.median : NaN;
  return { m, x, median: b.median, pct, z, cls: classify(z, x, b.median) };
}

/** Highest-z months within [m0, m1]. */
export function topAnomalies(
  values: ArrayLike<number>,
  axis: MonthAxis,
  obs: Observability,
  base: Baseline,
  m0: number,
  m1: number,
  k = 5,
): MonthReading[] {
  const out: MonthReading[] = [];
  for (let m = Math.max(0, m0); m <= Math.min(axis.n - 1, m1); m++) {
    if (!obs.observed(m) || obs.partial(m)) continue;
    const r = readMonth(values, axis, base, m);
    if (Number.isFinite(r.z)) out.push(r);
  }
  out.sort((a, b) => b.z - a.z);
  return out.slice(0, k);
}

/** Latest complete observed month (falls back to the latest observed one). */
export function latestMonth(axis: MonthAxis, obs: Observability): { m: number; partialM: number | null } | null {
  let partialM: number | null = null;
  for (let m = axis.n - 1; m >= 0; m--) {
    if (!obs.observed(m)) continue;
    if (obs.partial(m)) {
      if (partialM === null && m >= axis.n - 2) partialM = m;
      continue;
    }
    return { m, partialM };
  }
  return null;
}

export interface FireSeason {
  /** calendar month 1..12 where the season starts */
  start: number;
  length: number;
  /** share of the typical year's total inside the season */
  share: number;
  /** calendar month with the largest median */
  peak: number;
}

/** Shortest run of consecutive calendar months (wrapping) holding 80% of the median profile's total. */
export function fireSeason(base: Baseline, target = 0.8): FireSeason | null {
  const p = base.months.map((b) => (Number.isFinite(b.median) ? b.median : 0));
  const total = p.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  let peak = 0;
  for (let c = 1; c < 12; c++) if (p[c] > p[peak]) peak = c;
  for (let len = 1; len <= 12; len++) {
    let best = -1;
    let bestStart = 0;
    for (let s = 0; s < 12; s++) {
      let acc = 0;
      for (let k = 0; k < len; k++) acc += p[(s + k) % 12];
      if (acc > best + 1e-9) {
        best = acc;
        bestStart = s;
      }
    }
    if (best >= target * total - 1e-9) return { start: bestStart + 1, length: len, share: best / total, peak: peak + 1 };
  }
  return { start: 1, length: 12, share: 1, peak: peak + 1 };
}

export interface PeriodComparison {
  kind: 'window' | 'annualized';
  total: number;
  /** months in the window that had data */
  observedMonths: number;
  months: number;
  /** median of the same window over baseline years, or the median annual total */
  typical: number;
  /** total (or annualized total) as a percent of typical */
  pct: number;
  /** number of baseline windows behind the typical value */
  nYears: number;
  hasPartial: boolean;
}

export function comparePeriod(
  values: ArrayLike<number>,
  axis: MonthAxis,
  obs: Observability,
  base: Baseline,
  m0: number,
  m1: number,
): PeriodComparison {
  const len = m1 - m0 + 1;
  let total = 0;
  let observedMonths = 0;
  let hasPartial = false;
  for (let m = m0; m <= m1; m++) {
    if (!obs.observed(m)) continue;
    observedMonths++;
    total += values[m];
    if (obs.partial(m)) hasPartial = true;
  }
  if (len <= 12) {
    const sums: number[] = [];
    for (let y = base.first; y <= base.last; y++) {
      const shift = (y - yearOf(axis, m0)) * 12;
      let s = 0;
      let ok = true;
      for (let m = m0 + shift; m <= m1 + shift; m++) {
        const yy = yearOf(axis, m);
        if (m < 0 || m >= axis.n || yy < base.first || yy > base.last || !obs.observed(m) || obs.partial(m)) {
          ok = false;
          break;
        }
        s += values[m];
      }
      if (ok) sums.push(s);
    }
    const typical = sums.length >= MIN_BASELINE_YEARS ? median(sums) : NaN;
    return { kind: 'window', total, observedMonths, months: len, typical, pct: typical > 0 ? (100 * total) / typical : NaN, nYears: sums.length, hasPartial };
  }
  const annualized = observedMonths > 0 ? (total / observedMonths) * 12 : NaN;
  const typical = base.medianAnnual;
  return {
    kind: 'annualized',
    total,
    observedMonths,
    months: len,
    typical,
    pct: typical > 0 ? (100 * annualized) / typical : NaN,
    nYears: base.annual.length,
    hasPartial,
  };
}

/** Calendar-year totals; complete = every month observed and not partial. */
export function annualTotals(
  values: ArrayLike<number>,
  axis: MonthAxis,
  obs: Observability,
): { year: number; total: number; months: number; complete: boolean; full: boolean }[] {
  const out: { year: number; total: number; months: number; complete: boolean; full: boolean }[] = [];
  const y0 = yearOf(axis, 0);
  const y1 = yearOf(axis, axis.n - 1);
  for (let y = y0; y <= y1; y++) {
    let total = 0;
    let months = 0;
    let complete = true;
    for (let c = 1; c <= 12; c++) {
      const m = indexOf(axis, y, c);
      if (!obs.observed(m)) {
        complete = false;
        continue;
      }
      if (obs.partial(m)) complete = false;
      total += values[m];
      months++;
    }
    out.push({ year: y, total, months, complete, full: months === 12 });
  }
  return out;
}

/**
 * Ratio of mean annual totals in the k years from `year` onward to the k years before it, using
 * years with all 12 months observed (reduced-coverage months count). Shows the size of the step
 * when a sensor joins the record.
 */
export function stepRatio(
  annual: { year: number; total: number; full: boolean }[],
  year: number,
  k = 3,
): { ratio: number; before: number; after: number } | null {
  const get = (y: number) => annual.find((a) => a.year === y && a.full);
  const before: number[] = [];
  const after: number[] = [];
  for (let i = 1; i <= k; i++) {
    const b = get(year - i);
    const a = get(year + i - 1);
    if (!a || !b) return null;
    before.push(b.total);
    after.push(a.total);
  }
  const mb = before.reduce((s, v) => s + v, 0) / k;
  const ma = after.reduce((s, v) => s + v, 0) / k;
  if (!(mb > 0)) return null;
  return { ratio: ma / mb, before: mb, after: ma };
}

/**
 * Months that are the highest of their calendar month over the whole record (observed, complete
 * months only; at least MIN_EXCESS hotspots; ties are not records). A factual marker that does not
 * depend on the anomaly scale.
 */
export function recordMonths(values: ArrayLike<number>, axis: MonthAxis, obs: Observability): Set<number> {
  const best = new Array<number>(12).fill(-1);
  const bestM = new Array<number>(12).fill(-1);
  const tie = new Array<boolean>(12).fill(false);
  for (let m = 0; m < axis.n; m++) {
    if (!obs.observed(m) || obs.partial(m)) continue;
    const c = monthOf(axis, m) - 1;
    const x = values[m];
    if (x > best[c]) {
      best[c] = x;
      bestM[c] = m;
      tie[c] = false;
    } else if (x === best[c]) tie[c] = true;
  }
  const out = new Set<number>();
  for (let c = 0; c < 12; c++) if (bestM[c] >= 0 && !tie[c] && best[c] >= MIN_EXCESS) out.add(bestM[c]);
  return out;
}
