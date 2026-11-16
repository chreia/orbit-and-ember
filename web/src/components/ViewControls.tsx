// Map view controls: globe, tilted 3D or flat 2D; back to the framed area; the sensor comparison.
import { useI18n } from '../i18n.tsx';
import type { Key } from '../i18n.tsx';
import { MAP_MODES } from '../state.ts';
import type { MapMode } from '../state.ts';
import { useUi } from '../store.ts';

const LABEL: Record<MapMode, [Key, Key]> = {
  globe: ['viewGlobe', 'viewGlobeTitle'],
  '3d': ['view3d', 'view3dTitle'],
  '2d': ['view2d', 'view2dTitle'],
};

export function ViewControls() {
  const { t } = useI18n();
  const mapMode = useUi((s) => s.mapMode);
  const blocked = useUi((s) => s.columnsBlocked);
  const plotsOpen = useUi((s) => s.plotsOpen);
  const setMapMode = useUi((s) => s.setMapMode);
  const resetCamera = useUi((s) => s.resetCamera);
  const view = useUi((s) => s.view);
  const set = useUi((s) => s.set);
  // without WebGL 2 the plain canvas map has one view and frames the area by itself
  const plain = blocked === 'webgl';
  const why = blocked === 'failed' ? t('blockedFailed') : '';
  return (
    <div className="view-controls" role="group" aria-label={t('viewLabel')}>
      {!plain && (
        <div className="seg dim" role="group" aria-label={t('viewLabel')}>
          {MAP_MODES.map((m) => (
            <button key={m} type="button" aria-pressed={mapMode === m} onClick={() => setMapMode(m)} title={t(LABEL[m][1])}>
              {t(LABEL[m][0])}
            </button>
          ))}
        </div>
      )}
      {!plain && (
        <button type="button" className="btn small overlay-btn" onClick={resetCamera}>
          {t('resetView')}
        </button>
      )}
      <button type="button" className="btn small overlay-btn compare-btn" aria-pressed={plotsOpen} onClick={() => set({ plotsOpen: !plotsOpen })}>
        {t('compareSensors')}
      </button>
      {/* one tour button: the worldwide quick tour on the world view, the guided story on the Argentina record */}
      <button
        type="button"
        className="btn small overlay-btn"
        onClick={() => (view === 'explore' ? window.dispatchEvent(new Event('focos:tour')) : set({ story: 0, howToOpen: false }))}
      >
        {t('tourButton')}
      </button>
      {mapMode !== '2d' && why && <span className="vc-note warn">{why}</span>}
    </div>
  );
}
