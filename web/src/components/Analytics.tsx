// Region analytics on the harmonized series: seasonal profile, fire season, latest month,
// the selected period against its historical median, and the most anomalous months.
import { useId, useMemo, useState } from 'react';
import type { MonthAxis } from '../lib/months.ts';
import { indexOf, monthOf, yearOf } from '../lib/months.ts';
import type { AnomalyClass, Baseline, Observability } from '../lib/analytics.ts';
import { comparePeriod, fireSeason, latestMonth, readMonth, recordMonths, topAnomalies, zForDisplay } from '../lib/analytics.ts';
import type { Theme } from '../lib/color.ts';
import { zColor } from '../lib/color.ts';
import { useI18n } from '../i18n.tsx';
import type { Key } from '../i18n.tsx';
import { LineChart, SeriesLegend } from './LineChart.tsx';
import type { LineSpec } from './LineChart.tsx';

export function ClassBadge({ cls, z, theme }: { cls: AnomalyClass | null; z: number; theme: Theme }) {
  const { t } = useI18n();
  if (!cls) return <span className="muted">–</span>;
  const glyph = { far_above: '++', above: '+', normal: '', below: '−' }[cls];
  return (
    <span className="cls">
      <span className="dot" style={{ background: zColor(z, theme), outline: '1px solid var(--ring)' }} aria-hidden="true" />
      {t(`cls_${cls}` as Key)}
      {glyph && <span aria-hidden="true">{glyph}</span>}
    </span>
  );
}

