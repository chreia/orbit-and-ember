// Interface state shared by the map, the scrubber, the calendar and the panels. The data bundle
// itself is immutable and lives in ModelContext; everything a reader can change lives here, and the
// shareable part is mirrored in the URL hash by App.
import { create } from 'zustand';
import type { Region } from './lib/region.ts';
import type { ViewSeries } from './lib/series.ts';
import type { Range } from './lib/timeline.ts';
import type { BaseChoice, CalMode, MapColor, MapMode, Tool, View } from './state.ts';
import type { BaseMap } from './map/style.ts';
import type { Lang } from './i18n.tsx';
import { readStored, writeStored } from './hooks.ts';

export interface CircleDraft {
  lon: number;
  lat: number;
  radiusKm: number;
}

export interface WorldFocus {
  code: string;
  name: string;
  /** Natural Earth bounds used only to frame the camera, not to measure fire area. */
  bounds: [number, number, number, number] | null;
}

/** What is under the pointer on the map. */
export interface Readout {
  lon: number;
  lat: number;
  /** table index of the active cell, or -1 for a cell with no hotspots in the record */
  cell: number;
  /** grid cell id, or -1 outside the grid */
  cellId: number;
}

export const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2'));
  } catch {
    return false;
  }
}

export interface Ui {
  view: View;
  lang: Lang;
  region: Region;
  worldFocus: WorldFocus | null;
  networkOpen: boolean;
  networkTerrainActive: boolean;
  networkSelection: { lon: number; lat: number; count: number; latest?: number } | null;
  networkFeed: { source: 'live' | 'snapshot'; fetchedAt: string; cellCount: number; latestObservation?: number } | null;
  range: Range;
  series: ViewSeries;
  mode: CalMode;
  mapColor: MapColor;
  showBorders: boolean;
  showDetections: boolean;
  mapMode: MapMode;
  baseChoice: BaseChoice;
  /** why the columns cannot be drawn (the flat hotspot image is shown instead), or null */
  columnsBlocked: null | 'webgl' | 'failed';
  cameraNonce: number;
  /** the elevation grid that seats the columns on the terrain is loaded */
  terrainReady: boolean;
  /** the opening approach to Argentina has run (or was skipped) */
  opened: boolean;
  tool: Tool;
  circle: CircleDraft;
  playing: boolean;
  readout: Readout | null;
  plotsOpen: boolean;
  howToOpen: boolean;
  /** the layers card on the worldwide view: folded, so the Earth stays in view */
  layersOpen: boolean;
  /** the layers card on the Argentina record: open on wide screens, since it holds the colour key */
  recordLayersOpen: boolean;
  /** numbers inside calendar cells */
  showValues: boolean;
  /** the guided tour's current step, or null when it is closed */
  story: number | null;
  /** grid cells per column side at the current zoom (1 = one column per cell) */
  columnBlock: number;

  set: (p: Partial<Ui>) => void;
  setRange: (r: Range) => void;
  setRegion: (r: Region) => void;
  pickMonth: (m: number, extend: boolean) => void;
  setMapMode: (m: MapMode) => void;
  blockColumns: (why: 'webgl' | 'failed') => void;
  resetCamera: () => void;
  setHowTo: (open: boolean) => void;
}

/** Columns are drawn in 3D and on the globe, unless deck.gl could not start. */
export const columnsOn = (s: Pick<Ui, 'mapMode' | 'columnsBlocked'>): boolean => s.mapMode !== '2d' && !s.columnsBlocked;

/** The base map actually shown. */
export const baseOf = (s: Pick<Ui, 'mapMode' | 'baseChoice'>): BaseMap =>
  s.baseChoice !== 'auto' ? s.baseChoice : s.mapMode === '2d' ? 'plain' : 'imagery';

const narrow = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 900px)').matches);

export const useUi = create<Ui>()((set, get) => ({
  view: 'explore',
  lang: 'en',
  region: { kind: 'all', key: 'all', name: '' },
  worldFocus: null,
  networkOpen: false,
  networkTerrainActive: false,
  networkSelection: null,
  networkFeed: null,
  range: [0, 0],
  series: 'harmonized',
  mode: 'counts',
  mapColor: 'hotspots',
  showBorders: true,
  showDetections: false,
  mapMode: 'globe',
  baseChoice: 'auto',
  columnsBlocked: null,
  cameraNonce: 0,
  terrainReady: false,
  opened: false,
  tool: 'select',
  circle: { lon: -63.6, lat: -38.4, radiusKm: 50 },
  playing: false,
  readout: null,
  plotsOpen: false,
  howToOpen: readStored('focos.howto') !== 'closed',
  layersOpen: false,
  recordLayersOpen: !narrow(),
  showValues: !narrow(),
  story: null,
  columnBlock: 1,

  set: (p) => set(p),
  setRange: (r) => {
    const [a, b] = r;
    set({ range: a <= b ? [a, b] : [b, a] });
  },
  setRegion: (region) => set({ region }),
  pickMonth: (m, extend) => {
    const [a, b] = get().range;
    set({ playing: false, range: extend ? [Math.min(a, m), Math.max(b, m)] : [m, m] });
  },
  setMapMode: (m) => {
    if (m === get().mapMode) return;
    set({ mapMode: m, cameraNonce: get().cameraNonce + 1 });
  },
  blockColumns: (why) => set({ columnsBlocked: why }),
  resetCamera: () => set({ cameraNonce: get().cameraNonce + 1 }),
  setHowTo: (open) => {
    writeStored('focos.howto', open ? 'open' : 'closed');
    set({ howToOpen: open });
  },
}));
