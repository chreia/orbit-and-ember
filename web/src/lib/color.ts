// Colour scales. Counts use a warm single-direction ramp on a log scale; anomalies and percent of
// median use a blue/red diverging ramp with a neutral grey midpoint. Each theme has its own steps:
// in dark mode low values recede into the dark surface and high values are brightest. The dark
// steps are tuned for the Deep Blue surface (#07173F) and checked by tests/palette.test.ts:
// monotone lightness, separation under simulated colour-vision deficiency, contrast with the surface.

export type Theme = 'light' | 'dark';

export const HEAT: Record<Theme, string[]> = {
  light: ['#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
  dark: ['#8b2b42', '#b03533', '#d14706', '#eb6300', '#fa8600', '#ffab00', '#ffd041', '#fff185'],
};
export const ZERO: Record<Theme, string> = { light: '#ecebe6', dark: '#252a34' };
/** The surface the dark steps are designed against (NASA Space Apps Deep Blue). */
export const DARK_SURFACE = '#07173F';
/** Dark ink for labels on light fills. */
export const DARK_INK = '#07173F';

/**
 * Line colours for the sensor comparison, on the dark surface. Hue says MODIS (blue) or VIIRS
 * (orange); the second satellite of each family is also dashed, and the naive merge is dashed
 * teal, so no pair depends on colour alone.
 */
export const SERIES_DARK = {
  harmonized: '#ffffff',
  naive: '#48a689',
  modis_terra: '#92c4ee',
  modis_aqua: '#4885df',
  viirs_snpp: '#f6ab6b',
  viirs_noaa20: '#dd6836',
} as const;

/** Detection points on the map: MODIS and VIIRS. */
export const DETECTION_DARK = { modis: '#92c4ee', viirs: '#f6ab6b' } as const;

/** z bins: < -2, -2..-1, -1..1, 1..2, >= 2 */
export const Z_BREAKS = [-2, -1, 1, 2];
export const Z_COLORS: Record<Theme, string[]> = {
  light: ['#2166ac', '#92c5de', '#e8e6e1', '#f4a582', '#b2182b'],
  dark: ['#79c0f1', '#347ec4', '#44484e', '#c64e31', '#fea47c'],
};

/** percent-of-median bins */
export const PCT_BREAKS = [25, 50, 80, 125, 200, 400];
export const PCT_COLORS: Record<Theme, string[]> = {
  light: ['#2166ac', '#67a9cf', '#d1e5f0', '#e8e6e1', '#fddbc7', '#ef8a62', '#b2182b'],
  dark: ['#90cdf1', '#4b99d7', '#3a6aa7', '#44484e', '#ae4538', '#e56d41', '#ffb481'],
};

/**
 * Log-spaced class breaks for values in [lo, hi]. Returns the lower edges of every class after the
 * first, so the classes are (0, b0), [b0, b1), ..., [b_last, inf). Prefers 1-2-5 steps, falls back
 * to finer or coarser steps to land between minClasses and maxClasses.
 */
export function logBreaks(hi: number, lo = 1, maxClasses = 8, minClasses = 5): number[] {
  if (!(hi > 0)) return [1];
  const floor = Math.max(Math.min(lo > 0 ? lo : 1, hi), hi / 1e6, 1e-3);
  // Friendlier sequences first; the first that yields 6 to 8 classes wins, else the first with 5 to 8.
  const seqs = [
    [1, 2, 5],
    [1, 2, 3, 5],
    [1, 1.5, 2, 3, 5, 7],
    [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8],
    [1, 3],
    [1],
  ];
  const sig = (v: number) => Number(v.toPrecision(6));
  const gen = (seq: number[]) => {
    const out: number[] = [];
    for (let p = 10 ** Math.floor(Math.log10(floor)); p <= hi * 10; p *= 10) {
      for (const s of seq) {
        const v = sig(s * p);
        if (v > floor * 1.000001 && v <= hi) out.push(v);
      }
    }
    return out;
  };
  const candidates = seqs.map(gen);
  const fits =
    candidates.find((c) => c.length + 1 >= Math.max(minClasses, 6) && c.length + 1 <= maxClasses) ??
    candidates.find((c) => c.length + 1 >= minClasses && c.length + 1 <= maxClasses);
  if (fits) return fits;
  const under = candidates.filter((c) => c.length + 1 <= maxClasses).sort((a, b) => b.length - a.length)[0];
  if (under && under.length > 0) return under;
  const dec = candidates[candidates.length - 1].slice();
  while (dec.length + 1 > maxClasses) dec.splice(1, 1);
  return dec.length ? dec : [sig(hi)];
}

/**
 * Ends for a count scale: the 5th and 99th percentiles of the positive values, so one extreme month
 * does not wash out the rest. Values above the top break fall in the open top class.
 */
export function positiveRange(
  values: ArrayLike<number>,
  keep?: (i: number) => boolean,
  loQ = 0.05,
  hiQ = 0.99,
): { lo: number; hi: number } {
  const pos: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v > 0 && (!keep || keep(i))) pos.push(v);
  }
  if (!pos.length) return { lo: 1, hi: 1 };
  pos.sort((a, b) => a - b);
  const at = (q: number) => pos[Math.min(pos.length - 1, Math.max(0, Math.round(q * (pos.length - 1))))];
  return { lo: at(loQ), hi: at(hiQ) };
}

export function binIndex(x: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && x >= breaks[i]) i++;
  return i;
}

/** Colours for a class count, spread across the ramp so the top class is always the darkest. */
export function spreadRamp(ramp: string[], classes: number): string[] {
  if (classes >= ramp.length) return ramp.slice();
  if (classes <= 1) return [ramp[ramp.length - 1]];
  return Array.from({ length: classes }, (_, i) => ramp[Math.round((i * (ramp.length - 1)) / (classes - 1))]);
}

export interface CountScale {
  breaks: number[];
  colors: string[];
  zero: string;
  color: (x: number) => string;
}

export function countScale(max: number, theme: Theme, lo = 1): CountScale {
  const breaks = logBreaks(max, lo);
  const colors = spreadRamp(HEAT[theme], breaks.length + 1);
  const zero = ZERO[theme];
  return {
    breaks,
    colors,
    zero,
    color: (x: number) => (x > 0 ? colors[binIndex(x, breaks)] : zero),
  };
}

export function zColor(z: number, theme: Theme): string {
  return Z_COLORS[theme][binIndex(z, Z_BREAKS)];
}

export function pctColor(p: number, theme: Theme): string {
  return PCT_COLORS[theme][binIndex(p, PCT_BREAKS)];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relLum(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Dark or light ink for text drawn on a fill, whichever has more contrast. */
export function inkOn(fill: string): string {
  const L = relLum(fill);
  const vsWhite = 1.05 / (L + 0.05);
  const vsInk = (L + 0.05) / (relLum(DARK_INK) + 0.05);
  return vsInk >= vsWhite ? DARK_INK : '#ffffff';
}