export function Analytics({
  axis,
  values,
  obs,
  base,
  range,
  theme,
  regionName,
  onPickMonth,
  bare = false,
  unit,
}: {
  axis: MonthAxis;
  values: Float64Array;
  obs: Observability;
  base: Baseline;
  range: [number, number];
  theme: Theme;
  regionName: string;
  onPickMonth: (m: number) => void;
  /** inside a container that already carries the section title */
  bare?: boolean;
  /** Unit for a historical series other than hotspot counts. */
  unit?: string;
}) {
  const i18n = useI18n();
  const { t, fmt, monthShort, monthLong, monthYear } = i18n;
  const id = useId();
  const latest = useMemo(() => latestMonth(axis, obs), [axis, obs]);
  const defaultYear = latest ? yearOf(axis, latest.m) : yearOf(axis, axis.n - 1);
  const [year, setYear] = useState<number | null>(null);
  const shownYear = year ?? Math.min(defaultYear, yearOf(axis, range[1]));
  const y0 = yearOf(axis, 0);
  const y1 = yearOf(axis, axis.n - 1);

  const season = useMemo(() => fireSeason(base), [base]);
  const period = useMemo(() => comparePeriod(values, axis, obs, base, range[0], range[1]), [values, axis, obs, base, range]);
  const top = useMemo(() => topAnomalies(values, axis, obs, base, range[0], range[1], 6), [values, axis, obs, base, range]);
  const latestReading = latest ? readMonth(values, axis, base, latest.m) : null;
  const records = useMemo(() => recordMonths(values, axis, obs), [values, axis, obs]);

  const profileLines: LineSpec[] = useMemo(() => {
    const med = base.months.map((b) => b.median);
    const q25 = base.months.map((b) => b.q25);
    const q75 = base.months.map((b) => b.q75);
    const yv = Array.from({ length: 12 }, (_, c) => {
      const m = indexOf(axis, shownYear, c + 1);
      return obs.observed(m) && !obs.partial(m) ? values[m] : NaN;
    });
    return [
      { id: 'median', label: t('profileMedian'), values: med, color: 'var(--ink-2)', width: 2, band: { lo: q25, hi: q75, label: t('profileIqr') } },
      { id: 'year', label: String(shownYear), values: yv, color: 'var(--c-year)', width: 2.25, dots: true },
    ];
  }, [base, axis, obs, values, shownYear, t]);

  const seasonText = () => {
    if (!season) return t('seasonNone');
    const end = ((season.start - 1 + season.length - 1) % 12) + 1;
    const share = fmt(100 * season.share);
    const main =
      season.length === 1
        ? t('seasonTextOne', { start: monthLong(season.start), share })
        : t('seasonText', { start: monthLong(season.start), end: monthLong(end), n: season.length, share });
    return `${main} ${t('seasonPeak', { peak: monthLong(season.peak) })}`;
  };

  const latestText = () => {
    if (!latest || !latestReading) return '–';
    const mo = monthLong(monthOf(axis, latest.m));
    const r = latestReading;
    if (unit) return Number.isFinite(r.pct)
      ? `${fmt(r.x)} ${unit} in ${mo}, ${fmt(r.pct)}% of the ${fmt(r.median)} ${unit} monthly median.`
      : `${fmt(r.x)} ${unit} in ${mo}.`;
    return Number.isFinite(r.pct)
      ? t('latestText', { v: fmt(r.x), pct: fmt(r.pct), month: mo, median: fmt(r.median) })
      : t('latestNoMedian', { v: fmt(r.x), month: mo });
  };

  const periodText = () => {
    const p = period;
    if (unit) return Number.isFinite(p.pct)
      ? `${fmt(p.total)} ${unit} in this period, ${fmt(p.pct)}% of the historical median (${fmt(p.typical)} ${unit}).`
      : `${fmt(p.total)} ${unit} in this period.`;
    if (!Number.isFinite(p.pct)) return t('periodNoBaseline', { v: fmt(p.total) });
    if (p.kind === 'window') return t('periodText', { v: fmt(p.total), pct: fmt(p.pct), first: base.first, last: base.last, typical: fmt(p.typical) });
    return t('periodTextAnnual', { v: fmt(p.total), n: p.observedMonths, pct: fmt(p.pct), typical: fmt(p.typical) });
  };

  return (
    <section className="analytics" aria-labelledby={bare ? undefined : `${id}-title`} aria-label={bare ? t('analyticsTitle', { region: regionName }) : undefined}>
      <div>
        {!bare && (
          <h2 id={`${id}-title`} className="section-title">
            {t('analyticsTitle', { region: regionName })}
          </h2>
        )}
        <p className="help">{t('analyticsNote')}</p>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>{t('profileTitle')}</h3>
              <div className="sub">{t('profileSub', { first: base.first, last: base.last })}</div>
            </div>
            <div className="field">
              <label className="label" htmlFor={`${id}-year`}>
                {t('year')}
              </label>
              <select id={`${id}-year`} value={shownYear} onChange={(e) => setYear(Number(e.target.value))}>
                {Array.from({ length: y1 - y0 + 1 }, (_, i) => y1 - i).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <SeriesLegend
            lines={profileLines}
            extra={
              <span className="key">
                <span style={{ width: 18, height: 10, background: 'var(--band)', display: 'inline-block', borderRadius: 2 }} />
                {t('profileIqr')}
              </span>
            }
          />
          <LineChart
            n={12}
            bandX
            xLabel={(i) => monthLong(i + 1)}
            xTicks={Array.from({ length: 12 }, (_, i) => ({ i, label: monthShort(i + 1) }))}
            lines={profileLines}
            height={260}
            ariaLabel={t('profileLabel')}
            formatValue={(v) => fmt(v)}
            formatTick={(v) => i18n.fmtCompact(v)}
            directLabels={false}
          />
        </div>
        <div className="card">
          <div className="tiles">
            <div className="tile">
              <div className="t-label">{t('seasonTitle')}</div>
              {season && (
                <div className="t-value">
                  {season.length === 12
                    ? `${monthShort(1)} – ${monthShort(12)}`
                    : `${monthShort(season.start)} – ${monthShort(((season.start - 1 + season.length - 1) % 12) + 1)}`}
                </div>
              )}
              <div className="t-text">{seasonText()}</div>
            </div>
            <div className="tile">
              <div className="t-label">
                {t('latestTitle')}
                {latest ? `: ${monthYear(yearOf(axis, latest.m), monthOf(axis, latest.m))}` : ''}
              </div>
              {latestReading && (
                <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
                  <span className="t-value">{Number.isFinite(latestReading.pct) ? `${fmt(latestReading.pct)}%` : fmt(latestReading.x)}</span>
                  <ClassBadge cls={latestReading.cls} z={latestReading.z} theme={theme} />
                </div>
              )}
              <div className="t-text">{latestText()}</div>
              {latest?.partialM != null && (
                <div className="t-text small">
                  {t('latestPartial', {
                    month: monthYear(yearOf(axis, latest.partialM), monthOf(axis, latest.partialM)),
                    v: fmt(values[latest.partialM]),
                    pct: fmt(100 * obs.availability(latest.partialM)),
                  })}
                </div>
              )}
            </div>
            <div className="tile" style={{ gridColumn: '1 / -1' }}>
              <div className="t-label">{t('periodTitle')}</div>
              <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
                <span className="t-value">{Number.isFinite(period.pct) ? `${fmt(period.pct)}%` : fmt(period.total)}</span>
                <span className="small muted">{Number.isFinite(period.pct) ? t('ofMedian') : unit ?? t('colHotspots')}</span>
              </div>
              <div className="t-text">{periodText()}</div>
              {period.hasPartial && <div className="t-text small">{t('periodPartial')}</div>}
            </div>
          </div>
          <div>
            <h3 style={{ marginBottom: 6 }}>{t('topTitle')}</h3>
            {top.length === 0 ? (
              <p className="small muted">{t('topEmpty')}</p>
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('colMonth')}</th>
                      <th className="n">{unit ?? t('colHotspots')}</th>
                      <th className="n">{t('colMedian')}</th>
                      <th className="n">{t('colZ')}</th>
                      <th>{t('colClass')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((r) => (
                      <tr key={r.m}>
                        <td>
                          <button type="button" className="ghost" style={{ padding: '2px 4px' }} onClick={() => onPickMonth(r.m)}>
                            {monthYear(yearOf(axis, r.m), monthOf(axis, r.m))}
                          </button>
                        </td>
                        <td className="n">{fmt(r.x)}</td>
                        <td className="n">{fmt(r.median)}</td>
                        <td className="n">{fmt(zForDisplay(r.z), 1)}</td>
                        <td>
                          <ClassBadge cls={r.cls} z={r.z} theme={theme} />
                          {records.has(r.m) && (
                            <span className="rectag" title={t('tipRecord', { month: monthLong(monthOf(axis, r.m)) })}>
                              {t('recordTag')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
