// Month index arithmetic. Month index 0 is manifest.months.start.

export interface MonthAxis {
  startYear: number;
  /** 1..12 */
  startMonth: number;
  n: number;
  labels: string[];
}

export function parseYm(s: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Bad month label: ${s}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function makeAxis(start: string, n: number, labels?: string[]): MonthAxis {
  const { year, month } = parseYm(start);
  const axis: MonthAxis = { startYear: year, startMonth: month, n, labels: [] };
  axis.labels = labels && labels.length === n ? labels : Array.from({ length: n }, (_, m) => labelOf(axis, m));
  return axis;
}

/** Calendar year of month index m. */
export function yearOf(axis: MonthAxis, m: number): number {
  return axis.startYear + Math.floor((axis.startMonth - 1 + m) / 12);
}

/** Calendar month (1..12) of month index m. */
export function monthOf(axis: MonthAxis, m: number): number {
  return (((axis.startMonth - 1 + m) % 12) + 12) % 12 + 1;
}

/** Month index of (year, month); may fall outside 0..n-1. */
export function indexOf(axis: MonthAxis, year: number, month: number): number {
  return (year - axis.startYear) * 12 + (month - axis.startMonth);
}

export function labelOf(axis: MonthAxis, m: number): string {
  return `${yearOf(axis, m)}-${String(monthOf(axis, m)).padStart(2, '0')}`;
}

export function indexOfLabel(axis: MonthAxis, label: string): number {
  const { year, month } = parseYm(label);
  return indexOf(axis, year, month);
}

export function firstYear(axis: MonthAxis): number {
  return axis.startYear;
}

export function lastYear(axis: MonthAxis): number {
  return yearOf(axis, axis.n - 1);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function clampIndex(axis: MonthAxis, m: number): number {
  return Math.max(0, Math.min(axis.n - 1, m));
}
