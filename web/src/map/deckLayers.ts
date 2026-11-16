// deck.gl layers for 3D and the globe: one column per grid cell, rising from the terrain, drawn
// inside MapLibre's own render pass (interleaved) so the terrain hides what is behind a ridge and the
// reference labels stay on top.
import type { Layer } from '@deck.gl/core';
import { ColumnLayer, PathLayer } from '@deck.gl/layers';
import type { MapScale } from './scales.ts';

export interface ColumnFrame {
  /** per cell: longitude, latitude, terrain height in metres (exaggerated) */
  basePos: Float32Array;
  elevation: Float32Array;
  color: Uint8Array;
  /** bumps when elevation or colour arrays are rebuilt */
  version: number;
  extruded: boolean;
  /** column half-diagonal in metres */
  radius: number;
}

/**
 * Per-cell attributes for one frame. Cells with no value are transparent and flat, so the arrays keep
 * one entry per table cell and deck only re-uploads the two that change.
 */
export function columnFrame(
  values: Float32Array,
  inRegion: Uint8Array | null,
  scale: MapScale,
  heightOf: (v: number) => number,
  prev: ColumnFrame | null,
  basePos: Float32Array,
  extruded: boolean,
  radius: number,
): ColumnFrame {
  const n = values.length;
  const elevation = new Float32Array(n);
  const color = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const k = scale.classOf(v);
    if (k < 0) continue;
    const [r, g, b] = scale.rgba[k];
    const dim = inRegion && !inRegion[i];
    color[i * 4] = r;
    color[i * 4 + 1] = g;
    color[i * 4 + 2] = b;
    color[i * 4 + 3] = dim ? 70 : 255;
    elevation[i] = extruded ? heightOf(v) : 0;
  }
  return { basePos, elevation, color, version: (prev?.version ?? 0) + 1, extruded, radius };
}

export function columnLayers(c: ColumnFrame | null, beforeId: string): Layer[] {
  if (!c) return [];
  return [
    new ColumnLayer({
      id: 'columns',
      beforeId,
      data: {
        length: c.elevation.length,
        attributes: {
          getPosition: { value: c.basePos, size: 3 },
          getElevation: { value: c.elevation, size: 1 },
          getFillColor: { value: c.color, size: 4, normalized: true },
        },
      },
      diskResolution: 4,
      angle: 45,
      radius: c.radius,
      extruded: c.extruded,
      flatShading: true,
      material: { ambient: 0.62, diffuse: 0.55, shininess: 12, specularColor: [40, 40, 40] },
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 90],
      updateTriggers: { getElevation: c.version, getFillColor: c.version },
    } as never) as unknown as Layer,
  ];
}

export type Path3 = [number, number, number][];

/**
 * The selected area's outline, drawn over the columns (no depth test) so it stays readable however
 * tall the columns in front of it are. The draped outline on the terrain stays underneath.
 */
export function outlineLayers(paths: Path3[] | null, beforeId: string): Layer[] {
  if (!paths?.length) return [];
  const common = {
    data: paths,
    getPath: (d: Path3) => d,
    widthUnits: 'pixels' as const,
    jointRounded: true,
    capRounded: true,
    pickable: false,
    beforeId,
    parameters: { depthCompare: 'always' as const, depthWriteEnabled: false },
  };
  return [
    new PathLayer<Path3>({ ...common, id: 'outline-halo', getColor: [7, 23, 63, 200], getWidth: 6 } as never) as unknown as Layer,
    new PathLayer<Path3>({ ...common, id: 'outline', getColor: [255, 255, 255, 255], getWidth: 2.2 } as never) as unknown as Layer,
  ];
}
