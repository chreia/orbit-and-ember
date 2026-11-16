// Step 1: the area. Presets and provinces from a list, a province clicked on the map, a rectangle
// drawn on the map, or a point and radius typed or clicked.
import { useEffect, useId, useMemo, useState } from 'react';
import { circleRegion, presetRegion, provinceRegion } from '../lib/region.ts';
import type { Tool } from '../state.ts';
import { useI18n } from '../i18n.tsx';
import { presetName, regionLabel, useModel } from '../model.ts';
import { useDerived } from '../derived.tsx';
import { useUi } from '../store.ts';

export function AreaPicker() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { manifest } = useModel();
  const d = useDerived();
  const id = useId();
  const region = useUi((s) => s.region);
  const tool = useUi((s) => s.tool);
  const circle = useUi((s) => s.circle);
  const set = useUi((s) => s.set);
  const provinces = useMemo(() => [...manifest.provinces].sort((a, b) => a.name.localeCompare(b.name, i18n.locale)), [manifest, i18n.locale]);
  const custom = (region.kind === 'bbox' && !region.key.startsWith('preset:')) || region.kind === 'circle';
  const value = custom ? 'custom' : region.key;

  const [lat, setLat] = useState(String(circle.lat));
  const [lon, setLon] = useState(String(circle.lon));
  const [rad, setRad] = useState(String(circle.radiusKm));
  const [err, setErr] = useState(false);
  useEffect(() => {
    setLat(String(circle.lat));
    setLon(String(circle.lon));
    setRad(String(circle.radiusKm));
  }, [circle]);

  const choose = (key: string) => {
    if (key.startsWith('preset:')) {
      const p = manifest.presets.find((q) => `preset:${q.id}` === key);
      if (p) set({ region: presetRegion(p, manifest), tool: 'select' });
    } else if (key.startsWith('prov:')) set({ region: provinceRegion(Number(key.slice(5)), manifest), tool: 'select' });
  };
  const apply = () => {
    const la = Number(lat.replace(',', '.'));
    const lo = Number(lon.replace(',', '.'));
    const r = Number(rad.replace(',', '.'));
    if (!(Math.abs(la) <= 90) || !(Math.abs(lo) <= 180) || !(r >= 1 && r <= 1000)) {
      setErr(true);
      return;
    }
    setErr(false);
    set({ circle: { lat: la, lon: lo, radiusKm: r }, region: circleRegion(lo, la, r, '') });
  };
  const hint = tool === 'rect' ? t('hintRect') : tool === 'circle' ? t('hintCircle') : t('hintSelect');

  return (
    <div className="area">
      <div className="area-name">
        <h1>{d.name}</h1>
        <span className="muted small" aria-live="polite">
          {t('cellsInRegion', { n: fmt(d.cells.length) })}
        </span>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${id}-region`}>
          {t('region')}
        </label>
        <select id={`${id}-region`} value={value} onChange={(e) => choose(e.target.value)}>
          {custom && <option value="custom">{regionLabel(region, i18n)}</option>}
          <optgroup label={t('presets')}>
            {manifest.presets.map((p) => (
              <option key={p.id} value={`preset:${p.id}`}>
                {presetName(p, i18n)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('provinces')}>
            {provinces.map((p) => (
              <option key={p.id} value={`prov:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <div className="field">
        <span className="label" id={`${id}-tool`}>
          {t('toolLabel')}
        </span>
        <div className="seg full" role="group" aria-labelledby={`${id}-tool`}>
          {(['select', 'rect', 'circle'] as Tool[]).map((k) => (
            <button key={k} type="button" aria-pressed={tool === k} onClick={() => set({ tool: k })}>
              {k === 'select' ? t('toolSelect') : k === 'rect' ? t('toolRect') : t('toolCircle')}
            </button>
          ))}
        </div>
        <p className="help small" aria-live="polite">
          {hint}
        </p>
      </div>
      {tool === 'circle' && (
        <form
          className="circle-form"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="field">
            <label className="label" htmlFor={`${id}-lat`}>
              {t('lat')}
            </label>
            <input id={`${id}-lat`} type="number" step="0.01" min={-90} max={90} value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-lon`}>
              {t('lon')}
            </label>
            <input id={`${id}-lon`} type="number" step="0.01" min={-180} max={180} value={lon} onChange={(e) => setLon(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-rad`}>
              {t('radiusKm')}
            </label>
            <input id={`${id}-rad`} type="number" step="1" min={1} max={1000} value={rad} onChange={(e) => setRad(e.target.value)} />
          </div>
          <button className="btn primary" type="submit">
            {t('apply')}
          </button>
          {err && (
            <p className="small form-error" role="alert">
              {t('coordError')}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
