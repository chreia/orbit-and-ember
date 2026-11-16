// The per-cell values the map shows for the selected record and period, their colour scale, and
// which cells lie inside the selected area. Shared by the WebGL map and the plain fallback map.
import { useMemo } from 'react';
import { cellExcess, cellMeans } from '../lib/cells.ts';
import { useModel } from '../model.ts';
import { useDerived } from '../derived.tsx';
import { useUi } from '../store.ts';
import { excessScale, hotspotScale } from './scales.ts';
import { useMapPeriod, useSeriesMedians, useSeriesRange } from './usePeriod.ts';

export function useCellValues() {
  const { table, axis } = useModel();
  const d = useDerived();
  const region = useUi((s) => s.region);
  const series = useUi((s) => s.series);
  const mapColor = useUi((s) => s.mapColor);
  const period = useMapPeriod();
  const sr = useSeriesRange();
  const medians = useSeriesMedians(mapColor === 'excess');
  const values = useMemo(() => {
    if (mapColor === 'excess' && medians) return cellExcess(table, series, axis, medians, period.months);
    return cellMeans(table, series, period.m0, period.m1, period.months.length);
  }, [mapColor, medians, table, series, axis, period]);
  const scale = useMemo(() => (mapColor === 'excess' ? excessScale(sr.hi) : hotspotScale(sr.lo, sr.hi)), [mapColor, sr]);
  const inRegion = useMemo(() => {
    if (region.kind === 'all') return null;
    const mask = new Uint8Array(table.nCells);
    for (let k = 0; k < d.cells.length; k++) mask[d.cells[k]] = 1;
    return mask;
  }, [region.kind, d.cells, table.nCells]);
  return { values, scale, inRegion, nothing: period.months.length === 0, mapColor, sr };
}
