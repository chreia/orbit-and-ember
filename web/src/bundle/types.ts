// Types for the static data bundle described in docs/DATA_CONTRACT.md.

export type SensorId = 'modis_terra' | 'modis_aqua' | 'viirs_snpp' | 'viirs_noaa20';
export type SeriesId = 'harmonized' | SensorId;
export const SENSORS: readonly SensorId[] = ['modis_terra', 'modis_aqua', 'viirs_snpp', 'viirs_noaa20'];

export type MonthSource = 'model_terra' | 'model' | 'viirs' | 'viirs_fill' | 'none';

export interface ArraySpec {
  name: string;
  dtype: 'uint8' | 'uint16' | 'uint32' | 'float32';
  offset: number;
  length: number;
}

export interface SeriesMeta {
  id: SeriesId;
  label: string;
  dtype: string;
  first?: string;
  last?: string;
}

/** name_es is optional: the Spanish interface uses it when present. */
export type Preset =
  | { id: string; name: string; name_es?: string; kind: 'all' }
  | { id: string; name: string; name_es?: string; kind: 'bbox'; bbox: [number, number, number, number] }
  | { id: string; name: string; name_es?: string; kind: 'province'; province: number };

export interface Source {
  name: string;
  doi?: string;
  url?: string;
}

export interface Manifest {
  version: number;
  generated: string;
  synthetic?: boolean;
  country: string;
  bbox: [number, number, number, number];
  grid: { res: number; lon0: number; lat0: number; nx: number; ny: number };
  months: { start: string; n: number; labels: string[]; last_complete?: string };
  series: SeriesMeta[];
  availability: Record<SensorId, number[]>;
  month_source: MonthSource[];
  uncertainty: { z80: number; points: [number, number][]; points_terra_only?: [number, number][] };
  harmonization?: { unit?: string; method?: string; train_years?: [number, number]; noaa20_per_snpp?: number };
  provinces: { id: number; name: string }[];
  presets: Preset[];
  baseline: { first_year: number; last_year: number };
  table: { file: string; n_cells: number; n_entries: number; arrays: ArraySpec[] };
  points: { years: [number, number]; file_pattern: string; index: string };
  boundaries: string;
  validation: string;
  sources: Source[];
}

export interface PointsYearInfo {
  n: number;
  bytes: number;
  arrays: ArraySpec[];
}

export interface PointsIndex {
  versions: string[];
  /** FIRMS satellite labels by sensor code, e.g. {"2": "N"} */
  sensors?: Record<string, string>;
  years: Record<string, PointsYearInfo>;
}

export interface Validation {
  synthetic?: boolean;
  protocol?: string[];
  protocol_es?: string[];
  methods?: { id: string; label: string; description?: string; label_es?: string; description_es?: string }[];
  tests?: { id: string; label: string; description?: string; label_es?: string; description_es?: string }[];
  metrics?: {
    method: string;
    test: string;
    level?: string;
    variant?: string;
    log_rmse?: number;
    bias_pct?: number;
    spearman?: number;
    anomaly_agreement?: number;
    n?: number;
    [k: string]: unknown;
  }[];
  metric_defs?: Record<string, string>;
  chosen_method?: string;
  national_series?: {
    months: string[];
    viirs_snpp?: number[];
    modis_terra?: number[];
    modis_aqua?: number[];
    predicted?: Record<string, number[]>;
  };
  annual_national?: {
    years: number[];
    naive_merge?: number[];
    modis_only?: number[];
    harmonized?: number[];
    harmonized_lo?: number[];
    harmonized_hi?: number[];
    viirs_snpp?: number[];
  };
  ratio_by_year?: { years: number[]; viirs_per_modis: number[] };
  ratio_by_province?: { province: number; name: string; viirs_per_modis: number; n_modis?: number }[];
  [k: string]: unknown;
}
