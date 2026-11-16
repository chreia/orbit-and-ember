// Data colours are checked here, not by eye: perceptual order (OKLab lightness), separation under
// simulated protanopia and deuteranopia (Machado, Oliveira and Fernandes 2009, severity 1.0), and
// contrast with the Deep Blue surface. Distances are Euclidean in OKLab times 100.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DARK_SURFACE, HEAT, PCT_COLORS, SERIES_DARK, DETECTION_DARK, Z_COLORS, ZERO } from '../src/lib/color.ts';

const s2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin = (h: string) => [0, 2, 4].map((i) => s2lin(parseInt(h.replace('#', '').slice(i, i + 2), 16) / 255));
const MACHADO: Record<'protan' | 'deutan', number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};
type Vision = 'normal' | 'protan' | 'deutan';
function oklab(h: string, v: Vision = 'normal'): [number, number, number] {
  let [r, g, b] = lin(h);
  if (v !== 'normal') {
    const M = MACHADO[v];
    const c = (x: number) => Math.max(0, Math.min(1, x));
    [r, g, b] = [c(M[0][0] * r + M[0][1] * g + M[0][2] * b), c(M[1][0] * r + M[1][1] * g + M[1][2] * b), c(M[2][0] * r + M[2][1] * g + M[2][2] * b)];
  }
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const L = (h: string) => oklab(h)[0];
const chroma = (h: string) => Math.hypot(oklab(h)[1], oklab(h)[2]);
const dE = (a: string, b: string, v: Vision) => {
  const A = oklab(a, v);
  const B = oklab(b, v);
  return 100 * Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};
const minDE = (a: string, b: string) => Math.min(dE(a, b, 'normal'), dE(a, b, 'protan'), dE(a, b, 'deutan'));
const relLum = (h: string) => {
  const [r, g, b] = lin(h);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('count ramp: brighter means more, steps visible under colour-vision deficiency, low end clears the surface', () => {
  const ramp = HEAT.dark;
  for (let i = 1; i < ramp.length; i++) {
    assert.ok(L(ramp[i]) - L(ramp[i - 1]) >= 0.06, `lightness step ${ramp[i - 1]} -> ${ramp[i]}`);
    assert.ok(minDE(ramp[i - 1], ramp[i]) >= 6, `adjacent ${ramp[i - 1]} / ${ramp[i]} ${minDE(ramp[i - 1], ramp[i]).toFixed(1)}`);
  }
  assert.ok(contrast(ramp[0], DARK_SURFACE) >= 2, 'darkest step against the surface');
  assert.ok(minDE(ramp[0], ZERO.dark) >= 8, 'lowest class against observed-zero');
  assert.ok(minDE(ZERO.dark, DARK_SURFACE) >= 6, 'observed-zero against the surface');
});

test('diverging ramps: grey middle, both arms brighten outward, sides and steps tell apart', () => {
  for (const [name, ramp] of [['anomaly', Z_COLORS.dark], ['percent of median', PCT_COLORS.dark]] as const) {
    const mid = (ramp.length - 1) / 2;
    assert.ok(chroma(ramp[mid]) < 0.03, `${name}: neutral middle`);
    for (let k = 1; k <= mid; k++) {
      assert.ok(L(ramp[mid - k]) > L(ramp[mid - k + 1]), `${name}: cool arm brightens outward at ${k}`);
      assert.ok(L(ramp[mid + k]) > L(ramp[mid + k - 1]), `${name}: warm arm brightens outward at ${k}`);
      assert.ok(minDE(ramp[mid - k], ramp[mid + k]) >= 15, `${name}: sides differ at step ${k}`);
    }
    for (let i = 1; i < ramp.length; i++) {
      assert.ok(minDE(ramp[i - 1], ramp[i]) >= 8, `${name}: adjacent ${ramp[i - 1]} / ${ramp[i]} ${minDE(ramp[i - 1], ramp[i]).toFixed(1)}`);
    }
    assert.ok(minDE(ramp[mid], DARK_SURFACE) >= 12, `${name}: middle against the surface`);
    assert.ok(minDE(ramp[mid], ZERO.dark) >= 8, `${name}: middle against no-baseline grey`);
  }
});

test('line and point colours: every pair separable, every line readable on the surface', () => {
  const lines = Object.values(SERIES_DARK);
  for (let i = 0; i < lines.length; i++) {
    assert.ok(contrast(lines[i], DARK_SURFACE) >= 3, `${lines[i]} against the surface`);
    for (let j = i + 1; j < lines.length; j++) {
      assert.ok(Math.min(dE(lines[i], lines[j], 'protan'), dE(lines[i], lines[j], 'deutan')) >= 8, `${lines[i]} / ${lines[j]}`);
      assert.ok(dE(lines[i], lines[j], 'normal') >= 15, `${lines[i]} / ${lines[j]} normal vision`);
    }
  }
  assert.ok(minDE(DETECTION_DARK.modis, DETECTION_DARK.viirs) >= 15);
  for (const c of Object.values(DETECTION_DARK)) assert.ok(contrast(c, DARK_SURFACE) >= 3);
});
