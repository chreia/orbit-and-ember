// Burning-activity calendar: years as rows, months as columns.
import { memo, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { MonthAxis } from '../lib/months.ts';
import { indexOf, monthOf, yearOf } from '../lib/months.ts';
import type { Baseline, Observability } from '../lib/analytics.ts';
import { annualTotals, MIN_EXCESS, readMonth, recordMonths, zForDisplay } from '../lib/analytics.ts';
import type { Theme } from '../lib/color.ts';
import { countScale, inkOn, pctColor, PCT_BREAKS, PCT_COLORS, positiveRange, Z_COLORS, zColor, ZERO } from '../lib/color.ts';
import type { CalMode } from '../state.ts';
import { useI18n } from '../i18n.tsx';
import { leaveUnlessTouch, useTooltip } from './Tooltip.tsx';

export interface CalendarProps {
  axis: MonthAxis;
  values: Float64Array;
  obs: Observability;
  base: Baseline;
  mode: CalMode;
  theme: Theme;
  showValues?: boolean;
  compact?: boolean;
  range?: [number, number];
  onPick?: (m: number, extend: boolean) => void;
  onPickYear?: (year: number) => void;
  renderTip?: (m: number) => ReactNode;
  describe?: (m: number) => string;
  label: string;
  /** shared count scale; computed from `values` when absent */
  scale?: ReturnType<typeof countScale>;
}

export const GLYPH: Record<string, string> = { far_above: '++', above: '+', normal: '', below: '−' };

export interface CellLook {
  /** nobase: observed, but no baseline to compare against (anomaly and percent modes) */
  kind: 'before' | 'after' | 'na' | 'value' | 'nobase';
  fill: string;
  text: string;
  partial: boolean;
}

/** Shared by the on-screen calendar and the PNG export. */
export function cellLook(
  m: number,
  p: { axis: MonthAxis; values: Float64Array; obs: Observability; base: Baseline; mode: CalMode; theme: Theme; showValues: boolean },
  scale: ReturnType<typeof countScale>,
  fmtCompact: (x: number) => string,
  fmt1: (x: number) => string,
): CellLook {
  if (m < 0) return { kind: 'before', fill: '', text: '', partial: false };
  if (m >= p.axis.n) return { kind: 'after', fill: '', text: '', partial: false };
  if (!p.obs.observed(m)) return { kind: 'na', fill: '', text: '', partial: false };
  const x = p.values[m];
  const partial = p.obs.partial(m);
  if (p.mode === 'counts') {
    return { kind: 'value', fill: scale.color(x), text: p.showValues ? fmtCompact(x) : '', partial };
  }
  const r = readMonth(p.values, p.axis, p.base, m);
  if (p.mode === 'anomaly') {
    if (!Number.isFinite(r.z) || !r.cls) return { kind: 'nobase', fill: ZERO[p.theme], text: '', partial };
    // Colour follows the class, so a month held at normal by the minimum-excess rule is grey.
    const fill = r.cls === 'normal' ? Z_COLORS[p.theme][2] : zColor(r.z, p.theme);
    return { kind: 'value', fill, text: p.showValues ? fmt1(r.z) : GLYPH[r.cls], partial };
  }
  if (!Number.isFinite(r.pct)) return { kind: 'nobase', fill: ZERO[p.theme], text: '', partial };
  // Same rule as the anomaly classes: within MIN_EXCESS hotspots of the median reads as typical.
  const fill = Math.abs(r.x - r.median) < MIN_EXCESS ? PCT_COLORS[p.theme][3] : pctColor(r.pct, p.theme);
  return { kind: 'value', fill, text: p.showValues ? `${Math.round(r.pct)}` : '', partial };
}

/**
 * Count scale for a region: log-spaced classes between the 5th and 99th percentiles of its observed,
 * complete harmonized months. Every series in the calendar uses it, so they stay comparable.
 */
export function seriesScale(values: Float64Array, obs: Observability, theme: Theme) {
  const { lo, hi } = positiveRange(values, (m) => obs.observed(m) && !obs.partial(m));
  return countScale(hi, theme, lo);
}

function CalendarImpl(props: CalendarProps) {
  const { axis, values, obs, base, mode, theme, compact = false, range, onPick, onPickYear, renderTip, describe, label } = props;
  const showValues = props.showValues ?? false;
  const { t, fmt, fmtCompact, monthShort, monthLong } = useI18n();
  const tip = useTooltip();
  const gridRef = useRef<HTMLDivElement>(null);

  const y0 = yearOf(axis, 0);
  const y1 = yearOf(axis, axis.n - 1);
  const years = useMemo(() => Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i), [y0, y1]);
  const ownScale = useMemo(() => (props.scale ? null : seriesScale(values, obs, theme)), [props.scale, values, obs, theme]);
  const scale = props.scale ?? ownScale!;
  const annual = useMemo(() => annualTotals(values, axis, obs), [values, axis, obs]);
  const records = useMemo(() => recordMonths(values, axis, obs), [values, axis, obs]);
  const maxAnnual = useMemo(() => Math.max(1, ...annual.map((a) => a.total)), [annual]);
  const fmt1 = (x: number) => fmt(zForDisplay(x), 1);

  const lastObserved = useMemo(() => {
    for (let m = axis.n - 1; m >= 0; m--) if (obs.observed(m)) return m;
    return axis.n - 1;
  }, [axis, obs]);
  const [focusM, setFocusM] = useState<number>(() => range?.[1] ?? lastObserved);
  const focusable = (m: number) => m >= 0 && m < axis.n;

  const moveFocus = (m: number) => {
    const next = Math.max(0, Math.min(axis.n - 1, m));
    setFocusM(next);
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-m="${next}"]`);
    el?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Only month cells navigate; keys on the year buttons keep their native behaviour.
    if (compact || (e.target as HTMLElement).dataset.m === undefined) return;
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -12, ArrowDown: 12 };
    if (e.key in keys) {
      e.preventDefault();
      moveFocus(focusM + keys[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      moveFocus(focusM - (monthOf(axis, focusM) - 1));
    } else if (e.key === 'End') {
      e.preventDefault();
      moveFocus(focusM + (12 - monthOf(axis, focusM)));
    } else if ((e.key === 'Enter' || e.key === ' ') && onPick) {
      e.preventDefault();
      onPick(focusM, e.shiftKey);
    } else if ((e.key === 'y' || e.key === 'Y') && onPickYear) {
      e.preventDefault();
      onPickYear(yearOf(axis, focusM));
    }
  };

  const look = (m: number) => cellLook(m, { axis, values, obs, base, mode, theme, showValues }, scale, fmtCompact, fmt1);

  const tipFor = (m: number): ReactNode => {
    if (m < 0) return <div className="tt-note">{t('tipBeforeRecord')}</div>;
    if (m >= axis.n) return <div className="tt-note">{t('tipAfterRecord')}</div>;
    return renderTip ? renderTip(m) : null;
  };

  const cells: ReactNode[] = [];
  cells.push(<div key="corner" className="ch" role="columnheader" aria-label={t('year')} />);
  for (let c = 1; c <= 12; c++) {
    cells.push(
      <div key={`h${c}`} className="ch" role="columnheader" aria-label={monthLong(c)}>
        {compact ? monthShort(c).charAt(0) : monthShort(c)}
      </div>,
    );
  }
  if (!compact) cells.push(<div key="hy" className="ch" role="columnheader">{t('yearTotal')}</div>);

  const rows: ReactNode[] = [];
  for (const y of years) {
    const rowCells: ReactNode[] = [];
    rowCells.push(
      <div key="rh" className="rh" role="rowheader">
        {onPickYear && !compact ? (
          <button type="button" className="yearbtn" tabIndex={-1} onClick={() => onPickYear(y)} aria-label={t('pickYear', { year: y })}>
            {y}
          </button>
        ) : compact ? (
          y % 5 === 0 ? y : ''
        ) : (
          y
        )}
      </div>,
    );
    for (let c = 1; c <= 12; c++) {
      const m = indexOf(axis, y, c);
      const lk = look(m);
      const inRange = range && m >= range[0] && m <= range[1];
      const painted = lk.kind === 'value' || lk.kind === 'nobase';
      const cls = ['c', painted ? '' : 'na', lk.kind === 'nobase' ? 'nobase' : '', lk.partial ? 'partial' : '', inRange && !compact ? 'inrange' : '']
        .filter(Boolean)
        .join(' ');
      const style = painted ? { background: lk.fill, color: inkOn(lk.fill) } : undefined;
      const interactive = !compact && focusable(m);
      rowCells.push(
        <div
          key={c}
          className={cls}
          style={style}
          role="gridcell"
          data-m={interactive ? m : undefined}
          tabIndex={interactive ? (m === focusM ? 0 : -1) : undefined}
          aria-selected={interactive ? Boolean(inRange) : undefined}
          aria-label={interactive && describe ? describe(m) : undefined}
          onPointerEnter={(e) => tip.show({ x: e.clientX, y: e.clientY, content: tipFor(m) })}
          onPointerMove={(e) => tip.show({ x: e.clientX, y: e.clientY, content: tipFor(m) })}
          onPointerLeave={leaveUnlessTouch(tip.hide)}
          onFocus={(e) => {
            if (interactive) setFocusM(m);
            tip.show({ x: 0, y: 0, anchor: e.currentTarget.getBoundingClientRect(), content: tipFor(m) });
          }}
          onBlur={() => tip.hide()}
          onClick={interactive && onPick ? (e) => onPick(m, e.shiftKey) : undefined}
        >
          {lk.text}
          {records.has(m) && !compact && <span className="rec" aria-hidden="true" />}
        </div>,
      );
    }
    if (!compact) {
      const a = annual.find((q) => q.year === y);
      const total = a?.total ?? 0;
      const w = a && a.months > 0 ? (100 * total) / maxAnnual : 0;
      const yearTip = (
        <div>
          <div className="tt-title">{t('tipYearTotal', { year: y })}</div>
          <div className="tt-value">{fmt(total)}</div>
          {a && !a.complete && <div className="tt-note">{t('tipYearPartial', { n: completeMonths(y) })}</div>}
          {a && a.complete && Number.isFinite(base.medianAnnual) && base.medianAnnual > 0 && (
            <div className="tt-note">{t('tipPct', { p: fmt((100 * total) / base.medianAnnual) })}</div>
          )}
        </div>
      );
      rowCells.push(
        <div
          key="yt"
          className={`yt ${a && !a.complete ? 'incomplete' : ''}`}
          role="gridcell"
          aria-label={`${t('tipYearTotal', { year: y })}: ${fmt(total)}`}
          onPointerEnter={(e) => tip.show({ x: e.clientX, y: e.clientY, content: yearTip })}
          onPointerMove={(e) => tip.show({ x: e.clientX, y: e.clientY, content: yearTip })}
          onPointerLeave={leaveUnlessTouch(tip.hide)}
        >
          <div className="bar" style={{ width: `${w}%` }} />
          <span>{a && a.months > 0 ? `${fmtCompact(total)}${a.complete ? '' : '*'}` : ''}</span>
        </div>,
      );
    }
    rows.push(
      <div key={y} role="row" style={{ display: 'contents' }}>
        {rowCells}
      </div>,
    );
  }

  function completeMonths(y: number): number {
    let n = 0;
    for (let c = 1; c <= 12; c++) {
      const m = indexOf(axis, y, c);
      if (obs.observed(m) && !obs.partial(m)) n++;
    }
    return n;
  }

  let medianRow: ReactNode = null;
  if (!compact) {
    const med: ReactNode[] = [
      <div key="ml" className="medlabel" role="rowheader">
        {t('medianRow')}
      </div>,
    ];
    for (let c = 1; c <= 12; c++) {
      const v = base.months[c - 1].median;
      const ok = Number.isFinite(v);
      const fill = ok ? scale.color(v) : '';
      const content = (
        <div>
          <div className="tt-title">{t('tipMedian', { month: monthLong(c), first: base.first, last: base.last, v: ok ? fmt(v) : '–' })}</div>
          {!ok && <div className="tt-note">{t('tipNoBaseline')}</div>}
        </div>
      );
      med.push(
        <div
          key={c}
          className={`c ${ok ? '' : 'na'}`}
          role="gridcell"
          style={ok ? { background: fill, color: inkOn(fill) } : undefined}
          aria-label={t('tipMedian', { month: monthLong(c), first: base.first, last: base.last, v: ok ? fmt(v) : '–' })}
          onPointerEnter={(e) => tip.show({ x: e.clientX, y: e.clientY, content })}
          onPointerMove={(e) => tip.show({ x: e.clientX, y: e.clientY, content })}
          onPointerLeave={leaveUnlessTouch(tip.hide)}
        >
          {ok && showValues ? fmtCompact(v) : ''}
        </div>,
      );
    }
    med.push(
      <div key="mt" className="yt">
        <span>{Number.isFinite(base.medianAnnual) ? fmtCompact(base.medianAnnual) : ''}</span>
      </div>,
    );
    medianRow = (
      <>
        <div className="sep" aria-hidden="true" />
        <div role="row" style={{ display: 'contents' }}>
          {med}
        </div>
      </>
    );
  }

  return (
    <div
      ref={gridRef}
      className={`cal ${compact ? 'compact' : ''}`}
      role={compact ? 'img' : 'grid'}
      aria-label={label}
      onKeyDown={onKey}
    >
      <div role="row" style={{ display: 'contents' }}>
        {cells}
      </div>
      {rows}
      {medianRow}
    </div>
  );
}

export const Calendar = memo(CalendarImpl);

export function CalendarLegend({
  mode,
  theme,
  scale,
  base,
  shared = false,
  countLabel,
}: {
  mode: CalMode;
  theme: Theme;
  scale: ReturnType<typeof countScale>;
  base: Baseline;
  shared?: boolean;
  countLabel?: string;
}) {
  const { t, fmt } = useI18n();
  const extras = (
    <>
      {mode === 'counts' && (
        <span className="key">
          <span className="box" style={{ background: ZERO[theme], outline: '1px solid var(--ring)' }} />
          {t('legendZero')}
        </span>
      )}
      {mode !== 'counts' && (
        <span className="key">
          <span className="box nobase" style={{ background: ZERO[theme] }} />
          {t('legendNoBase')}
        </span>
      )}
      <span className="key">
        <span className="box na" />
        {t('legendNotObserved')}
      </span>
      <span className="key">
        <span className="box partial" />
        {t('legendPartial')}
      </span>
      <span className="key">
        <span className="box" style={{ background: 'var(--surface-2)' }}>
          <span className="rec" />
        </span>
        {t('legendRecord')}
      </span>
    </>
  );
  if (mode === 'counts') {
    const s = scale;
    return (
      <div className="legend">
        <div>
          <div className="label" style={{ marginBottom: 3 }}>
            {countLabel ?? t('legendCounts')}
            {shared ? ` · ${t('legendShared')}` : ''}
          </div>
          <div className="ramp" aria-hidden="true">
            {s.colors.map((c, i) => (
              <div className="ramp-step" key={c + i}>
                <div className="sw" style={{ background: c }} />
                <div className="lb">{i === 0 ? `<${fmt(s.breaks[0])}` : `${fmt(s.breaks[i - 1])}+`}</div>
              </div>
            ))}
          </div>
        </div>
        {extras}
      </div>
    );
  }
  if (mode === 'anomaly') {
    const labels = ['< -2', '-2 to -1', '-1 to 1', '1 to 2', '≥ 2'];
    const classes = ['below', 'below', 'normal', 'above', 'far_above'];
    return (
      <div className="legend">
        <div>
          <div className="label" style={{ marginBottom: 3 }}>{t('legendAnomaly', { first: base.first, last: base.last })}</div>
          <div className="ramp">
            {Z_COLORS[theme].map((c, i) => (
              <div className="ramp-step" key={c} style={{ minWidth: 64 }}>
                <div className="sw" style={{ background: c, color: inkOn(c), height: 14, fontSize: 10, textAlign: 'center', lineHeight: '14px', fontWeight: 700 }}>
                  {GLYPH[classes[i]]}
                </div>
                <div className="lb">{labels[i].replace(' to ', ' / ')}</div>
                <div className="lb" style={{ whiteSpace: 'normal' }}>{t(`cls_${classes[i]}` as 'cls_normal')}</div>
              </div>
            ))}
          </div>
        </div>
        {extras}
      </div>
    );
  }
  return (
    <div className="legend">
      <div>
        <div className="label" style={{ marginBottom: 3 }}>{t('legendPct', { first: base.first, last: base.last })}</div>
        <div className="ramp" aria-hidden="true">
          {PCT_COLORS[theme].map((c, i) => (
            <div className="ramp-step" key={c + i}>
              <div className="sw" style={{ background: c }} />
              <div className="lb">{i === 0 ? `<${PCT_BREAKS[0]}%` : `${PCT_BREAKS[i - 1]}%+`}</div>
            </div>
          ))}
        </div>
      </div>
      {extras}
    </div>
  );
}
