import { apiUrl } from '../lib/api.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, RasterTileSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { filterFires, fireFootprints } from '../lib/fireFeed.ts';
import type { FireFeed, FirePoint } from '../lib/fireFeed.ts';
import './terrain.css';
import {readObservation} from '../lib/terrainLink.ts';

import {hotspotDestinations,replayPoints,nearestHotspot} from '../lib/terrainExperience.ts';
import {useTerrainNavigation} from './useTerrainNavigation.ts';
import type {TravelMode} from './useTerrainNavigation.ts';
import {useI18n} from '../i18n.tsx';
import type {TKey} from '../i18n.tsx';

const EMPTY: GeoJSON.FeatureCollection = {type:'FeatureCollection',features:[]};
const DAY=86400000;
const isoDay=(time:number)=>new Date(time).toISOString().slice(0,10);
/** Satellite filter choices. Product names read the same in every language. */
const SATELLITES=[['all','NOAA-20 + NOAA-21'],['N20','NOAA-20'],['N21','NOAA-21']] as const;
/** Region shortcuts in the destination panel: name key, longitude, latitude, zoom. */
const REGIONS=[['tvRegionUS',-99,39,3.6],['tvRegionAlaska',-151,64,5],['tvRegionHawaii',-155.5,19.6,10]] as const;
/** On-screen movement buttons: key held, name key. */
const PAD=[['w','tvPadForward'],['s','tvPadBack'],['a','tvPadLeft'],['d','tvPadRight'],['q','tvPadDown'],['e','tvPadUp']] as const;
/** A message kept in state as a dictionary key and its values, so it is worded at render time in the reader's language. */
type Note={key:TKey;vars?:Record<string,string|number>};
const validDate=(value:string|null)=>!!value&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'));
const gibs=(date:string, falseColor:boolean)=>`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${falseColor?'MODIS_Terra_CorrectedReflectance_Bands721':'VIIRS_NOAA20_CorrectedReflectance_TrueColor'}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
function style(): StyleSpecification { return {version:8,projection:{type:'globe'},sources:{
  satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'},
  elevation:{type:'raster-dem',tiles:['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],tileSize:512,encoding:'terrarium',maxzoom:12,attribution:'Elevation © Mapterhorn contributors'},
  imagery:{type:'raster',tiles:[gibs(isoDay(Date.now()-DAY),false)],tileSize:256,maxzoom:9,attribution:'NASA GIBS'},
  footprints:{type:'geojson',data:EMPTY},dots:{type:'geojson',data:EMPTY},
},layers:[
  {id:'base',type:'raster',source:'satellite'},
  {id:'dated-imagery',type:'raster',source:'imagery',paint:{'raster-opacity':0}},
  {id:'fire-pixels',type:'fill',source:'footprints',minzoom:8,paint:{'fill-color':'#ff5c20','fill-opacity':['case',['==',['get','current'],true],0.48,0.10]}},
  {id:'fire-rim',type:'line',source:'footprints',minzoom:8,paint:{'line-color':'#ffc16c','line-width':1.3,'line-opacity':0.8}},
  {id:'fire-dots',type:'circle',source:'dots',paint:{'circle-radius':['interpolate',['linear'],['zoom'],2,1.8,8,3.5,10,5],'circle-color':'#ff6b28','circle-stroke-color':'#ffdc95','circle-stroke-width':0.5,'circle-pitch-alignment':'viewport'}},
],terrain:{source:'elevation',exaggeration:1},sky:{'sky-color':'#101e2b','horizon-color':'#7b929d','fog-color':'#8ba0aa','fog-ground-blend':0}}; }

export function TerrainViewer() {
  const {t,lang,locale,fmt}=useI18n();
  const say=(note:Note)=>t(note.key,note.vars);
  const [observation,setObservation]=useState(readObservation);
  const initial=useRef(new URLSearchParams(location.search));
  const ref=useRef<HTMLDivElement>(null), map=useRef<maplibregl.Map|null>(null);
  const [ready,setReady]=useState(false),[mapError,setMapError]=useState<Note|null>(null);
  const [feed,setFeed]=useState<FireFeed|null>(null),[busy,setBusy]=useState(false),[feedError,setFeedError]=useState<Note|null>(null),[snapshot,setSnapshot]=useState(false);
  const [now,setNow]=useState(Date.now()),[hours,setHours]=useState(24),[sensor,setSensor]=useState('all'),[minimum,setMinimum]=useState(true),[day,setDay]=useState('');
  const [reference,setReference]=useState(initial.current.get('scene')==='hermits'),[archive,setArchive]=useState<FirePoint[]>([]);
  const [imagery,setImagery]=useState(['hls','satellite','true','false'].includes(initial.current.get('imagery')??'')?initial.current.get('imagery')!:'satellite');
  const [imageDate,setImageDate]=useState(validDate(initial.current.get('imageDate'))?initial.current.get('imageDate')!:initial.current.get('scene')==='hermits'?'2022-05-03':isoDay(Date.now()-DAY));
  const [imageMessage,setImageMessage]=useState<Note|null>(null),[opacity,setOpacity]=useState(1),[exaggeration,setExaggeration]=useState(1.6);
  const [selected,setSelected]=useState<FirePoint|null>(observation?.point??null),[viewCount,setViewCount]=useState(0),[copied,setCopied]=useState(false);
  const [destination,setDestination]=useState<{center:[number,number];zoom:number;arrival?:TravelMode}|null>(null);
  const [travelTarget,setTravelTarget]=useState<FirePoint|null>(observation?.point??null),[arriving,setArriving]=useState(false),[travelMessage,setTravelMessage]=useState<Note|null>(observation?{key:'tvAtObservation'}:null);
  const flat=false; const [speed,setSpeed]=useState(1);
  const [mode,setMode]=useState<TravelMode>(observation?'ground':'orbit'),[panel,setPanel]=useState<'places'|'layers'|null>(null);
  const [playing,setPlaying]=useState(false),[replayDay,setReplayDay]=useState(validDate(initial.current.get('date'))&&initial.current.get('date')!>='2022-04-06'&&initial.current.get('date')!<='2022-05-15'?initial.current.get('date')!:'2022-05-03'),[archiveDays,setArchiveDays]=useState<string[]>([]),[trails,setTrails]=useState(false),[showPixels,setShowPixels]=useState(true);
  const {hold,telemetry}=useTerrainNavigation(map,ready,mode,speed,flat,travelTarget,t('tvCanvasLabel'));
  const [coordinate,setCoordinate]=useState(''),[coordinateError,setCoordinateError]=useState(false);
  const points=useMemo(()=>observation?observation.points:reference?replayPoints(archive,replayDay,trails):filterFires(feed?.points??[],hours,now,sensor,minimum,day),[observation,reference,archive,replayDay,trails,feed,hours,now,sensor,minimum,day]);
  const pointsRef=useRef(points); pointsRef.current=points;
  const controller=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    controller.current?.abort(); const control=new AbortController(); controller.current=control;
    setBusy(true);setFeedError(null);
    // Which message to show if the saved copy also fails; a request that never completes keeps the general one.
    let failure:TKey='tvFeedFailed';
    try {
      let response:Response;let data:FireFeed;
      try {response=await fetch(apiUrl('api/firms/world'),{signal:control.signal});if(!response.ok) throw new Error();data=await response.json();if(!Array.isArray(data.points)||!data.sources)throw new Error();setSnapshot(false);}
      catch {
        if(control.signal.aborted)return;
        response=await fetch(`${import.meta.env.BASE_URL}data-live/world-fires.json`,{signal:control.signal});if(!response.ok||!response.headers.get('content-type')?.includes('application/json')){failure='tvFeedPending';throw new Error();}
        failure='tvFeedInvalid';data=await response.json();if(!Array.isArray(data.points)||!data.sources)throw new Error();setSnapshot(true);
      }
      if(control.signal.aborted)return;setFeed(data);setNow(Date.now());
    } catch {if(!control.signal.aborted)setFeedError({key:failure});}
    finally {if(!control.signal.aborted)setBusy(false);}
  },[]);
  useEffect(()=>{let alive=true;setBusy(true);void (async()=>{try{const r=await fetch(`${import.meta.env.BASE_URL}data-live/world-fires.json`);if(r.ok&&r.headers.get('content-type')?.includes('application/json')){const d=await r.json();if(alive&&Array.isArray(d.points)){setFeed(d);setSnapshot(true);}}}catch{/* Live endpoint is the next attempt. */}if(alive)void refresh();})();const id=setInterval(()=>void refresh(),300000);return()=>{alive=false;clearInterval(id);controller.current?.abort();};},[refresh]);
  useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(id);},[]);
  useEffect(()=>{if(!reference)return;let alive=true;fetch(`${import.meta.env.BASE_URL}data-live/hermits-replay.json`).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(p=>{if(alive){setArchive(p.points);setArchiveDays(p.days);}}).catch(()=>{if(alive)setFeedError({key:'tvReplayFailed'});});return()=>{alive=false;};},[reference]);
  useEffect(()=>{
    if(!ref.current)return;
    const q=initial.current, lon=Number(q.get('lon')),lat=Number(q.get('lat')),zoom=Number(q.get('zoom'));
    const shared=q.has('lon')&&q.has('lat')&&Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=85;
    let m:maplibregl.Map;
    try {m=new maplibregl.Map({container:ref.current,style:{...style(),projection:{type:reference||shared?'mercator':'globe'}},center:shared?[lon,lat]:reference?[-105.40,35.78]:[-40,20],zoom:shared?Math.max(0,Math.min(19,zoom||1.5)):reference?10.5:2,pitch:reference||shared?65:0,bearing:reference?-25:0,maxPitch:88,maxZoom:20,attributionControl:{compact:true},renderWorldCopies:false,locale:{'Map.Title':t('tvCanvasLabel'),'NavigationControl.ZoomIn':t('tvMapZoomIn'),'NavigationControl.ZoomOut':t('tvMapZoomOut'),'NavigationControl.ResetBearing':t('tvMapResetNorth'),'FullscreenControl.Enter':t('tvMapFullscreen'),'FullscreenControl.Exit':t('tvMapFullscreenExit'),'AttributionControl.ToggleAttribution':t('tvMapAttribution')}});}
    catch {setMapError({key:'tvWebglFailed'});return;}
    map.current=m;
    m.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');m.addControl(new maplibregl.FullscreenControl({container:ref.current.parentElement!}),'top-right');m.addControl(new maplibregl.ScaleControl(),'bottom-left');
    m.on('style.load',()=>setReady(true));
    m.on('error',event=>{const e=event as typeof event & {sourceId?:string};if(e.sourceId==='imagery'||e.sourceId==='hls')setImageMessage({key:'tvImageryTilesMissing'});else if(e.sourceId==='elevation')setMapError({key:'tvElevationFailed'});else if(e.sourceId==='satellite')setMapError({key:'tvBasemapFailed'});});
    let countTime=0;const count=()=>{if(performance.now()-countTime<250)return;countTime=performance.now();setViewCount(pointsRef.current.filter(p=>m.getBounds().contains([p.lon,p.lat])).length);};m.on('moveend',count);
    const inspect=(e:maplibregl.MapLayerMouseEvent)=>{const p=e.features?.[0]?.properties;if(p)setSelected({lon:Number(p.lon),lat:Number(p.lat),timestamp:Number(p.timestamp),date:String(p.date),time:String(p.time),satellite:String(p.satellite),confidence:String(p.confidence),frp:p.frp==null?null:Number(p.frp),scan:Number(p.scan),track:Number(p.track)});};
    m.on('click','fire-pixels',inspect);m.on('click','fire-dots',inspect);
    const resize=new ResizeObserver(()=>m.resize());resize.observe(ref.current);
    return()=>{resize.disconnect();m.remove();map.current=null;};
  },[]);
  useEffect(()=>{const m=map.current;if(!m||!ready||!selected)return;const el=document.createElement('div');el.className='selected-hotspot-beacon';el.setAttribute('aria-label',t('tvSelectedMarker',{date:selected.date}));const marker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([selected.lon,selected.lat]).addTo(m);return()=>{marker.remove();};},[selected,ready,t]);
  useEffect(()=>{if(!ready||!map.current)return;const m=map.current;
    (m.getSource('dots') as GeoJSONSource).setData({type:'FeatureCollection',features:points.map(p=>({type:'Feature',properties:{...p},geometry:{type:'Point',coordinates:[p.lon,p.lat]}}))});
    // Detailed geographic footprints are only built for the local view, not the entire planet.
    const update=()=>{const local=points.filter(p=>m.getBounds().contains([p.lon,p.lat]));const footprints=fireFootprints(m.getZoom()>=8?local:[]);(m.getSource('footprints') as GeoJSONSource).setData({...footprints,features:footprints.features.map(f=>({...f,properties:{...f.properties,current:!reference||f.properties?.date===replayDay}}))});setViewCount(local.length);};
    update();m.on('moveend',update);return()=>{m.off('moveend',update);};
  },[points,ready,reference,replayDay]);
  useEffect(()=>{if(!ready||!map.current)return;map.current.setTerrain(flat||map.current.getZoom()<6?null:{source:'elevation',exaggeration});},[ready,exaggeration,flat]);
  useEffect(()=>{
    if(!ready||!map.current)return;const m=map.current,abort=new AbortController();setImageMessage(null);
    m.setPaintProperty('dated-imagery','raster-opacity',0);
    if(m.getLayer('hls-image'))m.removeLayer('hls-image');if(m.getSource('hls'))m.removeSource('hls');
    if(imagery==='satellite')return;
    if(imagery!=='hls'){(m.getSource('imagery') as RasterTileSource).setTiles([gibs(imageDate,imagery==='false')]);m.setPaintProperty('dated-imagery','raster-opacity',['interpolate',['linear'],['zoom'],8,opacity,11,0]);return;}
    setImageMessage({key:'tvHlsLoading'});
    const params=new URLSearchParams({collection_concept_id:'C2021957295-LPCLOUD',temporal:`${imageDate}T00:00:00Z/${imageDate}T23:59:59Z`,assets_regex:'B[0-9][0-9A-Za-z]',minzoom:'7',maxzoom:'13',color_formula:'Gamma RGB 2.5 Saturation 1.2 Sigmoidal RGB 10 0.35'});
    ['B12','B8A','B04'].forEach(b=>params.append('assets',b));
    fetch(`https://openveda.cloud/api/titiler-cmr/rasterio/WebMercatorQuad/tilejson.json?${params}`,{signal:abort.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{
      if(abort.signal.aborted||!map.current)return;if(!data.tiles?.length)throw new Error();
      m.addSource('hls',{type:'raster',tiles:data.tiles,tileSize:512,minzoom:7,maxzoom:13,attribution:'NASA HLS / IMPACT / VEDA'});
      m.addLayer({id:'hls-image',type:'raster',source:'hls',paint:{'raster-opacity':['interpolate',['linear'],['zoom'],11,opacity,14,0]}},'fire-pixels');setImageMessage({key:'tvHlsReady'});
    }).catch(()=>{if(!abort.signal.aborted)setImageMessage({key:'tvHlsFailed'});});
    return()=>abort.abort();
  },[imagery,imageDate,ready,opacity]);
  useEffect(()=>{if(!ready||!map.current)return;const m=map.current;const center=m.getCenter();const zoom=m.getZoom();m.setProjection({type:flat||zoom>=6?'mercator':'globe'});m.setTerrain(flat||zoom<6?null:{source:'elevation',exaggeration});m.jumpTo({center,zoom});m.easeTo({pitch:flat?0:m.getZoom()<5?0:65,duration:800});},[flat,ready,exaggeration]);
  useEffect(()=>{if(!ready||!map.current)return;const m=map.current;const update=()=>{const enabled=!flat&&m.getZoom()>=6;if(enabled!==!!m.getTerrain())m.setTerrain(enabled?{source:'elevation',exaggeration}:null);};m.on('zoomend',update);update();return()=>{m.off('zoomend',update);};},[ready,flat,exaggeration]);
  const fly=(center:[number,number],zoom:number)=>{setArriving(false);setTravelMessage(null);setMode('orbit');setDestination({center,zoom});};
  const enterHotspot=(arrival:TravelMode,explicit?:FirePoint)=>{
    const m=map.current;if(!m||!ready)return;
    const c=m.getCenter();
    const currentSelected=selected&&points.find(p=>p.lon===selected.lon&&p.lat===selected.lat&&p.timestamp===selected.timestamp);
    const target=explicit??currentSelected??nearestHotspot(points,c.lng,c.lat);
    if(!target){setTravelMessage({key:'tvNoDetectionsWindow'});return;}
    setMode('orbit');setSelected(target);setTravelTarget(target);setPanel(null);setArriving(true);setTravelMessage({key:'tvTravelling'});
    setDestination({center:[target.lon,target.lat],zoom:arrival==='ground'?14:13,arrival});
  };
  useEffect(()=>{if(!destination||!ready||!map.current)return;const m=map.current;
    m.setCenterClampedToGround(true);
    if(destination.zoom>=6)m.setProjection({type:'mercator'});else if(!flat)m.setProjection({type:'globe'});
    const finish=()=>{if(destination.arrival){const c=m.getCenter();if(Math.abs(c.lng-destination.center[0])>.01||Math.abs(c.lat-destination.center[1])>.01){setArriving(false);setTravelMessage({key:'tvTravelInterrupted'});return;}setMode(destination.arrival);setArriving(false);setTravelMessage({key:'tvAtHotspot'});}};
    // Register after starting the flight, so a cancelled earlier animation cannot trigger arrival.
    m.flyTo({center:destination.center,zoom:destination.zoom,pitch:flat||destination.zoom<5?0:60,bearing:destination.zoom<5?0:-20,duration:2200});
    m.once('moveend',finish);return()=>{m.off('moveend',finish);};
  },[destination,ready,flat]);
  const timelineDays=observation?[observation.point.date]:reference?archiveDays:[...new Set((feed?.points??[]).map(p=>p.date))].sort();
  const activeDay=observation?observation.point.date:reference?replayDay:day||timelineDays[timelineDays.length-1];
  const setDate=(d:string)=>{if(reference)setReplayDay(d);else{setHours(24);setDay(d);}};
  useEffect(()=>{if(!playing||!timelineDays.length)return;const id=setTimeout(()=>{const i=timelineDays.indexOf(activeDay);if(i>=timelineDays.length-1){setPlaying(false);return;}setDate(timelineDays[i+1]);},1600);return()=>clearTimeout(id);},[playing,activeDay,reference,timelineDays.join(',')]);
  useEffect(()=>{if(!ready||!map.current)return;for(const layer of ['fire-pixels','fire-rim','fire-dots'])map.current.setLayoutProperty(layer,'visibility',showPixels?'visible':'none');},[showPixels,ready]);
  const selectScene=(historical:boolean)=>{setObservation(null);setReference(historical);setTravelTarget(null);setPlaying(false);setSelected(null);setPanel(null);setDay('');setReplayDay('2022-05-03');setImagery('satellite');setImageDate(historical?'2022-05-03':isoDay(now-DAY));fly(historical?[-105.40,35.78]:[-40,20],historical?10.5:2);};

  const latest=feed?.points.reduce((v,p)=>Math.max(v,p.timestamp),0)??0;
  const stale=feed && (now-Date.parse(feed.fetchedAt)>30*60000 || (latest>0&&now-latest>48*3600000));
  const strongest=useMemo(()=>hotspotDestinations(points),[points]);
  const currentCount=observation?observation.points.length:reference?archive.filter(p=>p.date===replayDay).length:points.length;
  const share=async()=>{const m=map.current;if(!m)return;const u=new URL(location.href),c=m.getCenter();u.hash=`view=terrain&lang=${lang}`;u.search='';u.searchParams.set('terrain','1');if(observation)u.searchParams.set('observation',initial.current.get('observation')??'');u.searchParams.set('lon',c.lng.toFixed(5));u.searchParams.set('lat',c.lat.toFixed(5));u.searchParams.set('zoom',m.getZoom().toFixed(2));if(reference){u.searchParams.set('scene','hermits');u.searchParams.set('date',replayDay);}u.searchParams.set('imagery',imagery);u.searchParams.set('imageDate',imageDate);try{await navigator.clipboard.writeText(u.href);setCopied(true);setTimeout(()=>setCopied(false),2500);}catch{setFeedError({key:'tvShareFallback',vars:{url:u.href}});}};
  return <section className="terrain-view immersive">
    <div ref={ref} className="terrain-map" aria-label={t('tvMapLabel')}/>
    <div className="scene-vignette"/>
    <header className="scene-header">
      <div className="scene-title"><span className="terrain-eyebrow">{t('tvEyebrow')}</span><h1>{observation?t('tvTitleObservation'):reference?t('tvTitleHermits'):t('tvTitleEarth')}</h1><p>{observation?t(observation.historical?'tvSubHistorical':'tvSubRecent',{date:observation.point.date,time:observation.point.time}):reference?t('tvSubHermits'):t('tvSubLive')}</p></div>
      <div className="scene-tools">{observation&&<button onClick={()=>{setObservation(null);setSelected(null);setTravelTarget(null);setTravelMessage({key:'tvShowingLatest'});setDay('');setReference(false);const u=new URL(location.href);u.searchParams.delete('observation');history.replaceState(null,'',u);void refresh();}}>{t('tvLatestHere')} ↗</button>}<button onClick={()=>selectScene(false)}>{t('tvEarth')} ↗</button><button aria-pressed={panel==='places'} onClick={()=>setPanel(panel==='places'?null:'places')}>⌖ {t('tvTeleport')}</button><button aria-pressed={panel==='layers'} onClick={()=>setPanel(panel==='layers'?null:'layers')}>{t('tvLayers')}</button><button onClick={()=>void share()}>{copied?t('tvCopied'):t('tvShareView')}</button><a className="scene-exit" href={observation?.returnUrl??`${location.pathname}#lang=${lang}`}>{t('tvBackToGlobe')} ↗</a></div>
    </header>
    <div className="scene-mode" aria-label={t('tvCameraMode')}>{(['orbit','flight','ground'] as TravelMode[]).map(v=><button key={v} disabled={!ready||arriving} aria-pressed={mode===v} onClick={()=>{if(v==='orbit'){fly([map.current?.getCenter().lng??-105.4,map.current?.getCenter().lat??35.78],Math.min(11,map.current?.getZoom()??11));}else enterHotspot(v);}}>{v==='orbit'?t('tvOverview'):v==='flight'?t('tvFlyToHotspot'):t('tvNearHotspot')}</button>)}</div>
    <div className="hotspot-route" role="status">{travelMessage?say(travelMessage):t('tvChooseDot')}{travelTarget&&<span>{fmt(travelTarget.lat,3)}°, {fmt(travelTarget.lon,3)}° · {travelTarget.date}</span>}<small>{t('tvReliefShort',{x:fmt(exaggeration,1)})}</small></div>
    {panel&&<aside className="scene-panel">
      <button className="terrain-close" aria-label={t('tvClosePanel')} onClick={()=>setPanel(null)}>×</button>
      {panel==='places'?<><span className="terrain-eyebrow">{t('tvPlacesEyebrow')}</span><h2>{t('tvPlacesTitle')}</h2>
        <div className="terrain-segment"><button aria-pressed={reference} onClick={()=>selectScene(true)}>{t('tvSceneHermits')}</button><button aria-pressed={!reference} onClick={()=>selectScene(false)}>{t('tvSceneLive')}</button></div>
        <div className="region-links">{REGIONS.map(([name,lon,lat,z])=><button key={name} onClick={()=>{if(reference)selectScene(false);fly([lon,lat],z);setPanel(null);}}>{t(name)}</button>)}</div>
        <form onSubmit={e=>{e.preventDefault();const parts=coordinate.split(',').map(v=>v.trim());const lat=Number(parts[0]),lon=Number(parts[1]);if(parts.length!==2||parts.some(v=>!v)||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>80||Math.abs(lon)>180){setCoordinateError(true);return;}setCoordinateError(false);fly([lon,lat],13);setPanel(null);}}><label>{t('tvCoordinates')}<input value={coordinate} onChange={e=>setCoordinate(e.target.value)} placeholder="35.78, -105.40"/></label><button>{t('tvTeleportGo')} →</button></form>{coordinateError&&<p role="alert">{t('tvCoordError')}</p>}
        <h3>{t('tvObservedHotspots')}</h3><p className="panel-note">{t('tvHotspotsNote')}</p>
        <div className="destination-list">{strongest.map((p,i)=><button key={`${p.lon}-${p.lat}-${p.timestamp}`} onClick={()=>{enterHotspot('flight',p);}}><span className="destination-number">{String(i+1).padStart(2,'0')}</span><span>{fmt(p.lat,2)}°, {fmt(p.lon,2)}°<small>{p.date} · {p.satellite}</small></span><b>{p.frp==null?'–':fmt(p.frp,0)}<small>MW</small></b><span>↗</span></button>)}</div>{!strongest.length&&<p>{t('tvNoObservationsDay')}</p>}
      </>:<><span className="terrain-eyebrow">{t('tvLayersEyebrow')}</span><h2>{t('tvLayersTitle')}</h2>
        <label>{t('tvGroundImagery')}<select value={imagery} onChange={e=>setImagery(e.target.value)}><option value="hls">{t('tvImageryHls')}</option><option value="satellite">{t('tvImagerySatellite')}</option><option value="true">{t('tvImageryTrue')}</option><option value="false">{t('tvImageryFalse')}</option></select></label>
        {imagery!=='satellite'&&<><label>{t('tvImageDate')}<input type="date" min="2022-03-15" max={isoDay(now)} value={imageDate} onChange={e=>{if(e.target.value)setImageDate(e.target.value);}}/></label><button onClick={()=>setImageDate(activeDay)}>{t('tvUseReplayDate')}</button><p className="panel-note">{t('tvImageryNote')}</p><label>{t('tvImageryBlend')}<input type="range" min="0" max="1" step=".05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label></>}
        <label className="terrain-check"><input type="checkbox" checked={showPixels} onChange={e=>setShowPixels(e.target.checked)}/>{t('tvShowFootprints')}</label>
        {reference&&<label className="terrain-check"><input type="checkbox" checked={trails} onChange={e=>setTrails(e.target.checked)}/>{t('tvTrails')}</label>}
        <label>{t('tvReliefLabel',{x:fmt(exaggeration,1)})}<input type="range" min="1" max="3" step=".2" value={exaggeration} onChange={e=>setExaggeration(Number(e.target.value))}/></label>
        {!reference&&<><label>{t('tvDetectionWindow')}<select value={hours} onChange={e=>{setHours(Number(e.target.value));setDay('');setPlaying(false);}}><option value={24}>{t('tvPastHours',{n:fmt(24)})}</option></select></label><label>{t('tvSatellite')}<select value={sensor} onChange={e=>setSensor(e.target.value)}>{SATELLITES.map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label><label className="terrain-check"><input type="checkbox" checked={minimum} onChange={e=>setMinimum(e.target.checked)}/>{t('tvConfidence')}</label><button disabled={busy} onClick={()=>void refresh()}>{busy?t('tvCheckingNasa'):t('tvRefreshNasa')}</button></>}
        <details><summary>{t('tvDataSummary')}</summary>{feed&&<p>{t('tvFetched',{fetched:feed.fetchedAt,latest:latest?new Date(latest).toISOString():t('tvUnavailable')})}</p>}<p>{t('tvCaveatTerrain')}</p><p>{t('tvCaveatImagery')}</p>{imageMessage&&<p>{say(imageMessage)}</p>}<a href="https://firms.modaps.eosdis.nasa.gov/map/" target="_blank" rel="noreferrer">NASA FIRMS {'↗'}</a>{feed?.sources.map(s=><p key={s.url}><a href={s.url}>{s.satellite} · {s.region}</a>: {s.error?t('tvUnavailable'):fmt(s.count)}</p>)}</details>
      </>}
    </aside>}
    <div className="scene-compass"><span>{fmt((telemetry.bearing+360)%360,0)}°</span><i style={{transform:`rotate(${-telemetry.bearing}deg)`}}>N ↑</i><small>{fmt(telemetry.lat,3)}° / {fmt(telemetry.lon,3)}°</small></div>
    {mode==='ground'&&<div className="scene-crosshair" aria-hidden="true">+</div>}
    <div className="scene-movement"><span>{mode==='ground'?t('tvMoveGround'):t('tvMoveExplore')}</span><p>{t('tvHintClick')} · <kbd>W A S D</kbd> {t('tvHintMove')} · <kbd>↑ ↓ ← →</kbd> {t('tvHintLook')} · <kbd>Q / E</kbd> {t('tvHintHeight')} · <kbd>Shift</kbd> {t('tvHintFaster')}</p><label className="travel-speed">{t('tvTravelSpeed')}<select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>{`${t('tvSpeedFast')} · 1×`}</option><option value={3}>{`${t('tvSpeedExpress')} · 3×`}</option><option value={10}>{`${t('tvSpeedPlanet')} · 10×`}</option></select></label><div className="movement-pad">{PAD.map(([key,label])=><button key={key} aria-label={t(label)} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);hold(key,true);}} onPointerUp={()=>hold(key,false)} onPointerCancel={()=>hold(key,false)} onLostPointerCapture={()=>hold(key,false)}>{t(label)}</button>)}</div></div>
    {selected&&<div className="terrain-inspect"><button className="terrain-close" aria-label={t('tvCloseDetails')} onClick={()=>setSelected(null)}>×</button><span className="terrain-eyebrow">{t('tvInspectEyebrow')}</span><h2>{selected.frp==null?'–':fmt(selected.frp,1)} <small>MW</small></h2><p>{selected.satellite} · {selected.date} · {selected.time.slice(0,2)}:{selected.time.slice(2)} UTC</p><p>{fmt(selected.lat,4)}°, {fmt(selected.lon,4)}°</p><div className="hotspot-actions"><button onClick={()=>enterHotspot('flight',selected)}>{t('tvFlyAbove')} ↗</button><button onClick={()=>enterHotspot('ground',selected)}>{t('tvNearHotspot')} ↘</button></div><a target="_blank" rel="noreferrer" href={`https://firms.modaps.eosdis.nasa.gov/map/#d:${selected.date};@${selected.lon},${selected.lat},12z`}>{t('tvNasaRecord')} ↗</a></div>}
    <div className="scene-replay">
      <div className="replay-heading"><button className="play-button" aria-label={playing?t('tvPauseReplay'):t('tvPlayReplay')} aria-pressed={playing} disabled={timelineDays.length<2} onClick={()=>{if(!playing&&activeDay===timelineDays[timelineDays.length-1])setDate(timelineDays[0]);setPlaying(!playing);}}>{playing?'Ⅱ':'▶'}</button><div><span className="terrain-eyebrow">{observation?t('tvReplayEyebrowObservation'):reference?t('tvReplayEyebrowHermits'):t('tvReplayEyebrowLive')}</span><strong>{!observation&&!reference&&!day?t('tvPastHours',{n:fmt(hours)}):new Date(activeDay+'T12:00:00Z').toLocaleDateString(locale,{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'})}</strong></div><div className="replay-metric"><b>{!observation&&!reference&&!feed?'–':fmt(currentCount)}</b><span>{t('tvDetectionsInView',{n:fmt(viewCount)})}</span></div></div>
      <div className="replay-track"><div className="replay-bars" aria-hidden="true">{timelineDays.map(d=>{const n=(reference?archive:feed?.points??[]).filter(p=>p.date===d).length;return <i key={d} className={d===activeDay?'active':''} style={{height:`${Math.min(100,6+Math.sqrt(n)*5)}%`}}/>;})}</div><input aria-label={t('tvReplayDate')} type="range" min="0" max={Math.max(0,timelineDays.length-1)} value={Math.max(0,timelineDays.indexOf(activeDay))} onChange={e=>{setPlaying(false);setDate(timelineDays[Number(e.target.value)]);}}/></div>
      <div className="replay-caption"><span>{timelineDays[0]} → {timelineDays[timelineDays.length-1]} · {'UTC'}</span><span>{!observation&&!reference&&!feed?(busy?t('tvDownloading'):t('tvObsUnavailable')):currentCount===0?t('tvNoDetectionsDay'):t('tvSnapshots')}</span><span>{imagery==='satellite'?t('tvContextUndated'):t('tvOverlayDate',{date:imageDate})}</span></div>
    </div>
    {(feedError||mapError||(!observation&&!reference&&(stale||snapshot||feed?.sources.some(s=>s.error))))&&<div className="scene-alert" role="status">{feedError?say(feedError):mapError?say(mapError):t('tvStale')}</div>}
  </section>;
}
