// Fixed colour classes for the map, shared by the flat image and the 3D columns.
import { binIndex, HEAT, hexToRgb, logBreaks, PCT_COLORS, spreadRamp } from '../lib/color.ts';
import { excessBreaks } from '../lib/cells.ts';
import type { MapColor } from '../state.ts';

export interface MapScale {
  kind: MapColor;
  /** class edges; class 0 is below the first edge */
  breaks: number[];
  colors: string[];
  rgba: [number, number, number, number][];
  /** class index of a value, or -1 for "draw nothing" */
  classOf: (v: number) => number;
}

/** Hotspots: log-spaced classes between the record's low and high single cell-month values. */
export function hotspotScale(lo: number, hi: number): MapScale {
  const breaks = logBreaks(hi, lo);
  const colors = spreadRamp(HEAT.dark, breaks.length + 1);
  return {
    kind: 'hotspots',
    breaks,
    colors,
    rgba: colors.map((c) => [...hexToRgb(c), 255] as [number, number, number, number]),
    classOf: (v) => (v > 0 ? binIndex(v, breaks) : -1),
  };
}

/** Difference from usual: seven classes around a neutral middle. Cells that never burned stay empty. */
export function excessScale(hi: number): MapScale {
  const breaks = excessBreaks(hi);
  const colors = PCT_COLORS.dark.slice();
  return {
    kind: 'excess',
    breaks,
    colors,
    rgba: colors.map((c) => [...hexToRgb(c), 255] as [number, number, number, number]),
    classOf: (v) => (Number.isFinite(v) ? binIndex(v, breaks) : -1),
  };
}
