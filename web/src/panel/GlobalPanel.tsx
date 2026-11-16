import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Calendar, CalendarLegend, seriesScale } from '../components/Calendar.tsx';
import { Analytics } from '../components/Analytics.tsx';
import { useI18n } from '../i18n.tsx';
import { computeBaseline, fireSeason, readMonth, type Observability } from '../lib/analytics.ts';
import { indexOf, makeAxis, monthOf, yearOf } from '../lib/months.ts';
import { Section } from '../shell/Section.tsx';
import { SpaceAppsLogo } from '../shell/TopBar.tsx';
import type { CalMode } from '../state.ts';
import { useUi } from '../store.ts';

interface History {
  source: string;
  sourceUrl: string;
  startYear: number;
  endYear: number;
  world: number[];
  countries: Record<string, { name: string; months: number[] }>;
}

const axis = makeAxis('2002-01', 24 * 12);
/** Link text for the historical source: product names, the same in every language. */
const GWIS_SOURCE = 'GWIS / JRC';
const obs: Observability = {
  observed: (m) => m >= 0 && m < axis.n,
  availability: (m) => m >= 0 && m < axis.n ? 1 : 0,
  partial: () => false,
};

/** A sentence holding one link: the dictionary marks the link's place with {link}. */
function linked(text: string, link: ReactNode) {
  const [before, after = ''] = text.split('{link}');
  return <>{before}{link}{after}</>;
}

