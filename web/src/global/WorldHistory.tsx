import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n.tsx';
import './world-history.css';

interface History {
  source: string;
  sourceUrl: string;
  startYear: number;
  endYear: number;
  world: number[];
  countries: Record<string, { name: string; months: number[] }>;
}

/** Calendar months, 0-based; names come from the reading language */
const MONTHS = Array.from({ length: 12 }, (_, m) => m);
const median = (values: number[]) => { const ordered = [...values].sort((a, b) => a - b); return ordered.length ? (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2 : 0; };

export function WorldHistory() {
  const { t, locale, fmt, monthShort, monthYear } = useI18n();
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState(false);
  const [area, setArea] = useState('world');
  const [selected, setSelected] = useState(2025 * 12 + 11);
  const [full, setFull] = useState(false);
  const [calendarMode, setCalendarMode] = useState<'area' | 'anomaly'>('area');
  const [showValues, setShowValues] = useState(true);
  // hectares short enough for the small calendar cells: whole thousands, millions to one decimal
  const display = useMemo(() => {
    const thousands = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 0 });
    const millions = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    return (hectares: number) => hectares >= 1_000_000 ? millions.format(hectares) : hectares >= 1_000 ? thousands.format(hectares) : fmt(hectares);
  }, [locale, fmt]);
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}data-global/history.json`)
      .then((r) => { if (!r.ok) throw new Error('history unavailable'); return r.json() as Promise<History>; })
      .then((data) => { if (active) setHistory(data); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const values = area === 'world' ? history?.world : history?.countries[area]?.months;
  const max = useMemo(() => Math.max(1, ...(values ?? [])), [values]);
  const countries = useMemo(() => Object.entries(history?.countries ?? {}).sort((a, b) => a[1].name.localeCompare(b[1].name, locale)), [history, locale]);
  const currentIndex = selected - 2002 * 12;
  const chosen = values?.[currentIndex] ?? 0;
  const month = selected % 12;
  const typical = values ? median(values.filter((_, i) => i % 12 === month && i !== currentIndex)) : 0;
  const ratio = typical > 0 ? chosen / typical : 0;
  const years = Array.from({ length: full ? 24 : 6 }, (_, i) => 2025 - i);

  return <section className="world-history" aria-label={t('whLabel')}>
    <div className="world-history-step"><i>1</i><span>{t('whStepArea')}</span></div>
    <label htmlFor="world-history-area">{t('whAreaLabel')}</label>
    <select id="world-history-area" value={area} onChange={(event) => setArea(event.target.value)}>
      <option value="world">{t('wholeWorld')}</option>
      {countries.map(([code, country]) => <option key={code} value={code}>{country.name}</option>)}
    </select>
    <p className="world-history-note">{t('whNote')}</p>
    <div className="world-history-step"><i>2</i><span>{t('whStepCalendar')}</span></div>
    <div className="world-history-heading"><strong>2002–2025</strong><button type="button" onClick={() => setFull(!full)}>{full ? t('whRecent') : t('whFull')}</button></div>
    <div className="world-history-modes" role="group" aria-label={t('whMeasure')}><button type="button" aria-pressed={calendarMode === 'area'} onClick={() => setCalendarMode('area')}>{t('whModeArea')}</button><button type="button" aria-pressed={calendarMode === 'anomaly'} onClick={() => setCalendarMode('anomaly')}>{t('whModeAnomaly')}</button></div>
    <label className="world-history-values"><input type="checkbox" checked={showValues} onChange={(event) => setShowValues(event.target.checked)} /> {t('whShowValues')}</label>
    {error ? <p role="alert">{t('whError')}</p> : !history ? <p role="status">{t('whLoading')}</p> : <>
      <div className="world-history-grid" role="grid" aria-label={t('whGridLabel')}>
        <span className="world-history-yearhead" />
        {MONTHS.map((m) => <span key={m} className="world-history-monthhead">{monthShort(m + 1)}</span>)}
        {years.map((year) => <div className="world-history-row" role="row" key={year}>
          <span className="world-history-year">{year}</span>
          {MONTHS.map((m) => {
            const index = (year - 2002) * 12 + m;
            const value = values?.[index] ?? 0;
            const baseline = median((values ?? []).filter((_, i) => i % 12 === m && i !== index));
            const relative = baseline > 0 ? value / baseline : null;
            const heat = calendarMode === 'area' ? value > 0 ? Math.max(.14, Math.log1p(value) / Math.log1p(max)) : 0 : relative === null ? 0 : Math.min(1, Math.abs(Math.log2(Math.max(.1, relative))) / 2);
            const when = monthYear(year, m + 1);
            const ha = fmt(Math.round(value));
            const pct = relative === null ? '' : fmt(Math.round(relative * 100));
            const label = t('whCell', { when, ha });
            return <button key={m} type="button" role="gridcell" className={calendarMode === 'anomaly' && relative !== null ? relative >= 1 ? 'above-usual' : 'below-usual' : undefined} aria-selected={selected === year * 12 + m} title={relative !== null ? t('whCellPct', { when, ha, pct }) : label} aria-label={label} onClick={() => setSelected(year * 12 + m)} style={{ '--heat': heat } as CSSProperties}>{showValues ? calendarMode === 'area' ? display(value) : relative === null ? '–' : `${pct}%` : ''}</button>;
          })}
        </div>)}
      </div>
      <div className="world-history-selection"><span>{monthYear(Math.floor(selected / 12), month + 1)}</span><strong>{t('whSelArea', { ha: fmt(Math.round(chosen)) })}</strong><small>{typical > 0 ? t('whSelRatio', { r: fmt(ratio, 1), month: monthShort(month + 1) }) : t('whSelNone')}</small></div>
      <p className="world-history-source">{t('whSource')} <a href={history.sourceUrl} target="_blank" rel="noreferrer">{t('whSourceLink')} ↗</a></p>
    </>}
  </section>;
}
