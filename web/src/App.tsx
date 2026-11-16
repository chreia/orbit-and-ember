import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { Bundle } from './bundle/load.ts';
import { loadBoundaries, loadBundle, loadTable } from './bundle/load.ts';
import { indexOfLabel, makeAxis } from './lib/months.ts';
import { latestMonth, observability } from './lib/analytics.ts';
import { I18nContext, makeI18n, useI18n } from './i18n.tsx';
import type { Lang } from './i18n.tsx';
import type { Model } from './model.ts';
import { ModelContext } from './model.ts';
import { defaultRegion, isLang, readHash, regionFromKey, writeHash } from './state.ts';
import type { HashState } from './state.ts';
import { reducedMotion, useUi, webglAvailable } from './store.ts';
import type { Ui } from './store.ts';
import { DerivedProvider } from './derived.tsx';
import { readStored, writeStored } from './hooks.ts';
import { TooltipProvider } from './components/Tooltip.tsx';
import { Methods } from './components/Methods.tsx';
import { TimeScrubber } from './components/TimeScrubber.tsx';
import { LayerControls } from './components/LayerControls.tsx';
import { MapReadout } from './components/MapReadout.tsx';
import { MapStatus } from './components/MapStatus.tsx';
import { ViewControls } from './components/ViewControls.tsx';
import { HowToRead } from './components/HowToRead.tsx';
import { PlotsDrawer } from './components/PlotsDrawer.tsx';
import { StoryCard, StoryDriver } from './components/Story.tsx';
import { TopBar, SpaceAppsLogo, FocosMark } from './shell/TopBar.tsx';
import { PanelBoundary } from './shell/PanelBoundary.tsx';
import { Panel } from './panel/Panel.tsx';
import { QuickTour } from './components/QuickTour.tsx';
import { GlobalPanel } from './panel/GlobalPanel.tsx';
import { SignalRelay } from './network/SignalRelay.tsx';

