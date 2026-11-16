// Raw sensors, the naive merge and the harmonized series on one chart, plus the size of the
// steps each new sensor introduces and anomaly calendars with and without harmonization.
import { useMemo, useState } from 'react';
import { indexOf, indexOfLabel, monthOf, yearOf } from '../lib/months.ts';
import type { RegionSeries, ViewSeries } from '../lib/series.ts';
import { pick } from '../lib/series.ts';
import type { Observability } from '../lib/analytics.ts';
import { annualTotals, computeBaseline, observability, readMonth, stepRatio, zForDisplay } from '../lib/analytics.ts';
import type { Theme } from '../lib/color.ts';
import type { Model } from '../model.ts';
import { SERIES_STYLE, sensorStartIndex, sensorStartYear, seriesLabel } from '../model.ts';
import { useI18n } from '../i18n.tsx';
import type { Key } from '../i18n.tsx';
import { LineChart, SeriesLegend } from './LineChart.tsx';
import type { LineSpec } from './LineChart.tsx';
import { Calendar } from './Calendar.tsx';

const ORDER: ViewSeries[] = ['modis_terra', 'modis_aqua', 'viirs_snpp', 'viirs_noaa20', 'naive', 'harmonized'];
const shortName = (label: string) => label.replace(/^(MODIS|VIIRS)\s+/, '');

