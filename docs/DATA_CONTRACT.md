# Data contract: pipeline to web app

The pipeline (`pipeline/`, Python, runs on the Spark) writes a static bundle to `web/public/data/`.
The web app reads only this bundle, so it runs offline and deploys as static files.
All binary files are little-endian and gzip-compressed (`.bin.gz`); offsets refer to the decompressed
bytes. Readers check for the gzip magic bytes (0x1f 0x8b) and decompress only when present, since a host
may decompress in transit. Every typed array starts at a 4-byte-aligned offset.

## Conventions

- **Month index** `m`: 0 is `manifest.months.start` (e.g. `2000-11`), counting calendar months.
- **Grid**: regular lon/lat grid. Cell `(ix, iy)` covers lon `[lon0 + ix*res, lon0 + (ix+1)*res)`,
  lat `[lat0 + iy*res, lat0 + (iy+1)*res)`. Cell id = `iy * nx + ix`. Cell centre = lower-left + res/2.
- **Series** (one value per active cell per month):
  - `harmonized` (float32): estimated count of hotspots a single S-NPP-class VIIRS observer would have
    detected. Observed VIIRS where VIIRS exists, a model estimate from MODIS before it.
  - `modis_terra`, `modis_aqua`, `viirs_snpp`, `viirs_noaa20` (uint16): raw detection counts after the
    analysis filter (vegetation-fire type, confidence nominal or high). These are what each sensor saw.
- A region's value for a month is the sum over active cells whose centre lies inside the region.

## `manifest.json`

```jsonc
{
  "version": 1,
  "generated": "2026-11-15T03:00:00Z",
  "country": "Argentina",
  "bbox": [-73.6, -55.1, -53.6, -21.8],            // lon_min, lat_min, lon_max, lat_max
  "grid": { "res": 0.1, "lon0": -74.0, "lat0": -55.2, "nx": 210, "ny": 340 },
  "months": { "start": "2000-11", "n": 302, "labels": ["2000-11", "..."] },
  "series": [
    { "id": "harmonized",   "label": "Harmonized (VIIRS-equivalent)", "dtype": "float32" },
    { "id": "modis_terra",  "label": "MODIS Terra",  "dtype": "uint16", "first": "2000-11", "last": "2025-12" },
    { "id": "modis_aqua",   "label": "MODIS Aqua",   "dtype": "uint16", "first": "2002-07", "last": "2025-12" },
    { "id": "viirs_snpp",   "label": "VIIRS S-NPP",  "dtype": "uint16", "first": "2012-01", "last": "2025-12" },
    { "id": "viirs_noaa20", "label": "VIIRS NOAA-20","dtype": "uint16", "first": "2018-01", "last": "2025-12" }
  ],
  // Fraction of days in each month on which the sensor delivered data over the country (0..1).
  // 0 means "not observed", which the calendar must show differently from "observed, no fires".
  "availability": { "modis_terra": [/* n */], "modis_aqua": [], "viirs_snpp": [], "viirs_noaa20": [] },
  // Where each month's harmonized value comes from, one code per month:
  // "model_terra" (MODIS Terra only, before Aqua), "model" (MODIS Terra+Aqua),
  // "viirs" (S-NPP observed), "viirs_fill" (S-NPP gaps filled from NOAA-20), "none" (no data).
  "month_source": [/* n strings */],
  // Uncertainty of model months, measured on held-out years. For a region whose model-month
  // estimate is x, the 80% interval is [max(0, (x+0.5)*exp(-z*s) - 0.5), (x+0.5)*exp(z*s) - 0.5]
  // with z = 1.2816, where s is interpolated linearly in log10(x) from these points (clamped to the
  // end values outside them). Observed months have s = 0. The +0.5 offset matches how the errors were
  // measured and lets the interval include zero for small regions.
  "uncertainty": { "z80": 1.2816, "points": [[1, 0.9], [10, 0.6], [100, 0.35], [1000, 0.2], [10000, 0.12]] },
  "provinces": [ { "id": 0, "name": "Buenos Aires" } ],   // index used by cell_province; 255 = none
  "presets": [
    { "id": "country", "name": "All of Argentina", "kind": "all" },
    { "id": "delta", "name": "Paraná Delta", "kind": "bbox", "bbox": [-60.9, -34.4, -58.4, -32.0] },
    { "id": "corrientes", "name": "Corrientes", "kind": "province", "province": 5 }
  ],
  "baseline": { "first_year": 2001, "last_year": 2025 },  // years used for medians and anomalies
  "table": {
    "file": "table.bin.gz", "n_cells": 0, "n_entries": 0,
    "arrays": [
      { "name": "cell_id",       "dtype": "uint32",  "offset": 0, "length": 0 },  // n_cells, sorted
      { "name": "cell_province", "dtype": "uint8",   "offset": 0, "length": 0 },  // n_cells
      { "name": "cell_start",    "dtype": "uint32",  "offset": 0, "length": 0 },  // n_cells + 1 (CSR)
      { "name": "month",         "dtype": "uint16",  "offset": 0, "length": 0 },  // n_entries
      { "name": "harmonized",    "dtype": "float32", "offset": 0, "length": 0 },  // n_entries
      { "name": "modis_terra",   "dtype": "uint16",  "offset": 0, "length": 0 },
      { "name": "modis_aqua",    "dtype": "uint16",  "offset": 0, "length": 0 },
      { "name": "viirs_snpp",    "dtype": "uint16",  "offset": 0, "length": 0 },
      { "name": "viirs_noaa20",  "dtype": "uint16",  "offset": 0, "length": 0 }
    ]
  },
  "points": {                     // raw detections, one file per year, loaded on demand
    "years": [2000, 2025], "file_pattern": "points/{year}.bin.gz", "index": "points/index.json"
  },
  "boundaries": "provinces.geojson",
  "validation": "validation.json",
  "sources": [ { "name": "NASA FIRMS MODIS C6.1 (MCD14ML)", "doi": "10.5067/FIRMS/MODIS/MCD14ML", "url": "..." } ]
}
```

