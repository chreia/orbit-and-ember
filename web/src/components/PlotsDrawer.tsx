// The sensor comparison in a drawer over the map: the raw sensors, the naive merge and the
// harmonized record for the selected area, with the steps each new sensor introduces.
import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n.tsx';
import { useModel } from '../model.ts';
import { useDerived } from '../derived.tsx';
import { useUi } from '../store.ts';
import { SensorComparison } from './SensorComparison.tsx';
import { PanelBoundary } from '../shell/PanelBoundary.tsx';

export function PlotsDrawer() {
  const { t } = useI18n();
  const model = useModel();
  const d = useDerived();
  const open = useUi((s) => s.plotsOpen);
  const set = useUi((s) => s.set);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') set({ plotsOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, set]);
  if (!open) return null;
  return (
    <div className="drawer" role="dialog" aria-modal="false" aria-labelledby="plots-title">
      <header>
        <h2 id="plots-title">{t('cmpTitle')}</h2>
        <span className="muted">{d.name}</span>
        <span className="grow" />
        <button ref={closeRef} type="button" className="btn small" onClick={() => set({ plotsOpen: false })}>
          {t('close')}
        </button>
      </header>
      <PanelBoundary name={t('nameComparison')}>
        <SensorComparison model={model} rs={d.rs} band={d.harmBand} theme="dark" regionName={d.name} bare />
      </PanelBoundary>
    </div>
  );
}
