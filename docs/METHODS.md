# Methods

Orbit and Ember turns two satellite fire records that cannot be compared directly into one monthly record of
burning activity, then lets anyone ask what a place's fire history looks like and whether this month is
unusual. Every number quoted in the app and in `docs/results.md` is produced by the pipeline in
`pipeline/focos/` from public NASA FIRMS archives.

## 1. Data

NASA FIRMS yearly country archives for Argentina, standard-quality products, downloaded without a key
(`pipeline/download.sh`):

| Sensor | Satellite | Pixel | Archive in this build |
|---|---|---|---|
| MODIS Collection 6.1 | Terra | 1 km | Nov 2000 to Dec 2025 |
| MODIS Collection 6.1 | Aqua | 1 km | Jul 2002 to Dec 2025 |
| VIIRS 375 m, Collection 2 | S-NPP | 375 m | Jan 2012 to Dec 2025 |
| VIIRS 375 m, Collection 2 | NOAA-20 | 375 m | Apr 2018 to Dec 2025 |

Every detection keeps its sensor, acquisition date and time, confidence, fire radiative power,
brightness temperature, day or night flag and product version (`pipeline/focos/ingest.py`).

**What counts.** Only FIRMS type 0 (presumed vegetation fire) is kept; volcanoes, static land sources
such as gas flares and industry, and offshore detections are dropped. Counts use nominal and high
confidence only (MODIS confidence 30 or more; VIIRS "n" or "h"). Low-confidence VIIRS night detections
include noise from the South Atlantic Anomaly, which sits over this region; they stay in the downloadable
records with a flag but do not enter the counts.

## 2. When a sensor was looking

A month with no hotspots is only informative if the sensor was observing. A day is marked "not observed"
for a sensor when it reported nothing over the whole country while the other sensors' detections imply
it should have seen at least eight (`pipeline/focos/grid.py`). This finds the known outages, for example
S-NPP from 27 July to 10 August 2022 and several spells in 2024, Aqua in spring 2022, Terra in
December 2003. Counts are scaled to a full month by each sensor's observing fraction, and the calendar
shows unobserved months differently from months observed with no fires. Cloud cover is not modelled:
a cloudy month with fires under the clouds will read low for every sensor alike.

## 3. Common grid and unit

Detections are counted per 0.1 degree cell (about 11 by 9 km) per month. The harmonized unit is
**the number of hotspots a single VIIRS S-NPP observer would detect**: one sensor, so adding NOAA-20 in
2018 does not double the count; VIIRS, because it is the record that continues and the more detailed of
the two. S-NPP stopped delivering new data on 2 November 2026; NOAA-20 and NOAA-21 carry the same VIIRS
instrument, and NOAA-20 is cross-calibrated against S-NPP from their seven shared years, so the
harmonized record continues on them without a break.

## 4. Harmonization

**VIIRS era (2012 onward).** S-NPP counts are used as observed. Days when S-NPP was down but NOAA-20 was
up are filled with NOAA-20's count times the S-NPP to NOAA-20 ratio measured on days both observed
(NOAA-20 detects within about 1% of S-NPP). Days when no VIIRS observed are filled by the transfer model
below.

**MODIS era (to 2011).** The transfer model predicts, for every active cell and month, the count S-NPP
would have made from what MODIS recorded. It is learned from the overlap years 2012 to 2017, when both
sensors were on their nominal orbits and MODIS was processed with the same product version as the years
being reconstructed. The MODIS version and its static-source flagging change in 2018, and Terra and Aqua
began drifting from their orbits in 2022, so those years serve only as a check.

Four methods were compared on the same held-out tests (`pipeline/focos/harmonize.py`):

| Method | What it does |
|---|---|
| No harmonization | MODIS counts as they are: what a plain splice shows before 2012 |
| National ratio | one VIIRS-to-MODIS ratio for the country, times the MODIS count |
| Local ratio | a ratio for each cell, pulled toward its 1 degree block and then the national value when the cell has few detections |
| Transfer model | gradient-boosted trees (Tweedie loss) on the cell's MODIS counts, mean fire radiative power, share of small and night detections, counts in the surrounding 3 by 3 and 7 by 7 cells, month, position, the cell's long-run MODIS activity, and its past VIIRS-to-MODIS ratio and VIIRS-only background (computed out of fold) |

