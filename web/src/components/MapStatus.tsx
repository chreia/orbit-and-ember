// What the map can and cannot say for the period shown: a sensor that was not observing, a period
// it only partly observed, and months that are model estimates rather than observations.
import { yearOf } from '../lib/months.ts';
import { isModelSource } from '../lib/series.ts';
import { useI18n } from '../i18n.tsx';
import { rangeLabel, seriesLabel, sensorStartIndex, useModel } from '../model.ts';
import { useDerived } from '../derived.tsx';
import { useUi } from '../store.ts';
import { useMapPeriod } from '../map/usePeriod.ts';

export function MapStatus() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { manifest, axis } = useModel();
  const d = useDerived();
  const series = useUi((s) => s.series);
  const p = useMapPeriod();
  const periodText = rangeLabel(axis, p.m0, p.m1, i18n);
  const k = p.months.length;
  if (k === 0) {
    return (
      <div className="map-status warn" role="status">
        {t('notObservedMap', { sensor: seriesLabel(series, i18n), period: periodText })}
      </div>
    );
  }
  if (series !== 'harmonized') {
    if (k < p.length) {
      return (
        <div className="map-status" role="status">
          {t('partialObsMap', { sensor: seriesLabel(series, i18n), k, n: p.length })}
        </div>
      );
    }
    return null;
  }
  if (p.modelMonths === 0) return null;
  if (p.modelMonths < k) {
    const s = sensorStartIndex(manifest, axis, 'viirs_snpp');
    return (
      <div className="map-status model" role="status">
        <span className="dot" aria-hidden="true" />
        {t('mixedBadge', { year: s !== null ? yearOf(axis, s) : 2012 })}
      </div>
    );
  }
  // every month is a model estimate: give the 80% interval for the selected area (monthly bounds summed)
  let x = 0;
  let lo = 0;
  let hi = 0;
  for (const m of p.months) {
    if (!isModelSource(manifest.month_source[m])) continue;
    x += d.rs.harmonized[m];
    lo += d.harmBand.lo[m];
    hi += d.harmBand.hi[m];
  }
  return (
    <div className="map-status model" role="status">
      <span className="dot" aria-hidden="true" />
      <b>{t('modelBadge')}</b>
      <span className="ms-sub">{t('modelBadgeHelp', { region: d.name, lo: fmt(lo), hi: fmt(hi) })}</span>
      <span className="sr-only">{fmt(x)}</span>
    </div>
  );
}
