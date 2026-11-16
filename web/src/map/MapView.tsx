import { apiUrl } from '../lib/api.ts';
// The map. MapLibre draws everything under the data: NASA imagery or a plain relief, the terrain
// with its hillshade, quiet labels, provinces and the selected area, as a flat map, a tilted map or
// the globe. deck.gl draws one column per grid cell inside MapLibre's render pass (interleaved), so
// ridges hide what lies behind them. Whenever the columns cannot be drawn, the same per-cell values
// show as a flat image draped on the terrain, so a failure never takes the data away.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, ImageSource, Map as MlMap, MapMouseEvent, MapTouchEvent, RasterDEMTileSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import {observationsInCell} from '../lib/globeSelection.ts';
import {fireFootprints} from '../lib/fireFeed.ts';
import type {FirePoint} from '../lib/fireFeed.ts';
import './hotspot-flight.css';
import {createTerrainWarmup} from './terrainWarmup.ts';
import { ColumnLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import { findCell } from '../bundle/table.ts';
import { acceptClick, guardConsumed, guardDown, newClickGuard } from '../lib/gesture.ts';
import type { BBox, GeoFeature } from '../lib/region.ts';
import { bboxRegion, cellCentre, cellIdAt, circleRegion, provinceRegion, regionBBox, regionOutline } from '../lib/region.ts';
import { blockInRegion, blockSize, blockValues, cellBlocks, columnHeight } from '../lib/cells.ts';
import { elevationBilinear } from '../lib/terrain.ts';
import type { Terrain } from '../lib/terrain.ts';
import type { MapMode } from '../state.ts';
import { useI18n } from '../i18n.tsx';
import type { TKey } from '../i18n.tsx';
import { useModel } from '../model.ts';
import { baseOf, columnsOn, reducedMotion, useUi, webglAvailable } from '../store.ts';
import { controlLanguage, installMapGuards, labelLanguage } from './basemap.ts';
import type { BaseMap } from './style.ts';
import { applyBase, FIRST_LABEL, focosStyle, LAND, SKY } from './style.ts';
import { LOCAL_DEM_TILES, registerLocalDem } from './dem.ts';
import { densityImage, imageCoords } from './density.ts';
import type { ColumnFrame, Path3 } from './deckLayers.ts';
import { columnFrame, columnLayers, outlineLayers } from './deckLayers.ts';
import { useTerrain } from './useTerrain.ts';
import { TERRAIN_EXAGGERATION } from './constants.ts';
import { useCellValues } from './useCellValues.ts';
import { EmberGlobe } from '../global/EmberGlobe.tsx';

maplibregl.setWorkerUrl(workerUrl);

/** Camera tilt per view: the globe is tilted a little so the columns read as height. */
const PITCH: Record<MapMode, number> = { '2d': 0, '3d': 45, globe: 30 };
/** Column half-diagonal as a share of the column spacing: leaves ground visible between columns. */
const COLUMN_RADIUS_SHARE = 0.34;
const M_PER_DEG = 111_320;
/** The custom layer that sits between the columns and the labels. */
const DEPTH_CLEAR = 'depth-clear';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
/** Status lines of the hotspot flight, kept as dictionary keys so they follow a language change. */
type FlightMessage = Extract<TKey, `mvFlight${string}`>;
/** Where the opening approach starts: the whole Earth, South America facing the viewer. */
const OPENING = { center: [-25, 20] as [number, number], zoom: 1.25 };

const fc = (f: GeoFeature | null): GeoJSON.FeatureCollection => (f ? { type: 'FeatureCollection', features: [f as GeoJSON.Feature] } : EMPTY);
const terrainSpec = () => ({ source: 'dem', exaggeration: TERRAIN_EXAGGERATION });
const projectionSpec = (m: MapMode) => ({ type: m === 'globe' ? 'globe' : 'mercator' });

/** Hillshade strength and background per base map. */
function baseLook(map: MlMap, base: BaseMap) {
  const set = (id: string, prop: string, v: unknown) => {
    try {
      if (map.getLayer(id)) map.setPaintProperty(id, prop as never, v as never);
    } catch {
      /* fine */
    }
  };
  set('background', 'background-color', base === 'plain' ? LAND : '#06102e');
  set('hillshade', 'hillshade-exaggeration', base === 'plain' ? 0.55 : 0.32);
  set('hillshade', 'hillshade-highlight-color', base === 'plain' ? 'rgba(200, 215, 255, 0.35)' : 'rgba(255, 250, 235, 0.25)');
}

/**
 * Tallest column, in metres, for the camera's zoom: about 150 km when the whole country is in view,
 * shrinking a little faster than the ground scale as the camera comes closer, so a province reads as
 * columns standing on a landscape rather than a wall.
 */
function fullHeight(zoom: number, lat: number): number {
  const kmPerPx = (78.271517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return Math.max(2_500, Math.min(200_000, 150_000 * (kmPerPx / 4.8) ** 1.25));
}

/** A little of the surroundings around a selected area, so it is seen in context. */
function withContext(b: BBox, all: boolean): BBox {
  if (all) return b;
  const dx = (b[2] - b[0]) * 0.18;
  const dy = (b[3] - b[1]) * 0.18;
  return [b[0] - dx, Math.max(-85, b[1] - dy), b[2] + dx, Math.min(85, b[3] + dy)];
}

/** Rings of a polygon feature as 3D paths on the terrain, densified so they follow the relief. */
function featurePaths(f: GeoFeature, z: (lon: number, lat: number) => number, maxStep: number): Path3[] {
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  return rings.map((ring) => {
    const out: Path3 = [];
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      if (i > 0) {
        const [x0, y0] = ring[i - 1];
        const steps = Math.min(64, Math.floor(Math.hypot(x1 - x0, y1 - y0) / maxStep));
        for (let k = 1; k <= steps; k++) {
          const f2 = k / (steps + 1);
          out.push([x0 + (x1 - x0) * f2, y0 + (y1 - y0) * f2, z(x0 + (x1 - x0) * f2, y0 + (y1 - y0) * f2)]);
        }
      }
      out.push([x1, y1, z(x1, y1)]);
    }
    return out;
  });
}

/** Room around the framed area: the timeline sits along the bottom and columns rise above the area. */
function framePadding(map: maplibregl.Map, tilted: boolean) {
  const h = map.getContainer().clientHeight;
  const w = map.getContainer().clientWidth;
  const narrow = w < 640;
  return {
    top: tilted ? Math.min(130, h * 0.15) : 72,
    bottom: narrow ? 140 : 150,
    left: narrow ? 16 : 40,
    right: narrow ? 16 : 40,
  };
}

function fitFlat(map: maplibregl.Map, b: [number, number, number, number]) {
  const flat = map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding: framePadding(map, false), bearing: 0, maxZoom: 9 });
  if (!flat) return null;
  return { center: maplibregl.LngLat.convert(flat.center ?? map.getCenter()), zoom: flat.zoom ?? map.getZoom(), pitch: 0 };
}

