// Prints national annual totals and implied VIIRS-per-MODIS ratios: node scripts/national_totals.mjs public/data
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { parseTable } from '../src/bundle/table.ts';
import { makeAxis, yearOf, monthOf } from '../src/lib/months.ts';
import { aggregate } from '../src/lib/series.ts';

const dir = process.argv[2] ?? 'public/data';
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
let b = readFileSync(join(dir, manifest.table.file));
if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
const table = parseTable(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), manifest);
const axis = makeAxis(manifest.months.start, manifest.months.n, manifest.months.labels);
const all = Uint32Array.from({ length: table.nCells }, (_, i) => i);
const rs = aggregate(table, all, axis.n);
const rows = [];
for (let y = 2001; y <= 2025; y++) {
  let h = 0, t = 0, a = 0, s = 0, n = 0;
  const src = new Set();
  for (let m = 0; m < axis.n; m++) {
    if (yearOf(axis, m) !== y) continue;
    h += rs.harmonized[m]; t += rs.raw.modis_terra[m]; a += rs.raw.modis_aqua[m]; s += rs.raw.viirs_snpp[m]; n += rs.raw.viirs_noaa20[m];
    src.add(manifest.month_source[m]);
  }
  rows.push({ y, src: [...src].join('+'), harm: Math.round(h), terra: t, aqua: a, snpp: s, n20: n, harm_per_modis: +(h / (t + a)).toFixed(2), snpp_per_modis: s ? +(s / (t + a)).toFixed(2) : null, harm_per_terra: +(h / t).toFixed(2) });
}
console.table(rows);
// January check
const jan = [];
for (let m = 0; m < axis.n; m++) if (monthOf(axis, m) === 1 || monthOf(axis, m) === 12) jan.push({ month: axis.labels[m], src: manifest.month_source[m], harm: Math.round(rs.harmonized[m]), terra: rs.raw.modis_terra[m], aqua: rs.raw.modis_aqua[m], snpp: rs.raw.viirs_snpp[m], harm_per_terra: +(rs.harmonized[m] / rs.raw.modis_terra[m]).toFixed(2) });
console.table(jan.slice(0, 16));