Entries for cell `i` are `cell_start[i] .. cell_start[i+1]-1`, sorted by month. A cell-month that is
absent is zero for every series.

## `points/{year}.bin.gz` and `points/index.json`

Every vegetation-type detection in the country for that year, all sensors, all confidences (so the CSV
download is complete; `used` marks the rows that enter the harmonized counts).
`index.json` maps year to `{ "n": rows, "bytes": size, "arrays": [ {name, dtype, offset, length} ] }`.

| array | dtype | meaning |
|---|---|---|
| `lon`, `lat` | float32 | degrees |
| `day` | uint16 | day of year, 1-based |
| `hhmm` | uint16 | acquisition time UTC, e.g. 1342 |
| `sensor` | uint8 | 0 MODIS Terra, 1 MODIS Aqua, 2 VIIRS S-NPP, 3 VIIRS NOAA-20, 4 VIIRS NOAA-21 |
| `conf` | uint8 | MODIS 0-100; VIIRS 1 low, 2 nominal, 3 high |
| `frp` | float32 | fire radiative power, MW |
| `bright` | float32 | brightness temperature, K (MODIS band 21/22, VIIRS I4) |
| `flags` | uint8 | bit0 night, bit1 used in harmonized counts |
| `version` | uint8 | index into `index.json` `versions` (e.g. "6.1", "6.1NRT", "2.0", "2.0NRT") |

## `provinces.geojson`

Simplified first-level boundaries (Natural Earth, public domain), `properties.id` matching
`manifest.provinces[].id`, `properties.name`.

## `validation.json`

Results of the held-out evaluation, rendered on the Methods page. Shape:

```jsonc
{
  "protocol": [ "plain-language paragraphs describing the tests" ],
  "methods": [ { "id": "naive", "label": "No harmonization", "description": "..." } ],
  "tests": [ { "id": "loyo", "label": "Leave one year out, 2012-2021", "description": "..." } ],
  "metrics": [
    { "method": "naive", "test": "loyo", "level": "province-month",
      "log_rmse": 0.0, "bias_pct": 0.0, "spearman": 0.0, "anomaly_agreement": 0.0, "n": 0 }
  ],
  "metric_defs": { "log_rmse": "...", "bias_pct": "...", "spearman": "...", "anomaly_agreement": "..." },
  "chosen_method": "gbm",
  "national_series": {           // monthly national totals over the overlap years
    "months": ["2012-01", "..."], "viirs_snpp": [], "modis_terra": [], "modis_aqua": [],
    "predicted": { "ratio": [], "gbm": [] }    // held-out predictions of S-NPP from MODIS
  },
  "annual_national": { "years": [2001, "..."], "naive_merge": [], "modis_only": [], "harmonized": [],
                       "harmonized_lo": [], "harmonized_hi": [], "viirs_snpp": [] },
  "ratio_by_year": { "years": [], "viirs_per_modis": [] },
  "ratio_by_province": [ { "province": 0, "name": "...", "viirs_per_modis": 0.0, "n_modis": 0 } ]
}
```

Render the parts that exist and skip the rest; fields may be added.

## `terrain/argentina.bin.gz` and `terrain/terrain.json`

Elevation for the 3D view, written by `python -m focos.terrain` to `web/public/terrain/`. The two files are
small (about 230 KB and 2 KB) and are committed, unlike the bundle in `web/public/data/`. The script caches
its tiles under `data/cache/terrain`, so reruns work offline and give byte-identical files.

- `argentina.bin.gz`: gzip of `nx * ny` int16 little-endian values in metres, row-major, `ny` rows of `nx`.
  **Row 0 is the north edge** and column 0 the west edge, so the value for column `i`, row `j` is at index
  `j * nx + i`. Rows run north to south here, the opposite of the hotspot grid above.