/**
 * Frame the area under a tilted camera (or on the globe). The tilt enlarges the near side and
 * shrinks the far side, so the flat fit is refined by projecting the area's outline at the target
 * camera and correcting zoom and centre until it fills the free box. The trial cameras are set and
 * undone within one frame, so nothing is drawn until the final move.
 */
function fitTilted(map: maplibregl.Map, b: [number, number, number, number], pitch: number) {
  const start = fitFlat(map, b);
  if (!start) return null;
  const pad = framePadding(map, true);
  const el = map.getContainer();
  const W = el.clientWidth;
  const H = el.clientHeight;
  const boxW = Math.max(40, W - pad.left - pad.right);
  const boxH = Math.max(40, H - pad.top - pad.bottom);
  const boxX = pad.left + boxW / 2;
  const boxY = pad.top + boxH / 2;
  const ring: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    const lon = b[0] + (b[2] - b[0]) * f;
    const lat = b[1] + (b[3] - b[1]) * f;
    ring.push([lon, b[1]], [lon, b[3]], [b[0], lat], [b[2], lat]);
  }
  const saved = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  let { center, zoom } = start;
  try {
    for (let k = 0; k < 5; k++) {
      map.jumpTo({ center, zoom, pitch, bearing: 0 });
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of ring) {
        const q = map.project(p);
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x);
        y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
      }
      const scale = Math.min(boxW / Math.max(1, x1 - x0), boxH / Math.max(1, y1 - y0));
      // move the projected area's centre onto the free box's centre, then rescale about it
      center = map.unproject([W / 2 + ((x0 + x1) / 2 - boxX), H / 2 + ((y0 + y1) / 2 - boxY)]);
      zoom = Math.min(9, zoom + Math.log2(scale));
      if (Math.abs(Math.log2(scale)) < 0.02 && Math.abs((x0 + x1) / 2 - boxX) < 4 && Math.abs((y0 + y1) / 2 - boxY) < 4) break;
    }
  } finally {
    map.jumpTo(saved);
  }
  return { center, zoom, pitch };
}