export function SensorComparison({
  model,
  rs,
  band,
  theme,
  regionName,
  bare = false,
}: {
  model: Model;
  rs: RegionSeries;
  band: { lo: Float64Array; hi: Float64Array };
  theme: Theme;
  regionName: string;
  /** inside a container that already shows the title and the region */
  bare?: boolean;
}) {
  const i18n = useI18n();
  const { t, fmt, monthYear } = i18n;
  const { manifest, axis } = model;
  const [unit, setUnit] = useState<'annual' | 'monthly'>('annual');
  const [log, setLog] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const obsBy = useMemo(() => {
    const o = {} as Record<ViewSeries, Observability>;
    for (const s of ORDER) o[s] = observability(manifest, axis, s);
    return o;
  }, [manifest, axis]);

  const annual = useMemo(() => {
    const y0 = yearOf(axis, 0);
    const y1 = yearOf(axis, axis.n - 1);
    const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
    const lastComplete = manifest.months.last_complete ? indexOfLabel(axis, manifest.months.last_complete) : axis.n - 1;
    const full = (s: ViewSeries, y: number) => {
      for (let c = 1; c <= 12; c++) {
        const m = indexOf(axis, y, c);
        if (!obsBy[s].observed(m) || m > lastComplete) return false;
      }
      return true;
    };
    // keep years where at least the naive merge has all 12 months
    const keep = years.filter((y) => full('naive', y));
    const values = {} as Record<ViewSeries, number[]>;
    for (const s of ORDER) {
      const v = pick(rs, s);
      values[s] = keep.map((y) => {
        if (!full(s, y)) return NaN;
        let acc = 0;
        for (let c = 1; c <= 12; c++) acc += v[indexOf(axis, y, c)];
        return acc;
      });
    }
    const sumBand = (arr: Float64Array) =>
      keep.map((y) => {
        let acc = 0;
        for (let c = 1; c <= 12; c++) acc += arr[indexOf(axis, y, c)];
        return acc;
      });
    return { years: keep, values, lo: sumBand(band.lo), hi: sumBand(band.hi) };
  }, [rs, band, axis, obsBy, manifest]);

  const monthly = useMemo(() => {
    const values = {} as Record<ViewSeries, number[]>;
    for (const s of ORDER) {
      const v = pick(rs, s);
      values[s] = Array.from({ length: axis.n }, (_, m) => (obsBy[s].observed(m) ? v[m] : NaN));
    }
    return values;
  }, [rs, axis, obsBy]);

  const lines: LineSpec[] = ORDER.map((s) => {
    const st = SERIES_STYLE[s];
    const values = unit === 'annual' ? annual.values[s] : monthly[s];
    return {
      id: s,
      label: seriesLabel(s, i18n),
      values,
      color: st.color,
      width: st.width,
      dash: st.dash,
      band:
        s === 'harmonized'
          ? unit === 'annual'
            ? { lo: annual.lo, hi: annual.hi, label: t('cmpBand') }
            : { lo: band.lo, hi: band.hi, label: t('cmpBand') }
          : undefined,
    };
  });

  const annotations = useMemo(() => {
    const out: { i: number; label: string }[] = [];
    for (const id of ['modis_aqua', 'viirs_snpp', 'viirs_noaa20']) {
      const meta = manifest.series.find((q) => q.id === id);
      if (!meta) continue;
      const name = shortName(meta.label);
      if (unit === 'annual') {
        const y = sensorStartYear(manifest, id);
        const i = y === null ? -1 : annual.years.indexOf(y);
        if (i > 0) out.push({ i, label: name });
      } else {
        const m = sensorStartIndex(manifest, axis, id);
        if (m !== null) out.push({ i: m, label: name });
      }
    }
    return out;
  }, [manifest, axis, unit, annual.years]);

  const n = unit === 'annual' ? annual.years.length : axis.n;
  const xTicks = useMemo(() => {
    if (unit === 'annual') {
      const step = annual.years.length > 16 ? 4 : 2;
      return annual.years.map((y, i) => ({ i, label: String(y) })).filter((tk) => Number(tk.label) % step === 0);
    }
    const out: { i: number; label: string }[] = [];
    for (let m = 0; m < axis.n; m++) if (monthOf(axis, m) === 1 && yearOf(axis, m) % 4 === 0) out.push({ i: m, label: String(yearOf(axis, m)) });
    return out;
  }, [unit, annual.years, axis]);

  // Step sizes when VIIRS arrives.
  const steps = useMemo(() => {
    const naiveA = annualTotals(rs.naive, axis, obsBy.naive);
    const harmA = annualTotals(rs.harmonized, axis, obsBy.harmonized);
    return (['viirs_snpp', 'viirs_noaa20'] as const)
      .map((id) => {
        const y = sensorStartYear(manifest, id);
        if (y === null) return null;
        return { id, year: y, naive: stepRatio(naiveA, y), harm: stepRatio(harmA, y) };
      })
      .filter(Boolean) as { id: string; year: number; naive: ReturnType<typeof stepRatio>; harm: ReturnType<typeof stepRatio> }[];
  }, [rs, axis, obsBy, manifest]);

  const naiveBase = useMemo(
    () => computeBaseline(rs.naive, axis, obsBy.naive, manifest.baseline.first_year, manifest.baseline.last_year),
    [rs, axis, obsBy, manifest],
  );
  const harmBase = useMemo(
    () => computeBaseline(rs.harmonized, axis, obsBy.harmonized, manifest.baseline.first_year, manifest.baseline.last_year),
    [rs, axis, obsBy, manifest],
  );

  const miniTip = (values: Float64Array, base: typeof naiveBase, label: string) => (m: number) => {
    const c = monthOf(axis, m);
    const r = readMonth(values, axis, base, m);
    const x = r.x;
    const z = r.z;
    return (
      <div>
        <div className="tt-title">
          {monthYear(yearOf(axis, m), c)} · {label}
        </div>
        <div className="tt-value">
          {fmt(x)} {t('tipHotspots')}
        </div>
        <div className="tt-note">
          {Number.isFinite(z) && r.cls ? `${t(`cls_${r.cls}` as Key)} · ${t('tipZ', { z: fmt(zForDisplay(z), 1) })}` : t('tipNoBaseline')}
        </div>
      </div>
    );
  };

  const ratioText = (r: { ratio: number } | null) => (r ? `×${fmt(r.ratio, 2)}` : '–');
  const unitLabel = unit === 'annual' ? t('cmpAnnual').toLowerCase() : t('cmpMonthly').toLowerCase();

  return (
    <section className="grid-cmp" aria-labelledby={bare ? undefined : 'cmp-title'} aria-label={bare ? t('cmpTitle') : undefined}>
      <div className="card">
        <div className="card-head">
          {!bare && (
            <div>
              <h2 id="cmp-title">{t('cmpTitle')}</h2>
              <div className="sub">{regionName}</div>
            </div>
          )}
          <div className="row">
            <div className="seg" role="group" aria-label={t('cmpTitle')}>
              <button type="button" aria-pressed={unit === 'annual'} onClick={() => setUnit('annual')}>
                {t('cmpAnnual')}
              </button>
              <button type="button" aria-pressed={unit === 'monthly'} onClick={() => setUnit('monthly')}>
                {t('cmpMonthly')}
              </button>
            </div>
            <label className="check">
              <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} />
              {t('logScale')}
            </label>
          </div>
        </div>
        <p className="help">{t('cmpExplain')}</p>
        <SeriesLegend
          lines={lines}
          extra={
            <span className="key">
              <span style={{ width: 18, height: 10, background: 'var(--band)', display: 'inline-block', borderRadius: 2 }} />
              {t('cmpBand')}
            </span>
          }
        />
        <LineChart
          n={n}
          xLabel={(i) => (unit === 'annual' ? String(annual.years[i]) : monthYear(yearOf(axis, i), monthOf(axis, i)))}
          xTicks={xTicks}
          lines={lines}
          log={log}
          height={330}
          annotations={annotations}
          ariaLabel={t('cmpLabel', { unit: unitLabel })}
          formatValue={(v) => fmt(v)}
          formatTick={(v) => i18n.fmtCompact(v)}
        />
        <div className="tiles">
          {steps.map((s) => (
            <div className="tile" key={s.id}>
              <div className="t-label">{t('stepTitle', { sensor: seriesLabel(s.id as ViewSeries, i18n), year: s.year })}</div>
              {s.naive || s.harm ? (
                <div className="row" style={{ gap: 18, alignItems: 'baseline' }}>
                  <span>
                    <span className="t-value" style={{ color: 'var(--c-naive)' }}>
                      {ratioText(s.naive)}
                    </span>{' '}
                    <span className="small muted">{t('s_naive')}</span>
                  </span>
                  <span>
                    <span className="t-value">{ratioText(s.harm)}</span> <span className="small muted">{t('s_harmonized')}</span>
                  </span>
                </div>
              ) : (
                <div className="t-text">{t('stepNA')}</div>
              )}
              {s.naive && s.harm && (
                <div className="t-text">{t('stepSensor', { r: fmt(s.naive.ratio / s.harm.ratio, 2) })}</div>
              )}
              <div className="t-text small">{t('stepNote', { year: s.year })}</div>
            </div>
          ))}
        </div>
        <div>
          <button type="button" className="ghost small" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? t('hideTable') : t('tableView')}
          </button>
          {showTable && (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('year')}</th>
                    {ORDER.map((s) => (
                      <th className="n" key={s}>
                        {seriesLabel(s, i18n)}
                      </th>
                    ))}
                    <th className="n">{t('cmpBand')}</th>
                  </tr>
                </thead>
                <tbody>
                  {annual.years.map((y, i) => (
                    <tr key={y}>
                      <td className="num">{y}</td>
                      {ORDER.map((s) => (
                        <td className="n" key={s}>
                          {fmt(annual.values[s][i])}
                        </td>
                      ))}
                      <td className="n">{annual.hi[i] - annual.lo[i] > 1e-9 ? `${fmt(annual.lo[i])} – ${fmt(annual.hi[i])}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div>
          <h2>{t('miniTitle')}</h2>
          <p className="help" style={{ marginTop: 4 }}>
            {t('miniExplain')}
          </p>
        </div>
        <div className="grid-2" style={{ gap: 12 }}>
          {(
            [
              ['naive', rs.naive, naiveBase],
              ['harmonized', rs.harmonized, harmBase],
            ] as const
          ).map(([id, values, base]) => (
            <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <h3 className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {seriesLabel(id, i18n)}
              </h3>
              <Calendar
                axis={axis}
                values={values}
                obs={obsBy[id]}
                base={base}
                mode="anomaly"
                theme={theme}
                compact
                label={`${t('miniTitle')}: ${seriesLabel(id, i18n)}`}
                renderTip={miniTip(values, base, seriesLabel(id, i18n))}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
