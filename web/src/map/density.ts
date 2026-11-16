// The flat map's data layer: one pixel per grid cell, rows spaced evenly in Web Mercator so the
// image lines up with the basemap when MapLibre stretches it over the grid's corners.
import type { Manifest } from '../bundle/types.ts';
import type { Table } from '../bundle/table.ts';
import type { MapScale } from './scales.ts';

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

/** Cells outside the selected area are drawn faint so the area stands out against its context. */
export function densityImage(values: Float32Array, inRegion: Uint8Array | null, table: Table, grid: Manifest['grid'], scale: MapScale): string {
  const W = grid.nx;
  const H = grid.ny * 4;
  const yTop = mercY(grid.lat0 + grid.ny * grid.res);
  const yBot = mercY(grid.lat0);
  const rowIy = new Int32Array(H);
  for (let r = 0; r < H; r++) {
    const lat = invMercY(yTop - ((r + 0.5) * (yTop - yBot)) / H);
    // image row 0 is the north edge; grid row iy counts from the south
    rowIy[r] = Math.min(grid.ny - 1, Math.max(0, Math.floor((lat - grid.lat0) / grid.res)));
  }
  const pack = (a: number) => scale.rgba.map(([r, g, b]) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0);
  const full = pack(255);
  const faint = pack(80);
  const cells = new Uint32Array(grid.nx * grid.ny); // little-endian ABGR
  for (let i = 0; i < table.nCells; i++) {
    const k = scale.classOf(values[i]);
    if (k >= 0) cells[table.cellId[i]] = (inRegion && !inRegion[i] ? faint : full)[k];
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.toDataURL();
  const img = ctx.createImageData(W, H);
  const out = new Uint32Array(img.data.buffer);
  for (let r = 0; r < H; r++) {
    const src = rowIy[r] * grid.nx;
    out.set(cells.subarray(src, src + W), r * W);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export function imageCoords(grid: Manifest['grid']): [[number, number], [number, number], [number, number], [number, number]] {
  const w = grid.lon0;
  const e = grid.lon0 + grid.nx * grid.res;
  const s = grid.lat0;
  const n = grid.lat0 + grid.ny * grid.res;
  return [[w, n], [e, n], [e, s], [w, s]];
}