- Column `i` covers lon `[lon0 + i*step, lon0 + (i+1)*step)`; row `j` covers lat
  `[lat_north - (j+1)*step, lat_north - j*step)`, where `lat_north = lat0 + ny*step` (-21.7).
- Each value is the **mean** height of the land part of the cell: the source pixels (about 9 x 10 per cell in
  the north, 9 x 16 in the south) whose centres fall inside the cell, excluding sea pixels.
- **Water** (the `water` field): 0 = sea-connected water (ocean, Rio de la Plata, fjords); inland lakes keep
  their surface elevation; land below sea level is negative; land that rounds to 0 is stored as 1. The UI can
  therefore colour every 0 cell as sea.
- **0 means sea**: the ocean, the Río de la Plata and the Chilean fjords. A cell is sea when under half of its
  pixels are land. Land is never stored as 0 (a land mean that rounds to 0 is stored as 1), so `value == 0`
  is a sea mask.
- **Negative values are land below sea level**: the Gran Bajo de San Julián (down to -99 m at this
  resolution), the Bajo del Gualicho, and salinas near Bahía Blanca and on Península Valdés.
- Inland lakes (Nahuel Huapi, Lago Argentino, Mar Chiquita) carry their flat surface height from the source.
- Before averaging, isolated source pixels more than 1500 m from the median of their 5 x 5 neighbourhood are
  replaced by that median (51 pixels at zoom 8). These are tile artifacts, such as an 8752 m spike on Isla
  Santa Inés and a hole in the Puna; no real slope rises 1500 m within two pixels.
- `-32768` means no data. The current source covers the whole grid, so it does not occur.

```jsonc
{
  "lon0": -73.6, "lat0": -55.0, "step": 0.05, "nx": 400, "ny": 666,   // west and south edges
  "units": "m", "rows": "north-to-south", "value": "mean",
  "water": "0 = sea-connected water (ocean, Rio de la Plata, fjords); inland lakes keep their surface elevation; land below sea level is negative; land that rounds to 0 is stored as 1",
  "source": "...",      // tileset, zoom, and the source datasets present in the tiles used
  "licence": "...",     // attribution required by the tile provider
  "citation": "...",    // tileset and dataset references (SRTM, GMTED2010, ETOPO1)
  "dtype": "int16", "byte_order": "little", "nodata": -32768,
  "method": "...",      // how cells are averaged and how sea is found
  "source_tiles": { "etopo1": 292, "gmted": 354, "srtm": 329 }   // tiles listing each source
}
```

Source: the AWS Terrain Tiles (terrarium PNGs, zoom 8). At this zoom, land comes from NASA SRTM
(SRTMGL1 v3), water areas masked out of SRTM from GMTED2010, and the sea from ETOPO1 bathymetry. Each tile's
`x-amz-meta-x-imagery-sources` header lists its sources; the script builds the attribution from those headers
and stops if a source appears without a recorded attribution. Tile artifacts are removed first (above). Sea
pixels are those at or below 0 m that reach
the open sea across gaps of up to 4 pixels (narrow channels such as the mouth of the Strait of Magellan break
up in the tiles), or that lie in a closed basin deeper than -120 m, below any land in South America (Laguna
del Carbón, -105 m).

### Desktop grid: `terrain/argentina-hi.bin.gz` and `terrain/terrain-hi.json`

The same format, fields, water rule and `water` note at twice the resolution, for desktop. Keep the 0.05
degree grid for phones. Written by `python -m focos.terrain --hi` (equivalent to
`--step 0.025 --zoom 9 --suffix=-hi`); the plain `python -m focos.terrain` writes the 0.05 degree files above.
Both runs remove tile artifacts with the default `--despike 1500`.

- `step` 0.025, `nx` 800, `ny` 1332, with the same edges (`lon0` -73.6, `lat0` -55.0, `lat_north` -21.7).
  About 875 KB gzipped and 2.1 MB raw. Hi cell `(i, j)` lies inside cell `(i // 2, j // 2)` of the 0.05
  degree grid.
- Built from zoom 9 tiles, so each cell averages about 9 x 10 (north) to 9 x 16 (south) source pixels, the
  same density as the 0.05 degree grid gets from zoom 8. The sea bridge is 8 pixels at zoom 9, the same
  distance on the ground as 4 pixels at zoom 8.
- Water that is sea in the 0.05 degree grid's zoom 8 mask also counts as sea. Narrow fjord channels that
  break up at zoom 9 therefore stay connected, and the two grids share their coastline. Grouped 2 x 2, the hi
  grid's sea matches the 0.05 degree grid's in all but 507 of 266,400 cells. Over land, the 2 x 2 means differ
  from the 0.05 degree values by 7.7 m RMS.
- Tile artifacts are removed as in the 0.05 degree grid: 111 pixels at zoom 9, such as a 7349 m spike in the
  Chilean fjords near 53.9 S and a -856 m hole in the Puna.
- Values: -104 to 6489 m. The Aconcagua summit cell is 5986 m; the 30 cells above it are all on the
  Pissis and Ojos del Salado massif.
