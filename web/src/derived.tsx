// Region series and baselines, computed once per area and record and shared by the panel, the
// scrubber, the map readout and the drawers. None of it depends on the selected period, so playing
// through the record does not recompute it.
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { SensorId } from './bundle/types.ts';
import { SENSORS } from './bundle/types.ts';
import { indexOf, monthOf, yearOf } from './lib/months.ts';
import type { Baseline, FireSeason, Observability } from './lib/analytics.ts';
import { computeBaseline, fireSeason, latestMonth, observability, recordMonths } from './lib/analytics.ts';
import type { RegionSeries } from './lib/series.ts';
import { aggregate, intervals, pick } from './lib/series.ts';
import { selectCells } from './lib/region.ts';
import type { CountScale } from './lib/color.ts';
import type { Range } from './lib/timeline.ts';
import { seriesScale } from './components/Calendar.tsx';
import { useI18n } from './i18n.tsx';
import { regionLabel, useModel } from './model.ts';
import { useUi } from './store.ts';

export interface PeriodPreset {
  key: 'last12' | 'year' | 'season' | 'all';
  range: Range | null;
}

export interface Derived {
  cells: Uint32Array;
  rs: RegionSeries;
  harmObs: Observability;
  harmBase: Baseline;
  harmBand: { lo: Float64Array; hi: Float64Array };
  viewValues: Float64Array;
  viewObs: Observability;
  viewBase: Baseline;
  viewRecords: Set<number>;
  rawObs: Record<SensorId, Observability>;
  latest: { m: number; partialM: number | null } | null;
  season: FireSeason | null;
  presets: PeriodPreset[];
  calScale: CountScale;
  name: string;
}

const DerivedContext = createContext<Derived | null>(null);

export function useDerived(): Derived {
  const d = useContext(DerivedContext);
  if (!d) throw new Error('useDerived outside DerivedProvider');
  return d;
}

export function DerivedProvider({ children }: { children: ReactNode }) {
  const model = useModel();
  const i18n = useI18n();
  const { manifest, axis, table } = model;
  const region = useUi((s) => s.region);
  const series = useUi((s) => s.series);

  const cells = useMemo(() => selectCells(region, table, manifest.grid), [region, table, manifest.grid]);
  const rs = useMemo(() => aggregate(table, cells, axis.n), [table, cells, axis.n]);
  const harmObs = useMemo(() => observability(manifest, axis, 'harmonized'), [manifest, axis]);
  const { first_year: first, last_year: last } = manifest.baseline;
  const harmBase = useMemo(() => computeBaseline(rs.harmonized, axis, harmObs, first, last), [rs, axis, harmObs, first, last]);
  const harmBand = useMemo(() => intervals(rs.harmonized, manifest), [rs, manifest]);
  const viewValues = pick(rs, series);
  const viewObs = useMemo(() => (series === 'harmonized' ? harmObs : observability(manifest, axis, series)), [series, harmObs, manifest, axis]);
  const viewBase = useMemo(
    () => (series === 'harmonized' ? harmBase : computeBaseline(viewValues, axis, viewObs, first, last)),
    [series, harmBase, viewValues, axis, viewObs, first, last],
  );
  const viewRecords = useMemo(() => recordMonths(viewValues, axis, viewObs), [viewValues, axis, viewObs]);
  const rawObs = useMemo(() => {
    const o = {} as Record<SensorId, Observability>;
    for (const s of SENSORS) o[s] = observability(manifest, axis, s);
    return o;
  }, [manifest, axis]);
  const latest = useMemo(() => latestMonth(axis, harmObs), [axis, harmObs]);
  const season = useMemo(() => fireSeason(harmBase), [harmBase]);

  const presets = useMemo<PeriodPreset[]>(() => {
    const lc = latest?.m ?? axis.n - 1;
    const lastDecYear = monthOf(axis, lc) === 12 ? yearOf(axis, lc) : yearOf(axis, lc) - 1;
    const yr: Range = [indexOf(axis, lastDecYear, 1), indexOf(axis, lastDecYear, 12)];
    let seasonRange: Range | null = null;
    if (season && season.length < 12) {
      for (let m = lc - season.length + 1; m >= 0; m--) {
        if (monthOf(axis, m) === season.start) {
          seasonRange = [m, m + season.length - 1];
          break;
        }
      }
    }
    return [
      { key: 'last12', range: [Math.max(0, lc - 11), lc] },
      { key: 'year', range: yr[0] >= 0 ? yr : null },
      { key: 'season', range: seasonRange },
      { key: 'all', range: [0, axis.n - 1] },
    ];
  }, [latest, axis, season]);

  // One count scale per region, from its harmonized months, shared by every series shown.
  const calScale = useMemo(() => seriesScale(rs.harmonized, harmObs, 'dark'), [rs, harmObs]);
  const name = regionLabel(region, i18n, manifest);

  const value = useMemo<Derived>(
    () => ({ cells, rs, harmObs, harmBase, harmBand, viewValues, viewObs, viewBase, viewRecords, rawObs, latest, season, presets, calScale, name }),
    [cells, rs, harmObs, harmBase, harmBand, viewValues, viewObs, viewBase, viewRecords, rawObs, latest, season, presets, calScale, name],
  );
  return <DerivedContext.Provider value={value}>{children}</DerivedContext.Provider>;
}
