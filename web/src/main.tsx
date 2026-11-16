import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
// Brand fonts, self-hosted so the app works offline: Fira Sans and Overpass for titles, Overpass for
// text, Fira Code for tabular numbers.
import '@fontsource/fira-sans/700.css';
import '@fontsource/fira-sans/900.css';
import '@fontsource/overpass/400.css';
import '@fontsource/overpass/700.css';
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/500.css';
import { App } from './App.tsx';
import { readStored } from './hooks.ts';
import { I18nContext, makeI18n } from './i18n.tsx';
import type { Lang } from './i18n.tsx';
import { SERIES_DARK } from './lib/color.ts';
import { isLang, readHash } from './state.ts';
import './styles.css';

const TerrainViewer = lazy(() => import('./components/TerrainViewer.tsx').then(m => ({default:m.TerrainViewer})));

/** The terrain explorer opens outside <App>, so it reads the language itself: the link first, then the saved choice. */
function terrainLang(): Lang {
  const stored = readStored('focos.lang');
  return readHash().lang ?? (isLang(stored) ? stored : 'en');
}
const terrain = new URLSearchParams(location.search).has('terrain') ? makeI18n(terrainLang()) : null;
if (terrain) document.documentElement.lang = terrain.lang;

// Line colours have one source (lib/color.ts, checked by tests/palette.test.ts); CSS reads them here.
const root = document.documentElement.style;
root.setProperty('--c-harm', SERIES_DARK.harmonized);
root.setProperty('--c-naive', SERIES_DARK.naive);
root.setProperty('--c-terra', SERIES_DARK.modis_terra);
root.setProperty('--c-aqua', SERIES_DARK.modis_aqua);
root.setProperty('--c-snpp', SERIES_DARK.viirs_snpp);
root.setProperty('--c-n20', SERIES_DARK.viirs_noaa20);
root.setProperty('--c-year', SERIES_DARK.viirs_snpp);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {terrain ? (
      <I18nContext.Provider value={terrain}>
        <Suspense fallback={<div role="status">{terrain.t('tvLoading')}</div>}>
          <TerrainViewer />
        </Suspense>
      </I18nContext.Provider>
    ) : (
      <App />
    )}
  </StrictMode>,
);
