// The numbers under the pointer: the cell's province, its hotspots for the period on the map, and in
// the difference view its usual value for those months. Every value is read from the bundle.
import { cellTotal, cellUsual } from '../lib/cells.ts';
import { useI18n } from '../i18n.tsx';
import { rangeLabel, useModel } from '../model.ts';
import { useUi } from '../store.ts';
import { useMapPeriod, useSeriesMedians } from '../map/usePeriod.ts';

export function MapReadout() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { manifest, table, axis } = useModel();
  const readout = useUi((s) => s.readout);
  const series = useUi((s) => s.series);
  const mapColor = useUi((s) => s.mapColor);
  const period = useMapPeriod();
  const medians = useSeriesMedians(mapColor === 'excess');
  if (!readout) {
    return (
      <div className="readout overlay-card idle" aria-hidden="true">
        {t('readoutIdle')}
      </div>
    );
  }
  const { cell, cellId, lon, lat } = readout;
  const coords = t('readoutCell', { lat: fmt(lat, 2), lon: fmt(lon, 2) });
  if (cellId < 0) {
    return (
      <div className="readout overlay-card" role="status" aria-live="off">
        <div className="ro-head">{t('readoutOutside')}</div>
        <div className="ro-sub">{coords}</div>
      </div>
    );
  }
  const prov = cell >= 0 ? manifest.provinces.find((p) => p.id === table.cellProvince[cell])?.name : undefined;
  const k = period.months.length;
  const total = cellTotal(table, series, cell, period.m0, period.m1);
  const rows: { label: string; value: string }[] = [];
  if (k === 0) rows.push({ label: rangeLabel(axis, period.m0, period.m1, i18n), value: t('tipNotObserved') });
  else if (cell < 0) rows.push({ label: rangeLabel(axis, period.m0, period.m1, i18n), value: t('readoutNever') });
  else if (period.length === 1) rows.push({ label: t('readoutMonth', { period: rangeLabel(axis, period.m0, period.m1, i18n) }), value: fmt(total) });
  else {
    rows.push({ label: t('readoutTotal'), value: fmt(total) });
    rows.push({ label: t('readoutMean'), value: fmt(total / k) });
  }
  if (mapColor === 'excess' && medians && cell >= 0 && k > 0) {
    const usual = cellUsual(medians, cell, axis, period.months);
    if (Number.isFinite(usual)) {
      const diff = total / k - usual;
      rows.push({ label: t('readoutUsual'), value: fmt(usual) });
      rows.push({ label: t('readoutDiff'), value: `${diff > 0 ? '+' : ''}${fmt(diff)}` });
    }
  }
  return (
    <div className="readout overlay-card" role="status" aria-live="off">
      <div className="ro-head">{prov ?? manifest.country}</div>
      <div className="ro-sub">{coords}</div>
      <dl>
        {rows.map((r) => (
          <div key={r.label} className="ro-row">
            <dt>{r.label}</dt>
            <dd className="num">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
