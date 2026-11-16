import { apiUrl } from '../lib/api.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import { ColumnLayer } from '@deck.gl/layers';
import { focosStyle, SKY } from '../map/style.ts';
import { labelLanguage } from '../map/basemap.ts';
import { reducedMotion, useUi } from '../store.ts';
import { useI18n } from '../i18n.tsx';
import type { Lang, TKey } from '../i18n.tsx';
import { WorldHistory } from './WorldHistory.tsx';
import { EmberGlobe } from './EmberGlobe.tsx';
import { SignalRelay } from '../network/SignalRelay.tsx';
import './global.css';
import {fireFootprints} from '../lib/fireFeed.ts';
import {moveOnEarth,travelSpeed} from '../lib/terrainExperience.ts';
import {observationsInCell} from '../lib/globeSelection.ts';
import type {FirePoint} from '../lib/fireFeed.ts';

maplibregl.setWorkerUrl(workerUrl);

interface Cell { lon: number; lat: number; count: number; latest: number; hours: number[] }
interface GridFeed {
  points?: FirePoint[];
  fetchedAt: string;
  windowHours: number;
  startHour: number;
  hourlyDetections: number[];
  resolutionDegrees: number;
  detections: number;
  latestObservation: number;
  cells: Cell[];
  sources: Array<{ sensor: string; url: string; count: number }>;
}
type Mode = 'globe' | '3d' | '2d';
const destinations: Array<{ id: string; label: TKey; center: [number, number]; zoom: number }> = [
  { id: 'earth', label: 'gvDestEarth', center: [-25, 20], zoom: 2.1 },
  { id: 'united-states', label: 'gvDestUnitedStates', center: [-99, 39], zoom: 3.1 },
  { id: 'south-america', label: 'gvDestSouthAmerica', center: [-61, -15], zoom: 2.7 },
  { id: 'africa', label: 'gvDestAfrica', center: [20, 2], zoom: 2.7 },
  { id: 'europe-asia', label: 'gvDestEuropeAsia', center: [66, 42], zoom: 2.2 },
  { id: 'australia', label: 'gvDestAustralia', center: [135, -25], zoom: 2.8 },
];
/** Grid cell size of the worldwide feed, in degrees */
const CELL_DEGREES = 0.5;
/** Date and time with every field named: the bare default drops a.m./p.m. in es-AR, leaving 11:58 for 23:58 */
const STAMP: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' };
const hoursAgo = (timestamp: number) => Math.max(0, Math.round((Date.now() - timestamp) / 3_600_000));
/** Legend classes, matching the thresholds in color() */
const KEY_CLASSES = ['1–4', '5–19', '20–79', '80+'];
const color = (count: number): [number, number, number, number] => count >= 80 ? [255, 232, 109, 245] : count >= 20 ? [255, 173, 50, 235] : count >= 5 ? [255, 95, 40, 220] : [203, 56, 55, 205];

/** A failure the reader can act on, carried as its dictionary key so it follows the reading language. */
class TravelProblem extends Error {
  key: TKey;
  constructor(key: TKey) {
    super(key);
    this.key = key;
  }
}