export default function MapView() {
  const model = useModel();
  const { manifest, table, boundaries } = model;
  const { t, fmt } = useI18n();
  const region = useUi((s) => s.region);
  const mapColor = useUi((s) => s.mapColor);
  const showBorders = useUi((s) => s.showBorders);
  const mapMode = useUi((s) => s.mapMode);
  const cols = useUi(columnsOn);
  const base = useUi(baseOf);
  const cameraNonce = useUi((s) => s.cameraNonce);
  const tool = useUi((s) => s.tool);
  const circle = useUi((s) => s.circle);
  const lang = useUi((s) => s.lang);
  const view = useUi((s) => s.view);
  const networkOpen = useUi((s) => s.networkOpen);
  const worldFocus = useUi((s) => s.worldFocus);
  const warmup=useRef<ReturnType<typeof createTerrainWarmup>|null>(null);
  const hoverWarm=useRef<ReturnType<typeof setTimeout>|null>(null);
  const warmCell=useRef('');
  const flightEnd=useRef<(()=>void)|null>(null);
  const returningFromHotspot=useRef(false);
  const requestId=useRef(0);
  useEffect(()=>{warmup.current=createTerrainWarmup();return()=>{warmup.current?.dispose();if(hoverWarm.current)clearTimeout(hoverWarm.current);requestId.current++;};},[]);
  const [hotspot,setHotspot]=useState<FirePoint|null>(null);
  // Retain the observation through the exit transition instead of unmounting mid-fade.
  const [cardHotspot, setCardHotspot] = useState<FirePoint | null>(null);
  useEffect(() => {
    if (hotspot) { setCardHotspot(hotspot); return; }
    const timeout = window.setTimeout(() => setCardHotspot(null), 220);
    return () => window.clearTimeout(timeout);
  }, [hotspot]);
  const [flightMessage,setFlightMessage]=useState<FlightMessage|''>('');
  const worldFeed=useRef<{points?:FirePoint[];startHour:number}|null>(null);
  const [emberFeed, setEmberFeed] = useState<{ fetchedAt: string; startHour?: number; latestObservation?: number; hourlyDetections?: number[]; cells: Array<{ lon: number; lat: number; count: number; latest: number }> } | null>(null);
  const [emberSource, setEmberSource] = useState<'live' | 'snapshot' | null>(null);
  const previousCamera=useRef<{center:[number,number];zoom:number;pitch:number;bearing:number}|null>(null);
  const [worldCells, setWorldCells] = useState<Array<{ lon: number; lat: number; count: number; latest: number }>>([]);
  const [worldSelected, setWorldSelected] = useState<{ lon: number; lat: number; count: number; latest?: number } | null>(null);
  useEffect(() => { useUi.getState().set({ networkSelection: worldSelected }); }, [worldSelected]);
  useEffect(() => { useUi.getState().set({ networkFeed: emberFeed && emberSource ? { source: emberSource, fetchedAt: emberFeed.fetchedAt, cellCount: emberFeed.cells.length, latestObservation: emberFeed.latestObservation } : null }); }, [emberFeed, emberSource]);
  const [cameraCenter, setCameraCenter] = useState<[number, number]>([-25, 20]);
  const visibleWorldCells = useMemo(() => {
    if (mapMode !== 'globe') return worldCells;
    // A margin inside the horizon keeps tall columns on the far side from showing through Earth.
    const radians = Math.PI / 180;
    const [lon, lat] = cameraCenter;
    return worldCells.filter((cell) => Math.sin(lat * radians) * Math.sin(cell.lat * radians)
      + Math.cos(lat * radians) * Math.cos(cell.lat * radians) * Math.cos((cell.lon - lon) * radians) > 0.2);
  }, [worldCells, cameraCenter, mapMode]);

  useEffect(() => {
    if (view !== 'explore') return;
    let active = true;
    async function refreshWorld() {
      for (const [source, url] of ([['live', apiUrl('api/world-grid')], ['snapshot', `${import.meta.env.BASE_URL}data-live/world-grid.json`]] as const)) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          const feed = await response.json() as { points?:FirePoint[];startHour:number; fetchedAt?:string; latestObservation?: number; hourlyDetections?:number[]; cells?: Array<{ lon: number; lat: number; count: number; latest: number }> };
          if (Array.isArray(feed.cells)) { if (active) {setWorldCells(feed.cells);worldFeed.current=feed;setEmberFeed({...feed,fetchedAt:feed.fetchedAt??'',cells:feed.cells});setEmberSource(source);} return; }
        } catch { /* try the saved observation snapshot */ }
      }
    }
    void refreshWorld();
    const timer = window.setInterval(() => { void refreshWorld(); }, 10 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [view]);

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const overlayRef = useRef<MapLibreOverlay | null>(null);
  const [ready, setReady] = useState(false);
  const [imageryFailed, setImageryFailed] = useState(false);
  const [draft, setDraft] = useState<[number, number, number, number] | null>(null);

  // ------------------------------------------------------------ values for the period
  const { values, scale, inRegion, nothing, sr } = useCellValues();

  async function enterWorldCell(cell:{lon:number;lat:number;count:number;latest?:number}) {
    const map=mapRef.current,feed=worldFeed.current;if(!map||!feed)return;
    returningFromHotspot.current=false;
    const request=++requestId.current;
    setWorldSelected(cell);setFlightMessage('mvFlightPreparing');
    try {
      let points=feed.points;
      if(!points){const response=await fetch(`${import.meta.env.BASE_URL}data-live/world-fires.json`);if(!response.ok){setFlightMessage('mvFlightNoDetails');return;}points=(await response.json()).points;}
      const matches=observationsInCell(points??[],cell,feed.startHour,feed.startHour+86400000);
      if(!matches.length){setFlightMessage('mvFlightNoMatch');return;}
      if(request!==requestId.current)return;
      const target=matches[0],center=map.getCenter();
      warmup.current?.warm(target.lon,target.lat);
      previousCamera.current={center:[center.lng,center.lat],zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};
      if(!map.getSource('hotspot-elevation')){
        map.addSource('hotspot-elevation',{type:'raster-dem',tiles:['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],tileSize:512,encoding:'terrarium',maxzoom:12,attribution:'Elevation © Mapterhorn contributors'});
        map.addSource('hotspot-imagery',{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'});
        map.addLayer({id:'hotspot-imagery',type:'raster',source:'hotspot-imagery',minzoom:6,paint:{'raster-fade-duration':180,'raster-opacity':['interpolate',['linear'],['zoom'],6,0,9,1]}},FIRST_LABEL);
        map.addSource('hotspot-pixels',{type:'geojson',data:EMPTY});
        map.addLayer({id:'hotspot-pixels',type:'fill',source:'hotspot-pixels',minzoom:9,paint:{'fill-color':'#ff782d','fill-opacity':.4}},FIRST_LABEL);
        map.addLayer({id:'hotspot-rim',type:'line',source:'hotspot-pixels',minzoom:9,paint:{'line-color':'#ffe0a0','line-width':2}},FIRST_LABEL);
      }
      (map.getSource('hotspot-pixels') as GeoJSONSource).setData(fireFootprints(matches));
      map.setLayoutProperty('hotspot-imagery','visibility','visible');
      map.setTerrain({source:'hotspot-elevation',exaggeration:1.5});map.setProjection({type:'globe'});
      setHotspot(target);setFlightMessage('mvFlightFlying');
      flyHotspot([target.lon,target.lat],13.2,68,5200);
    }catch(e){console.warn('[focos] hotspot observation could not open:',e);setFlightMessage('mvFlightError');}
  }
  function flyHotspot(center:[number,number],zoom:number,pitch:number,duration:number,bearing=-25){
    const map=mapRef.current;if(!map)return;
    if(flightEnd.current)map.off('moveend',flightEnd.current);
    map.stop();
    const done=()=>{setFlightMessage('mvFlightControls');flightEnd.current=null;};
    flightEnd.current=done;
    map.flyTo({center,zoom,pitch,bearing,duration:reducedMotion()?0:duration,curve:1.3});
    if(reducedMotion())done();else map.once('moveend',done);
  }
  function leaveHotspot(){
    const map=mapRef.current,camera=previousCamera.current;if(!map||!camera)return;
    returningFromHotspot.current=true;
    requestId.current++;if(flightEnd.current){map.off('moveend',flightEnd.current);flightEnd.current=null;}
    map.stop();
    setFlightMessage('mvFlightAscending');
    const finishReturn = () => {
      flightEnd.current = null;
      // A drag can interrupt the ascent. Keep the detail scene intact until we
      // actually reach globe scale; never snap to the destination on interruption.
      if (map.getZoom() >= 7) {
        returningFromHotspot.current = false;
        setFlightMessage('mvFlightControls');
        return;
      }
      const mode = useUi.getState().mapMode;
      if (map.getLayer('hotspot-imagery')) map.setLayoutProperty('hotspot-imagery', 'visibility', 'none');
      (map.getSource('hotspot-pixels') as GeoJSONSource | undefined)?.setData(EMPTY);
      map.setProjection(projectionSpec(mode) as Parameters<MlMap['setProjection']>[0]);
      map.setTerrain(mode === '2d' ? null : terrainSpec());
      setHotspot(null); setWorldSelected(null); setFlightMessage('');
      useUi.getState().set({ networkOpen: false });
      returningFromHotspot.current = false;
    };
    flightEnd.current = finishReturn;
    map.once('moveend', finishReturn);
    // Rise above the current location without returning sideways to the old camera.
    // Keep terrain mounted and let detail imagery fade between zooms 9 and 6.
    map.easeTo({
      center: map.getCenter(),
      bearing: map.getBearing(),
      pitch: 0,
      zoom: Math.min(camera.zoom, 2),
      duration: reducedMotion() ? 0 : 1800,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
    });
  }

  useEffect(() => {
    useUi.getState().set({ networkTerrainActive: Boolean(hotspot) });
    return () => { useUi.getState().set({ networkTerrainActive: false }); };
  }, [hotspot]);
  useEffect(() => {
    const returnToGlobe = () => { if (hotspot) leaveHotspot(); };
    window.addEventListener('focos:return-globe', returnToGlobe);
    return () => window.removeEventListener('focos:return-globe', returnToGlobe);
  }, [hotspot]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hotspot) return;
    // A gesture can interrupt the flight before it reaches terrain. If the camera
    // is back at globe scale, exit the detail and restore the fire columns.
    const exitAtGlobeScale = () => {
      if (!returningFromHotspot.current && !flightEnd.current && !map.isMoving() && map.getZoom() < 7) leaveHotspot();
    };
    let checkFrame = 0;
    const scheduleCheck = () => { cancelAnimationFrame(checkFrame); checkFrame = requestAnimationFrame(exitAtGlobeScale); };
    map.on('moveend', scheduleCheck);
    exitAtGlobeScale();
    return () => { map.off('moveend', scheduleCheck); cancelAnimationFrame(checkFrame); };
  }, [hotspot]);

  // ------------------------------------------------------------ columns, seated on the terrain
  const terrain: Terrain | null = useTerrain(cols && view !== 'explore');
  useEffect(() => {
    useUi.getState().set({ terrainReady: Boolean(terrain) });
  }, [terrain]);
  const basePos = useMemo(() => {
    const p = new Float32Array(table.nCells * 3);
    for (let i = 0; i < table.nCells; i++) {
      const [lon, lat] = cellCentre(table.cellId[i], manifest.grid);
      p[i * 3] = lon;
      p[i * 3 + 1] = lat;
      p[i * 3 + 2] = terrain ? Math.max(0, elevationBilinear(terrain, lon, lat)) * TERRAIN_EXAGGERATION : 0;
    }
    return p;
  }, [table, manifest.grid, terrain]);
  const outline = useMemo(() => regionOutline(region, boundaries), [region, boundaries]);
  const bbox = useMemo(() => regionBBox(region, manifest, boundaries), [region, manifest, boundaries]);

  // level of detail from the camera: coarser columns for the whole country, single cells up close
  const [cam, setCam] = useState({ zoom: 3.6, lat: -38 });
  const k = blockSize(cam.zoom);
  useEffect(() => {
    useUi.getState().set({ columnBlock: k });
  }, [k]);
  const blocks = useMemo(() => (k > 1 ? cellBlocks(table.cellId, manifest.grid, k) : null), [k, table, manifest.grid]);
  const blockPos = useMemo(() => {
    if (!blocks) return null;
    const p = new Float32Array(blocks.n * 3);
    for (let j = 0; j < blocks.n; j++) {
      const lon = blocks.lon[j];
      const lat = blocks.lat[j];
      p[j * 3] = lon;
      p[j * 3 + 1] = lat;
      p[j * 3 + 2] = terrain ? Math.max(0, elevationBilinear(terrain, lon, lat)) * TERRAIN_EXAGGERATION : 0;
    }
    return p;
  }, [blocks, terrain]);
  const full = fullHeight(cam.zoom, cam.lat);
  const frameRef = useRef<ColumnFrame | null>(null);
  const frame = useMemo(() => {
    if (!cols || view === 'explore') return null;
    const extruded = mapColor === 'hotspots';
    const radius = k * manifest.grid.res * M_PER_DEG * COLUMN_RADIUS_SHARE;
    const heightOf = (v: number) => columnHeight(v, sr.hi, full);
    const f = blocks && blockPos
      ? columnFrame(blockValues(values, blocks), blockInRegion(inRegion, blocks), scale, heightOf, frameRef.current, blockPos, extruded, radius)
      : columnFrame(values, inRegion, scale, heightOf, frameRef.current, basePos, extruded, radius);
    frameRef.current = f;
    return f;
  }, [cols, values, inRegion, scale, sr.hi, full, basePos, blockPos, blocks, k, mapColor, manifest.grid.res, view]);

  // the selected area's outline over the columns
  const outlinePaths = useMemo(() => {
    if (!cols || !outline || region.kind === 'all' || view === 'explore') return null;
    const z = (lon: number, lat: number) => (terrain ? Math.max(0, elevationBilinear(terrain, lon, lat)) * TERRAIN_EXAGGERATION : 0) + 60;
    return featurePaths(outline, z, 0.05);
  }, [cols, outline, region.kind, terrain, view]);

  // Latest values for handlers registered once.
  const live = useRef({ tool, cols, circle, hoverCell: -1 });
  live.current = { ...live.current, tool: view === 'explore' ? 'select' : tool, cols, circle };
  const readoutAtRef = useRef<(lon: number, lat: number, cell?: number) => void>(() => {});

  // ------------------------------------------------------------ create the map once
  useEffect(() => {
    if (!container.current) return;
    const st = useUi.getState();
    const still = reducedMotion();
    const mode = st.mapMode;
    const opening = mode === 'globe' && !still && !st.opened;
    const style: StyleSpecification = focosStyle({ base: baseOf(st), lang: st.lang, density: { url: blankPixel(), coordinates: imageCoords(manifest.grid) } });
    style.projection = projectionSpec(mode) as StyleSpecification['projection'];
    style.sky = SKY as unknown as StyleSpecification['sky'];
    if (mode !== '2d') style.terrain = terrainSpec();
    const [w, s, e, n] = manifest.bbox;
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style,
        ...(opening ? { center: OPENING.center, zoom: OPENING.zoom } : { bounds: [[w, s], [e, n]] as [[number, number], [number, number]], fitBoundsOptions: { padding: 24 } }),
        attributionControl: false,
        maxPitch: 75,
        // Bound framebuffer cost on Retina/large displays; DOM text stays native resolution.
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(2_000_000 / Math.max(1, container.current.clientWidth * container.current.clientHeight))),
        maxTileCacheSize: 96,
        cancelPendingTileRequestsWhileZooming: false,
        fadeDuration: still ? 0 : 200,
        canvasContextAttributes: { antialias: false, powerPreference: 'high-performance' },
      });
    } catch (err) {
      // MapLibre 6 needs WebGL 2; the panel keeps working and the boundary around the map explains
      useUi.getState().blockColumns('webgl');
      throw err;
    }
    mapRef.current = map;
    let cameraTimer = 0;
    const updateCameraCenter = () => {
      window.clearTimeout(cameraTimer);
      cameraTimer = 0;
      const center = map.getCenter();
      setCameraCenter([center.lng, center.lat]);
    };
    const scheduleCameraCenter = () => {
      if (useUi.getState().mapMode !== 'globe' || cameraTimer) return;
      cameraTimer = window.setTimeout(updateCameraCenter, 90);
    };
    map.on('move', scheduleCameraCenter);
    map.on('moveend', updateCameraCenter);
    // Picking renders an extra offscreen pass. No hover target is needed during a flight/drag.
    map.on('movestart', () => {
      overlayRef.current?.setProps({ _pickable: false });
      if (hoverWarm.current) clearTimeout(hoverWarm.current);
      warmCell.current = '';
    });
    map.on('moveend', () => overlayRef.current?.setProps({ _pickable: true }));
    // MapLibre ignores a trackpad's sideways swipe. Pan the globe for that gesture.
    let swipeDx = 0;
    let swipeDy = 0;
    let swipeFrame = 0;
    const swipePan = (event: WheelEvent) => {
      if (useUi.getState().view !== 'explore' || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) < 2 || Math.abs(event.deltaX) < Math.abs(event.deltaY) * 0.5) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      swipeDx += event.deltaX;
      swipeDy += event.deltaY;
      if (!swipeFrame) swipeFrame = requestAnimationFrame(() => {
        swipeFrame = 0;
        map.panBy([swipeDx, swipeDy], { duration: 0 });
        swipeDx = 0;
        swipeDy = 0;
      });
    };
    map.getContainer().addEventListener('wheel', swipePan, { capture: true, passive: false });
    installMapGuards(map);
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Hotspots: NASA FIRMS (MODIS, VIIRS) · Boundaries: Natural Earth' }), 'bottom-right');
    // the credits start folded behind their button; the full text is also in the panel footer
    map.once('load', () => map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));

    // ---------------------------------------------------------- when a tile service cannot be reached
    let demErrors = 0;
    let gibsErrors = 0;
    let localDem = false;
    map.on('error', (ev) => {
      const id = (ev as unknown as { sourceId?: string }).sourceId ?? '';
      if ((id === 'dem' || id === 'dem-shade') && !localDem && ++demErrors >= 3) {
        // terrain from the bundled grid instead
        localDem = true;
        registerLocalDem();
        for (const sid of ['dem', 'dem-shade']) (map.getSource(sid) as RasterDEMTileSource | undefined)?.setTiles([LOCAL_DEM_TILES]);
      } else if (id.startsWith('gibs-') && ++gibsErrors >= 4) {
        setImageryFailed(true);
      }
    });

    const onMoveEnd = () => {
      const z = Math.round(map.getZoom() * 4) / 4;
      const lat = Math.round(map.getCenter().lat);
      setCam((v) => (v.zoom === z && v.lat === lat ? v : { zoom: z, lat }));
    };
    map.on('moveend', onMoveEnd);

    map.once('style.load', () => {
      (map.getSource('provinces') as GeoJSONSource | undefined)?.setData((boundaries as GeoJSON.FeatureCollection) ?? EMPTY);
      map.addSource('ember-focus-extent', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'ember-focus-fill', type: 'fill', source: 'ember-focus-extent', paint: { 'fill-color': '#42c7ee', 'fill-opacity': 0.07 } }, FIRST_LABEL);
      map.addLayer({ id: 'ember-focus-glow', type: 'line', source: 'ember-focus-extent', paint: { 'line-color': '#47d5ff', 'line-width': 8, 'line-blur': 8, 'line-opacity': 0.8 } }, FIRST_LABEL);
      map.addLayer({ id: 'ember-focus-line', type: 'line', source: 'ember-focus-extent', paint: { 'line-color': '#a7efff', 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.92 } }, FIRST_LABEL);
      // Labels are depth-tested once terrain is on, and the columns write depth, so a label behind a
      // column would lose letters. Clearing depth between the columns and the labels keeps every
      // label whole; the columns still hide one another and are hidden by ridges.
      map.addLayer(
        {
          id: DEPTH_CLEAR,
          type: 'custom',
          renderingMode: '3d',
          render: (gl: WebGLRenderingContext | WebGL2RenderingContext) => {
            gl.depthMask(true);
            gl.clear(gl.DEPTH_BUFFER_BIT);
          },
        },
        FIRST_LABEL,
      );
      if (webglAvailable()) {
        try {
          const overlay = new MapLibreOverlay({
            interleaved: true,
            useDevicePixels: 1,
            layers: [],
            onError: (err: Error) => {
              console.error('[focos] column layer error:', err);
              useUi.getState().blockColumns('failed');
            },
          } as ConstructorParameters<typeof MapLibreOverlay>[0]);
          map.addControl(overlay);
          overlayRef.current = overlay;
        } catch (err) {
          console.error('[focos] column layer unavailable:', err);
          useUi.getState().blockColumns('failed');
        }
      } else {
        useUi.getState().blockColumns('webgl');
      }
      setReady(true);
    });

    // ---------------------------------------------------------- interactions
    const setReadoutAt = (lon: number, lat: number, cell?: number) => {
      const id = cellIdAt(lon, lat, manifest.grid);
      const i = cell !== undefined && cell >= 0 ? cell : id >= 0 ? findCell(table, id) : -1;
      const cellId = i >= 0 ? table.cellId[i] : id;
      useUi.getState().set({ readout: { lon, lat, cell: i, cellId } });
    };
    let rectStart: maplibregl.LngLat | null = null;
    const guard = newClickGuard();
    const finishRect = (end: maplibregl.LngLat) => {
      const start = rectStart;
      rectStart = null;
      setDraft(null);
      if (!start) return;
      guardConsumed(guard);
      const min = manifest.grid.res;
      if (Math.abs(end.lng - start.lng) < min || Math.abs(end.lat - start.lat) < min) return;
      useUi.getState().set({ region: bboxRegion([start.lng, start.lat, end.lng, end.lat], ''), tool: 'select' });
    };
    const onDown = (ev: MapMouseEvent | MapTouchEvent) => {
      guardDown(guard, ev.point);
      if (live.current.tool !== 'rect') return;
      if ('points' in ev && ev.points.length !== 1) return;
      ev.preventDefault();
      rectStart = ev.lngLat;
    };
    const onMoveDraw = (ev: MapMouseEvent | MapTouchEvent) => {
      if (rectStart) setDraft([rectStart.lng, rectStart.lat, ev.lngLat.lng, ev.lngLat.lat]);
    };
    const onUp = (ev: MapMouseEvent | MapTouchEvent) => {
      if (rectStart) finishRect(ev.lngLat);
    };
    const onWindowUp = (ev: MouseEvent) => {
      if (rectStart && !map.getCanvas().contains(ev.target as Node)) {
        rectStart = null;
        setDraft(null);
      }
    };
    window.addEventListener('mouseup', onWindowUp);
    map.on('mousedown', onDown);
    map.on('touchstart', onDown);
    map.on('mousemove', onMoveDraw);
    map.on('touchmove', onMoveDraw);
    map.on('mouseup', onUp);
    map.on('touchend', onUp);
    map.on('click', (ev) => {
      if(useUi.getState().view==='explore') return;
      if (!acceptClick(guard, ev.point)) return;
      const L = live.current;
      if (L.tool === 'circle') {
        const c = { lon: Math.round(ev.lngLat.lng * 100) / 100, lat: Math.round(ev.lngLat.lat * 100) / 100, radiusKm: L.circle.radiusKm };
        useUi.getState().set({ circle: c, region: circleRegion(c.lon, c.lat, c.radiusKm, '') });
        return;
      }
      if (L.tool !== 'select') return;
      // with columns, the column under the pointer wins over the ground behind it
      let i = L.cols && L.hoverCell >= 0 ? L.hoverCell : -1;
      if (i < 0) {
        const id = cellIdAt(ev.lngLat.lng, ev.lngLat.lat, manifest.grid);
        i = id >= 0 ? findCell(table, id) : -1;
      }
      let prov = i >= 0 ? table.cellProvince[i] : 255;
      if (prov === 255 && map.getLayer('prov-fill')) {
        const f = map.queryRenderedFeatures(ev.point, { layers: ['prov-fill'] })[0];
        if (f) prov = Number(f.properties?.id);
      }
      if (prov !== 255 && Number.isFinite(prov) && manifest.provinces.some((q) => q.id === prov)) {
        useUi.getState().set({ region: provinceRegion(prov, manifest) });
      }
    });
    let raf = 0;
    map.on('mousemove', (ev) => {
      if(useUi.getState().view==='explore')return;
      if (live.current.cols && live.current.hoverCell >= 0) return; // the column under the pointer reports itself
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setReadoutAt(ev.lngLat.lng, ev.lngLat.lat));
    });
    map.getCanvas().addEventListener('mouseleave', () => {
      live.current.hoverCell = -1;
      useUi.getState().set({ readout: null });
    });
    readoutAtRef.current = setReadoutAt;

    return () => {
      window.clearTimeout(cameraTimer);
      map.off('move', scheduleCameraCenter);
      map.off('moveend', updateCameraCenter);
      map.getContainer().removeEventListener('wheel', swipePan, true);
      cancelAnimationFrame(swipeFrame);
      window.removeEventListener('mouseup', onWindowUp);
      cancelAnimationFrame(raf);
      const overlay = overlayRef.current;
      overlayRef.current = null;
      mapRef.current = null;
      // detach deck first, or its next render asks a removed map for its projection
      if (overlay) {
        try {
          map.removeControl(overlay);
        } catch {
          /* already detached */
        }
        try {
          overlay.finalize();
        } catch {
          /* already torn down */
        }
      }
      try {
        map.remove();
      } catch {
        /* already removed */
      }
      setReady(false);
    };
    // The map is created once; later changes are pushed by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------ drawing mode: no panning while drawing
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tool === 'rect' && view !== 'explore') {
      map.dragPan.disable();
      map.boxZoom.disable();
    } else {
      map.dragPan.enable();
      map.boxZoom.enable();
      setDraft(null);
    }
  }, [tool, view]);

  // ------------------------------------------------------------ projection and terrain per view
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setProjection(projectionSpec(mapMode) as Parameters<MlMap['setProjection']>[0]);
    map.setTerrain(mapMode === '2d' ? null : terrainSpec());
  }, [ready, mapMode]);

  // ------------------------------------------------------------ base map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const shown: BaseMap = imageryFailed && base !== 'plain' ? 'plain' : base;
    applyBase((id, on) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }, shown);
    baseLook(map, shown);
  }, [ready, base, imageryFailed]);

  // ------------------------------------------------------------ flat hotspot image (2D, or when columns cannot be drawn)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || cols) return;
    const src = map.getSource('density') as ImageSource | undefined;
    const url = nothing ? blankPixel() : densityImage(values, inRegion, table, manifest.grid, scale);
    src?.updateImage({ url, coordinates: imageCoords(manifest.grid) });
  }, [ready, cols, values, inRegion, scale, table, manifest.grid, nothing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    };
    vis('density', !cols && view !== 'explore');
    vis('prov-line', showBorders);
  }, [ready, cols, showBorders, view]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('region') as GeoJSONSource | undefined)?.setData(fc(outline));
  }, [ready, outline]);

  useEffect(() => {
    const src = mapRef.current?.getSource('draft') as GeoJSONSource | undefined;
    if (!src || !ready) return;
    if (draft) {
      const [a, b, c, e] = draft;
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[a, b], [c, b], [c, e], [a, e], [a, b]]] } });
    } else if (tool === 'circle') {
      src.setData(fc(regionOutline(circleRegion(circle.lon, circle.lat, circle.radiusKm, ''), null)));
    } else src.setData(EMPTY);
  }, [ready, draft, tool, circle]);

  useEffect(() => {
    const src = mapRef.current?.getSource('provinces') as GeoJSONSource | undefined;
    if (src && boundaries && ready) src.setData(boundaries as GeoJSON.FeatureCollection);
  }, [boundaries, ready]);

  // ------------------------------------------------------------ columns
  useEffect(() => {
    const overlay = overlayRef.current;
    const map = mapRef.current;
    if (!overlay || !map || !ready) return;
    const globalLayer = new ColumnLayer({
      id: 'world-live-columns', visible: !hotspot, beforeId: DEPTH_CLEAR, data: visibleWorldCells,
      diskResolution: 4, angle: 45, radius: 22_500, extruded: mapMode !== '2d', flatShading: true,
      pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 90],
      getPosition: (cell: { lon: number; lat: number }) => [cell.lon, cell.lat, 0],
      getElevation: (cell: { count: number }) => mapMode === '2d' ? 0 : Math.min(180_000, 12_000 + Math.sqrt(cell.count) * 20_000),
      getFillColor: (cell: { count: number }) => cell.count >= 80 ? [255, 232, 109, 245] : cell.count >= 20 ? [255, 173, 50, 235] : cell.count >= 5 ? [255, 95, 40, 220] : [203, 56, 55, 205],
      material: { ambient: 0.62, diffuse: 0.55, shininess: 12, specularColor: [40, 40, 40] },
      onClick: (info: { object?: { lon: number; lat: number; count: number; latest?: number } }) => { if (info.object) void enterWorldCell(info.object); return true; },
    } as never);
    overlay.setProps({
      layers: view === 'explore' ? [globalLayer] : cols ? [...(nothing ? [] : columnLayers(frame, DEPTH_CLEAR)), ...outlineLayers(outlinePaths, DEPTH_CLEAR)] : [],
      onHover: (info: PickingInfo) => {
        if(view==='explore'){
          if (map.isMoving()) return;
          const cell=info.object as {lon:number;lat:number}|undefined;
          const key=cell?`${cell.lon}:${cell.lat}`:'';
          map.getCanvas().style.cursor=cell?'pointer':'';
          if(key!==warmCell.current){warmCell.current=key;if(hoverWarm.current)clearTimeout(hoverWarm.current);
            if(cell)hoverWarm.current=setTimeout(()=>{const f=worldFeed.current;const point=f?.points&&observationsInCell(f.points,cell,f.startHour,f.startHour+86400000)[0];if(point)warmup.current?.warm(point.lon,point.lat);},220);
          }
          return;
        }
        // a single-cell column reports itself; block columns let the ground under the pointer answer
        const cell = k === 1 && info.layer?.id === 'columns' && info.index >= 0 ? info.index : -1;
        live.current.hoverCell = cell;
        map.getCanvas().style.cursor = live.current.tool !== 'select' ? 'crosshair' : cell >= 0 ? 'pointer' : '';
        if (cell >= 0) {
          const [lon, lat] = cellCentre(table.cellId[cell], manifest.grid);
          readoutAtRef.current(lon, lat, cell);
        }
      },
    });
  }, [ready, cols, frame, nothing, table, manifest.grid, outlinePaths, k, view, visibleWorldCells, mapMode, hotspot]);

  // ------------------------------------------------------------ place names follow the language
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    labelLanguage(map, lang);
    controlLanguage(map, t);
  }, [ready, lang, t]);

  // ------------------------------------------------------------ camera: frame the area; the first time on the globe, fly in from space
  const lastFramed = useRef('');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const world = view === 'explore';
    const key = `${world ? 'world' : region.key}|${mapMode}|${cameraNonce}`;
    if (key === lastFramed.current) return;
    const fromWorld = lastFramed.current.startsWith('world|');
    lastFramed.current = key;
    const still = reducedMotion();
    const first = !useUi.getState().opened;
    useUi.getState().set({ opened: true });
    if (world) {
      // the worldwide view shows the whole Earth, or the country picked in its calendar
      const b = useUi.getState().worldFocus?.bounds;
      if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 100, right: 90, bottom: 180, left: 90 }, maxZoom: 11, pitch: mapMode === '2d' ? 0 : 25, bearing: 0, duration: still ? 0 : 900 });
      else map.easeTo({ center: OPENING.center, zoom: OPENING.zoom, pitch: PITCH[mapMode], bearing: 0, duration: still ? 0 : 900 });
      return;
    }
    const framed = withContext(bbox, region.kind === 'all');
    const target = mapMode === '2d' ? fitFlat(map, framed) : fitTilted(map, framed, PITCH[mapMode]);
    if (!target) return;
    if ((first || fromWorld) && mapMode === 'globe' && !still) {
      // the approach: a descent from the whole Earth onto the area; any touch or drag ends it
      map.flyTo({ ...target, bearing: 0, duration: first ? 6500 : 3200, curve: 1.15, essential: false });
      return;
    }
    map.easeTo({ ...target, bearing: 0, duration: still ? 0 : 900 });
  }, [ready, region.key, region.kind, mapMode, cameraNonce, bbox, view]);

  // The worldwide calendar's country picker only changes the global camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || view !== 'explore' || !worldFocus) return;
    const bounds = worldFocus.bounds;
    const extent = map.getSource('ember-focus-extent') as GeoJSONSource | undefined;
    if (extent) extent.setData(bounds && bounds[2] - bounds[0] < 180 ? {
      type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[
        [bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]], [bounds[0], bounds[1]],
      ]] } }],
    } : EMPTY);
    map.stop();
    setWorldSelected(null);
    if (hotspot) {
      setHotspot(null);
      setFlightMessage('');
      (map.getSource('hotspot-pixels') as GeoJSONSource | undefined)?.setData(EMPTY);
      if (map.getLayer('hotspot-imagery')) map.setLayoutProperty('hotspot-imagery', 'visibility', 'none');
      map.setProjection(projectionSpec(mapMode) as Parameters<MlMap['setProjection']>[0]);
      map.setTerrain(mapMode === '2d' ? null : terrainSpec());
    }
    const duration = reducedMotion() ? 0 : 1150;
    if (!bounds) {
      map.flyTo({ center: [-25, 20], zoom: 1.25, pitch: PITCH[mapMode], bearing: 0, duration, essential: false });
      return;
    }
    const [west, south, east, north] = bounds;
    map.fitBounds([[west, south], [east, north]], {
      padding: { top: 100, right: 90, bottom: 180, left: 90 },
      maxZoom: 11,
      pitch: mapMode === '2d' ? 0 : 25,
      bearing: 0,
      duration,
      essential: false,
    });
  }, [ready, view, worldFocus, mapMode]);

  return (
    <>
      <div ref={container} className={`map ${tool !== 'select' ? 'drawing' : ''}`} role="region" aria-label={view === 'explore' ? t('mvGlobeLabel') : t('mapLabel')} data-3d={cols} data-mode={mapMode} data-ready={ready} />
      {view === 'explore' && <EmberGlobe
        feed={emberFeed} cells={visibleWorldCells} allCells={worldCells} selected={worldSelected ? { ...worldSelected, latest: worldSelected.latest ?? 0 } : null} source={emberSource}
        stale={emberFeed ? Number.isFinite(Date.parse(emberFeed.fetchedAt)) && Date.now() - Date.parse(emberFeed.fetchedAt) > 36 * 3_600_000 : false}
        mode={mapMode}
        regionName={worldFocus && !(worldFocus.code === 'world' && !worldFocus.bounds) ? worldFocus.name : t('wholeWorld')}
        onFocus={(lon, lat) => {
          const cell = worldCells.find((item) => item.lon === lon && item.lat === lat);
          if (cell) setWorldSelected(cell);
          mapRef.current?.flyTo({ center: [lon, lat], zoom: 5.5, pitch: mapMode === '2d' ? 0 : 35, duration: reducedMotion() ? 0 : 1100 });
        }}
        onSelectArea={(area, monthIndex, showAnomaly) => {
          useUi.getState().set({ howToOpen: false, worldFocus: { code: area.code, name: area.name, bounds: area.bounds } });
          window.dispatchEvent(new CustomEvent('focos:ember-area', { detail: { code: area.code, monthIndex, showAnomaly } }));
        }}
      />}
      {cardHotspot && <section className={`hotspot-flight-card${!hotspot || networkOpen ? ' is-exiting' : ''}`} aria-hidden={!hotspot || networkOpen} inert={!hotspot || networkOpen} aria-label={t('mvCardLabel')}>
        <span>{t('mvCardTag', { satellite: cardHotspot.satellite })}</span><h2>{fmt(cardHotspot.frp ?? NaN, 1)} MW</h2>
        <p>{cardHotspot.date} · {cardHotspot.time.slice(0,2)}:{cardHotspot.time.slice(2)} UTC<br/>{t('mvCoord', { lat: fmt(Math.abs(cardHotspot.lat), 3), ns: t(cardHotspot.lat < 0 ? 'mvSouth' : 'mvNorth'), lon: fmt(Math.abs(cardHotspot.lon), 3), ew: t(cardHotspot.lon < 0 ? 'mvWest' : 'mvEast') })}</p>
        {/* the flight's progress, for screen readers; sighted readers follow the camera */}
        <p className="sr-only" role="status">{flightMessage && t(flightMessage)}</p>
        <button onClick={()=>{warmup.current?.warm(cardHotspot.lon,cardHotspot.lat);flyHotspot([cardHotspot.lon,cardHotspot.lat],14.2,74,2200);}}>{t('mvNearGround')}</button>
        <button onClick={leaveHotspot}>{t('mvReturnGlobe')}</button>
      </section>}
      {!hotspot && flightMessage && <div className="map-note" role="status">{t(flightMessage)}</div>}
      {!ready && (
        <div className="map-loading" role="status">
          <div className="spinner" aria-hidden="true" />
          <span>{t('mapLoading')}</span>
        </div>
      )}
      {imageryFailed && base !== 'plain' && <div className="map-note subtle">{t('mapLoadingTiles')}</div>}
    </>
  );
}

let blank: string | null = null;
function blankPixel(): string {
  if (blank) return blank;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  blank = c.toDataURL('image/png');
  return blank;
}
