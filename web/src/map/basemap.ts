// Small guards and helpers for the map style in style.ts.
import type { Map as MlMap } from 'maplibre-gl';
import type { Lang, T } from '../i18n.tsx';
import { nameField } from './style.ts';

/** Blank images for icons a style references but has no sprite for, so nothing is logged per tile. */
export function installMapGuards(map: MlMap): void {
  map.setMissingStyleImageResolver((id: string) => {
    if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}

/** MapLibre's own control tooltips, which it writes once in English, in the reading language. */
const CONTROL_LABELS = [
  ['.maplibregl-ctrl-zoom-in', 'mapZoomIn'],
  ['.maplibregl-ctrl-zoom-out', 'mapZoomOut'],
  ['.maplibregl-ctrl-compass', 'mapResetNorth'],
  ['.maplibregl-ctrl-attrib-button', 'mapCredits'],
] as const;

export function controlLanguage(map: MlMap, t: T): void {
  const root = map.getContainer();
  for (const [selector, key] of CONTROL_LABELS) {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      el.title = t(key);
      el.setAttribute('aria-label', t(key));
    });
  }
}

const NAMED_LABELS = ['label-ocean', 'label-country', 'label-city'];

/** Place names in the reading language: the Spanish or English name where the map data has one. */
export function labelLanguage(map: MlMap, lang: Lang): void {
  for (const id of NAMED_LABELS) {
    if (!map.getLayer(id)) continue;
    try {
      map.setLayoutProperty(id, 'text-field', nameField(lang) as never);
    } catch {
      /* not a label we can change: fine */
    }
  }
}