| Blend | the average of the transfer model and the local ratio, with equal weights fixed in advance |

The transfer model can predict hotspots in cells where MODIS saw nothing nearby, which is where VIIRS's
finer pixels add the most. Before Aqua (November 2000 to June 2002) a Terra-only variant of each method is
used and evaluated separately.

**Choosing the method.** The record uses the method with the lowest mean province-month log error over
the leave-one-year-out and backcast tests, the two tests that mimic reconstructing earlier years. The rule
is applied by the pipeline (`choose_method`), not by hand; `docs/results.md` reports every method on every
test, including the ones that did not win.

## 5. Evaluation

In the overlap years the true S-NPP count is known, so each method is scored by hiding VIIRS and
predicting it from MODIS alone, which is what it must do for 2000 to 2011:

- **Leave one year out**, 2012 to 2017: six folds.
- **Backcast**: train on 2015 to 2017, predict 2012 to 2014, the closest analogue to reconstructing the past.
- **Leave one region out**: train without one of Argentina's five macro-regions (Northwest, Northeast,
  Cuyo, Pampas, Patagonia) and predict it.
- **Forward**: train on 2012 to 2017, predict 2018 to 2021, across the MODIS version change.

Scores are computed at four scales (0.1 degree cells, 1 degree blocks, provinces, the country) by month:
log error, total bias, rank correlation, and three calendar checks: whether the shape of each year's
season matches, whether the peak month matches, and whether months fall in the same anomaly class.
Results: `docs/results.md`.

## 6. Uncertainty

Model months carry an 80% interval measured from the held-out predictions. Predictions from the leave-
one-year-out test are summed over regions of many sizes (0.1 to 8 degree blocks, provinces, the
country); the spread of log(actual / predicted) is tabulated against the predicted total, and the app
interpolates that table for whatever region is selected, so a small area gets a wide interval and a
province a narrow one. The interval's coverage is then checked on the backcast test. Annual intervals sum
the monthly bounds, which treats monthly errors as fully correlated and is deliberately conservative.

## 7. Calendar analytics

For a selected region the app sums the cells whose centre lies inside it, then computes, per calendar
month c over the baseline years 2001 to 2025:

- the median, and the interquartile range, of the harmonized count;
- the anomaly score z = (log(1 + x) - median_c) / max(1.4826 MAD_c, 0.3), with the median and median
  absolute deviation of log(1 + x); classes: far above normal (z of 2 or more), above (1 to 2), normal
  (-1 to 1), below (under -1). A month is only classed unusual if it also differs from that calendar
  month's median count by at least 5 hotspots, so a single hotspot in a place that usually has none
  does not read as an extreme month;
- the fire season: the shortest run of consecutive months, wrapping December to January, whose
  monthly medians add up to 80% of the sum of the twelve monthly medians;
- a "highest on record" mark on the strict maximum of each calendar month (complete months, at least 5
  hotspots). The log-scale z compresses extreme events in months that vary a lot from year to year (the
  Corrientes fires of February 2022 were 22 times the median and score z = 1.96), so the record mark
  keeps them visible.

The map's "difference from usual" layer applies the same idea to each 0.1 degree cell. For a selected
period it is the cell's harmonized total minus the sum of that cell's own calendar-month medians (over
complete, observed baseline years) for the same months, divided by the number of observed months: hotspots
per month above or below what that cell usually has at that time of year, on a diverging scale centred on
zero.

## 8. Scope

- Counts are FIRMS fire pixels per cell and month, the standard unit for comparing fire activity across sensors.
- The transfer model is learned in Argentina from the 2012 to 2017 overlap and applied with the relation of those years.
- Reconstructed months are expected values with an 80% interval measured on held-out years.
- The record covers November 2000 to December 2025; new months join as FIRMS publishes them.
