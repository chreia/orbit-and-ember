// Map layers: which record the map (and the calendar) shows, whether the map shows hotspot counts or
// the difference from each cell's usual value, and the legend for what is on screen.
import { useId } from 'react';
import { VIEW_SERIES } from '../lib/series.ts';
import type { BaseChoice, MapColor } from '../state.ts';
import { useI18n } from '../i18n.tsx';
import type { Key } from '../i18n.tsx';
import { rangeLabel, SERIES_STYLE, seriesLabel, useModel } from '../model.ts';
import { baseOf, columnsOn, useUi } from '../store.ts';
import { excessScale, hotspotScale } from '../map/scales.ts';
import { useMapPeriod, useSeriesRange } from '../map/usePeriod.ts';
import { LineKey } from './Tooltip.tsx';
import { TERRAIN_EXAGGERATION } from '../map/constants.ts';

const BASE_CHOICES: [BaseChoice, Key][] = [
  ['auto', 'baseAuto'],
  ['imagery', 'baseImagery'],
  ['relief', 'baseRelief'],
  ['night', 'baseNight'],
  ['plain', 'basePlain'],
];

export function LayerControls() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { manifest, axis } = useModel();
  const id = useId();
  const view = useUi((s) => s.view);
  const open = useUi((s) => (s.view === 'explore' ? s.layersOpen : s.recordLayersOpen));
  const series = useUi((s) => s.series);
  const mapColor = useUi((s) => s.mapColor);
  const showBorders = useUi((s) => s.showBorders);
  const baseChoice = useUi((s) => s.baseChoice);
  const base = useUi(baseOf);
  const plainMap = useUi((s) => s.columnsBlocked === 'webgl');
  const block = useUi((s) => s.columnBlock);
  const threeD = useUi(columnsOn);
  const set = useUi((s) => s.set);
  const period = useMapPeriod();
  const sr = useSeriesRange();
  const scale = mapColor === 'excess' ? excessScale(sr.hi) : hotspotScale(sr.lo, sr.hi);
  const periodText = rangeLabel(axis, period.m0, period.m1, i18n);
  const res = String(manifest.grid.res);
  const title =
    mapColor === 'excess'
      ? t('legendExcess', { first: manifest.baseline.first_year, last: manifest.baseline.last_year, period: periodText })
      : t(period.length > 1 ? 'legendCellsMean' : 'legendCells', { series: seriesLabel(series, i18n), res, period: periodText });
  const n = (v: number) => (Math.abs(v) < 1 && v !== 0 ? fmt(v, 1) : fmt(v));

  return (
    <div className={`layers overlay-card${open ? '' : ' collapsed'}`}>
      <button type="button" className="lc-toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => set(view === 'explore' ? { layersOpen: !open } : { recordLayersOpen: !open })}>
        <span>{t('layersTitle')}</span>
        <span className="caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="lc-body" id={`${id}-body`}>
          {view === 'explore' && <p className="lc-note">{t('appLayersNote')}</p>}
          <fieldset className="lc-series">
            <legend>{t('layersRecord')}</legend>
            {VIEW_SERIES.map((s) => (
              <label key={s}>
                <input type="radio" name={`${id}-series`} checked={series === s} onChange={() => set({ series: s })} />
                <LineKey color={SERIES_STYLE[s].color} dash={SERIES_STYLE[s].dash} width={SERIES_STYLE[s].width} />
                <span>{seriesLabel(s, i18n)}</span>
              </label>
            ))}
          </fieldset>
          <div className="lc-row">
            <span className="lc-label" id={`${id}-show`}>
              {t('showAs')}
            </span>
            <div className="seg" role="group" aria-labelledby={`${id}-show`}>
              {(['hotspots', 'excess'] as MapColor[]).map((k) => (
                <button key={k} type="button" aria-pressed={mapColor === k} onClick={() => set({ mapColor: k })}>
                  {k === 'hotspots' ? t('showHotspots') : t('showExcess')}
                </button>
              ))}
            </div>
          </div>
          <label className="lc-check">
            <input type="checkbox" checked={showBorders} onChange={(e) => set({ showBorders: e.target.checked })} />
            {t('showBorders')}
          </label>
          {!plainMap && (
          <div className="lc-row">
            <label className="lc-label" htmlFor={`${id}-base`}>
              {t('baseTitle')}
            </label>
            <select id={`${id}-base`} value={baseChoice} onChange={(e) => set({ baseChoice: e.target.value as BaseChoice })}>
              {BASE_CHOICES.map(([k, key]) => (
                <option key={k} value={k}>
                  {t(key)}
                </option>
              ))}
            </select>
            {baseChoice === 'auto' && <p className="lc-note">{t('baseAutoHelp')}</p>}
            {base === 'night' && <p className="lc-note">{t('baseNightNote')}</p>}
          </div>
          )}
          <div className="lc-legend">
            <div className="lc-legend-title">{title}</div>
            <div className="ramp" aria-hidden="true">
              {scale.colors.map((c, i) => (
                <div className="ramp-step" key={c + i}>
                  <div className="sw" style={{ background: c }} />
                  {mapColor === 'hotspots' && <div className="lb">{i === 0 ? `<${n(scale.breaks[0])}` : `${n(scale.breaks[i - 1])}+`}</div>}
                </div>
              ))}
            </div>
            {mapColor === 'excess' && (
              <div className="ramp-edges" aria-hidden="true">
                {scale.breaks.map((b, k) => (
                  <span key={k} style={{ left: `${((k + 1) / scale.colors.length) * 100}%` }}>
                    {b > 0 ? `+${n(b)}` : n(b)}
                  </span>
                ))}
              </div>
            )}
            {mapColor === 'excess' && (
              <div className="ramp-ends" aria-hidden="true">
                <span>{t('legendFewer')}</span>
                <span>{t('legendUsual')}</span>
                <span>{t('legendMore')}</span>
              </div>
            )}
            {threeD && <p className="lc-note">{mapColor === 'excess' ? t('legendFlat') : t('legendHeight')}</p>}
            {threeD && block > 1 && <p className="lc-note">{t('legendBlock', { k: block, res })}</p>}
            {threeD && <p className="lc-note">{t('terrainNote', { x: TERRAIN_EXAGGERATION })}</p>}
            <p className="lc-note lc-source">{t('dataBy')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
