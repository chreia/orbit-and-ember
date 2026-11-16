// The month scrubber under the map: the selected area's monthly record as a small bar strip, with
// the period on the map highlighted. Drag it, step it with the keyboard, or press play to watch
// the map move through the record. The strip says where the record is a model estimate and where
// a sensor was not observing, so the animation never hides how a month was measured.
import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { monthOf, yearOf } from '../lib/months.ts';
import { isModelSource } from '../lib/series.ts';
import type { Range } from '../lib/timeline.ts';
import { playNext, playStart, runs, scrubKeyStep, windowEndingAt, windowLength, windowOfLength } from '../lib/timeline.ts';
import { useI18n } from '../i18n.tsx';
import { rangeLabel, seriesLabel, sensorStartIndex, sourceLabel, useModel } from '../model.ts';
import { useDerived } from '../derived.tsx';
import { reducedMotion, useUi } from '../store.ts';
import { useWidth } from '../hooks.ts';

const TICK_MS = 520;
const H = 46; // strip height in px
const BAND = 5;

export function TimeScrubber() {
  const i18n = useI18n();
  const { t } = i18n;
  const { manifest, axis } = useModel();
  const d = useDerived();
  const range = useUi((s) => s.range);
  const series = useUi((s) => s.series);
  const playing = useUi((s) => s.playing);
  const set = useUi((s) => s.set);
  const n = axis.n;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const dragging = useRef(false);

  // ---- play: one month per tick, stop at the end of the record
  useEffect(() => {
    if (!playing) return;
    const ms = reducedMotion() ? TICK_MS * 1.6 : TICK_MS;
    const id = window.setInterval(() => {
      const s = useUi.getState();
      const next = playNext(s.range, n);
      if (!next) s.set({ playing: false });
      else s.set({ range: next });
    }, ms);
    return () => window.clearInterval(id);
  }, [playing, n]);

  const togglePlay = () => {
    if (playing) return set({ playing: false });
    set({ range: playStart(range, n), playing: true });
  };

  const moveTo = (m: number) => set({ range: windowEndingAt(range, m, n), playing: false });

  // ---- geometry
  const values = d.viewValues;
  const obs = d.viewObs;
  const max = useMemo(() => {
    let mx = 0;
    for (let m = 0; m < n; m++) if (obs.observed(m) && values[m] > mx) mx = values[m];
    return mx || 1;
  }, [values, obs, n]);
  const w = Math.max(10, width);
  const x = (m: number) => (m / n) * w;
  const bw = w / n;
  const kindOf = (m: number): 'none' | 'model' | 'obs' => {
    if (!obs.observed(m)) return 'none';
    return series === 'harmonized' && isModelSource(manifest.month_source[m]) ? 'model' : 'obs';
  };
  const bars = useMemo(() => {
    let model = '';
    let observed = '';
    const top = H - BAND - 3;
    for (let m = 0; m < n; m++) {
      if (!obs.observed(m)) continue;
      const v = values[m];
      if (!(v > 0)) continue;
      const h = Math.max(1, (v / max) * (top - 2));
      const r = `M${x(m).toFixed(2)},${top}h${Math.max(0.6, bw - 0.4).toFixed(2)}v${(-h).toFixed(2)}h${(-Math.max(0.6, bw - 0.4)).toFixed(2)}Z`;
      if (kindOf(m) === 'model') model += r;
      else observed += r;
    }
    return { model, observed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, obs, max, w, n, series, manifest]);
  const bandRuns = useMemo(() => runs(n, kindOf), [n, obs, series, manifest]); // eslint-disable-line react-hooks/exhaustive-deps
  const years = useMemo(() => {
    const out: { m: number; y: number }[] = [];
    const every = w < 420 ? 10 : 5;
    for (let m = 0; m < n; m++) if (monthOf(axis, m) === 1 && yearOf(axis, m) % every === 0) out.push({ m, y: yearOf(axis, m) });
    return out;
  }, [axis, n, w]);
  const starts = useMemo(
    () =>
      (['viirs_snpp', 'viirs_noaa20'] as const)
        .map((id) => ({ id, m: sensorStartIndex(manifest, axis, id) }))
        .filter((s): s is { id: 'viirs_snpp' | 'viirs_noaa20'; m: number } => s.m !== null),
    [manifest, axis],
  );

  // ---- pointer and keyboard
  const monthAt = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    moveTo(monthAt(e.clientX, e.currentTarget));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) moveTo(monthAt(e.clientX, e.currentTarget));
  };
  const onUp = () => {
    dragging.current = false;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      togglePlay();
      return;
    }
    const k = scrubKeyStep(e.key);
    if (k === null) return;
    e.preventDefault();
    if (k === 'home') moveTo(0);
    else if (k === 'end') moveTo(n - 1);
    else moveTo(range[1] + k);
  };

  // ---- labels
  const [m0, m1] = range;
  const label = rangeLabel(axis, m0, m1, i18n);
  const len = windowLength(range);
  let source = '';
  if (len === 1) {
    if (series === 'harmonized') source = sourceLabel(manifest.month_source[m0], i18n);
    else source = obs.observed(m0) ? seriesLabel(series, i18n) : t('bandNone');
  } else if (series === 'harmonized') {
    let model = 0;
    for (let m = m0; m <= m1; m++) if (isModelSource(manifest.month_source[m])) model++;
    const viirsYear = starts.length ? yearOf(axis, starts[0].m) : 2012;
    source = model === 0 ? t('bandObserved') : model === len ? t('bandModel') : t('mixedBadge', { year: viirsYear });
  } else source = seriesLabel(series, i18n);
  const stepValue = len === 1 ? '1' : len === 12 ? '12' : 'custom';
  const hi: Range = range;

  return (
    <div className="scrubber" role="group" aria-label={t('scrubLabel')}>
      <button
        type="button"
        className={`play${playing ? ' on' : ''}`}
        onClick={togglePlay}
        aria-label={playing ? t('pause') : t('play')}
        title={playing ? t('pause') : t('play')}
        aria-pressed={playing}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="2" y="1.5" width="3.5" height="11" rx="1" fill="currentColor" />
            <rect x="8.5" y="1.5" width="3.5" height="11" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 1.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L3.9 1.1a.6.6 0 0 0-.9.5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div className="scrub-main" ref={wrapRef}>
        <div
          className="scrub-track"
          role="slider"
          tabIndex={0}
          aria-label={t('scrubLabel')}
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={m1}
          aria-valuetext={`${label}. ${source}`}
          aria-describedby="scrub-help"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
        >
          <svg width={w} height={H + 14} aria-hidden="true">
            {bandRuns.map((r) => (
              <rect key={r.m0} className={`band ${r.key}`} x={x(r.m0)} y={H - BAND} width={x(r.m1 + 1) - x(r.m0)} height={BAND} />
            ))}
            <path className="bars obs" d={bars.observed} />
            <path className="bars model" d={bars.model} />
            {starts.map((s) => (
              <line key={s.id} className="start" x1={x(s.m)} x2={x(s.m)} y1={2} y2={H - BAND} />
            ))}
            <rect className="window" x={x(hi[0])} y={0.5} width={Math.max(2, x(hi[1] + 1) - x(hi[0]))} height={H - 1} rx={2} />
            {years.map((yy) => (
              <text key={yy.y} className="year" x={x(yy.m)} y={H + 11}>
                {yy.y}
              </text>
            ))}
          </svg>
        </div>
        <div className="scrub-key" aria-hidden="true">
          {series === 'harmonized' ? (
            <>
              <span>
                <i className="model" />
                {t('bandModel')}
              </span>
              <span>
                <i className="obs" />
                {t('bandObserved')}
              </span>
            </>
          ) : (
            <span>
              <i className="obs" />
              {seriesLabel(series, i18n)}
            </span>
          )}
          <span>
            <i className="none" />
            {t('bandNone')}
          </span>
        </div>
        <span id="scrub-help" className="sr-only">
          {t('scrubHelp')}
        </span>
      </div>
      <div className="scrub-when" aria-live="polite">
        <b>{label}</b>
        <span className={`src ${len === 1 ? kindOf(m0) : ''}`}>{source}</span>
      </div>
      <label className="scrub-step">
        <span className="sr-only">{t('windowLabel')}</span>
        <select value={stepValue} onChange={(e) => e.target.value !== 'custom' && set({ range: windowOfLength(range, Number(e.target.value), n), playing: false })}>
          <option value="1">{t('windowOne')}</option>
          <option value="12">{t('windowYear')}</option>
          {stepValue === 'custom' && <option value="custom">{t('windowN', { n: len })}</option>}
        </select>
      </label>
    </div>
  );
}
