// points/index.json reader, kept free of browser-only imports so scripts can use it.
import type { PointsIndex, PointsYearInfo } from './types.ts';

/** Accepts {versions, years: {...}} or year keys at the top level beside "versions". */
export function normalisePointsIndex(raw: Record<string, unknown>): PointsIndex {
  const versions = Array.isArray(raw.versions) ? (raw.versions as string[]) : [];
  const yearsObj = (raw.years && typeof raw.years === 'object' ? raw.years : raw) as Record<string, unknown>;
  const years: Record<string, PointsYearInfo> = {};
  for (const [k, v] of Object.entries(yearsObj)) {
    if (/^\d{4}$/.test(k) && v && typeof v === 'object') years[k] = v as PointsYearInfo;
  }
  const sensors =
    raw.sensors && typeof raw.sensors === 'object' && !Array.isArray(raw.sensors) ? (raw.sensors as Record<string, string>) : undefined;
  return { versions, sensors, years };
}