function globalStyle(lang: Lang): StyleSpecification {
  const style = focosStyle({ base: 'imagery', lang, density: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', coordinates: [[-180, 85], [180, 85], [180, -85], [-180, -85]] } });
  const excluded = new Set(['density', 'prov-fill', 'prov-line', 'region-halo', 'region-line', 'draft-fill', 'draft-line', 'label-province']);
  style.layers = style.layers.filter((layer) => !excluded.has(layer.id));
  delete style.sources.density;
  style.sources['close-imagery']={type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'};
  style.sources['world-elevation']={type:'raster-dem',tiles:['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],tileSize:512,encoding:'terrarium',maxzoom:12,attribution:'Terrain © Mapterhorn contributors'};
  style.sources['selected-fires']={type:'geojson',data:{type:'FeatureCollection',features:[]}};
  const insertion=style.layers.findIndex(l=>l.id==='label-ocean');
  style.layers.splice(insertion,0,
    {id:'close-imagery',type:'raster',source:'close-imagery',minzoom:6,paint:{'raster-opacity':['interpolate',['linear'],['zoom'],6,0,9,1],'raster-fade-duration':500}},
    {id:'selected-pixels',type:'fill',source:'selected-fires',minzoom:9,paint:{'fill-color':'#ff692b','fill-opacity':0.35}},
    {id:'selected-rims',type:'line',source:'selected-fires',minzoom:9,paint:{'line-color':'#ffd28c','line-width':2}});
  style.terrain={source:'world-elevation',exaggeration:1.5};
  style.projection = { type: 'globe' };
  style.sky = SKY as unknown as StyleSpecification['sky'];
  return style;
}

export default function GlobalView() {
  const mount = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const overlay = useRef<MapLibreOverlay | null>(null);
  const [ready, setReady] = useState(false);
  const [feed, setFeed] = useState<GridFeed | null>(null);
  const [source, setSource] = useState<'live' | 'snapshot' | null>(null);
  const [error, setError] = useState<TKey | ''>('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<Mode>('globe');
  const [hourIndex, setHourIndex] = useState(23);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [travelError, setTravelError] = useState<TKey | ''>('');
  const [entering, setEntering] = useState(false);
  const [terrainPoint,setTerrainPoint]=useState<FirePoint|null>(null);
  const [relief,setRelief]=useState(1.5);
  const returnCamera=useRef<{center:[number,number];zoom:number;pitch:number;bearing:number}|null>(null);
  const flightFinish=useRef<(()=>void)|null>(null);
  const [now, setNow] = useState(Date.now());
  const hasFeed = useRef(false);
  const focus = useRef(destinations[0]);
  const { t, lang, locale, fmt } = useI18n();
  const view = useUi((s) => s.view);
  useEffect(() => {
    if (!networkOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setNetworkOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [networkOpen]);

  useEffect(() => {
    let active = true;
    async function refresh() {
      setLoading(true);
      try {
        const response = await fetch(apiUrl('api/world-grid'), { cache: 'no-store' });
        if (!response.ok) throw new Error('NASA feed unavailable');
        const next = await response.json() as GridFeed;
        if (!Array.isArray(next.cells)) throw new Error('Unexpected NASA feed');
        if (active) { hasFeed.current = true; setFeed(next); setSource('live'); setError(''); setNow(Date.now()); }
      } catch {
        if (active && !hasFeed.current) {
          try {
            const response = await fetch(`${import.meta.env.BASE_URL}data-live/world-grid.json`);
            if (!response.ok) throw new Error();
            const next = await response.json() as GridFeed;
            if (!Array.isArray(next.cells)) throw new Error();
            if (active) { hasFeed.current = true; setFeed(next); setSource('snapshot'); setError('gvErrSnapshot'); }
          } catch { if (active) setError('gvErrNone'); }
        } else if (active) setError('gvErrStale');
      } finally { if (active) setLoading(false); }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); setNow(Date.now()); }, 10 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [revision]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setHourIndex((index) => {
      if (index >= 23) { setPlaying(false); return 23; }
      return index + 1;
    }), 800);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (!mount.current) return;
    const intro = !reducedMotion();
    const m = new maplibregl.Map({ container: mount.current, style: globalStyle(lang), center: [-25, 20], zoom: intro ? .75 : 2.1, maxPitch: 75, attributionControl: false, canvasContextAttributes: { antialias: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Hotspots: NASA FIRMS VIIRS NOAA-20 / NOAA-21 · Imagery: NASA GIBS' }), 'bottom-right');
    m.once('style.load', () => {
      const o = new MapLibreOverlay({ interleaved: true, layers: [], onError: (e: Error) => console.error('[focos] global columns:', e) } as ConstructorParameters<typeof MapLibreOverlay>[0]);
      m.addControl(o);
      overlay.current = o;
      setReady(true);
      if (intro) m.flyTo({ center: [-25, 20], zoom: 2.1, duration: 2800, curve: 1.25, essential: false });
    });
    const resize = new ResizeObserver(() => m.resize());
    resize.observe(mount.current);
    return () => { resize.disconnect(); overlay.current = null; m.remove(); map.current = null; setReady(false); };
  }, []);
  // place names follow the reading language after the map is built
  useEffect(() => { const m = map.current; if (ready && m) labelLanguage(m, lang); }, [ready, lang]);

  const cells = useMemo(() => (feed?.cells ?? []).map((cell) => ({ ...cell, count: cell.hours.slice(0, hourIndex + 1).reduce((sum, value) => sum + value, 0) })).filter((cell) => cell.count > 0), [feed, hourIndex]);
  async function enterCell(cell:Cell) {
    if (!feed || entering) return;
    setSelected(cell); setPlaying(false); setEntering(true); setTravelError('');
    try {
      let points=feed.points;
      if (!points) {
        const response=await fetch(`${import.meta.env.BASE_URL}data-live/world-fires.json`);
        if (!response.ok) throw new TravelProblem('gvErrDetails');
        points=(await response.json()).points;
      }
      const matches=observationsInCell(points??[],cell,feed.startHour,feed.startHour+(hourIndex+1)*3600000);
      if (!matches.length) throw new TravelProblem('gvErrNoMatch');
      const m=map.current;if(!m)throw new TravelProblem('gvErrNotReady');
      const c=m.getCenter();returnCamera.current={center:[c.lng,c.lat],zoom:m.getZoom(),pitch:m.getPitch(),bearing:m.getBearing()};
      setTerrainPoint(matches[0]);
      (m.getSource('selected-fires') as maplibregl.GeoJSONSource).setData(fireFootprints(matches));
      travelTo([matches[0].lon,matches[0].lat],13.2,70,6500);
    } catch(e) {
      if (!(e instanceof TravelProblem)) console.error('[focos] terrain:', e);
      setTravelError(e instanceof TravelProblem?e.key:'gvErrTerrain'); setEntering(false);
    }
  }
  function travelTo(center:[number,number],zoom:number,pitch:number,duration:number,bearing=-25) {
    const m=map.current;if(!m)return;
    if(flightFinish.current)m.off('moveend',flightFinish.current);
    m.stop(); setEntering(true);
    const done=()=>{setEntering(false);flightFinish.current=null;};
    flightFinish.current=done;
    m.setProjection({type:'globe'});
    m.flyTo({center,zoom,pitch,bearing,duration:reducedMotion()?0:duration,curve:1.25,essential:false});
    if(reducedMotion())done();else m.once('moveend',done);
  }
  function returnToEarth(){
    const c=returnCamera.current??{center:[-25,20] as [number,number],zoom:2.1,pitch:0,bearing:0};
    setTerrainPoint(null);setSelected(null);setMode('globe');
    travelTo(c.center,c.zoom,c.pitch,4800,c.bearing);
  }
  useEffect(()=>{const m=map.current;if(!ready||!m)return;m.setTerrain({source:'world-elevation',exaggeration:relief});},[ready,relief]);
  useEffect(()=>{
    const m=map.current;if(!ready||!m||!terrainPoint)return;
    const canvas=m.getCanvas();canvas.tabIndex=0;const keys=new Set<string>();
    const accepted=['w','a','s','d','q','e','arrowleft','arrowright','arrowup','arrowdown','shift'];
    const down=(e:KeyboardEvent)=>{if(document.activeElement===canvas&&accepted.includes(e.key.toLowerCase())){e.preventDefault();keys.add(e.key.toLowerCase());}};
    const up=(e:KeyboardEvent)=>keys.delete(e.key.toLowerCase());const clear=()=>keys.clear();
    const focus=()=>canvas.focus({preventScroll:true});
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);canvas.addEventListener('pointerdown',focus);canvas.addEventListener('blur',clear);
    let frame=0,last=performance.now();
    const tick=(time:number)=>{const dt=Math.min(.05,(time-last)/1000);last=time;
      if(keys.size){m.stop();const c=m.getCenter(),axis=(a:string,b:string)=>Number(keys.has(a))-Number(keys.has(b)),step=travelSpeed(m.getZoom(),false,1,keys.has('shift'))*dt;
        m.jumpTo({center:moveOnEarth(c.lng,c.lat,m.getBearing(),axis('w','s')*step,axis('d','a')*step),bearing:m.getBearing()+axis('arrowright','arrowleft')*45*dt,pitch:Math.max(0,Math.min(82,m.getPitch()+axis('arrowup','arrowdown')*25*dt)),zoom:Math.max(0,Math.min(18,m.getZoom()+axis('q','e')*dt))});}
      frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);canvas.removeEventListener('pointerdown',focus);canvas.removeEventListener('blur',clear);};
  },[ready,terrainPoint]);
  const visibleTotal = useMemo(() => cells.reduce((sum, cell) => sum + cell.count, 0), [cells]);
  useEffect(() => {
    if (!ready || !overlay.current) return;
    const footprint = new ColumnLayer<Cell>({
      id: 'global-hotspot-footprints', data: cells, beforeId: 'label-ocean', diskResolution: 4, angle: 45,
      visible: !terrainPoint, radius: 28_000, extruded: false, pickable: mode === '2d',
      getPosition: (d: Cell) => [d.lon, d.lat, 0],
      getFillColor: (d: Cell) => { const [r, g, b] = color(d.count); return [r, g, b, mode === '2d' ? 220 : 95]; },
      onClick: (info: { object?: Cell }) => { if (info.object) void enterCell(info.object); return true; },
      transitions: { getFillColor: 550 },
    } as never);
    const towers = new ColumnLayer<Cell>({
      id: 'global-standing-fires', data: cells, beforeId: 'label-ocean', diskResolution: 4, angle: 45,
      visible: !terrainPoint, radius: 17_000, extruded: mode !== '2d', flatShading: true, pickable: mode !== '2d',
      getPosition: (d: Cell) => [d.lon, d.lat, 0],
      getElevation: (d: Cell) => mode === '2d' ? 0 : Math.min(480_000, 45_000 + Math.sqrt(d.count) * 50_000),
      getFillColor: (d: Cell) => color(d.count),
      autoHighlight: true, highlightColor: [255, 255, 255, 100],
      onClick: (info: { object?: Cell }) => { if (info.object) void enterCell(info.object); return true; },
      transitions: { getElevation: 650, getFillColor: 550 },
      material: { ambient: .62, diffuse: .55, shininess: 12, specularColor: [40, 40, 40] },
      updateTriggers: { getElevation: mode },
    } as never);
    overlay.current.setProps({ layers: mode === '2d' ? [footprint] : [footprint, towers] });
  }, [ready, cells, mode, feed, hourIndex, entering, terrainPoint]);

  function changeMode(next: Mode) {
    setMode(next);
    const m = map.current;
    if (!m) return;
    m.stop();
    const place = focus.current.id === 'earth' && next !== 'globe' ? destinations[1] : focus.current;
    m.setProjection({ type: next === 'globe' ? 'globe' : 'mercator' });
    const zoom = next === '3d' ? Math.max(4.1, place.zoom) : next === '2d' ? Math.max(3.2, place.zoom) : place.zoom;
    m.jumpTo({ center: place.center, zoom, pitch: 0 });
    m.easeTo({ center: place.center, zoom, pitch: next === '3d' ? 65 : 0, duration: 850 });
  }
  const latest = feed?.latestObservation ?? 0;
  const stale = source === 'snapshot' || (latest > 0 && now - latest > 12 * 3_600_000);
  const cellSize = fmt(CELL_DEGREES);
  const reliefText = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(relief);
  return <main className={`global-view${terrainPoint ? ' terrain-active' : ''}`}>
    <aside className="global-panel">
      <span className="global-kicker">{t('gvKicker')}</span>
      <h1>{t('gvTitle')}</h1>
      <p className="global-lede">{t('gvLede')}</p>
      {view === 'explore' && <WorldHistory />}
      <div className="global-stats"><div><strong>{feed ? fmt(visibleTotal) : '–'}</strong><span>{t('gvStatDetections')}</span></div><div><strong>{feed ? fmt(cells.length) : '–'}</strong><span>{t('gvStatCells')}</span></div></div>
      <div className={`global-status${stale ? ' stale' : ''}`}><i />{t(loading && !feed ? 'gvStatusLoading' : source === 'live' ? 'gvStatusLive' : source === 'snapshot' ? 'gvStatusSnapshot' : 'gvStatusWaiting')}</div>
      <p className="global-meta">{t('gvMetaWindow')}<br />{t('gvMetaLatest', { when: latest ? `${new Date(latest).toLocaleString(locale, { ...STAMP, timeZone: 'UTC' })} UTC` : t('gvUnavailable') })}<br />{t('gvMetaFetched', { when: feed ? new Date(feed.fetchedAt).toLocaleString(locale, STAMP) : t('gvWaiting') })}</p>
      <button className="global-refresh" type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>{loading ? t('gvChecking') : `${t('gvRefresh')} ↻`}</button>
      {error && <p className="global-error" role="status">{t(error)}</p>}
      <h2>{t('gvExplore')}</h2>
      <div className="global-destinations">{destinations.map((place) => <button key={place.id} type="button" onClick={() => { focus.current = place; setTerrainPoint(null); setSelected(null); map.current?.flyTo({ center: place.center, zoom: mode === '3d' ? Math.max(4.1, place.zoom) : place.zoom, pitch: mode === '3d' ? 65 : 0, duration: 1300 }); }}>{t(place.label)}<span>↗</span></button>)}</div>
      <div className="global-key"><span>{t('gvKeyTitle', { res: cellSize })}</span><div><i /><i /><i /><i /></div><small>{KEY_CLASSES.join(' \u00a0\u00a0\u00a0\u00a0 ')}</small></div>
      <p className="global-caveat">{t('gvCaveat')}</p>
      <a className="global-source" href="https://firms.modaps.eosdis.nasa.gov/active_fire/" target="_blank" rel="noreferrer">{t('gvSourceLink')} ↗</a>
    </aside>
    <section className="global-map-wrap" aria-label={t('gvMapLabel')}><div ref={mount} className="global-map" />
      {!terrainPoint && <div className="global-signal-relay"><SignalRelay cell={selected} source={source} open={networkOpen} onToggle={() => setNetworkOpen(value => !value)} /></div>}
      <div className="global-map-heading"><span>{t('gvMapKicker')}</span><strong>{terrainPoint ? t('gvHeadingTerrain') : t('gvHeadingGlobe')}</strong><small>{terrainPoint ? t('gvHintTerrain') : t('gvHintGlobe')}</small></div>
      <div className="global-view-controls" role="group" aria-label={t('gvViewControls')}>{!terrainPoint && (['globe', '3d'] as Mode[]).map((v) => <button key={v} type="button" aria-pressed={mode === v} onClick={() => changeMode(v)}>{v === 'globe' ? t('gvModeGlobe') : t('gvMode3d')}</button>)}</div>
      {selected && !terrainPoint && <div className="global-inspect"><button type="button" aria-label={t('gvCloseCell')} onClick={() => setSelected(null)}>×</button><span>{entering ? t('gvEntering') : t('gvSelectedCell', { res: cellSize })}</span><b>{t(selected.count === 1 ? 'gvCellDetectionOne' : 'gvCellDetections', { n: fmt(selected.count) })}</b><small>{t('gvCellWhere', { lat: fmt(selected.lat, 2), lon: fmt(selected.lon, 2), age: selected.latest ? t('gvHoursAgo', { n: fmt(hoursAgo(selected.latest)) }) : t('gvUnavailable') })}</small>{travelError && <p role="alert">{t(travelError)}</p>}</div>}
      {terrainPoint && <div className="globe-terrain-panel">
        <span>{t('gvObsKicker', { satellite: terrainPoint.satellite })}</span>
        <h2>{terrainPoint.frp==null?t('gvThermalDetection'):`${fmt(terrainPoint.frp,1)} MW`}</h2>
        <p>{terrainPoint.date} · {terrainPoint.time.slice(0,2)}:{terrainPoint.time.slice(2)} UTC<br/>{fmt(terrainPoint.lat,4)}°, {fmt(terrainPoint.lon,4)}°</p>
        <div role="status">{entering?t('gvFlying'):t('gvExploreTerrain')}</div>
        <button onClick={()=>travelTo([terrainPoint.lon,terrainPoint.lat],13.2,70,2400)}>{t('gvOblique')}</button>
        <button onClick={()=>travelTo([terrainPoint.lon,terrainPoint.lat],14.5,78,2800)}>{t('gvNearGround')}</button>
        <button onClick={returnToEarth}>↑ {t('gvReturnEarth')}</button>
        <label>{t('gvRelief', { x: reliefText })}<input aria-label={t('gvReliefLabel')} type="range" min="1" max="3" step=".25" value={relief} onChange={e=>setRelief(Number(e.target.value))}/></label>
        <small>{t('gvKeysHelp')}<br/>{t('gvPixelsNote')}</small>
      </div>}
      <div className="global-timeline"><button type="button" aria-label={playing ? t('gvPause') : t('gvPlay')} aria-pressed={playing} disabled={!feed} onClick={() => { if (playing) setPlaying(false); else { if (hourIndex === 23) setHourIndex(0); setPlaying(true); } }}>{playing ? 'Ⅱ' : '▶'}</button><div className="global-timeline-main"><div className="global-timeline-title"><span>{t('gvReplayTitle')}</span><b>{feed ? `${new Date(feed.startHour + (hourIndex + 1) * 3_600_000).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} UTC` : t('gvReplayWaiting')}</b><small>{t('gvReplayTotal', { n: fmt(visibleTotal) })}</small></div><div className="global-timeline-bars">{(feed?.hourlyDetections ?? Array(24).fill(0)).map((value, index) => <i key={index} className={index <= hourIndex ? 'active' : ''} style={{ height: `${Math.max(6, Math.sqrt(value / Math.max(1, Math.max(...(feed?.hourlyDetections ?? [1])))) * 100)}%` }} />)}</div><input type="range" aria-label={t('gvReplayHour')} min="0" max="23" value={hourIndex} disabled={!feed} onChange={(event) => { setPlaying(false); setHourIndex(Number(event.target.value)); }} /><div className="global-timeline-labels"><span>{t('gvReplayStart')}</span><span>{t('gvReplayNote')}</span><span>{t('gvReplayEnd')}</span></div></div></div>
      <div className="global-map-foot">{t('gvFoot', { n: fmt(cells.length), feed: t(stale ? 'gvFootSnapshot' : 'gvFootLive') })}</div>
      <EmberGlobe feed={feed} cells={cells} selected={selected} hourIndex={hourIndex} source={source} stale={stale} mode={mode} onFocus={(lon, lat) => { const cell = cells.find(c => c.lon === lon && c.lat === lat); if (cell) setSelected(cell); map.current?.flyTo({ center: [lon, lat], zoom: mode === 'globe' ? 4 : 6, duration: 900 }); }} />
    </section>
  </main>;
}
