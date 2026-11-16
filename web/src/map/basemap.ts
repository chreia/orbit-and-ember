// Small guards and helpers for the map style in style.ts.
import type { Map as MlMap } from 'maplibre-gl';
import type { Lang } from '../i18n.tsx';
import { nameField } from './style.ts';

/** Blank images for icons a style references but has no sprite for, so nothing is logged per tile. */
export function installMapGuards(map: MlMap): void {
  map.setMissingStyleImageResolver((id: string) => {
    if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
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
