// Jamaican Patwa (jam) entries for the Methods and validation page. Each export parallels a
// dictionary in Methods.tsx and has the same keys as its English side. Spelling and term
// choices follow the glossary at the top of ../i18n.jam.ts.

/** jam side of TEXT. */
export const TEXT_JAM: Record<string, string> = {
  h_what: 'Wah di calendar show',
  p_what:
    'Each cell a di number a active-fire detection (hotspot) inna di region yuh pick, fi one month. Di value fi a region a di sum a di {res}° grid cell dem weh dem centre fall inside it. Month dem before di record start, or wen no sensor neva a observe, get hatch, so nobody mistake dem fi month widout fire.',
  h_data: 'Data',
  p_data:
    'NASA FIRMS archive fi {country}: MODIS Collection 6.1 pon Terra (from {terra}) an Aqua (from {aqua}), an VIIRS 375 m pon S-NPP (from {snpp}) an NOAA-20 (from {n20}). Only di presumed vegetation fire dem count (FIRMS type 0), at nominal or high confidence (MODIS 30 or more; VIIRS “n” or “h”). Low-confidence VIIRS night detection, weh include noise from di South Atlantic Anomaly ova dis region, stay inna di downloadable record dem wid a flag, but dem nuh go inna di count.',
  h_obs: 'Wen a sensor did a look',
  p_obs:
    'A day get mark as neva observe fi a sensor wen it report nutten ova di whole country, while di odda sensor dem detection mean seh it shoulda see at least eight. Di count dem scale to a full month by di fraction a day each sensor observe. Di calendar hatch month wid no observation, an show month weh observe but have no fire as zero. Wi nuh model cloud cover: a cloudy month read low fi every sensor di same way.',
  h_why: 'Why di raw record need harmonizing',
  p_why:
    'VIIRS see fire weh MODIS miss: di VIIRS 375 m pixel cover bout a seventh a di area a one 1 km MODIS pixel, so it detect small an cool fire, an it split big fire into more detection. If yuh add di sensor dem togedda as dem join di record, yuh get step dem weh nuh have nutten fi do wid fire activity, an anomaly weh calculate pon dat kinda record follow di satellite dem instead a di fire dem.',
  h_harm: 'Di harmonized series',
  p_harm_unit: 'Every month measure inna one unit: {unit}.',
  p_harm_viirs:
    'From 2012, wi use di S-NPP count dem as dem observe. Day dem wen S-NPP did down but NOAA-20 did up get fill wid di NOAA-20 count times di S-NPP to NOAA-20 ratio, weh measure pon day dem wen both did a observe{n20}.',
  p_harm_modis:
    'Before 2012, a transfer model predict, fi every grid cell an month, di count S-NPP woulda get from wah MODIS record. It learn from di overlap year dem {train}, wen both sensor did deh pon dem nominal orbit, an MODIS did process wid di same product version as di year dem weh a reconstruct. Before Aqua (up to June 2002), wi use a Terra-only variant an evaluate it separate.',
  h_unc: 'Uncertainty inna di model month dem',
  p_unc:
    'Model month carry a 80% interval weh measure pon held-out prediction. Fi a estimate x, di interval a [max(0, (x + 0.5)·exp(−z·s) − 0.5), (x + 0.5)·exp(z·s) − 0.5] wid z = 1.2816, weh s get smaller as di estimate get bigger (a small area get a wide interval, a province get a narrow one), an s interpolate linear inna log10(x) from di table below. Di 0.5 offset match how di error dem did measure, an it mek di interval reach zero fi small region. Terra-only month use dem own table wen di bundle have one. Observed month nuh have no interval. Yearly interval add up di monthly bound dem. Dat treat di error inna di month dem as fully correlated, an it conservative on purpose.',
  h_anom: 'Anomaly',
  p_anom:
    'Fi each calendar month, di baseline a dat month value dem ova {first}–{last}. Di anomaly fi a month a one robust z score pon di log scale, so it measure how unusual a month look against di same month inna odda year dem.',
  p_classes:
    'Class dem: z ≥ 2 way above normal; 1 ≤ z < 2 above normal; −1 ≤ z < 1 normal; z < −1 below normal. A month only class as unusual if it also differ from di median count fi dat calendar month by at least {excess} hotspot, so one hotspot inna place weh usually have none nah go read as a extreme month. Percent a median divide a month count by di baseline median fi dat calendar month, an di colour dem follow di same 5-hotspot rule.',
  h_season: 'Fire season',
  p_season:
    'Di fire season a di shortest run a calendar month back to back, weh can wrap round from December to January, weh hold at least 80% a di hotspot inna a typical year. Di typical year a di median count fi each calendar month ova di baseline year dem.',
  h_limits: 'Di limit dem',
  p_limits:
    'FIRMS count fire pixel, not di fire dem demself or di burn area: a big fire weh dem see pon nuff day count nuff time. Cloud an thick smoke hide fire from every sensor. Di transfer learn from di overlap year dem, so place weh di fire pattern change since den get reconstruct wid di relation from dem year deh.',
  h_val: 'Validation',
  h_metrics: 'Accuracy pon held-out data',
  variant: 'Sensor weh use',
  level: 'Scale',
  h_national: 'National monthly total, weh observe an weh predict, fi held-out year dem',
  h_annual: 'National yearly total',
  h_ratio_year: 'VIIRS S-NPP hotspot per MODIS hotspot, by year',
  h_ratio_prov: 'VIIRS S-NPP hotspot per MODIS hotspot, by province',
  p_ratio_prov:
    'Di ratio different from region to region because fire size an type different: small farm burn an wetland burn push it up. One national ratio woulda bias di regional series, an dat a why di model use location an season. Province wid at least {n} MODIS hotspot inna 2012 to 2017.',
  h_cov: 'Interval coverage',
  p_cov: 'Share a held-out month weh di observed S-NPP count fall inside di 80% interval, by test.',
  h_gain: 'Wah di transfer model depend pon',
  p_gain: 'Gain fi each input inna di gradient-boosted model, as a share a di total.',
  h_out: 'Sensor outage weh find inna di record',
  p_n20: 'NOAA-20 detect {r} hotspot fi every S-NPP hotspot pon day dem wen both did a observe.',
  h_sources: 'Source dem',
  chosen: 'di one wi pick',
  method: 'Method',
  n: 'n',
  syntheticValidation: 'Dese validation number a mek-up placeholder, an di real evaluation a go replace dem.',
  noValidation: 'Di validation result dem nuh inna dis bundle yet.',
  observed: 'Wah VIIRS S-NPP observe',
  ratio: 'Ratio',
  uncPoints: 'Estimate x',
  uncS: 'Spread s',
  uncTerra: 'Spread s, Terra only',
  uncInterval: '80% interval fi x',
  none: 'none',
};

