import { apiUrl } from '../lib/api.ts';
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { makeI18n, useI18n, type I18n, type TKey } from '../i18n.tsx';
import { earthReport, resolveEarthArea, wantsActivity, wantsAnomaly, wantsEarthSelection, type EarthArea, type EarthAtlas, type EarthReport } from './emberEarth.ts';
import './ember-globe.css';

interface Cell { lon: number; lat: number; count: number; latest: number; hours?: number[] }
interface Feed {
  fetchedAt: string;
  startHour?: number;
  hourlyDetections?: number[];
  cells: Cell[];
}
type Message = { role: 'user' | 'assistant'; text: string; model?: boolean; greeting?: boolean };
type Mode = 'globe' | '3d' | '2d';
type StatusKey = 'emStatusSnapshot' | 'emStatusLive' | 'emStatusNone';
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void };
type RecognitionCtor = new () => Recognition;
const recognition = () => (window as Window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition
  ?? (window as Window & { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;
const chatUrl = import.meta.env.VITE_EMBER_GLOBE_API_BASE ? `${import.meta.env.VITE_EMBER_GLOBE_API_BASE.replace(/\/$/, '')}/api/ember/chat` : import.meta.env.DEV ? 'http://127.0.0.1:8021/api/ember/chat' : apiUrl('api/ember/chat');
/** The chat model always receives the map evidence in English, whatever language the reader uses. */
const EN = makeI18n('en');
const coord = (cell: Pick<Cell, 'lon' | 'lat'>) => `${cell.lat.toFixed(2)}°, ${cell.lon.toFixed(2)}°`;
const visiblePosition = (x: number, y: number) => ({
  x: Math.max(0, Math.min(x, window.innerWidth - (window.innerWidth <= 760 ? 66 : 80))),
  y: Math.max(0, Math.min(y, window.innerHeight - (window.innerWidth <= 760 ? 92 : 110))),
});
/** Suggestion buttons: a localized label, and the English command the intent parser reads. */
const SUGGESTIONS: Array<[TKey, string]> = [
  ['emSugBrazil', 'Show anomalies in Brazil'],
  ['emSugCalifornia', 'Show fire activity in California'],
  ['emSugActive', 'Find the most active cell'],
  ['emSugExplain', 'What am I seeing?'],
];

interface EvidenceInput {
  hasFeed: boolean; mode: Mode; stamp: string | null; region: string; status: StatusKey;
  cells: Cell[]; selected: Cell | null; visibleSelected: Cell | null | undefined; top: Cell | undefined;
}
/** What the view shows right now, in the language of the given dictionary. */
function evidenceText({ t, fmt }: I18n, e: EvidenceInput): string {
  if (!e.hasFeed) return t('emEvNotLoaded');
  const n = (x: number) => fmt(Math.round(x));
  const view = t(e.mode === 'globe' ? 'emViewGlobe' : e.mode === '3d' ? 'emView3d' : 'emView2d');
  return [
    e.stamp ? t('emEvThrough', { view, hour: e.stamp }) : t('emEvLatest', { view }),
    t('emEvFocus', { region: e.region }),
    t('emEvCounts', { detections: n(e.cells.reduce((sum, c) => sum + c.count, 0)), cells: n(e.cells.length) }),
    t('emEvSource', { status: t(e.status) }),
    e.selected
      ? e.visibleSelected ? t('emEvSelected', { coord: coord(e.visibleSelected), n: n(e.visibleSelected.count) }) : t('emEvSelectedNone', { coord: coord(e.selected) })
      : t('emEvNoSelection'),
    e.top ? t('emEvTop', { coord: coord(e.top), n: n(e.top.count) }) : '',
  ].filter(Boolean).join(' ');
}

export function EmberGlobe({ feed, cells, allCells = cells, selected, hourIndex = 23, source, stale, mode, regionName, onFocus, onSelectArea }: {
  feed: Feed | null; cells: Cell[]; selected: Cell | null; hourIndex?: number;
  allCells?: Cell[];
  source: 'live' | 'snapshot' | null; stale: boolean; mode: Mode;
  /** Camera focus shown in the evidence; defaults to the whole world. */
  regionName?: string;
  onFocus: (lon: number, lat: number) => void;
  onSelectArea?: (area: EarthArea, monthIndex?: number, showAnomaly?: boolean) => void;
}) {
  const i18n = useI18n();
  const { t, lang, locale, fmt, monthShort, monthLong } = i18n;
  const num = (x: number) => fmt(Math.round(x));
  // Month names inside a sentence: Spanish writes them in lower case.
  const monthIn = (month: number) => lang === 'es' ? monthLong(month + 1).toLocaleLowerCase(locale) : monthLong(month + 1);
  // emberEarth names the whole-world area in English; show it in the reader's language.
  const areaName = (area: EarthArea) => area.bounds === null ? t('wholeWorld') : area.name;
  const historyName = (data: EarthReport) => data.area.historyCode === 'world' ? t('wholeWorld') : data.historicalName;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', text: '', greeting: true }]);
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [entering, setEntering] = useState(true);
  const [atlas, setAtlas] = useState<EarthAtlas | null>(null);
  const atlasPromise = useRef<Promise<EarthAtlas> | null>(null);
  const [earthArea, setEarthArea] = useState<EarthArea | null>(null);
  const [areaSuggestions, setAreaSuggestions] = useState<EarthArea[]>([]);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    return null;
  });
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const request = useRef<AbortController | null>(null);
  const rec = useRef<Recognition | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const characterWidth = viewport.width <= 760 ? 66 : 80;
  const characterHeight = viewport.width <= 760 ? 92 : 110;
  const desiredBubbleWidth = 300;
  const x = position?.x ?? viewport.width - characterWidth - 24;
  const y = position?.y ?? Math.max(0, viewport.height - characterHeight - 140);
  const bubbleOnRight = x < desiredBubbleWidth + 20 && viewport.width - x - characterWidth > x;
  const bubbleRoom = bubbleOnRight ? viewport.width - x - characterWidth - 16 : x - 16;
  const desiredBubbleHeight = Math.min(expanded ? 380 : 300, viewport.height * 0.45);
  const bubbleBelow = y < desiredBubbleHeight && viewport.height - y - characterHeight > y;
  const bubbleHeight = Math.min(desiredBubbleHeight, Math.max(80, (bubbleBelow ? viewport.height - y : y + characterHeight) - 16));
  const top = useMemo(() => [...cells].sort((a, b) => b.count - a.count).slice(0, 3), [cells]);
  const visibleSelected = selected ? cells.find(c => c.lon === selected.lon && c.lat === selected.lat) : null;
  const stamp = feed && Number.isFinite(feed.startHour)
    ? new Date(feed.startHour! + (hourIndex + 1) * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    : null;
  const status: StatusKey = source === 'snapshot' || stale ? 'emStatusSnapshot' : source === 'live' ? 'emStatusLive' : 'emStatusNone';
  // The camera focus may arrive as the whole-world label in either language; name it in each dictionary's own words.
  const isWorld = !regionName || regionName === EN.t('wholeWorld') || regionName === t('wholeWorld');
  const describe = (words: I18n) => evidenceText(words, {
    hasFeed: !!feed, mode, stamp, status, cells, selected, visibleSelected, top: top[0],
    region: isWorld ? words.t('wholeWorld') : regionName!,
  });
  const evidence = describe(i18n);
  const report = useMemo(() => earthArea && atlas ? earthReport(earthArea, atlas, allCells) : null, [earthArea, atlas, allCells]);
  const textOf = (m: Message) => m.greeting ? t('emGreeting') : m.text;

  function loadAtlas(): Promise<EarthAtlas> {
    if (!atlasPromise.current) atlasPromise.current = Promise.all([
      fetch(`${import.meta.env.BASE_URL}data-global/history.json`).then(response => { if (!response.ok) throw new Error('Historical fire data unavailable'); return response.json(); }),
      fetch(`${import.meta.env.BASE_URL}data-global/country-focus.json`).then(response => { if (!response.ok) throw new Error('Country locations unavailable'); return response.json(); }),
    ]).then(([history, focus]) => ({ history, bounds: focus.bounds } as EarthAtlas));
    return atlasPromise.current;
  }

  function reportText(area: EarthArea, data: EarthReport): string {
    const name = areaName(area);
    const hist = historyName(data);
    const strongest = data.topCells[0];
    const unusual = data.unusual;
    return [
      t('emRpShowing', { area: name }),
      feed ? t('emRpObserved', { detections: num(data.detections), cells: num(data.activeCells) }) : t('emRpLoading'),
      strongest ? t('emRpStrongest', { coord: coord(strongest), n: num(strongest.count) }) : '',
      data.peakMonths.length ? t('emRpSeason', { name: hist ?? '', months: data.peakMonths.map(monthIn).join(', ') }) : '',
      unusual
        ? t(unusual.direction === 'above' ? 'emRpAbove' : 'emRpBelow', { month: monthIn(unusual.month), name: hist ?? '', burned: num(unusual.burned), multiple: fmt(unusual.multiple, 1) })
        : data.seasonal ? t('emRpNoAnomaly') : '',
      area.local ? hist ? t('emRpScope', { hist, area: name }) : t('emRpNoHistory', { area: name }) : '',
      t('emRpCaveat'),
    ].filter(Boolean).join(' ');
  }

  useEffect(() => { const timer = window.setTimeout(() => setEntering(false), 2700); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { let active = true; void loadAtlas().then(data => { if (active) setAtlas(data); }).catch(() => { atlasPromise.current = null; }); return () => { active = false; }; }, []);
  useEffect(() => {
    const keepVisible = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setPosition(current => {
        if (!current) return null;
        const next = visiblePosition(current.x, current.y);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    };
    window.addEventListener('resize', keepVisible);
    return () => window.removeEventListener('resize', keepVisible);
  }, []);
  useEffect(() => { if (open && end.current?.parentElement) end.current.parentElement.scrollTop = end.current.parentElement.scrollHeight; }, [open, messages]);
  useEffect(() => () => { request.current?.abort(); rec.current?.stop(); window.speechSynthesis?.cancel(); }, []);

  function explain(q: string) {
    const s = q.toLowerCase();
    if (/current fire|emergency|evacuat|safe|forecast/.test(s)) return t('emExSafety');
    if (/pattern|hotspot|where|most|cluster|concentrat/.test(s)) return [
      evidence,
      top.length > 1 ? t('emExOthers', { list: top.slice(1).map(c => `${coord(c)} (${num(c.count)})`).join('; ') }) : '',
      t('emExRepeated'),
    ].filter(Boolean).join(' ');
    if (/selected|this cell|click|inspect|coordinate/.test(s)) return selected ? `${evidence} ${t('emExAnother')}` : t('emExClickFirst');
    return `${evidence} ${t('emExColumns')}`;
  }
  function speak(text: string, force = false) {
    if ((!voice && !force) || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }
  function serviceError(code: number) {
    if (code === 429) return t('emBusy');
    if (code === 504) return t('emSlow');
    if (code === 400 || code === 413) return t('emTooLong');
    return t('emUnavailable');
  }
  /** `display` is what the reader's bubble shows; the parser reads `command` (English) when a button supplies one. */
  async function send(display: string, spoken = false, command?: string) {
    const shown = display.trim().slice(0, 800);
    if (!shown || busy) return;
    const message = (command ?? shown).trim().slice(0, 800);
    setDraft(''); setBusy(true);
    setAreaSuggestions([]);
    const history = messages.slice(-6).map(m => ({ role: m.role, content: textOf(m) }));
    setMessages(old => [...old, { role: 'user', text: shown }]);
    const speakReply = spoken || /\b(speak|say aloud|read aloud|talk to me)\b/i.test(message);
    const possibleAreas: EarthArea[] = [];
    const recognizedArea = atlas && resolveEarthArea(message, atlas, possibleAreas);
    if (wantsEarthSelection(message) || recognizedArea || possibleAreas.length) {
      try {
        const data = atlas ?? await loadAtlas();
        if (!atlas) setAtlas(data);
        const suggestions: EarthArea[] = [];
        const area = resolveEarthArea(message, data, suggestions);
        if (area) {
          const analysis = earthReport(area, data, allCells);
          setEarthArea(area);
          setExpanded(false);
          const showAnomaly = wantsAnomaly(message);
          onSelectArea?.(area, showAnomaly && analysis.unusual ? 276 + analysis.unusual.month : undefined, showAnomaly);
          const reply = reportText(area, analysis);
          setMessages(old => [...old, { role: 'assistant', text: reply }]);
          setBusy(false); speak(reply, speakReply);
          return;
        }
        if (wantsActivity(message) && top[0] && !/\b(in|near|around|at|for)\s+\w/i.test(message)) {
          onFocus(top[0].lon, top[0].lat);
          const reply = t('emActivity', { coord: coord(top[0]), n: num(top[0].count) });
          setMessages(old => [...old, { role: 'assistant', text: reply }]);
          setBusy(false); speak(reply, speakReply);
          return;
        }
        setAreaSuggestions(suggestions);
        const reply = suggestions.length ? t('emPickPlace') : t('emUnknownArea');
        setExpanded(true);
        setMessages(old => [...old, { role: 'assistant', text: reply }]);
        setBusy(false); speak(reply, speakReply);
        return;
      } catch {
        const reply = t('emLoadFailed');
        setExpanded(true);
        setMessages(old => [...old, { role: 'assistant', text: reply }]);
        setBusy(false); speak(reply, speakReply);
        return;
      }
    }
    let reply = explain(message), model = false;
    if (!/what am i seeing|explain globe|pattern|hotspot|where|most|cluster|concentrat|selected|this cell|click|inspect|coordinate|current fire|emergency|evacuat|safe|forecast/.test(message.toLowerCase())) {
      const controller = new AbortController(); request.current = controller;
      let timedOut = false;
      const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 50000);
      try {
        const response = await fetch(chatUrl, {
          method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history, lang, context: { view: 'global', mode, feed_status: EN.t(status), replay_hour: stamp ?? 'latest 24-hour window', evidence: describe(EN) } }),
        });
        if (response.ok) {
          const data = await response.json();
          // a complete model answer replaces the local one; anything else keeps the local answer, never a cut-off text
          if (data.mode === 'model' && typeof data.reply === 'string' && data.reply.trim() && data.reply.length <= 4000) { reply = data.reply.trim(); model = true; }
        } else { reply = serviceError(response.status); }
      } catch { if (controller.signal.aborted && !timedOut) { setBusy(false); return; } reply = t('emNoConnect'); }
      finally { window.clearTimeout(timeout); request.current = null; }
    }
    setMessages(old => [...old, { role: 'assistant', text: reply, model }]);
    setBusy(false); speak(reply, speakReply);
  }
  function toggleMic() {
    if (listening) { rec.current?.stop(); return; }
    const Ctor = recognition(); if (!Ctor) return;
    const r = new Ctor(); rec.current = r; r.lang = locale; r.continuous = false; r.interimResults = false;
    r.onresult = e => { const words = Array.from(e.results).map(x => x[0]?.transcript ?? '').join(' ').trim(); if (words) void send(words, true); };
    r.onend = r.onerror = () => setListening(false);
    try { r.start(); setListening(true); setVoice(true); } catch { setListening(false); }
  }
  function pointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || !host.current) return;
    const rect = host.current.getBoundingClientRect();
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true; setDragging(true); e.preventDefault();
    setPosition(visiblePosition(d.left + dx, d.top + dy));
  }
  function pointerUp(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    drag.current = null; setDragging(false);
    if (!d.moved) return;
    suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0);
    const next = visiblePosition(d.left + e.clientX - d.x, d.top + e.clientY - d.y);
    setPosition(next); try { localStorage.setItem('focos.ember.globe.viewport-position', JSON.stringify(next)); } catch {}
  }
  function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); void send(draft); }
  const reportName = report ? areaName(report.area) : '';
  const reportHistory = report ? historyName(report) : null;
  return createPortal(<div ref={host} className={`global-ember${busy ? ' thinking' : ''}${speaking ? ' speaking' : ''}${listening ? ' listening' : ''}${dragging ? ' dragging' : ''}${entering && !position ? ' entering' : ''}${bubbleOnRight ? ' left-side' : ''}${bubbleBelow ? ' top-side' : ''}${expanded ? ' expanded' : ''}`} style={{ left: x, top: y, right: 'auto', bottom: 'auto' }}>
    {open && <aside className="global-ember-bubble" style={{ width: Math.min(desiredBubbleWidth, Math.max(100, bubbleRoom)), maxHeight: bubbleHeight }} aria-label={t('emBubbleLabel')}>
      <header><strong>{t('emHeader')}</strong><button type="button" onClick={() => setExpanded(!expanded)} aria-label={report ? expanded ? t('emShowAnalysis') : t('emShowChat') : expanded ? t('emCollapse') : t('emExpand')}>{expanded ? '−' : '⤢'}</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setOpen(false); window.speechSynthesis?.cancel(); }} aria-label={t('emClose')}>×</button></header>
      {(!report || expanded) && <div className="global-ember-messages" role="log" aria-live="polite">{(expanded ? messages : messages.slice(-1)).map((m, i) => <div className={`global-ember-message ${m.role}`} key={expanded ? i : messages.length - 1}>{textOf(m)}{expanded && m.model && <small>{t('emModelNote')}</small>}</div>)}{busy && <p className="global-ember-wait" role="status"><span aria-hidden="true">● ● ●</span> {t('emThinking')}</p>}<div ref={end} /></div>}
      {report && !expanded && <section className="global-ember-report" aria-label={t('emReportLabel', { area: reportName })}>
        <div className="global-ember-report-head"><span>{t('emEarthFocus')}</span><strong>{reportName}</strong></div>
        <p className="global-ember-report-intro">{t('emReportIntro')}</p>
        <div className="global-ember-report-metrics"><div><b>{feed ? num(report.detections) : '…'}</b><span>{t('emMetricDetections')}</span></div><div><b>{feed ? num(report.activeCells) : '…'}</b><span>{t('emMetricCells')}</span></div></div>
        <details className="global-ember-details" key={report.area.name}><summary>{t('emDetails')}</summary>
        {report.seasonal && <div className="global-ember-season"><div><b>{t('emSeasonTitle', { name: reportHistory ?? '' })}</b><small>{t('emSeasonSub')}</small></div><div className="global-ember-season-bars">{report.seasonal.map((amount, month) => <div key={month} title={t('emBarTitle', { month: monthIn(month), v: num(amount) })}><i style={{ height: `${Math.max(4, Math.sqrt(amount / Math.max(...report.seasonal!, 1)) * 100)}%` }} className={report.peakMonths.includes(month) ? 'peak' : ''} /><span>{monthShort(month + 1).slice(0, 1)}</span></div>)}</div></div>}
        {report.unusual && <p className={`global-ember-anomaly ${report.unusual.direction}`}><strong>{t('emAnomalyCard', { n: fmt(report.unusual.multiple, 1), direction: t(report.unusual.direction === 'above' ? 'emAbove' : 'emBelow') })}</strong><span>{t('emAnomalyBurned', { month: monthShort(report.unusual.month + 1), v: num(report.unusual.burned) })}</span></p>}
        {report.topCells.length > 0 && <div className="global-ember-active-cells"><span>{t('emTopCells')}</span>{report.topCells.map((cell, index) => <button type="button" key={`${cell.lon}:${cell.lat}`} onClick={() => onFocus(cell.lon, cell.lat)}><b>{String(index + 1).padStart(2, '0')}</b><span>{coord(cell)}</span><strong>{num(cell.count)}</strong></button>)}</div>}
        <small>{report.area.local ? reportHistory ? t('emNoteLocal', { hist: reportHistory, area: reportName }) : t('emNoteNoBase', { area: reportName }) : t('emNoteMeasures')}</small>
        <div className="global-ember-sources"><a href="https://firms.modaps.eosdis.nasa.gov/active_fire/" target="_blank" rel="noreferrer">NASA FIRMS <span aria-hidden="true">↗</span></a>{report.seasonal && <a href={atlas?.history.sourceUrl} target="_blank" rel="noreferrer">{t('emGwisLink')} <span aria-hidden="true">↗</span></a>}</div>
        </details>
        <button type="button" onClick={() => setExpanded(true)}>{t('emReadMore')} <span aria-hidden="true">↗</span></button>
      </section>}
      {areaSuggestions.length > 0 && <div className="global-ember-prompts" aria-label={t('emChoosePlace')}>{areaSuggestions.map(area => <button type="button" key={area.name} onClick={() => void send(areaName(area), false, `Outline ${area.name}`)}>{areaName(area)}</button>)}</div>}
      {!report && <div className="global-ember-prompts">{SUGGESTIONS.map(([key, command]) => <button type="button" key={key} onClick={() => void send(t(key), false, command)}>{t(key)}</button>)}</div>}
      {!report && top[0] && <button className="global-ember-focus" type="button" onClick={() => onFocus(top[0].lon, top[0].lat)}>{t('emShowTop')} <span aria-hidden="true">↗</span></button>}
      <form onSubmit={submit}><input aria-label={t('emAsk')} value={draft} onChange={e => setDraft(e.target.value)} maxLength={800} placeholder={t('emPlaceholder')} /><button type="submit" disabled={!draft.trim() || busy}>{t('emSend')}</button></form>
      {/* both labels of each toggle share one grid cell, so switching state never changes the button's width in any language */}
      <footer><button className="global-ember-voice-toggle" type="button" aria-pressed={voice} onClick={() => { setVoice(!voice); if (voice) window.speechSynthesis?.cancel(); }}><span aria-hidden={!voice} className={voice ? '' : 'is-off'}>🔊 {t('emVoiceOn')}</span><span aria-hidden={voice} className={voice ? 'is-off' : ''}>🔇 {t('emVoiceOff')}</span></button><button className="global-ember-mic-toggle" type="button" aria-pressed={listening} disabled={!recognition()} onClick={toggleMic}><span aria-hidden={!listening} className={listening ? '' : 'is-off'}>● {t('emListening')}</span><span aria-hidden={listening} className={listening ? 'is-off' : ''}>🎙 {t('emSpeak')}</span></button><span>{t('emFooterNote')}</span></footer>
    </aside>}
    <button className="global-ember-character" type="button" aria-label={open ? t('emClose') : t('emOpen')} aria-expanded={open} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } setOpen(!open); }}><span className="global-ember-sprite" aria-hidden="true" />{!open && <span className="global-ember-name">{t('emAsk')}</span>}</button>
  </div>, document.body);
}