/** The original Focos sidebar and calendar, supplied with worldwide GWIS burned-area data. */
export function GlobalPanel() {
  const { t, fmt, monthShort, monthYear } = useI18n();
  const id = useId();
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState(false);
  const [area, setArea] = useState(() => useUi.getState().worldFocus?.code ?? 'world');
  const worldFocus = useUi((state) => state.worldFocus);
  const focusedArea = worldFocus?.code;
  const [focusBounds, setFocusBounds] = useState<Record<string, [number, number, number, number]> | null>(null);
  const [range, setRange] = useState<[number, number]>([276, 287]);
  const [selectedPreset, setSelectedPreset] = useState<string | null>('last12');
  const [mode, setMode] = useState<CalMode>('counts');
  const [showValues, setShowValues] = useState(true);
  useEffect(() => { if (focusedArea && focusedArea !== area) setArea(focusedArea); }, [focusedArea]);
  useEffect(() => {
    const selectFromEmber = (event: Event) => {
      const detail = (event as CustomEvent<{ code: string; monthIndex?: number; showAnomaly?: boolean }>).detail;
      if (detail?.code) setArea(detail.code);
      if (detail?.showAnomaly) setMode('anomaly');
      if (Number.isInteger(detail?.monthIndex) && detail.monthIndex! >= 0 && detail.monthIndex! < axis.n) {
        setRange([detail.monthIndex!, detail.monthIndex!]);
        setSelectedPreset(null);
      }
    };
    window.addEventListener('focos:ember-area', selectFromEmber);
    return () => window.removeEventListener('focos:ember-area', selectFromEmber);
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}data-global/history.json`)
      .then((r) => { if (!r.ok) throw new Error('Global history unavailable'); return r.json() as Promise<History>; })
      .then((data) => { if (active) setHistory(data); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}data-global/country-focus.json`)
      .then((r) => { if (!r.ok) throw new Error('Country bounds unavailable'); return r.json() as Promise<{ bounds: Record<string, [number, number, number, number]> }>; })
      .then((data) => { if (active) setFocusBounds(data.bounds); })
      .catch(() => { /* History remains usable even if camera bounds cannot load. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const bounds = focusBounds?.[area];
    const current = useUi.getState().worldFocus;
    if (area !== 'world' && bounds && (!current || current.code !== area || !current.bounds)) useUi.getState().set({ worldFocus: { code: area, name: history?.countries[area]?.name ?? area, bounds } });
  }, [area, focusBounds, history]);

  const countries = useMemo(() => Object.entries(history?.countries ?? {}).sort((a, b) => a[1].name.localeCompare(b[1].name)), [history]);
  const name = area === 'world' ? t('wholeWorld') : history?.countries[area]?.name ?? area;
  // the whole-world focus is named in the reader's language, whoever stored it and in which language
  const focusName = worldFocus && (worldFocus.code === 'world' && !worldFocus.bounds ? t('wholeWorld') : worldFocus.name);
  const values = useMemo(() => new Float64Array(area === 'world' ? history?.world ?? [] : history?.countries[area]?.months ?? []), [history, area]);
  const base = useMemo(() => computeBaseline(values, axis, obs, 2002, 2024), [values]);
  const scale = useMemo(() => seriesScale(values, obs, 'dark'), [values]);
  const season = useMemo(() => fireSeason(base), [base]);
  const pickMonth = (m: number, extend: boolean) => { setSelectedPreset(null); setRange(extend ? [Math.min(range[0], m), Math.max(range[1], m)] : [m, m]); };
  const pickYear = (y: number) => { setSelectedPreset(null); setRange([indexOf(axis, y, 1), indexOf(axis, y, 12)]); };
  const setEnd = (end: 0 | 1, year: number, month: number) => {
    const m = Math.max(0, Math.min(axis.n - 1, indexOf(axis, year, month)));
    setSelectedPreset(null);
    setRange(end === 0 ? [Math.min(m, range[1]), range[1]] : [range[0], Math.max(m, range[0])]);
  };
  const picker = (end: 0 | 1, label: 'from' | 'to') => {
    const m = range[end];
    const y = yearOf(axis, m);
    const mo = monthOf(axis, m);
    return <div className="field">
      <span className="label" id={`${id}-${label}`}>{t(label)}</span>
      <div className="row nowrap" role="group" aria-labelledby={`${id}-${label}`}>
        <select aria-label={`${t(label)}: ${t('month')}`} value={mo} onChange={(e) => setEnd(end, y, Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthShort(i + 1)}</option>)}
        </select>
        <select aria-label={`${t(label)}: ${t('year')}`} value={y} onChange={(e) => setEnd(end, Number(e.target.value), mo)}>
          {Array.from({ length: 24 }, (_, i) => 2025 - i).map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </div>
    </div>;
  };
  const seasonRange = (() => {
    if (!season) return null;
    const end = 287;
    const peak = indexOf(axis, 2025, season.peak);
    let start = indexOf(axis, 2025, season.start);
    if (start > peak) start -= 12;
    return [Math.max(0, start), Math.min(end, start + season.length - 1)] as [number, number];
  })();
  const presets: { key: string; label: string; range: [number, number] | null }[] = [
    { key: 'last12', label: t('presetLast12'), range: [276, 287] },
    { key: 'year', label: t('presetLastYear'), range: [276, 287] },
    { key: 'season', label: t('presetSeason'), range: seasonRange },
    { key: 'all', label: t('presetAll'), range: [0, 287] },
  ];
  const download = () => {
    const rows = ['area,month,hectares_burned'];
    for (let m = range[0]; m <= range[1]; m++) rows.push(`${JSON.stringify(name)},${axis.labels[m]},${values[m]}`);
    const url = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }));
    const link = document.createElement('a'); link.href = url; link.download = `focos-burned-area-${area}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <aside className="panel" aria-label={t('panelLabel')}>
    <Section step={1} title={t('stepArea')} id="area" name={t('stepArea')}>
      <div className="area">
        <div className="area-name"><h1>{name}</h1><span className="muted small">GWIS{' · '}{history?.startYear ?? 2002}–{history?.endYear ?? 2025}</span></div>
        <div className="field">
          <label className="label" htmlFor={`${id}-region`}>{t('region')}</label>
          <select id={`${id}-region`} value={area} onChange={(e) => { const code = e.target.value; setArea(code); useUi.getState().set({ worldFocus: code === 'world' ? { code, name: t('wholeWorld'), bounds: null } : { code, name: history?.countries[code]?.name ?? code, bounds: focusBounds?.[code] ?? null } }); }}>
            <option value="world">{t('wholeWorld')}</option>
            <optgroup label={t('gpCountries')}>{countries.map(([code, country]) => <option key={code} value={code}>{country.name}</option>)}</optgroup>
          </select>
        </div>
        <p className="help small">{t('gpAreaHelp')}</p>
        {focusName && focusName !== name && <p className="help small"><strong>{t('gpGlobeFocus', { name: focusName })}</strong> {t('gpCalendarCovers', { name })}</p>}
      </div>
      <div className="period">
        <div className="period-head"><span className="label">{t('periodShown')}</span><b className="period-label">{monthYear(yearOf(axis, range[0]), monthOf(axis, range[0]))} – {monthYear(yearOf(axis, range[1]), monthOf(axis, range[1]))}</b></div>
        <div className="seg wrap" role="group" aria-label={t('period')}>
          {presets.map((p) => <button key={p.key} type="button" aria-pressed={selectedPreset === p.key} disabled={!p.range} onClick={() => { if (p.range) { setRange(p.range); setSelectedPreset(p.key); } }}>{p.label}</button>)}
        </div>
        <div className="row period-custom">{picker(0, 'from')}{picker(1, 'to')}</div>
      </div>
    </Section>
    <Section step={2} title={t('stepCalendar')} hint={t('gpCalendarHint', { start: monthYear(axis.startYear, axis.startMonth) })} id="calendar" name={t('nameCalendar')}>
      {error ? <p role="alert">{t('gpHistoryError')}</p> : !history ? <p role="status">{t('gpHistoryLoading')}</p> : <div className="calendar-section">
        <div className="cal-controls">
          <div className="field"><label className="label" htmlFor={`${id}-series`}>{t('seriesShown')}</label><select id={`${id}-series`} defaultValue="gwis"><option value="gwis">{t('gpSeriesGwis')}</option></select></div>
          <div className="field"><span className="label" id={`${id}-mode`}>{t('modeLabel')}</span><div className="seg" role="group" aria-labelledby={`${id}-mode`}>
            {(['counts', 'anomaly', 'pct'] as CalMode[]).map((k) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{k === 'counts' ? t('gpModeBurned') : k === 'anomaly' ? t('modeAnomaly') : t('modePct')}</button>)}
          </div></div>
          <label className="check"><input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} />{t('showValues')}</label>
        </div>
        <p className="help">{t('gpCalendarNote')}</p>
        <Calendar axis={axis} values={values} obs={obs} base={base} mode={mode} theme="dark" showValues={showValues} range={range} onPick={pickMonth} onPickYear={pickYear} scale={scale} label={t('gpCalendarLabel', { name })} renderTip={(m) => <div><div className="tt-title">{monthYear(yearOf(axis, m), monthOf(axis, m))} · {name}</div><div className="tt-value">{t('gpTipBurned', { v: fmt(values[m]) })}</div><div className="tt-note">{t('gpTipPct', { pct: fmt(readMonth(values, axis, base, m).pct) })}</div></div>} describe={(m) => t('gpDescribe', { month: monthYear(yearOf(axis, m), monthOf(axis, m)), v: fmt(values[m]), name })} />
        <CalendarLegend mode={mode} theme="dark" scale={scale} base={base} countLabel={t('gpLegendCount')} />
        <p className="help small">{t('calHelp')}</p>
      </div>}
    </Section>
    {history && <Section step={3} title={t('stepNormal')} id="normal" name={t('nameAnalytics')}>
      <Analytics axis={axis} values={values} obs={obs} base={base} range={range} theme="dark" regionName={name} onPickMonth={(m) => pickMonth(m, false)} bare unit={t('gpUnit')} />
      <p className="help small">{t('gpAnalyticsNote')}</p>
    </Section>}
    <Section step={4} title={t('stepDownload')} id="download" name={t('nameDownloads')}>
      <p className="help">{t('gpDownloadHelp', { name })}</p>
      <button type="button" className="btn primary" onClick={download} disabled={!history}>{t('gpDownloadCsv')}</button>
    </Section>
    <footer className="panel-foot"><SpaceAppsLogo height={40} /><p>{t('spaceAppsLine')}</p><p>{linked(t('gpSourceHistory'), <a href={history?.sourceUrl ?? 'https://gwis.jrc.ec.europa.eu/apps/country.profile/downloads'} target="_blank" rel="noreferrer">{GWIS_SOURCE}</a>)}</p><p>{linked(t('gpSourceLive'), <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS</a>)}</p></footer>
  </aside>;
}
