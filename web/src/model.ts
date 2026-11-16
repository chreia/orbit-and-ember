import { createContext, useContext } from 'react';
import type { Bundle } from './bundle/load.ts';
import type { Manifest, MonthSource, Preset } from './bundle/types.ts';
import type { Table } from './bundle/table.ts';
import type { MonthAxis } from './lib/months.ts';
import { parseYm } from './lib/months.ts';
import type { GeoCollection, Region } from './lib/region.ts';
import type { ViewSeries } from './lib/series.ts';
import type { I18n, Key } from './i18n.tsx';
import { SERIES_DARK } from './lib/color.ts';

export interface Model {
  bundle: Bundle;
  manifest: Manifest;
  axis: MonthAxis;
  table: Table;
  boundaries: GeoCollection | null;
}

export const ModelContext = createContext<Model | null>(null);

/** The loaded bundle; only rendered below App's loading gate, so it is always present. */
export function useModel(): Model {
  const m = useContext(ModelContext);
  if (!m) throw new Error('useModel outside ModelContext');
  return m;
}

/** Line identity shared by every chart and the series picker: hue says MODIS or VIIRS, dash says which satellite. */
export const SERIES_STYLE: Record<ViewSeries, { color: string; dash?: string; width: number }> = {
  harmonized: { color: SERIES_DARK.harmonized, width: 2.75 },
  naive: { color: SERIES_DARK.naive, dash: '7 4', width: 2.25 },
  modis_terra: { color: SERIES_DARK.modis_terra, width: 1.75 },
  modis_aqua: { color: SERIES_DARK.modis_aqua, dash: '4 3', width: 1.75 },
  viirs_snpp: { color: SERIES_DARK.viirs_snpp, width: 1.75 },
  viirs_noaa20: { color: SERIES_DARK.viirs_noaa20, dash: '4 3', width: 1.75 },
};

export function seriesLabel(id: ViewSeries, i18n: I18n): string {
  return i18n.t(`s_${id}` as Key);
}

export function sourceLabel(src: MonthSource, i18n: I18n): string {
  return i18n.t(`src_${src}` as Key);
}

export function presetName(p: Preset, i18n: I18n): string {
  return i18n.lang === 'es' && p.name_es ? p.name_es : p.name;
}

export function regionLabel(region: Region, i18n: I18n, manifest?: Manifest): string {
  if (manifest && region.key.startsWith('preset:')) {
    const p = manifest.presets.find((q) => `preset:${q.id}` === region.key);
    if (p) return presetName(p, i18n);
  }
  const f = (x: number) => i18n.fmt(x, 2);
  if (region.kind === 'bbox' && !region.name) {
    const [w, s, e, n] = region.bbox;
    return i18n.t('rectName', { w: f(w), s: f(s), e: f(e), n: f(n) });
  }
  if (region.kind === 'circle' && !region.name) {
    return i18n.t('circleName', { r: i18n.fmt(region.radiusKm), lat: f(region.center[1]), lon: f(region.center[0]) });
  }
  return region.name;
}

/** First year a sensor appears, from the manifest series list. */
export function sensorStartYear(manifest: Manifest, id: string): number | null {
  const s = manifest.series.find((q) => q.id === id);
  return s?.first ? parseYm(s.first).year : null;
}

/** Month index where a sensor first appears. */
export function sensorStartIndex(manifest: Manifest, axis: MonthAxis, id: string): number | null {
  const s = manifest.series.find((q) => q.id === id);
  if (!s?.first) return null;
  const { year, month } = parseYm(s.first);
  const m = (year - axis.startYear) * 12 + (month - axis.startMonth);
  return m > 0 && m < axis.n ? m : null;
}

export function rangeLabel(axis: MonthAxis, m0: number, m1: number, i18n: I18n): string {
  const y0 = axis.startYear + Math.floor((axis.startMonth - 1 + m0) / 12);
  const mo0 = ((axis.startMonth - 1 + m0) % 12) + 1;
  const y1 = axis.startYear + Math.floor((axis.startMonth - 1 + m1) / 12);
  const mo1 = ((axis.startMonth - 1 + m1) % 12) + 1;
  const a = i18n.monthYear(y0, mo0);
  return m0 === m1 ? a : `${a} – ${i18n.monthYear(y1, mo1)}`;
}
