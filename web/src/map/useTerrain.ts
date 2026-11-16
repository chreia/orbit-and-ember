// Loads the elevation grid that seats the columns on the terrain: the 0.025 degree grid on wide
// screens, the 0.05 degree grid on phones and on connections that ask to save data, falling back from
// the sharp grid to the light one. Absent files are normal (columns then stand at sea level); a file
// that is present but malformed is reported once in the console and also treated as absent.
import { useEffect, useState } from 'react';
import { gunzipIfNeeded } from '../bundle/gunzip.ts';
import type { Terrain } from '../lib/terrain.ts';
import { checkMeta, parseTerrain } from '../lib/terrain.ts';

const BASE = (import.meta.env.BASE_URL ?? './').replace(/\/+$/, '');
let cache: Promise<Terrain | null> | null = null;

async function loadGrid(json: string, bin: string): Promise<Terrain | null> {
  const res = await fetch(`${BASE}/terrain/${json}`, { cache: 'no-cache' });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trimStart().startsWith('{')) return null; // dev servers answer missing files with index.html
  const meta = checkMeta(JSON.parse(text));
  const data = await fetch(`${BASE}/terrain/${bin}`);
  if (!data.ok) return null;
  return parseTerrain(await gunzipIfNeeded(await data.arrayBuffer()), meta);
}

function wantsSharp(): boolean {
  if (typeof window === 'undefined') return false;
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  return !saveData && window.matchMedia?.('(min-width: 901px)').matches === true;
}

/** The grid for this screen, loaded once per page. */
export function terrainGrid(): Promise<Terrain | null> {
  if (!cache) {
    cache = (async () => {
      if (wantsSharp()) {
        const hi = await loadGrid('terrain-hi.json', 'argentina-hi.bin.gz').catch(() => null);
        if (hi) return hi;
      }
      return loadGrid('terrain.json', 'argentina.bin.gz');
    })().catch((e: unknown) => {
      console.warn('[focos] terrain grid unavailable, columns stand at sea level:', e instanceof Error ? e.message : e);
      return null;
    });
  }
  return cache;
}

export function useTerrain(enabled: boolean): Terrain | null {
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  useEffect(() => {
    if (!enabled || terrain) return;
    let alive = true;
    terrainGrid().then((t) => {
      if (alive && t) setTerrain(t);
    });
    return () => {
      alive = false;
    };
  }, [enabled, terrain]);
  return terrain;
}
