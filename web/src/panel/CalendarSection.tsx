// Step 2: the burning calendar for the selected area and record, linked to the map: clicking a
// month shows it on the map, and the period on the map is outlined in the calendar.
import { useCallback, useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { SENSORS } from '../bundle/types.ts';
import { indexOf, monthOf, yearOf } from '../lib/months.ts';
import { VIEW_SERIES, isModelSource } from '../lib/series.ts';
import { MIN_EXCESS, readMonth, zForDisplay } from '../lib/analytics.ts';
import type { CalMode } from '../state.ts';
import { useI18n } from '../i18n.tsx';
import type { Key } from '../i18n.tsx';
import { SERIES_STYLE, seriesLabel, sensorStartYear, sourceLabel, useModel } from '../model.ts';
import { useDerived } from '../derived.tsx';
import { useUi } from '../store.ts';
import { Calendar, CalendarLegend } from '../components/Calendar.tsx';
import { ClassBadge } from '../components/Analytics.tsx';
import { LineKey } from '../components/Tooltip.tsx';

export function CalendarSection() {
  const i18n = useI18n();
  const { t, fmt, monthLong, monthYear } = i18n;
  const { manifest, axis } = useModel();
  const d = useDerived();
  const { rs, harmObs, harmBand, viewValues, viewObs, viewBase, viewRecords, rawObs, calScale, name } = d;
  const id = useId();
  const series = useUi((s) => s.series);
  const mode = useUi((s) => s.mode);
  const range = useUi((s) => s.range);
  const showValues = useUi((s) => s.showValues);
  const set = useUi((s) => s.set);
  const pickMonth = useUi((s) => s.pickMonth);
  const theme = 'dark' as const;

  const onPickYear = useCallback(
    (y: number) => set({ playing: false, range: [Math.max(0, indexOf(axis, y, 1)), Math.min(axis.n - 1, indexOf(axis, y, 12))] }),
    [axis, set],
  );

  const renderTip = useCallback(
    (m: number): ReactNode => {
      const y = yearOf(axis, m);
      const c = monthOf(axis, m);
      const title = monthYear(y, c);
      const raw = (
        <>
          <div className="tt-sep" />
          <div className="tt-note" style={{ marginBottom: 2 }}>
            {t('tipRaw')}
          </div>
          {SENSORS.map((s) => (
            <div className="tt-row" key={s}>
              <span className="tt-key">
                <LineKey color={SERIES_STYLE[s].color} dash={SERIES_STYLE[s].dash} />
                {seriesLabel(s, i18n)}
              </span>
              <span className="v">{rawObs[s].observed(m) ? fmt(rs.raw[s][m]) : t('tipNotOperating')}</span>
            </div>
          ))}
          <div className="tt-row">
            <span className="tt-key">
              <LineKey color={SERIES_STYLE.naive.color} dash={SERIES_STYLE.naive.dash} />
              {seriesLabel('naive', i18n)}
            </span>
            <span className="v">{fmt(rs.naive[m])}</span>
          </div>
          {series !== 'harmonized' && harmObs.observed(m) && (
            <div className="tt-row">
              <span className="tt-key">
                <LineKey color={SERIES_STYLE.harmonized.color} />
                {seriesLabel('harmonized', i18n)}
              </span>
              <span className="v">{fmt(rs.harmonized[m])}</span>
            </div>
          )}
        </>
      );
      if (!viewObs.observed(m)) {
        return (
          <div>
            <div className="tt-title">{title}</div>
            <div className="tt-note">{t('tipNotObserved')}</div>
            {raw}
          </div>
        );
      }
      const x = viewValues[m];
      const r = readMonth(viewValues, axis, viewBase, m);
      const src = manifest.month_source[m];
      const showInterval = series === 'harmonized' && isModelSource(src) && harmBand.hi[m] - harmBand.lo[m] > 1e-9;
      return (
        <div>
          <div className="tt-title">
            {title} · {seriesLabel(series, i18n)}
          </div>
          <div className="tt-value">
            {fmt(x)} {t('tipHotspots')}
          </div>
          {showInterval && <div className="tt-note">{t('tipInterval', { lo: fmt(harmBand.lo[m]), hi: fmt(harmBand.hi[m]) })}</div>}
          {series === 'harmonized' && (
            <div className="tt-note">
              {t('tipSource')}: {sourceLabel(src, i18n)}
            </div>
          )}
          {viewObs.partial(m) && <div className="tt-note">{t('tipPartial', { pct: fmt(100 * viewObs.availability(m)) })}</div>}
          {viewRecords.has(m) && (
            <div className="tt-note" style={{ fontWeight: 700, color: 'var(--ink)' }}>
              {t('tipRecord', { month: monthLong(c) })}
            </div>
          )}
          <div className="tt-sep" />
          {Number.isFinite(r.z) ? (
            <>
              <div className="tt-note">{t('tipMedian', { month: monthLong(c), first: viewBase.first, last: viewBase.last, v: fmt(r.median) })}</div>
              <div className="tt-row" style={{ marginTop: 3 }}>
                <ClassBadge cls={r.cls} z={r.z} theme={theme} />
                <span className="v">
                  {t('tipZ', { z: fmt(zForDisplay(r.z), 1) })}
                  {Number.isFinite(r.pct) ? ` · ${t('tipPct', { p: fmt(r.pct) })}` : ''}
                </span>
              </div>
            </>
          ) : (
            <div className="tt-note">{t('tipNoBaseline')}</div>
          )}
          {raw}
        </div>
      );
    },
    [axis, monthYear, t, i18n, rawObs, fmt, rs, series, harmObs, viewObs, viewValues, viewBase, manifest, harmBand, monthLong, viewRecords],
  );

  const describe = useCallback(
    (m: number): string => {
      const title = monthYear(yearOf(axis, m), monthOf(axis, m));
      if (!viewObs.observed(m)) return `${title}: ${t('tipNotObserved')}`;
      const r = readMonth(viewValues, axis, viewBase, m);
      const parts = [`${title}: ${fmt(r.x)} ${t('tipHotspots')}`];
      if (r.cls) parts.push(t(`cls_${r.cls}` as Key));
      if (series === 'harmonized') parts.push(sourceLabel(manifest.month_source[m], i18n));
      if (viewObs.partial(m)) parts.push(t('legendPartial'));
      if (viewRecords.has(m)) parts.push(t('tipRecord', { month: monthLong(monthOf(axis, m)) }));
      return parts.join(', ');
    },
    [axis, monthYear, viewObs, viewValues, viewBase, fmt, t, series, manifest, i18n, viewRecords, monthLong],
  );

  const s1 = sensorStartYear(manifest, 'viirs_snpp') ?? 2012;
  const s2 = sensorStartYear(manifest, 'viirs_noaa20') ?? 2018;
  const seriesHelp = (() => {
    if (series === 'harmonized') return t('help_harmonized');
    if (series === 'naive') return t('help_naive', { y1: s1, y2: s2 });
    const meta = manifest.series.find((q) => q.id === series);
    return t('help_raw', { first: meta?.first ?? '', last: meta?.last ?? '' });
  })();
  const sparse = useMemo(() => viewBase.months.filter((b) => Number.isFinite(b.median) && b.median < MIN_EXCESS).length >= 3, [viewBase]);

  return (
    <div className="calendar-section">
      <div className="cal-controls">
        <div className="field">
          <label className="label" htmlFor={`${id}-series`}>
            {t('seriesShown')}
          </label>
          <select id={`${id}-series`} value={series} onChange={(e) => set({ series: e.target.value as typeof series })}>
            {VIEW_SERIES.map((s) => (
              <option key={s} value={s}>
                {seriesLabel(s, i18n)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label" id={`${id}-mode`}>
            {t('modeLabel')}
          </span>
          <div className="seg" role="group" aria-labelledby={`${id}-mode`}>
            {(['counts', 'anomaly', 'pct'] as CalMode[]).map((k) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => set({ mode: k })}>
                {k === 'counts' ? t('modeCounts') : k === 'anomaly' ? t('modeAnomaly') : t('modePct')}
              </button>
            ))}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={showValues} onChange={(e) => set({ showValues: e.target.checked })} />
          {t('showValues')}
        </label>
      </div>
      <p className="help">{seriesHelp}</p>
      <Calendar
        axis={axis}
        values={viewValues}
        obs={viewObs}
        base={viewBase}
        mode={mode}
        theme={theme}
        showValues={showValues}
        range={range}
        onPick={pickMonth}
        onPickYear={onPickYear}
        renderTip={renderTip}
        describe={describe}
        scale={calScale}
        label={`${t('calLabel')}: ${seriesLabel(series, i18n)}, ${name}`}
      />
      {mode !== 'counts' && sparse && <p className="notice">{t('sparseNote', { n: MIN_EXCESS })}</p>}
      <CalendarLegend mode={mode} theme={theme} scale={calScale} base={viewBase} shared={series !== 'harmonized'} />
      <p className="help small">{t('calHelp')}</p>
    </div>
  );
}