/** jam side of METRIC_LABEL (column headers). */
export const METRIC_LABEL_JAM: Record<string, string> = {
  log_rmse: 'Log error',
  bias_pct: 'Bias %',
  spearman: 'Rank corr.',
  season_r: 'Season shape',
  peak_match: 'Peak month',
  anomaly_agreement: 'Anomaly class',
};

/** jam side of FEATURE_LABEL. */
export const FEATURE_LABEL_JAM: Record<string, string> = {
  t: 'Terra hotspot inna di cell',
  a: 'Aqua hotspot inna di cell',
  t3: 'Terra hotspot, 3 x 3 cell round it',
  a3: 'Aqua hotspot, 3 x 3 cell round it',
  t7: 'Terra hotspot, 7 x 7 cell round it',
  a7: 'Aqua hotspot, 7 x 7 cell round it',
  frp_mean: 'Average fire radiative power',
  small_frac: 'Share a small detection',
  night_frac: 'Share a night detection',
  moy: 'Month a di year',
  lat: 'Latitude',
  lon: 'Longitude',
  clim: 'Usual MODIS count fi di cell',
  clim_moy: 'Usual MODIS count fi di cell inna dat month',
  clim_t: 'Usual Terra count fi di cell',
  r_c: 'VIIRS-to-MODIS ratio fi di cell',
  bg_c: 'VIIRS hotspot inna di cell wid no MODIS nearby',
  avail_t: 'Day dem Terra observe',
  avail_a: 'Day dem Aqua observe',
};

/** jam side of VARIANT_LABEL. */
export const VARIANT_LABEL_JAM: Record<string, string> = {
  terra_aqua: 'MODIS Terra an Aqua',
  terra_only: 'MODIS Terra only',
};

/** jam side of LEVEL_LABEL. */
export const LEVEL_LABEL_JAM: Record<string, string> = {
  'cell-month': 'Grid cell',
  'block-month': '1° block',
  'province-month': 'Province',
  'national-month': 'Country',
};

