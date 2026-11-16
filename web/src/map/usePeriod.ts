// The months the map is showing, shared by the map, its legend and the hover readout.
import { useMemo } from 'react';
import { observedMonths } from '../lib/cells.ts';
import { isModelSource } from '../lib/series.ts';
import { useDerived } from '../derived.tsx';
import { useModel } from '../model.ts';
import { useUi } from '../store.ts';
import { seriesMedians, seriesRange } from './cache.ts';

export interface MapPeriod {
  m0: number;
  m1: number;
  /** months in the period the selected record observed */
  months: number[];
  length: number;
  /** model months in the period (harmonized record only) */
  modelMonths: number;
}

export function useMapPeriod(): MapPeriod {
  const { manifest } = useModel();
  const { viewObs } = useDerived();
  const range = useUi((s) => s.range);
  const series = useUi((s) => s.series);
  return useMemo(() => {
    const [m0, m1] = range;
    const months = observedMonths(viewObs, m0, m1);
    let modelMonths = 0;
    if (series === 'harmonized') for (const m of months) if (isModelSource(manifest.month_source[m])) modelMonths++;
    return { m0, m1, months, length: m1 - m0 + 1, modelMonths };
  }, [range, viewObs, series, manifest]);
}

/** Fixed per-cell scale ends for the selected record. */
export function useSeriesRange(): { lo: number; hi: number } {
  const { table } = useModel();
  const series = useUi((s) => s.series);
  return useMemo(() => seriesRange(table, series), [table, series]);
}

/** Per-cell medians for the selected record, only when the difference map needs them. */
export function useSeriesMedians(enabled: boolean): Float32Array | null {
  const { table, axis, manifest } = useModel();
  const { viewObs } = useDerived();
  const series = useUi((s) => s.series);
  return useMemo(
    () => (enabled ? seriesMedians(table, series, axis, viewObs, manifest.baseline.first_year, manifest.baseline.last_year) : null),
    [enabled, table, series, axis, viewObs, manifest],
  );
}
