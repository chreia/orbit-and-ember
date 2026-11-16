// Parse table.bin (CSR layout: per active cell, a run of month entries).
import type { ArraySpec, Manifest, SensorId } from './types.ts';
import { SENSORS } from './types.ts';

export interface Table {
  nCells: number;
  nEntries: number;
  /** grid cell id (iy * nx + ix), sorted ascending */
  cellId: Uint32Array;
  /** index into manifest.provinces; 255 = none */
  cellProvince: Uint8Array;
  /** CSR offsets, length nCells + 1 */
  cellStart: Uint32Array;
  month: Uint16Array;
  harmonized: Float32Array;
  raw: Record<SensorId, Uint16Array>;
}

type Typed = Uint8Array | Uint16Array | Uint32Array | Float32Array;
const CTORS = { uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array, float32: Float32Array } as const;

export function viewArray(buf: ArrayBuffer, spec: ArraySpec): Typed {
  const Ctor = CTORS[spec.dtype];
  if (!Ctor) throw new Error(`Unknown dtype ${spec.dtype} for ${spec.name}`);
  const bytes = spec.length * Ctor.BYTES_PER_ELEMENT;
  if (spec.offset % Ctor.BYTES_PER_ELEMENT !== 0) throw new Error(`Array ${spec.name} is misaligned`);
  if (spec.offset + bytes > buf.byteLength) {
    throw new Error(`Array ${spec.name} runs past the end of the file (${spec.offset + bytes} > ${buf.byteLength})`);
  }
  return new Ctor(buf, spec.offset, spec.length);
}

export function parseTable(buf: ArrayBuffer, manifest: Manifest): Table {
  const specs = new Map(manifest.table.arrays.map((a) => [a.name, a]));
  const get = <T extends Typed>(name: string, dtype: ArraySpec['dtype']): T => {
    const spec = specs.get(name);
    if (!spec) throw new Error(`table.bin is missing array "${name}"`);
    if (spec.dtype !== dtype) throw new Error(`Array ${name} has dtype ${spec.dtype}, expected ${dtype}`);
    return viewArray(buf, spec) as T;
  };
  const cellId = get<Uint32Array>('cell_id', 'uint32');
  const cellProvince = get<Uint8Array>('cell_province', 'uint8');
  const cellStart = get<Uint32Array>('cell_start', 'uint32');
  const month = get<Uint16Array>('month', 'uint16');
  const harmonized = get<Float32Array>('harmonized', 'float32');
  const raw = {} as Record<SensorId, Uint16Array>;
  for (const s of SENSORS) raw[s] = get<Uint16Array>(s, 'uint16');

  const nCells = cellId.length;
  const nEntries = month.length;
  if (cellProvince.length !== nCells) throw new Error('cell_province length does not match cell_id');
  if (cellStart.length !== nCells + 1) throw new Error('cell_start must have n_cells + 1 entries');
  if (cellStart[nCells] !== nEntries) throw new Error('cell_start does not end at n_entries');
  if (harmonized.length !== nEntries) throw new Error('harmonized length does not match month');
  for (const s of SENSORS) if (raw[s].length !== nEntries) throw new Error(`${s} length does not match month`);
  return { nCells, nEntries, cellId, cellProvince, cellStart, month, harmonized, raw };
}

/** Table index of a grid cell id, or -1 if the cell is not active. */
export function findCell(table: Table, id: number): number {
  const a = table.cellId;
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = a[mid];
    if (v === id) return mid;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
