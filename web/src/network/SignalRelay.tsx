import { apiUrl } from '../lib/api.ts';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import type { TKey } from '../i18n.tsx';
import './signal-relay.css';

type Cell = { lat: number; lon: number; count: number; latest?: number } | null;
type Recipient = { role: 'scientist' | 'response' | 'land-manager' | 'watcher'; name: string | null; organization: string | null; logoUrl: string | null; lastDelivery: string | null };
type Status = { emailReady: boolean; lastCheck: string | null; count: number; recipients: Recipient[]; signal: { recent: number; earlier: number; latest: number } | null };
/** Status lines are kept as dictionary keys, so they follow a language change. */
type Message = Extract<TKey, 'srServiceDown' | 'srConfirmSent' | 'srErrorInvalid' | 'srErrorBusy' | 'srErrorCreate' | 'srCopied' | 'srCopyManual'>;

const roleName: Record<Recipient['role'], TKey> = { scientist: 'srRoleScientist', response: 'srRoleResponse', 'land-manager': 'srRoleLandManager', watcher: 'srRoleWatcher' };
const empty: Status = { emailReady: false, lastCheck: null, count: 0, recipients: [], signal: null };

export function SignalRelay({ cell, source, open, terrainActive = false, onReturnToGlobe, onToggle }: { cell: Cell; source: 'live' | 'snapshot' | null; open: boolean; terrainActive?: boolean; onReturnToGlobe?: () => void; onToggle: () => void }) {
  const { t, fmt, locale } = useI18n();
  const [status, setStatus] = useState<Status>(empty);
  const [, setChecking] = useState(false);
  const [form, setForm] = useState(false);
  const [message, setMessage] = useState<Message | ''>('');
  const [busy, setBusy] = useState(false);
  const [radius, setRadius] = useState(50);
  useEffect(() => {
    if (!open || !cell) return;
    setStatus(empty); setForm(false); setMessage('');
    let active = true;
    const update = async () => {
      setChecking(true);
      try {
        const res = await fetch(`${apiUrl('api/relay/status')}?lat=${cell.lat}&lon=${cell.lon}`, { cache: 'no-store' });
        if (!res.ok) throw new Error();
        const next = await res.json() as Status;
        if (active) { setStatus(next); setMessage(''); }
      } catch { if (active) setMessage('srServiceDown'); }
      finally { if (active) setChecking(false); }
    };
    void update();
    const timer = window.setInterval(() => { void update(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [cell?.lat, cell?.lon, open]);
  useEffect(() => { if (!open) { setForm(false); setMessage(''); } }, [open]);
  async function subscribe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cell) return;
    setBusy(true); setMessage('');
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch(apiUrl('api/relay/subscribe'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fields.get('name'), email: fields.get('email'), organization: fields.get('organization'), role: fields.get('role'), publicName: fields.get('publicName') === 'on', lat: cell.lat, lon: cell.lon, radiusKm: radius }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        // the server explains in English; the reader gets the matching message in their language
        console.warn('[focos] signal watch not created:', response.status, result.error ?? '');
        setMessage(response.status === 400 ? 'srErrorInvalid' : response.status === 429 ? 'srErrorBusy' : 'srErrorCreate');
        return;
      }
      setForm(false); setMessage('srConfirmSent');
    } catch (error) { console.warn('[focos] signal watch not created:', error); setMessage('srErrorCreate'); }
    finally { setBusy(false); }
  }
  async function copyLocation() {
    if (!cell) return;
    try { await navigator.clipboard.writeText(`${cell.lat.toFixed(4)}, ${cell.lon.toFixed(4)}`); setMessage('srCopied'); }
    catch { setMessage('srCopyManual'); }
  }
  const label = cell ? `${cell.lat.toFixed(2)}°, ${cell.lon.toFixed(2)}°` : t('srSelectHotspot');
  return <div className={`signal-relay${open ? ' is-open' : ''}`}>
    <button className="signal-relay-trigger" type="button" aria-expanded={open} aria-label={open ? t('srClose') : t('srOpen')} onClick={onToggle}><span className="signal-relay-glyph" aria-hidden="true"><i /><i /><i /></span><span><b>{t('srSignal')}</b><small>{cell ? t(cell.count === 1 ? 'srTriggerCountOne' : 'srTriggerCount', { n: fmt(cell.count) }) : t('srTriggerHint')}</small></span><strong aria-hidden="true">{open ? '×' : '↗'}</strong></button>
    {open && <section className={`signal-relay-card${!cell ? ' is-guide' : ''}`} aria-label={t('srCardLabel')}>
      {cell && <div className="signal-relay-header"><span>NASA FIRMS{' · '}{t(source === 'live' ? 'srFeedLive' : source === 'snapshot' ? 'srFeedSnapshot' : 'srFeedWaiting')}</span>{terrainActive && onReturnToGlobe ? <button className="sr-return" type="button" onClick={onToggle} aria-label={t('srBackLabel')}>← {t('srBack')}</button> : <button type="button" onClick={onToggle} aria-label={t('close')}>×</button>}</div>}

      {!cell ? <p className="signal-relay-instruction">{t('srGuide')}</p> : <>
        <div className="signal-relay-evidence"><span>{t('srSelected')}</span><b>{label}</b><div className="sr-observation"><strong>{fmt(cell.count)}</strong><span>{t(cell.count === 1 ? 'srPast24One' : 'srPast24')}</span></div>{cell.latest ? <small>{t('srLastObserved', { time: new Date(cell.latest).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) })}</small> : null}</div>
        <button className="sr-copy" type="button" onClick={copyLocation}>{t('srCopy')}</button>
        {status.count > 0 && <details className="sr-contacts"><summary>{t(status.count === 1 ? 'srContactsOne' : 'srContacts', { n: fmt(status.count) })}</summary>{status.recipients.map((recipient, i) => <p key={i}>{recipient.organization ?? recipient.name ?? t(roleName[recipient.role])}</p>)}</details>}
        {status.emailReady ? <button className="sr-watch-button" type="button" onClick={() => setForm(value => !value)}>{form ? t('srCancel') : t('srWatch')} <span>↗</span></button> : <a className="sr-watch-button" href="https://firms.modaps.eosdis.nasa.gov/alerts/" target="_blank" rel="noopener noreferrer">{t('srFirmsAlerts')} <span>↗</span></a>}
        {form && <form className="sr-form" onSubmit={subscribe}><label>{t('srFieldName')}<input name="name" required maxLength={80} /></label><label>{t('srFieldEmail')}<input name="email" type="email" required /></label><label>{t('srFieldOrg')}<input name="organization" maxLength={100} /></label><label>{t('srFieldRole')}<select name="role"><option value="scientist">{t('srRoleScientist')}</option><option value="response">{t('srRoleResponse')}</option><option value="land-manager">{t('srRoleLandManager')}</option></select></label><label>{t('srFieldRadius', { km: radius })}<input type="range" min="5" max="150" step="5" value={radius} onChange={event => setRadius(Number(event.target.value))} /></label><label className="sr-checkbox"><input type="checkbox" name="publicName" /> {t('srPublicName')}</label><button disabled={busy} type="submit">{busy ? t('srSending') : t('srSubmit')}</button></form>}
        {message && <p className="sr-message" role="status">{t(message)}</p>}
      </>}
    </section>}
  </div>;
}