function initialLang(): Lang {
  const h = readHash().lang;
  if (h) return h;
  const s = readStored('focos.lang');
  if (isLang(s)) return s;
  // Patwa is chosen, never guessed: an en-JM browser opens in English
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/**
 * A lazily loaded part inside its own error boundary. React.lazy remembers a failed import forever,
 * so "Try again" builds a fresh lazy component.
 */
function LazySlot({ load, name, fallback }: { load: () => Promise<{ default: ComponentType }>; name: string; fallback: ReactNode }) {
  const [View, setView] = useState(() => lazy(load));
  return (
    <PanelBoundary name={name} className="over-map" onRetry={() => setView(() => lazy(load))}>
      <Suspense fallback={fallback}>
        <View />
      </Suspense>
    </PanelBoundary>
  );
}
// MapLibre and deck.gl load after the panel, so the calendar is readable before the map arrives.
// Without WebGL 2 a plain canvas map takes their place.
const loadMap = () => (webglAvailable() ? import('./map/MapView.tsx') : import('./map/StaticMap.tsx'));
const loadGlobal = () => import('./global/GlobalView.tsx');

/** The URL hash for the current state; 3D is the default, so only a chosen 2D view is written. */
function toHash(s: Ui, labels: string[]): HashState {
  return {
    region: s.region.key,
    from: labels[s.range[0]],
    to: labels[s.range[1]],
    series: s.series,
    mode: s.mode,
    view: s.view,
    lang: s.lang,
    map: s.mapMode === 'globe' ? undefined : s.mapMode,
    color: s.mapColor === 'excess' ? 'excess' : undefined,
    base: s.baseChoice === 'auto' ? undefined : s.baseChoice,
  };
}

export function App() {
  const lang = useUi((s) => s.lang);
  const view = useUi((s) => s.view);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const { t } = i18n;
  const [model, setModel] = useState<Model | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // ---- language and motion preferences, once
  useEffect(() => {
    const h = readHash();
    // with reduced motion the map opens flat and still; 3D and the globe stay one click away
    useUi.getState().set({ lang: initialLang(), view: h.view ?? 'explore', mapMode: h.map ?? (reducedMotion() ? '2d' : 'globe'), baseChoice: h.base ?? 'auto' });
    if (!webglAvailable()) useUi.getState().set({ mapMode: '2d', columnsBlocked: 'webgl' });
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    writeStored('focos.lang', lang);
  }, [lang]);

  // ---- data
  useEffect(() => {
    if (view === 'global' || model) return;
    let alive = true;
    setError(null);
    (async () => {
      try {
        const bundle: Bundle = await loadBundle();
        const axis = makeAxis(bundle.manifest.months.start, bundle.manifest.months.n, bundle.manifest.months.labels);
        const [table, boundaries] = await Promise.all([loadTable(bundle, (f) => alive && setProgress(f)), loadBoundaries(bundle)]);
        if (alive) setModel({ bundle, manifest: bundle.manifest, axis, table, boundaries });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt, view, model]);

  // ---- state from the URL once the bundle is here, then mirrored back into it
  useEffect(() => {
    if (!model || ready) return;
    const h = readHash();
    const { manifest, axis } = model;
    const region = (h.region && regionFromKey(h.region, manifest)) || defaultRegion(manifest);
    const lc = latestMonth(axis, observability(manifest, axis, 'harmonized'))?.m ?? axis.n - 1;
    let range: [number, number] = [Math.max(0, lc - 11), lc];
    if (h.from && h.to) {
      const a = indexOfLabel(axis, h.from);
      const b = indexOfLabel(axis, h.to);
      if (a >= 0 && b < axis.n && a <= b) range = [a, b];
    }
    const [w, s, e, n] = manifest.bbox;
    useUi.getState().set({
      region,
      range,
      series: h.series ?? 'harmonized',
      mode: h.mode ?? 'counts',
      mapColor: h.color ?? 'hotspots',
      circle: { lon: Math.round(((w + e) / 2) * 100) / 100, lat: Math.round(((s + n) / 2) * 100) / 100, radiusKm: 50 },
    });
    setReady(true);
  }, [model, ready]);

  useEffect(() => {
    if (!model || !ready) return;
    const labels = model.axis.labels;
    writeHash(toHash(useUi.getState(), labels));
    return useUi.subscribe((s, p) => {
      if (s.region !== p.region || s.range !== p.range || s.series !== p.series || s.mode !== p.mode || s.view !== p.view || s.lang !== p.lang || s.mapMode !== p.mapMode || s.mapColor !== p.mapColor || s.baseChoice !== p.baseChoice) {
        writeHash(toHash(s, labels));
      }
    });
  }, [model, ready]);

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      const s = useUi.getState();
      const patch: Partial<Ui> = {};
      if (h.view && h.view !== s.view) patch.view = h.view;
      if (h.lang && h.lang !== s.lang) patch.lang = h.lang;
      if (model) {
        const r = h.region ? regionFromKey(h.region, model.manifest) : null;
        if (r && r.key !== s.region.key) patch.region = r;
        if (h.from && h.to) {
          const a = indexOfLabel(model.axis, h.from);
          const b = indexOfLabel(model.axis, h.to);
          if (a >= 0 && b < model.axis.n && a <= b && (a !== s.range[0] || b !== s.range[1])) patch.range = [a, b];
        }
      }
      if (h.series && h.series !== s.series) patch.series = h.series;
      if (h.mode && h.mode !== s.mode) patch.mode = h.mode;
      if (Object.keys(patch).length) s.set(patch);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [model]);

  useEffect(() => {
    document.title = `Orbit and Ember · ${view === 'methods' ? t('navMethods') : view === 'history' ? t('appTaglineShort') : t('titleWorld')}`;
  }, [view, t]);

  const synthetic = Boolean(model?.bundle.synthetic);
  const setView = (v: 'explore' | 'global' | 'history' | 'methods') => {
    useUi.getState().set({ view: v });
    window.scrollTo(0, 0);
  };

  return (
    <I18nContext.Provider value={i18n}>
      <TooltipProvider>
        <div className={`app${view === 'methods' ? ' page-mode' : ''}`}>
          <TopBar view={view} onView={setView} synthetic={view === 'history' && synthetic} />
          {view === 'history' && synthetic && <p className="notice-bar">{t('syntheticNote')}</p>}
          {view === 'global' ? (
            <LazySlot name={t('appGlobalName')} load={loadGlobal} fallback={<Splash><p>{t('appLoadingGlobal')}</p></Splash>} />
          ) : error ? (
            <Splash>
              <div className="error" role="alert">
                <p>
                  <b>{t('loadError')}</b>
                </p>
                <p className="small">{error}</p>
              </div>
              <button type="button" className="btn primary" onClick={() => setAttempt((a) => a + 1)}>
                {t('retry')}
              </button>
            </Splash>
          ) : !model || !ready ? (
            <Splash>
              <p role="status" aria-live="polite">
                {progress > 0 ? t('loadingTable', { pct: `${Math.round(progress * 100)}%` }) : t('loading')}
              </p>
              <div className="progress" aria-hidden="true">
                <div style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            </Splash>
          ) : (
            <ModelContext.Provider value={model}>
              <DerivedProvider>{view === 'methods' ? <MethodsPage model={model} /> : <Explore />}</DerivedProvider>
            </ModelContext.Provider>
          )}
        </div>
      </TooltipProvider>
    </I18nContext.Provider>
  );
}

function Splash({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="splash">
      <div className="splash-card">
        <div className="splash-brand">
          <FocosMark size={34} />
          <span>Orbit and Ember</span>
        </div>
        <p className="splash-tag">{t('appTaglineShort')}</p>
        {children}
        <SpaceAppsLogo height={44} />
      </div>
    </div>
  );
}

function Explore() {
  const { t } = useI18n();
  const view = useUi((s) => s.view);
  const networkOpen = useUi((s) => s.networkOpen);
  const signalOpen = view === 'explore' && networkOpen;
  const networkSelection = useUi((s) => s.networkSelection);
  const networkSource = useUi((s) => s.networkFeed?.source ?? null);
  const networkTerrainActive = useUi((s) => s.networkTerrainActive);
  return (
    <div className="main">
      <PanelBoundary name={t('panelLabel')}>
        {view === 'explore' ? <GlobalPanel /> : <Panel />}
      </PanelBoundary>
      <section className={`mapwrap${signalOpen ? ' network-active' : ''}`} aria-label={view === 'explore' ? t('mvGlobeLabel') : t('mapLabel')}>
        <LazySlot
          name={t('nameMap')}
          load={loadMap}
          fallback={
            <div className="map-loading" role="status">
              <div className="spinner" aria-hidden="true" />
              <span>{t('mapLoading')}</span>
            </div>
          }
        />
        {view !== 'explore' && <PanelBoundary name={t('nameMap')} className="over-map"><MapStatus /></PanelBoundary>}
        <div className={`map-top-left${signalOpen ? ' network-active' : ''}`}>
          {view === 'explore' && <SignalRelay cell={networkSelection} source={networkSource} open={signalOpen} terrainActive={networkTerrainActive} onReturnToGlobe={() => window.dispatchEvent(new Event('focos:return-globe'))} onToggle={() => useUi.getState().set({ networkOpen: !networkOpen })} />}
          {!signalOpen && <HowToRead />}
          {view !== 'explore' && <StoryCard />}
        </div>
        <div className="map-top-right">
          <ViewControls />
          {!signalOpen && <PanelBoundary name={t('nameLayers')}>
            <LayerControls />
          </PanelBoundary>}
        </div>
        <div className="map-bottom">
          {/* the readout and the timeline belong to the Argentina record; the worldwide globe shows the past 24 hours */}
          {view !== 'explore' && <MapReadout />}
          {view === 'explore' && <details className="model-estimate-dock">
            <summary>{t('appDockSummary')}</summary>
            <PanelBoundary name={t('nameMap')}><MapStatus /></PanelBoundary>
          </details>}
          {view !== 'explore' && (
            <PanelBoundary name={t('nameTimeline')}>
              <TimeScrubber />
            </PanelBoundary>
          )}
        </div>
        <PlotsDrawer />
        {view === 'explore' && <QuickTour />}
      </section>
      <StoryDriver />
    </div>
  );
}

function MethodsPage({ model }: { model: Model }) {
  return (
    <main className="page">
      <Methods model={model} />
      <footer className="page-foot">
        <SpaceAppsLogo height={40} />
      </footer>
    </main>
  );
}
