// Offline terrain: when the online terrain tiles cannot be reached, the map's terrain and hillshade
// switch to tiles drawn from the bundled elevation grid (Argentina and its borders; sea level beyond).
import * as maplibregl from 'maplibre-gl';
import { terrariumTile } from '../lib/terrain.ts';
import { terrainGrid } from './useTerrain.ts';

export const LOCAL_DEM_TILES = 'focosdem://{z}/{x}/{y}';
let registered = false;

async function encodePng(rgba: Uint8ClampedArray, size: number): Promise<ArrayBuffer> {
  const data = new ImageData(new Uint8ClampedArray(rgba), size, size);
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(size, size);
    c.getContext('2d')!.putImageData(data, 0, 0);
    return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
  }
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.getContext('2d')!.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('PNG encoding failed'))), 'image/png'));
  return blob.arrayBuffer();
}

export function registerLocalDem(): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('focosdem', async (params) => {
    const m = /^focosdem:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`bad terrain tile url ${params.url}`);
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const size = 256;
    const grid = await terrainGrid();
    const rgba = grid ? terrariumTile(grid, z, x, y, size) : flat(size);
    return { data: await encodePng(rgba, size) };
  });
}

function flat(size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 128; // 32768 = sea level
    out[i + 3] = 255;
  }
  return out;
}
