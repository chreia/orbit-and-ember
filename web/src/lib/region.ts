// Region definitions and cell membership. A cell belongs to a region when its centre lies inside it
// (provinces use the cell_province column, which the pipeline computed the same way).
import type { Manifest, Preset } from '../bundle/types.ts';
import type { Table } from '../bundle/table.ts';
import { findCell } from '../bundle/table.ts';

export type BBox = [number, number, number, number]; // west, south, east, north

export type Region =
  | { kind: 'all'; key: string; name: string }
  | { kind: 'province'; key: string; name: string; province: number }
  | { kind: 'bbox'; key: string; name: string; bbox: BBox }
  | { kind: 'circle'; key: string; name: string; center: [number, number]; radiusKm: number };

type Grid = Manifest['grid'];

const EARTH_KM = 6371.0088;
export const POINT_TOL = 1e-9;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function presetRegion(p: Preset, manifest: Manifest): Region {
  if (p.kind === 'all') return { kind: 'all', key: `preset:${p.id}`, name: p.name };
  if (p.kind === 'bbox') return { kind: 'bbox', key: `preset:${p.id}`, name: p.name, bbox: p.bbox };
  const prov = manifest.provinces.find((q) => q.id === p.province);
  return { kind: 'province', key: `preset:${p.id}`, name: p.name || prov?.name || `#${p.province}`, province: p.province };
}

export function provinceRegion(id: number, manifest: Manifest): Region {
  const prov = manifest.provinces.find((q) => q.id === id);
  return { kind: 'province', key: `prov:${id}`, name: prov?.name ?? `#${id}`, province: id };
}

export function bboxRegion(b: BBox, name: string): Region {
  const bbox: BBox = [r4(Math.min(b[0], b[2])), r4(Math.min(b[1], b[3])), r4(Math.max(b[0], b[2])), r4(Math.max(b[1], b[3]))];
  return { kind: 'bbox', key: `bbox:${bbox.join(',')}`, name, bbox };
}

export function circleRegion(lon: number, lat: number, radiusKm: number, name: string): Region {
  const c: [number, number] = [r4(lon), r4(lat)];
  const r = Math.round(radiusKm * 10) / 10;
  return { kind: 'circle', key: `circle:${c[0]},${c[1]},${r}`, name, center: c, radiusKm: r };
}

export function cellCentre(id: number, grid: Grid): [number, number] {
  const ix = id % grid.nx;
  const iy = Math.floor(id / grid.nx);
  return [grid.lon0 + (ix + 0.5) * grid.res, grid.lat0 + (iy + 0.5) * grid.res];
}

/**
 * Grid cell of a coordinate. For raw detections pass tol = POINT_TOL: the pipeline grids the float32
 * coordinates with floor((lon - lon0) / res + 1e-9) in float64, and a Float32Array value promoted to
 * a JS number is that same float64, so this expression reproduces its cells bit for bit.
 */
export function cellIdAt(lon: number, lat: number, grid: Grid, tol = 0): number {
  const ix = Math.floor((lon - grid.lon0) / grid.res + tol);
  const iy = Math.floor((lat - grid.lat0) / grid.res + tol);
  if (ix < 0 || iy < 0 || ix >= grid.nx || iy >= grid.ny) return -1;
  return iy * grid.nx + ix;
}

/** Geometric test on a cell centre (used for bbox and circle regions). */
function centreInside(region: Region, lon: number, lat: number): boolean {
  switch (region.kind) {
    case 'all':
      return true;
    case 'bbox': {
      const [w, s, e, n] = region.bbox;
      return lon >= w && lon <= e && lat >= s && lat <= n;
    }
    case 'circle':
      return haversineKm(region.center[0], region.center[1], lon, lat) <= region.radiusKm;
    case 'province':
      return false;
  }
}

/** Table indices of the active cells inside the region. */
export function selectCells(region: Region, table: Table, grid: Grid): Uint32Array {
  const out: number[] = [];
  for (let i = 0; i < table.nCells; i++) {
    if (region.kind === 'province') {
      if (table.cellProvince[i] === region.province) out.push(i);
      continue;
    }
    if (region.kind === 'all') {
      out.push(i);
      continue;
    }
    const [lon, lat] = cellCentre(table.cellId[i], grid);
    if (centreInside(region, lon, lat)) out.push(i);
  }
  return Uint32Array.from(out);
}

/**
 * Membership test for a raw detection, decided by its grid cell so that the detections
 * listed for a region are the ones its counts were built from.
 */
export function pointFilter(region: Region, table: Table, grid: Grid, cells: Uint32Array): (lon: number, lat: number) => boolean {
  const mask = new Uint8Array(table.nCells);
  for (let k = 0; k < cells.length; k++) mask[cells[k]] = 1;
  return (lon, lat) => {
    const id = cellIdAt(lon, lat, grid, POINT_TOL);
    if (id < 0) return region.kind === 'all';
    const i = findCell(table, id);
    if (i >= 0) return mask[i] === 1;
    if (region.kind === 'province') return false;
    const [cx, cy] = cellCentre(id, grid);
    return centreInside(region, cx, cy);
  };
}

/** Polygon ring approximating a geodesic circle. */
export function circleRing(lon: number, lat: number, radiusKm: number, steps = 96): [number, number][] {
  const ring: [number, number][] = [];
  const d = radiusKm / EARTH_KM;
  const lat1 = rad(lat);
  const lon1 = rad(lon);
  for (let i = 0; i <= steps; i++) {
    const brg = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([r4(deg(lon2)), r4(deg(lat2))]);
  }
  return ring;
}

export interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };
}
export interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

/** Outline geometry for the selected region (null for the whole country). */
export function regionOutline(region: Region, boundaries: GeoCollection | null): GeoFeature | null {
  switch (region.kind) {
    case 'all':
      return null;
    case 'province': {
      const f = boundaries?.features.find((g) => Number(g.properties.id) === region.province);
      return f ? { type: 'Feature', properties: {}, geometry: f.geometry } : null;
    }
    case 'bbox': {
      const [w, s, e, n] = region.bbox;
      return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } };
    }
    case 'circle':
      return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [circleRing(region.center[0], region.center[1], region.radiusKm)] },
      };
  }
}

function extend(b: BBox, coords: unknown): void {
  if (Array.isArray(coords) && typeof coords[0] === 'number') {
    const [x, y] = coords as number[];
    b[0] = Math.min(b[0], x);
    b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x);
    b[3] = Math.max(b[3], y);
  } else if (Array.isArray(coords)) {
    for (const c of coords) extend(b, c);
  }
}

export function geometryBBox(f: GeoFeature): BBox | null {
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  extend(b, f.geometry.coordinates);
  return Number.isFinite(b[0]) ? b : null;
}

/** Bounding box to frame the region on the map. */
export function regionBBox(region: Region, manifest: Manifest, boundaries: GeoCollection | null): BBox {
  if (region.kind === 'all') return manifest.bbox;
  if (region.kind === 'bbox') return region.bbox;
  if (region.kind === 'circle') {
    const dLat = deg(region.radiusKm / EARTH_KM);
    const dLon = dLat / Math.max(0.1, Math.cos(rad(region.center[1])));
    return [region.center[0] - dLon, region.center[1] - dLat, region.center[0] + dLon, region.center[1] + dLat];
  }
  const outline = regionOutline(region, boundaries);
  return (outline && geometryBBox(outline)) || manifest.bbox;
}
