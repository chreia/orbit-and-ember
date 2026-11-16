// The period on the map and in the analytics: presets, or any month range. The calendar and the
// timeline under the map set the same period.
import { useId } from 'react';
import { indexOf, monthOf, yearOf } from '../lib/months.ts';
import { useI18n } from '../i18n.tsx';
import type { Key } from '../i18n.tsx';
import { rangeLabel, useModel } from '../model.ts';
import { useDerived } from '../derived.tsx';
import { useUi } from '../store.ts';

const PRESET_KEY: Record<string, Key> = { last12: 'presetLast12', year: 'presetLastYear', season: 'presetSeason', all: 'presetAll' };

export function PeriodPicker() {
  const i18n = useI18n();
  const { t, monthShort } = i18n;
  const { axis } = useModel();
  const { presets } = useDerived();
  const range = useUi((s) => s.range);
  const setRange = useUi((s) => s.setRange);
  const id = useId();
  const y0 = yearOf(axis, 0);
  const y1 = yearOf(axis, axis.n - 1);
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y1 - i);
  const clamp = (m: number) => Math.max(0, Math.min(axis.n - 1, m));
  const setEnd = (end: 0 | 1, year: number, month: number) => {
    const m = clamp(indexOf(axis, year, month));
    const next: [number, number] = end === 0 ? [m, range[1]] : [range[0], m];
    useUi.getState().set({ playing: false });
    setRange(next);
  };
  const picker = (end: 0 | 1, labelKey: 'from' | 'to') => {
    const m = range[end];
    const y = yearOf(axis, m);
    const mo = monthOf(axis, m);
    return (
      <div className="field">
        <span className="label" id={`${id}-${labelKey}`}>
          {t(labelKey)}
        </span>
        <div className="row nowrap" role="group" aria-labelledby={`${id}-${labelKey}`}>
          <select aria-label={`${t(labelKey)}: ${t('month')}`} value={mo} onChange={(e) => setEnd(end, y, Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                {monthShort(i + 1)}
              </option>
            ))}
          </select>
          <select aria-label={`${t(labelKey)}: ${t('year')}`} value={y} onChange={(e) => setEnd(end, Number(e.target.value), mo)}>
            {years.map((yy) => (
              <option key={yy} value={yy}>
                {yy}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };
  return (
    <div className="period">
      <div className="period-head">
        <span className="label">{t('periodShown')}</span>
        <b className="period-label">{rangeLabel(axis, range[0], range[1], i18n)}</b>
      </div>
      <div className="seg wrap" role="group" aria-label={t('period')}>
        {presets.map((p) => {
          const active = p.range !== null && p.range[0] === range[0] && p.range[1] === range[1];
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              disabled={!p.range}
              onClick={() => {
                if (!p.range) return;
                useUi.getState().set({ playing: false });
                setRange(p.range);
              }}
            >
              {t(PRESET_KEY[p.key])}
            </button>
          );
        })}
      </div>
      <div className="row period-custom">
        {picker(0, 'from')}
        {picker(1, 'to')}
      </div>
    </div>
  );
}