/** Parallels METHOD_ES: jam for the method labels and descriptions the bundle ships in English. */
export const METHOD_JAM: Record<string, { label: string; description: string }> = {
  none: {
    label: 'No harmonization',
    description: 'MODIS Terra plus Aqua count as dem stand. Dis a wah a plain splice a di two record show before 2012.',
  },
  ratio: {
    label: 'National ratio',
    description: 'One VIIRS-to-MODIS ratio fi di whole country, multiply by di MODIS count.',
  },
  ratio_local: {
    label: 'Local ratio',
    description:
      'A VIIRS-to-MODIS ratio fi each cell, weh get pull toward di 1 degree block it deh inna, an den toward di national ratio, wen di cell have few detection.',
  },
  gbm: {
    label: 'Transfer model',
    description:
      'Gradient-boosted tree dem weh predict di S-NPP count fi each cell an month from MODIS count, fire radiative power, di share a small an night detection, di neighbour cell dem, season, position, an di cell past VIIRS-to-MODIS behaviour. It can predict small fire weh only VIIRS see.',
  },
  blend: {
    label: 'Blend',
    description:
      'Di average a di transfer model an di local ratio, wid equal weight weh set in advance. Di two a dem mek mistake inna different place, so dem average more steady.',
  },
};

/** Parallels TEST_ES. */
export const TEST_JAM: Record<string, { label: string; description: string }> = {
  loyo: { label: 'Lef out one year', description: '2012 to 2017, six fold.' },
  backcast: { label: 'Backcast', description: 'Train pon 2015 to 2017, predict 2012 to 2014.' },
  loro: { label: 'Lef out one region', description: 'Five fold: Northwest, Northeast, Cuyo, Pampas, Patagonia.' },
  forward: { label: 'Forward', description: 'Train pon 2012 to 2017, predict 2018 to 2021 (new MODIS version).' },
};

/** Parallels PROTOCOL_ES: the same four paragraphs as the bundle's English protocol. */
export const PROTOCOL_JAM: string[] = [
  'VIIRS S-NPP an MODIS both observe Argentina from 2012 onward. Inna dem overlap year deh, wi know di true S-NPP count, so wi can score each harmonization method by hiding VIIRS an predict it from MODIS alone, an a exactly dat di method haffi do fi 2000 to 2011.',
  'Di model dem train pon 2012 to 2017: both sensor did deh pon dem nominal orbit, an di MODIS product version match di one weh use fi di year dem weh a reconstruct. Di MODIS version an how it flag static source change inna 2018, so di later year dem only use as a forward check.',
  'Four test. Lef out one year: train pon five a di six overlap year, predict di sixth one. Backcast: train pon 2015 to 2017, predict 2012 to 2014, di closest ting to reconstructing di earlier year dem. Lef out one region: train widout one a Argentina five macro-region, an predict it. Forward: train pon 2012 to 2017 an predict 2018 to 2021, across di MODIS version change.',
  'Every score calculate pon prediction fi data weh di method neva see. Di count dem compare at four scale: 0.1 degree cell, 1 degree block, province, an di whole country, by month.',
];

/** Parallels METRIC_DEF_ES: jam for the bundle's English metric_defs. */
export const METRIC_DEF_JAM: Record<string, string> = {
  log_rmse:
    'Typical error inna log space: di root mean square a log(1 + predicted) minus log(1 + actual). 0.10 a roughly a 10% error.',
  bias_pct: 'Total predicted minus total actual, as a percent a actual. Negative mean di method count too low.',
  spearman: 'Rank correlation between predicted an actual count across all region-month.',
  season_r:
    'Inside each region an year, di rank correlation a di twelve monthly value: di method get di shape a di fire season right?',
  peak_match: 'Share a region-year weh di method pick di same peak month as VIIRS.',
  anomaly_agreement:
    'Share a region-month weh get di same anomaly class (below, normal, above, way above) from di predicted an di actual series.',
};

/**
 * English hardcoded in Methods.tsx or shipped in the bundle, outside the dictionaries.
 * naturalEarth: the fallback <li> "Natural Earth, admin-1 boundaries (public domain)".
 * unit: manifest.harmonization.unit, shown through p_harm_unit; the bundle ships it in English.
 * Attribution lines (© OpenStreetMap contributors, DOIs, product names) stay verbatim.
 */
export const INLINE_JAM = {
  naturalEarth: 'Natural Earth, admin-1 boundary (public domain)',
  unit: 'Hotspot weh one single VIIRS S-NPP observer woulda detect (nominal an high confidence, vegetation fire)',
};
