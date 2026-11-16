// Elevation grids (public/terrain/argentina.bin.gz at 0.05 degrees, argentina-hi.bin.gz at 0.025,
// each described by its json): int16 little-endian metres, row-major, row 0 = north edge, column 0 =
// west edge, -32768 = nodata, 0 = sea-connected water (land that rounds to 0 is stored as 1). They
// seat the hotspot columns on the terrain and stand in for the online terrain tiles when those
// cannot be reached.

export interface TerrainMeta {
  /** west edge, degrees */
  lon0: number;
  /** south edge, degrees */
  lat0: number;
  /** cell size, degrees */
  step: number;
  nx: number;
  ny: number;
  source?: string;
  licence?: string;
  citation?: string;
}

export interface Terrain {
  meta: TerrainMeta;
  z: Int16Array;
  min: number;
  max: number;
}

export const NODATA = -32768;
/** Sea-connected water in the grid. */
export const SEA = 0;

export function checkMeta(m: unknown): TerrainMeta {
  const o = m as Record<string, unknown>;
  const num = (k: string) => {
    const v = o?.[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`terrain.json: "${k}" must be a number`);
    return v;
  };
  const meta: TerrainMeta = { lon0: num('lon0'), lat0: num('lat0'), step: num('step'), nx: num('nx'), ny: num('ny') };
  if (!(meta.step > 0) || meta.nx < 2 || meta.ny < 2 || !Number.isInteger(meta.nx) || !Number.isInteger(meta.ny)) {
    throw new Error('terrain.json: step, nx or ny out of range');
  }
  for (const k of ['source', 'licence', 'citation'] as const) if (typeof o[k] === 'string') meta[k] = o[k] as string;
  return meta;
}

/** Read the decompressed grid; the byte count must match nx * ny int16 values. */
export function parseTerrain(buf: ArrayBuffer, meta: TerrainMeta): Terrain {
  const n = meta.nx * meta.ny;
  if (buf.byteLength !== n * 2) throw new Error(`terrain grid is ${buf.byteLength} bytes; ${meta.nx} x ${meta.ny} int16 needs ${n * 2}`);
  const dv = new DataView(buf);
  const z = new Int16Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = dv.getInt16(i * 2, true);
    z[i] = v;
    if (v === NODATA || v === SEA) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 0;
  }
  return { meta, z, min, max };
}

/** Elevation in metres at a point (nearest cell; 0 at sea), or null outside the grid or on nodata. */
export function elevationAt(t: Terrain, lon: number, lat: number): number | null {
  const { lon0, lat0, step, nx, ny } = t.meta;
  const ix = Math.floor((lon - lon0) / step);
  const iyFromSouth = Math.floor((lat - lat0) / step);
  if (ix < 0 || ix >= nx || iyFromSouth < 0 || iyFromSouth >= ny) return null;
  const row = ny - 1 - iyFromSouth;
  const v = t.z[row * nx + ix];
  return v === NODATA ? null : v;
}

/**
 * Elevation in metres at a point, interpolated between the four nearest cell centres. Sea (0) and
 * nodata count as 0; outside the grid the answer is 0. This seats the columns on the same surface the
 * map's terrain draws.
 */
export function elevationBilinear(t: Terrain, lon: number, lat: number): number {
  const { lon0, lat0, step, nx, ny } = t.meta;
  // continuous position in cell-centre units, column from the west, row from the north
  const fx = (lon - lon0) / step - 0.5;
  const fy = (lat0 + ny * step - lat) / step - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > nx - 0.5 || fy > ny - 0.5) return 0;
  const x0 = Math.max(0, Math.min(nx - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(ny - 1, Math.floor(fy)));
  const x1 = Math.min(nx - 1, x0 + 1);
  const y1 = Math.min(ny - 1, y0 + 1);
  const ax = Math.max(0, Math.min(1, fx - x0));
  const ay = Math.max(0, Math.min(1, fy - y0));
  const z = (x: number, y: number) => {
    const v = t.z[y * nx + x];
    return v === NODATA ? 0 : v;
  };
  const top = z(x0, y0) * (1 - ax) + z(x1, y0) * ax;
  const bottom = z(x0, y1) * (1 - ax) + z(x1, y1) * ax;
  return top * (1 - ay) + bottom * ay;
}

/**
 * One Web Mercator tile of the grid in Terrarium encoding (RGBA, height = R*256 + G + B/256 - 32768),
 * for when the online terrain tiles cannot be reached. Outside the grid the tile is sea level.
 */
export function terrariumTile(t: Terrain, z: number, x: number, y: number, size = 256): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const n = 2 ** z;
  for (let py = 0; py < size; py++) {
    const my = (y + (py + 0.5) / size) / n;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
    for (let px = 0; px < size; px++) {
      const lon = ((x + (px + 0.5) / size) / n) * 360 - 180;
      const v = Math.max(0, Math.min(65535.99, elevationBilinear(t, lon, lat) + 32768));
      const i = (py * size + px) * 4;
      const whole = Math.floor(v);
      out[i] = whole >> 8;
      out[i + 1] = whole & 255;
      out[i + 2] = Math.floor((v - whole) * 256);
      out[i + 3] = 255;
    }
  }
  return out;
}
