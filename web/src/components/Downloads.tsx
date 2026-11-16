// Downloads: the region's monthly series, the raw detections behind it, and the calendar image.
import { useEffect, useRef, useState } from 'react';
import type { PointsIndex } from '../bundle/types.ts';
import { SENSORS } from '../bundle/types.ts';
import { loadPointsIndex, loadPointsYear } from '../bundle/load.ts';
import { indexOf, yearOf } from '../lib/months.ts';
import type { Region } from '../lib/region.ts';
import { pointFilter } from '../lib/region.ts';
import type { RegionSeries, ViewSeries } from '../lib/series.ts';
import type { Baseline, Observability } from '../lib/analytics.ts';
import { fireSeason, observability, readMonth } from '../lib/analytics.ts';
import type { CountScale, Theme } from '../lib/color.ts';
import type { CalMode } from '../state.ts';
import { csvRow, downloadBlob, round, slug } from '../lib/csv.ts';
import { useI18n } from '../i18n.tsx';
import type { Key } from '../i18n.tsx';
import type { Model } from '../model.ts';
import { rangeLabel, seriesLabel } from '../model.ts';
import { calendarPng } from './calendarPng.ts';

const SATELLITE = ['Terra', 'Aqua', 'N', 'N20', 'N21'];
/** Larger outputs risk exhausting browser memory while the file is assembled. */
const MAX_CSV_ROWS = 1_500_000;
const VIIRS_CONF = ['', 'l', 'n', 'h'];

const CUM_DAYS = (leap: boolean) => {
  const d = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const out = [0];
  for (const x of d) out.push(out[out.length - 1] + x);
  return out;
};

