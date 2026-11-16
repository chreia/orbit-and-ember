// The first-visit tour of the worldwide view. It opens once, on its own; the Tour button brings it
// back. Its last step hands over to the guided tour of the Argentina record.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n.tsx';
import { useUi } from '../store.ts';
import './quick-tour.css';

const KEY = 'focos.quick-tour.v1';
const steps = [
  { selector: '#area', label: 'qt1Label', title: 'qt1Title', text: 'qt1Text' },
  { selector: '#calendar', label: 'qt2Label', title: 'qt2Title', text: 'qt2Text' },
  { selector: '.mapwrap', label: 'qt3Label', title: 'qt3Title', text: 'qt3Text' },
  { selector: '.global-ember-character', label: 'qt4Label', title: 'qt4Title', text: 'qt4Text' },
  { selector: '.signal-relay-trigger', label: 'qt5Label', title: 'qt5Title', text: 'qt5Text' },
] as const;

export function QuickTour() {
  const { t } = useI18n();
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const active = step !== null;
  function start() { previousFocus.current = document.activeElement as HTMLElement; setStep(0); }
  function close() { try { localStorage.setItem(KEY, 'done'); } catch { /* session remains usable */ } setStep(null); previousFocus.current?.focus({ preventScroll: true }); }
  function argentina() {
    close();
    useUi.getState().set({ view: 'history', story: 0, howToOpen: false });
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const replay = () => start();
    window.addEventListener('focos:tour', replay);
    let seen = false;
    try { seen = localStorage.getItem(KEY) === 'done'; } catch { seen = false; }
    const timer = !seen ? window.setInterval(() => {
      if (document.querySelector('.map[data-ready="true"]')) { window.clearInterval(timer); start(); }
    }, 400) : undefined;
    return () => { window.removeEventListener('focos:tour', replay); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (step === null) return;
    const target = document.querySelector(steps[step].selector);
    if (target?.closest('.panel')) target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const update = () => {
      const r = target?.getBoundingClientRect();
      const width = window.innerWidth, height = window.innerHeight;
      setViewport({ width, height });
      if (r) {
        const left = Math.max(8, r.left - 5), top = Math.max(8, r.top - 5);
        setRect({ left, top, width: Math.max(0, Math.min(width - 8, r.right + 5) - left), height: Math.max(0, Math.min(height - 8, r.bottom + 5) - top) });
      } else setRect({ left: width / 2, top: height / 2, width: 0, height: 0 });
    };
    update();
    dialog.current?.focus({ preventScroll: true });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [step]);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault(); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active]);
  if (step === null) return null;
  const width = Math.min(320, viewport.width - 32);
  const last = step === steps.length - 1;
  const cardHeight = last ? 330 : 280;
  let left = rect.left + rect.width + 18;
  if (left + width > viewport.width - 16) left = rect.left - width - 18;
  if (left < 16) left = Math.max(16, Math.min(viewport.width - width - 16, rect.left + (rect.width - width) / 2));
  const top = Math.max(16, Math.min(viewport.height - cardHeight - 16, rect.top + Math.min(60, rect.height / 3)));
  return createPortal(<div className="quick-tour-overlay">
    <div className="quick-tour-shade" />
    <div className="quick-tour-spotlight" style={rect} aria-hidden="true" />
    <div ref={dialog} tabIndex={-1} className="quick-tour-card" style={{ left, top, width }} role="dialog" aria-modal="true" aria-labelledby="quick-tour-title" aria-describedby="quick-tour-description">
      <div className="quick-tour-meta"><span>{t('qtCount', { n: step + 1, total: steps.length })}</span><button type="button" onClick={close} aria-label={t('qtSkipLabel')}>×</button></div>
      <small>{t(steps[step].label)}</small><h2 id="quick-tour-title">{t(steps[step].title)}</h2><p id="quick-tour-description">{t(steps[step].text)}</p>
      <div className="quick-tour-progress" aria-hidden="true">{steps.map((_, index) => <i key={index} className={index <= step ? 'visited' : ''} />)}</div>
      {last && <div className="quick-tour-handoff"><p>{t('qtArgentinaHint')}</p><button type="button" onClick={argentina}>{t('qtArgentina')}</button></div>}
      <footer><button type="button" onClick={close}>{t('qtSkip')}</button><div><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>{t('storyBack')}</button><button type="button" className="quick-tour-next" onClick={() => last ? close() : setStep(step + 1)}>{last ? t('qtDone') : `${t('storyNext')} →`}</button></div></footer>
    </div>
  </div>, document.body);
}
