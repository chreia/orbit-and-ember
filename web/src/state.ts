// Shareable view state kept in the URL hash, e.g.
// #region=prov:3&from=2025-11&to=2026-10&series=harmonized&mode=anomaly&view=explore&map=3d&base=relief
import type { Manifest } from './bundle/types.ts';
import type { Lang } from './i18n.tsx';
import type { Region } from './lib/region.ts';
import { bboxRegion, circleRegion, presetRegion, provinceRegion } from './lib/region.ts';
import type { ViewSeries } from './lib/series.ts';
import { VIEW_SERIES } from './lib/series.ts';

export type CalMode = 'counts' | 'anomaly' | 'pct';
export type Tool = 'select' | 'rect' | 'circle';
export type View = 'explore' | 'global' | 'history' | 'methods';
/** What the map colours: hotspot counts, or the difference from each cell's usual value. */
export type MapColor = 'hotspots' | 'excess';
/** The map's projection and camera: a flat map, a tilted map with columns, or the globe with columns. */
export type MapMode = '2d' | '3d' | 'globe';
export const MAP_MODES: MapMode[] = ['globe', '3d', '2d'];
/** The picture under the data; auto means plain in 2D and NASA imagery in 3D and on the globe. */
export type BaseChoice = 'auto' | 'imagery' | 'relief' | 'night' | 'plain';

export interface HashState {
  region?: string;
  from?: string;
  to?: string;
  series?: ViewSeries;
  mode?: CalMode;
  view?: View;
  lang?: Lang;
  /** absent means the default view (the globe) */
  map?: MapMode;
  color?: MapColor;
  /** absent means auto */
  base?: Exclude<BaseChoice, 'auto'>;
}

export function readHash(): HashState {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const out: HashState = {};
  const region = h.get('region');
  if (region) out.region = region;
  const ym = /^\d{4}-\d{2}$/;
  const from = h.get('from');
  const to = h.get('to');
  if (from && ym.test(from)) out.from = from;
  if (to && ym.test(to)) out.to = to;
  const series = h.get('series') as ViewSeries | null;
  if (series && VIEW_SERIES.includes(series)) out.series = series;
  const mode = h.get('mode');
  if (mode === 'counts' || mode === 'anomaly' || mode === 'pct') out.mode = mode;
  const view = h.get('view');
  if (view === 'explore' || view === 'global' || view === 'history' || view === 'methods') out.view = view;
  // a shared link may also carry the language as ?lang=jam; the hash wins when both are present
  const lang = h.get('lang') ?? new URLSearchParams(window.location.search).get('lang');
  if (isLang(lang)) out.lang = lang;
  const map = h.get('map');
  if (map === '2d' || map === '3d' || map === 'globe') out.map = map;
  const base = h.get('base');
  if (base === 'imagery' || base === 'relief' || base === 'night' || base === 'plain') out.base = base;
  const color = h.get('color');
  if (color === 'hotspots' || color === 'excess') out.color = color;
  return out;
}

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'es' || v === 'jam';
}

export function writeHash(s: HashState): void {
  const h = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== '') h.set(k, String(v));
  const next = `#${h.toString()}`;
  if (next !== window.location.hash) window.history.replaceState(null, '', next);
}

export function regionFromKey(key: string, manifest: Manifest): Region | null {
  const [kind, rest = ''] = key.split(/:(.*)/s);
  if (kind === 'preset') {
    const p = manifest.presets.find((q) => q.id === rest);
    return p ? presetRegion(p, manifest) : null;
  }
  if (kind === 'prov') {
    const id = Number(rest);
    return manifest.provinces.some((p) => p.id === id) ? provinceRegion(id, manifest) : null;
  }
  const nums = rest.split(',').map(Number);
  if (nums.some((x) => !Number.isFinite(x))) return null;
  if (kind === 'bbox' && nums.length === 4) return bboxRegion(nums as [number, number, number, number], '');
  if (kind === 'circle' && nums.length === 3 && nums[2] > 0) return circleRegion(nums[0], nums[1], nums[2], '');
  return null;
}

export function defaultRegion(manifest: Manifest): Region {
  const all = manifest.presets.find((p) => p.kind === 'all') ?? manifest.presets[0];
  if (all) return presetRegion(all, manifest);
  return { kind: 'all', key: 'all', name: manifest.country };
}
