// The reading column beside the map, in the order of the task: pick an area, read its calendar,
// see which months were unusual and how this month compares with normal, then download.
import { yearOf } from '../lib/months.ts';
import { useI18n } from '../i18n.tsx';
import { sensorStartIndex, useModel } from '../model.ts';
import { useDerived } from '../derived.tsx';
import { useUi } from '../store.ts';
import { Section } from '../shell/Section.tsx';
import { PanelBoundary } from '../shell/PanelBoundary.tsx';
import { Analytics } from '../components/Analytics.tsx';
import { Downloads } from '../components/Downloads.tsx';
import { SpaceAppsLogo } from '../shell/TopBar.tsx';
import { HowToRead } from '../components/HowToRead.tsx';
import { StoryCard } from '../components/Story.tsx';
import { AreaPicker } from './AreaPicker.tsx';
import { PeriodPicker } from './PeriodPicker.tsx';
import { CalendarSection } from './CalendarSection.tsx';

export function Panel() {
  const i18n = useI18n();
  const { t, monthYear } = i18n;
  const model = useModel();
  const { manifest, axis } = model;
  const d = useDerived();
  const region = useUi((s) => s.region);
  const range = useUi((s) => s.range);
  const series = useUi((s) => s.series);
  const mode = useUi((s) => s.mode);
  const showValues = useUi((s) => s.showValues);
  const set = useUi((s) => s.set);
  const pickMonth = useUi((s) => s.pickMonth);
  const s = sensorStartIndex(manifest, axis, 'viirs_snpp');
  const viirsYear = s !== null ? yearOf(axis, s) : 2012;

  return (
    <aside className="panel" aria-label={t('panelLabel')}>
      <div className="how-to-panel">
        <HowToRead />
        <StoryCard />
      </div>
      <Section step={1} title={t('stepArea')} id="area" name={t('stepArea')}>
        <AreaPicker />
        <PeriodPicker />
      </Section>
      <Section step={2} title={t('stepCalendar')} hint={t('calendarHint', { start: monthYear(axis.startYear, axis.startMonth) })} id="calendar" name={t('nameCalendar')}>
        <CalendarSection />
        <p className="help small model-note">{t('modelYears', { year: viirsYear })}</p>
        <button type="button" className="btn cta" onClick={() => set({ plotsOpen: true })}>
          {t('compareCta')}
        </button>
      </Section>
      <Section step={3} title={t('stepNormal')} id="normal" name={t('nameAnalytics')}>
        <Analytics
          axis={axis}
          values={d.rs.harmonized}
          obs={d.harmObs}
          base={d.harmBase}
          range={range}
          theme="dark"
          regionName={d.name}
          onPickMonth={(m) => pickMonth(m, false)}
          bare
        />
      </Section>
      <Section step={4} title={t('stepDownload')} id="download" name={t('nameDownloads')}>
        <PanelBoundary name={t('nameDownloads')}>
          <Downloads
            model={model}
            region={region}
            regionName={d.name}
            cells={d.cells}
            rs={d.rs}
            range={range}
            harmBand={d.harmBand}
            harmBase={d.harmBase}
            harmObs={d.harmObs}
            calendar={{ values: d.viewValues, obs: d.viewObs, base: d.viewBase, mode, theme: 'dark', showValues, series, scale: d.calScale }}
            bare
          />
        </PanelBoundary>
      </Section>
      <footer className="panel-foot">
        <SpaceAppsLogo height={40} />
        <p>{t('spaceAppsLine')}</p>
        <p className="muted">{t('creditsText')}</p>
        <h2 className="foot-title">{t('sourcesTitle')}</h2>
        <ul className="foot-sources">
          {manifest.sources
            .filter((src) => src.doi && /FIRMS/.test(src.name))
            .map((src) => (
              <li key={src.name}>
                {src.name}.{' '}
                <a href={`https://doi.org/${src.doi}`} target="_blank" rel="noreferrer">
                  doi:{src.doi}
                </a>
              </li>
            ))}
        </ul>
        <p className="muted">{t('creditsImagery')}</p>
        <p className="muted">{t('creditsTerrain')}</p>
        <p className="muted">{t('generated', { date: manifest.generated.slice(0, 10) })}</p>
      </footer>
    </aside>
  );
}
