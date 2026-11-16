// Three short lines that make the map readable in the first seconds. The card folds into a small chip
// once the reader starts using the map (or dismisses it), and the chip brings it back; the choice is
// remembered. The chip also starts the guided tour.
import { useEffect } from 'react';
import { yearOf } from '../lib/months.ts';
import { useI18n } from '../i18n.tsx';
import { sensorStartIndex, useModel } from '../model.ts';
import { columnsOn, useUi } from '../store.ts';
import { HEAT, PCT_COLORS } from '../lib/color.ts';
import { StoryButton } from './Story.tsx';

export function HowToRead() {
  const i18n = useI18n();
  const { t, monthYear } = i18n;
  const { manifest, axis } = useModel();
  const open = useUi((s) => s.howToOpen);
  const story = useUi((s) => s.story);
  const threeD = useUi(columnsOn);
  const excess = useUi((s) => s.mapColor === 'excess');
  const view = useUi((s) => s.view);
  const setHowTo = useUi((s) => s.setHowTo);

  // fold away at the first real use of the map: a new area, a new period, play, or another view
  useEffect(
    () =>
      useUi.subscribe((s, p) => {
        if (!s.howToOpen) return;
        if (s.region !== p.region || s.range !== p.range || (s.playing && !p.playing) || s.mapMode !== p.mapMode) s.setHowTo(false);
      }),
    [],
  );

  if (story !== null) return null;
  const world = view === 'explore';
  if (!open) {
    return (
      <div className="how-chip">
        <button type="button" className="btn small overlay-btn" onClick={() => setHowTo(true)} aria-expanded={false}>
          {t('howShow')}
        </button>
        {!world && <StoryButton />}
      </div>
    );
  }
  // the worldwide view keeps a two-line key; its full introduction is the quick tour
  if (world)
    return (
      <aside className="how-to how-to-compact overlay-card" aria-label={t('howTitle')}>
        <div className="htr-head">
          <h2>{t('howTitle')}</h2>
          <button type="button" className="btn small ghost" onClick={() => setHowTo(false)} aria-expanded={true}>
            {t('howDismiss')}
          </button>
        </div>
        <p>{t('howWorld1')}</p>
        <p className="help">{t('howWorld2')}</p>
      </aside>
    );
  const s = sensorStartIndex(manifest, axis, 'viirs_snpp');
  const year = s !== null ? yearOf(axis, s) : 2012;
  const start = monthYear(axis.startYear, axis.startMonth);
  const res = String(manifest.grid.res);
  const first = manifest.baseline.first_year;
  const last = manifest.baseline.last_year;
  const keyColors = excess ? `linear-gradient(90deg, ${PCT_COLORS.dark[0]}, ${PCT_COLORS.dark[3]} 50%, ${PCT_COLORS.dark[6]})` : `linear-gradient(0deg, ${HEAT.dark[1]}, ${HEAT.dark[4]} 50%, ${HEAT.dark[7]})`;
  return (
    <aside className="how-to overlay-card" aria-label={t('howTitle')}>
      <div className="htr-head">
        <h2>{t('howTitle')}</h2>
        <button type="button" className="btn small ghost" onClick={() => setHowTo(false)} aria-expanded={true}>
          {t('howDismiss')}
        </button>
      </div>
      <ul>
        <li>
          <span className="key heat" aria-hidden="true" style={{ background: keyColors }} />
          <span>{excess ? t('how1Excess', { first, last }) : threeD ? t('how1', { res }) : t('how1Flat', { res })}</span>
        </li>
        <li>
          <span className="key area" aria-hidden="true" />
          <span>{t('how2', { start })}</span>
        </li>
        <li>
          <span className="key time" aria-hidden="true" />
          <span>{t('how3', { year })}</span>
        </li>
      </ul>
      <StoryButton className="btn small primary htr-tour" />
    </aside>
  );
}
