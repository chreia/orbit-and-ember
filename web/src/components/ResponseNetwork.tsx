import { useEffect, useState } from 'react';
import type { MonthSource } from '../bundle/types.ts';
import type { AnomalyClass } from '../lib/analytics.ts';
import { useI18n } from '../i18n.tsx';
import type { TKey } from '../i18n.tsx';
import './response-network.css';

type NodeId = 'firms' | 'focos' | 'weather' | 'dispatch' | 'national' | 'departments' | 'science';
type Kind = 'evidence' | 'context' | 'response' | 'research';
/** Text fields hold dictionary keys, so every node reads in the current language. */
interface NetworkNode { id: NodeId; label: TKey; short: TKey; kind: Kind; x: number; y: number; role: TKey; detail: TKey; url: string; link: TKey }

const NODES: NetworkNode[] = [
  { id: 'firms', label: 'rnFirmsLabel', short: 'rnFirmsShort', kind: 'evidence', x: 156, y: 108, role: 'rnFirmsRole', detail: 'rnFirmsDetail', url: 'https://firms.modaps.eosdis.nasa.gov/active_fire/', link: 'rnFirmsLink' },
  { id: 'weather', label: 'rnWeatherLabel', short: 'rnWeatherShort', kind: 'context', x: 475, y: 72, role: 'rnWeatherRole', detail: 'rnWeatherDetail', url: 'https://www.weather.gov/documentation/services-web-alerts', link: 'rnWeatherLink' },
  { id: 'dispatch', label: 'rnDispatchLabel', short: 'rnDispatchShort', kind: 'response', x: 803, y: 126, role: 'rnDispatchRole', detail: 'rnDispatchDetail', url: 'https://www.nifc.gov/nicc/geographic-areas', link: 'rnDispatchLink' },
  { id: 'national', label: 'rnNationalLabel', short: 'rnNationalShort', kind: 'response', x: 807, y: 348, role: 'rnNationalRole', detail: 'rnNationalDetail', url: 'https://www.nifc.gov/resources/mobilization', link: 'rnNationalLink' },
  { id: 'departments', label: 'rnDepartmentsLabel', short: 'rnDepartmentsShort', kind: 'response', x: 651, y: 485, role: 'rnDepartmentsRole', detail: 'rnDepartmentsDetail', url: 'https://www.usfa.fema.gov/neris/public/', link: 'rnDepartmentsLink' },
  { id: 'science', label: 'rnScienceLabel', short: 'rnScienceShort', kind: 'research', x: 295, y: 477, role: 'rnScienceRole', detail: 'rnScienceDetail', url: 'https://www.usgs.gov/special-topics/wildland-fire-science/connect', link: 'rnScienceLink' },
  { id: 'focos', label: 'rnFocosLabel', short: 'rnFocosShort', kind: 'evidence', x: 140, y: 327, role: 'rnFocosRole', detail: 'rnFocosDetail', url: 'https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/', link: 'rnFocosLink' },
];
const BY_ID = Object.fromEntries(NODES.map(n => [n.id, n])) as Record<NodeId, NetworkNode>;
const EDGES: [NodeId, NodeId][] = [['firms', 'focos'], ['focos', 'science'], ['weather', 'dispatch'], ['dispatch', 'national'], ['national', 'departments'], ['science', 'firms']];
/** Date and time with every field named: the bare default drops a.m./p.m. in es-AR */
const STAMP: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' };
const KIND: Record<Kind, TKey> = { evidence: 'rnKindEvidence', context: 'rnKindContext', response: 'rnKindResponse', research: 'rnKindResearch' };

export interface ResponseNetworkProps {
  area: string;
  month: string;
  count: number;
  median: number;
  anomaly: AnomalyClass | null;
  observed: boolean;
  partial: boolean;
  source: MonthSource | 'raw';
  peakMonth: string | null;
  point?: [number, number];
  mode?: 'history' | 'recent';
  feedNote?: string;
}

