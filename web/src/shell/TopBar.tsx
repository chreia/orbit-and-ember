// Top bar: the Focos name with the official NASA Space Apps Challenge logo beside it, the views and
// the language picker. The logo file is used as published (public/brand/README.md).
import { useI18n } from '../i18n.tsx';
import type { Lang } from '../i18n.tsx';
import { HEAT } from '../lib/color.ts';
import type { View } from '../state.ts';
import { useUi } from '../store.ts';

const BASE = import.meta.env.BASE_URL ?? './';

/** The Focos mark: a 3 x 3 calendar of warm cells, drawn from the count ramp. */
export function FocosMark({ size = 22 }: { size?: number }) {
  const h = HEAT.dark;
  const c = [h[3], h[5], h[2], h[6], h[7], h[4], h[1], h[4], h[5]];
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" className="focos-mark">
      {c.map((col, i) => (
        <rect key={i} x={(i % 3) * 7.5} y={Math.floor(i / 3) * 7.5} width="6.5" height="6.5" rx="1.5" fill={col} />
      ))}
    </svg>
  );
}

export function SpaceAppsLogo({ height = 34 }: { height?: number }) {
  const { t } = useI18n();
  // 561 x 221 is the published artboard; the width follows from the height so it is never stretched
  return (
    <img
      className="sa-logo"
      src={`${BASE}brand/spaceapps-logo-white.svg`}
      alt={t('spaceAppsAlt')}
      width={Math.round((height * 561) / 221)}
      height={height}
      decoding="async"
    />
  );
}

export function TopBar(props: { view: View; onView?: (v: View) => void; synthetic?: boolean; country?: string }) {
  const { view, onView, synthetic } = props;
  const { t } = useI18n();
  const tagline = view === 'explore' ? t('taglineWorld') : view === 'global' ? t('taglineGlobal') : t('appTaglineShort');
  return (
    <header className="topbar">
      <div className="brand">
        <a
          className="wordmark"
          href="#view=explore"
          aria-label={t('homeLabel')}
          onClick={(e) => {
            e.preventDefault();
            onView?.('explore');
          }}
        >
          <FocosMark />
          <span>Focos</span>
        </a>
        <span className="brand-sep" aria-hidden="true" />
        <SpaceAppsLogo height={52} />
      </div>
      <p className="tagline">{tagline}</p>
      <span className="grow" />
      {synthetic && <span className="badge warn">{t('syntheticBadge')}</span>}
      <nav className="topnav" aria-label={t('navLabel')}>
        {onView && (
          <>
            <button type="button" className="navbtn" aria-current={view === 'explore' ? 'page' : undefined} onClick={() => onView('explore')}>
              {t('navExplore')}
            </button>
            <button type="button" className="navbtn" aria-current={view === 'history' ? 'page' : undefined} onClick={() => onView('history')}>
              <NavLabel full={t('navArgentina')} short={t('navArgentinaShort')} />
            </button>
            <button type="button" className="navbtn" aria-current={view === 'methods' ? 'page' : undefined} onClick={() => onView('methods')}>
              <NavLabel full={t('navMethods')} short={t('navMethodsShort')} />
            </button>
          </>
        )}
        <LangPicker />
      </nav>
    </header>
  );
}

/** The full label, and a short one that takes its place on a phone; screen readers hear the full one. */
function NavLabel({ full, short }: { full: string; short: string }) {
  return (
    <>
      <span className="nav-full">{full}</span>
      <span className="nav-short" aria-hidden="true">
        {short}
      </span>
    </>
  );
}

/** Each language is named in itself, so a reader can find their own whatever is showing. */
const LANGS: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'jam', name: 'Patwa' },
];

function LangPicker() {
  const { t, lang } = useI18n();
  return (
    <label className="lang-pick">
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M1.8 8h12.4M8 1.6c2 2 2 10.8 0 12.8M8 1.6c-2 2-2 10.8 0 12.8" fill="none" stroke="currentColor" strokeWidth="1.1" />
      </svg>
      <select value={lang} aria-label={t('langLabel')} onChange={(e) => useUi.getState().set({ lang: e.target.value as Lang })}>
        {LANGS.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