export function Downloads(props: {
  model: Model;
  region: Region;
  regionName: string;
  cells: Uint32Array;
  rs: RegionSeries;
  range: [number, number];
  harmBand: { lo: Float64Array; hi: Float64Array };
  harmBase: Baseline;
  harmObs: Observability;
  calendar: { values: Float64Array; obs: Observability; base: Baseline; mode: CalMode; theme: Theme; showValues: boolean; series: ViewSeries; scale: CountScale };
  /** inside a container that already carries the title */
  bare?: boolean;
}) {
  const { model, region, regionName, cells, rs, range, harmBand, harmBase, harmObs, calendar, bare = false } = props;
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { manifest, axis, table, bundle } = model;
  const [index, setIndex] = useState<PointsIndex | null>(null);
  const [busy, setBusy] = useState<null | { pct: number }>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cancel = useRef(false);
  const base = slug(regionName);

  useEffect(() => {
    loadPointsIndex(bundle)
      .then(setIndex)
      .catch(() => setIndex(null));
  }, [bundle]);

  const yFrom = yearOf(axis, range[0]);
  const yTo = yearOf(axis, range[1]);
  const yearsNeeded: number[] = [];
  for (let y = yFrom; y <= yTo; y++) if (index?.years[String(y)]) yearsNeeded.push(y);
  const mb = yearsNeeded.reduce((s, y) => s + (index?.years[String(y)]?.bytes ?? 0), 0) / 1e6;
  // Rows used in the counts are known exactly from the table; low-confidence rows add some more.
  let usedRows = 0;
  for (let m = Math.max(0, range[0]); m <= Math.min(axis.n - 1, range[1]); m++) for (const s of SENSORS) usedRows += rs.raw[s][m];
  const tooMany = usedRows * 1.25 > MAX_CSV_ROWS;

  // ------------------------------------------------------------ monthly series
  const downloadSeries = () => {
    const rawObs = Object.fromEntries(SENSORS.map((s) => [s, observability(manifest, axis, s)])) as Record<string, Observability>;
    const naiveObs = observability(manifest, axis, 'naive');
    const header = [
      'month', 'harmonized', 'harmonized_lo80', 'harmonized_hi80', 'harmonized_source', 'coverage', 'partial',
      ...SENSORS, 'naive_merge', 'median_harmonized', 'pct_of_median', 'z', 'anomaly_class',
    ];
    const lines = [csvRow(header)];
    for (let m = 0; m < axis.n; m++) {
      const observed = harmObs.observed(m);
      const r = observed ? readMonth(rs.harmonized, axis, harmBase, m) : null;
      lines.push(
        csvRow([
          axis.labels[m],
          observed ? round(rs.harmonized[m]) : null,
          observed ? round(harmBand.lo[m]) : null,
          observed ? round(harmBand.hi[m]) : null,
          manifest.month_source[m],
          round(harmObs.availability(m), 3),
          harmObs.partial(m) ? 1 : 0,
          ...SENSORS.map((s) => (rawObs[s].observed(m) ? rs.raw[s][m] : null)),
          naiveObs.observed(m) ? rs.naive[m] : null,
          r ? round(r.median) : null,
          r ? round(r.pct, 1) : null,
          r ? round(r.z, 3) : null,
          r?.cls ?? null,
        ]),
      );
    }
    downloadBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }), `focos_${base}_monthly.csv`);
  };

  // ------------------------------------------------------------ seasonal profile and fire season
  const profileYear = yearOf(axis, range[1]);
  const downloadProfile = () => {
    const season = fireSeason(harmBase);
    const inSeason = (c: number) => {
      if (!season) return false;
      const k = (c - season.start + 12) % 12;
      return k < season.length;
    };
    const header = [
      'calendar_month', 'month_name', 'median', 'q25', 'q75', 'baseline_years',
      'in_fire_season', 'peak_month', `harmonized_${profileYear}`, `z_${profileYear}`, `class_${profileYear}`,
    ];
    const lines = [csvRow(header)];
    for (let c = 1; c <= 12; c++) {
      const b = harmBase.months[c - 1];
      const m = indexOf(axis, profileYear, c);
      const ok = m >= 0 && m < axis.n && harmObs.observed(m) && !harmObs.partial(m);
      const r = ok ? readMonth(rs.harmonized, axis, harmBase, m) : null;
      lines.push(
        csvRow([
          c,
          i18n.monthLong(c),
          round(b.median),
          round(b.q25),
          round(b.q75),
          b.years.length,
          inSeason(c) ? 1 : 0,
          season && season.peak === c ? 1 : 0,
          r ? round(r.x) : null,
          r ? round(r.z, 3) : null,
          r?.cls ?? null,
        ]),
      );
    }
    downloadBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }), `focos_${base}_seasonal_profile_${profileYear}.csv`);
  };

  // ------------------------------------------------------------ raw detections
  const downloadPoints = async () => {
    if (!index || busy) return;
    cancel.current = false;
    setMessage(null);
    setBusy({ pct: 0 });
    try {
      const inRegion = pointFilter(region, table, manifest.grid, cells);
      const parts: string[] = [
        csvRow(['latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'instrument', 'confidence', 'version', 'frp', 'brightness', 'daynight', 'used_in_harmonization']) + '\n',
      ];
      let rows = 0;
      for (let k = 0; k < yearsNeeded.length; k++) {
        if (cancel.current) break;
        const y = yearsNeeded[k];
        const info = index.years[String(y)];
        const pts = await loadPointsYear(bundle, info, y, (f) => setBusy({ pct: (100 * (k + f * 0.8)) / yearsNeeded.length }));
        const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        const cum = CUM_DAYS(leap);
        // month index range expressed as day-of-year bounds within this year
        const mStart = indexOf(axis, y, 1);
        const lo = Math.max(range[0], mStart) - mStart; // 0..11
        const hi = Math.min(range[1], mStart + 11) - mStart;
        const dayLo = cum[lo] + 1;
        const dayHi = cum[hi + 1];
        let chunk: string[] = [];
        for (let i = 0; i < pts.n; i++) {
          const d = pts.day[i];
          if (d < dayLo || d > dayHi) continue;
          const lon = pts.lon[i];
          const lat = pts.lat[i];
          if (!inRegion(lon, lat)) continue;
          let mo = 0;
          while (mo < 11 && d > cum[mo + 1]) mo++;
          const dom = d - cum[mo];
          const s = pts.sensor[i];
          const viirs = s >= 2;
          chunk.push(
            csvRow([
              round(lat, 5),
              round(lon, 5),
              `${y}-${String(mo + 1).padStart(2, '0')}-${String(dom).padStart(2, '0')}`,
              String(pts.hhmm[i]).padStart(4, '0'),
              index.sensors?.[String(s)] ?? SATELLITE[s] ?? String(s),
              viirs ? 'VIIRS' : 'MODIS',
              viirs ? VIIRS_CONF[pts.conf[i]] ?? String(pts.conf[i]) : pts.conf[i],
              index.versions[pts.version[i]] ?? String(pts.version[i]),
              round(pts.frp[i], 2),
              round(pts.bright[i], 2),
              pts.flags[i] & 1 ? 'N' : 'D',
              pts.flags[i] & 2 ? 1 : 0,
            ]),
          );
          rows++;
          if (chunk.length >= 20000) {
            parts.push(chunk.join('\n') + '\n');
            chunk = [];
          }
        }
        if (chunk.length) parts.push(chunk.join('\n') + '\n');
        setBusy({ pct: (100 * (k + 1)) / yearsNeeded.length });
        // yield so the progress bar repaints between years
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!cancel.current) {
        const period = `${axis.labels[range[0]]}_${axis.labels[range[1]]}`;
        downloadBlob(new Blob(parts, { type: 'text/csv;charset=utf-8' }), `focos_${base}_hotspots_${period}.csv`);
        setMessage(t('dlDone', { n: fmt(rows) }));
      }
    } catch (e) {
      setMessage(t('dlError', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------ calendar image
  const downloadPng = async () => {
    try {
      const modeKey: Key = calendar.mode === 'counts' ? 'modeCounts' : calendar.mode === 'anomaly' ? 'modeAnomaly' : 'modePct';
      const blob = await calendarPng({
        axis,
        values: calendar.values,
        obs: calendar.obs,
        base: calendar.base,
        mode: calendar.mode,
        theme: calendar.theme,
        showValues: calendar.showValues,
        scale: calendar.scale,
        title: `${regionName}: ${t('calTitle').toLowerCase()}, ${seriesLabel(calendar.series, i18n)}`,
        subtitle: `${t(modeKey)} · ${manifest.country} · ${rangeLabel(axis, 0, axis.n - 1, i18n)}${bundle.synthetic ? ` · ${t('syntheticBadge')}` : ''}`,
        credit: `Focos · NASA FIRMS MODIS C6.1 and VIIRS 375 m · ${t('generated', { date: manifest.generated.slice(0, 10) })}`,
        i18n,
      });
      downloadBlob(blob, `focos_${base}_calendar_${calendar.series}_${calendar.mode}.png`);
    } catch (e) {
      setMessage(t('dlError', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <section className={bare ? 'dl-section' : 'card'} aria-labelledby={bare ? undefined : 'dl-title'} aria-label={bare ? t('dlTitle') : undefined}>
      {!bare && <h2 id="dl-title">{t('dlTitle')}</h2>}
      <div className="downloads">
        <div className="dl">
          <button type="button" className="btn primary" onClick={downloadSeries}>
            {t('dlSeries')}
          </button>
          <p className="help small">{t('dlSeriesHelp')}</p>
        </div>
        <div className="dl">
          <button type="button" className="btn primary" onClick={downloadProfile}>
            {t('dlProfile')}
          </button>
          <p className="help small">{t('dlProfileHelp', { first: harmBase.first, last: harmBase.last, year: profileYear })}</p>
        </div>
        <div className="dl">
          <div className="row">
            <button type="button" className="btn primary" onClick={downloadPoints} disabled={!index || busy !== null || yearsNeeded.length === 0 || tooMany}>
              {t('dlPoints')}
            </button>
            {busy && (
              <button type="button" className="btn" onClick={() => (cancel.current = true)}>
                {t('dlCancel')}
              </button>
            )}
          </div>
          <p className="help small">
            {rangeLabel(axis, range[0], range[1], i18n)}. {t('dlPointsHelp', { n: yearsNeeded.length, mb: fmt(mb, mb < 10 ? 1 : 0) })}{' '}
            {t('dlPointsRows', { n: fmt(usedRows) })}
          </p>
          {tooMany && (
            <p className="small" role="note">
              {t('dlTooMany', { max: fmt(MAX_CSV_ROWS) })}
            </p>
          )}
          {busy && (
            <>
              <div className="progress" role="progressbar" aria-label={t('dlProgress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(busy.pct)}>
                <div style={{ width: `${busy.pct}%` }} />
              </div>
              <span className="small muted">{t('dlWorking', { pct: `${Math.round(busy.pct)}%` })}</span>
            </>
          )}
        </div>
        <div className="dl">
          <button type="button" className="btn primary" onClick={downloadPng}>
            {t('dlPng')}
          </button>
          <p className="help small">{t('dlPngHelp')}</p>
        </div>
      </div>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