/** event is empty when NWS sends none; the interface then names it in the reading language */
interface WeatherAlert { id: string; event: string; headline: string }
export function ResponseNetwork({ area, month, count, median, anomaly, observed, partial, source, peakMonth, point, mode = 'history', feedNote }: ResponseNetworkProps) {
  const { t, locale, fmt } = useI18n();
  const [active, setActive] = useState<NodeId>('focos');
  const [refresh, setRefresh] = useState(0);
  const [weather, setWeather] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; alerts: WeatherAlert[]; checked?: string }>({ status: 'idle', alerts: [] });
  const lon = point?.[0], lat = point?.[1];
  useEffect(() => {
    if (lon === undefined || lat === undefined) { setWeather({ status: 'idle', alerts: [] }); return; }
    const controller = new AbortController();
    setWeather({ status: 'loading', alerts: [] });
    fetch(`https://api.weather.gov/alerts/active?point=${encodeURIComponent(lat.toFixed(4))}%2C${encodeURIComponent(lon.toFixed(4))}`, { headers: { Accept: 'application/geo+json' }, signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`NWS ${r.status}`); return r.json(); })
      .then(data => { if (!controller.signal.aborted) setWeather({ status: 'ready', checked: new Date().toISOString(), alerts: (data.features ?? []).filter((f: { properties?: { event?: string } }) => /fire|red flag/i.test(f.properties?.event ?? '')).map((f: { id?: string; properties?: { event?: string; headline?: string } }) => ({ id: f.id ?? f.properties?.headline ?? 'alert', event: f.properties?.event ?? '', headline: f.properties?.headline ?? '' })) }); })
      .catch(() => { if (!controller.signal.aborted) setWeather({ status: 'error', alerts: [] }); });
    return () => controller.abort();
  }, [lon, lat, refresh]);
  const node = BY_ID[active];
  const modelled = source === 'model' || source === 'model_terra';
  const estimated = modelled || source === 'viirs_fill';
  const pattern: TKey = mode === 'recent' ? 'rnPatternRecent' : !observed ? 'rnPatternNone' : partial ? 'rnPatternPartial' : anomaly === 'far_above' ? 'rnPatternFarAbove' : anomaly === 'above' ? 'rnPatternAbove' : anomaly === 'below' ? 'rnPatternBelow' : anomaly === 'normal' ? 'rnPatternNormal' : 'rnPatternNoBase';
  const facts = [t(pattern), feedNote, Number.isFinite(median) ? t('rnFactsUsual', { n: fmt(Math.round(median)) }) : ''].filter(Boolean).join(' · ');
  // the area name is set in bold inside one translated sentence
  const [introBefore, introAfter = ''] = t('rnIntro').split('{area}');
  const [coreTop, coreMain = ''] = t('rnCore').split('\n');
  return <section className="response-network" aria-labelledby="network-title">
    <header className="network-heading"><div><span className="network-kicker">{t('rnKicker')}</span><h2 id="network-title">{t('rnTitle')}</h2><p>{introBefore}<strong>{area}</strong>{introAfter}</p></div><span className="network-index">07 <span>{t('rnPathways')}</span></span></header>
    <div className="network-layout">
      <div className="network-visual"><svg viewBox="0 0 960 590" aria-label={t('rnGraphLabel')}>
        <defs><radialGradient id="networkHalo"><stop stopColor="#fa793e" stopOpacity=".23"/><stop offset="1" stopColor="#fa793e" stopOpacity="0"/></radialGradient></defs>
        <circle cx="480" cy="276" r="210" fill="url(#networkHalo)"/>
        {[140, 235].map(r => <circle key={r} className="network-orbit" cx="480" cy="276" r={r}/>)}
        {NODES.map(n => <line key={`hub-${n.id}`} className={`network-link ${active === n.id ? 'is-active' : ''}`} x1="480" y1="276" x2={n.x} y2={n.y}/>)}
        {EDGES.map(([a,b]) => <line key={`${a}-${b}`} className="network-crosslink" x1={BY_ID[a].x} y1={BY_ID[a].y} x2={BY_ID[b].x} y2={BY_ID[b].y}/>)}
        <g className="network-core"><circle cx="480" cy="276" r="69"/><circle className="network-core-ring" cx="480" cy="276" r="80"/><text x="480" y="269" textAnchor="middle" className="network-core-label">{coreTop}</text><text x="480" y="293" textAnchor="middle" className="network-core-title">{coreMain}</text></g>
        {NODES.map(n => <g key={n.id} className={`network-node network-${n.kind} ${active === n.id ? 'is-active' : ''}`} transform={`translate(${n.x} ${n.y})`} role="button" tabIndex={0} aria-label={`${t(n.label)}: ${t(n.role)}`} aria-pressed={active === n.id} onClick={() => setActive(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(n.id); } }}><circle className="network-node-halo" r="42"/><circle className="network-node-disc" r="30"/><circle className="network-node-dot" r="5"/><text y="58" textAnchor="middle" className="network-node-label">{t(n.label)}</text><text y="75" textAnchor="middle" className="network-node-sub">{t(n.short)}</text></g>)}
      </svg><div className="network-node-list" aria-label={t('rnNodeList')}>{NODES.map(n => <button type="button" key={n.id} aria-pressed={active === n.id} onClick={() => setActive(n.id)}>{t(n.label)}</button>)}</div><p className="network-caption">{t('rnCaption')}</p></div>
      <div className="network-detail"><div className="network-detail-top"><span className={`network-type network-${node.kind}`}>{t(KIND[node.kind])}</span><span className="network-number">{String(NODES.findIndex(n => n.id === active) + 1).padStart(2, '0')} / 07</span></div><h3>{t(node.label)}</h3><strong>{t(node.role)}</strong><p>{active === 'focos' && mode === 'recent' ? t('rnFocosRecent') : t(node.detail)}</p><a href={node.url} target="_blank" rel="noopener noreferrer">{t(node.link)} ↗</a>{active === 'weather' && <div className="network-weather" role="status"><strong>{t('rnWxTitle')}</strong>{!point ? <p>{t('rnWxNoPoint')}</p> : weather.status === 'loading' ? <p>{t('rnWxLoading')}</p> : weather.status === 'error' ? <p>{t('rnWxError')}</p> : weather.alerts.length ? <ul>{weather.alerts.map(a => <li key={a.id}><b>{a.event || t('rnWxAlert')}</b>{a.headline && <span>{a.headline}</span>}</li>)}</ul> : <p>{t('rnWxNone')}</p>}{point && <button type="button" onClick={() => setRefresh(n => n + 1)}>{t('rnWxRefresh')}</button>}{weather.checked && <small>{t('rnWxChecked', { when: new Date(weather.checked).toLocaleString(locale, STAMP) })}</small>}</div>}<div className="network-facts"><span>{t('rnFactsTitle', { month })}</span><strong>{observed ? fmt(Math.round(count)) : '–'} <small>{estimated ? t('rnFactsEstimated') : t('rnFactsDetections')}</small></strong><p>{facts}</p>{peakMonth && <p>{t('rnFactsPeak', { peak: peakMonth })}</p>}{modelled && <p className="network-model-note">{t('rnModelNote')}</p>}</div></div>
    </div>
    <footer className="network-footer"><span><i className="network-key evidence"/>{t('rnLegendEvidence')}</span><span><i className="network-key context"/>{t('rnLegendContext')}</span><span><i className="network-key response"/>{t('rnLegendResponse')}</span><span><i className="network-key research"/>{t('rnLegendResearch')}</span><p>{t('rnFooter')}</p></footer>
  </section>;
}
