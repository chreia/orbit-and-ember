// Methods and validation. The text follows docs/METHODS.md; the validation section renders the parts
// of validation.json that exist and skips the rest.
import { useEffect, useId, useMemo, useState } from 'react';
import type { Manifest, Validation } from '../bundle/types.ts';
import { loadValidation } from '../bundle/load.ts';
import { parseYm } from '../lib/months.ts';
import type { Model } from '../model.ts';
import { SERIES_STYLE } from '../model.ts';
import { useI18n } from '../i18n.tsx';
import type { I18n, Key, Lang } from '../i18n.tsx';
import { LineChart, SeriesLegend } from './LineChart.tsx';
import type { LineSpec } from './LineChart.tsx';
import {
  FEATURE_LABEL_JAM,
  INLINE_JAM,
  LEVEL_LABEL_JAM,
  METHOD_JAM,
  METRIC_DEF_JAM,
  METRIC_LABEL_JAM,
  PROTOCOL_JAM,
  TEST_JAM,
  TEXT_JAM,
  VARIANT_LABEL_JAM,
} from './Methods.jam.ts';

type Vars = Record<string, string>;
const fill = (s: string, v: Vars) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? `{${k}}`);

/** Patwa entries laid over the English ones, so any entry the Patwa side lacks shows in English. */
function withJam<V>(d: Record<'en' | 'es', Record<string, V>>, jam: Record<string, V>): Record<Lang, Record<string, V>> {
  return { ...d, jam: { ...d.en, ...jam } };
}
/** The harmonized unit as the bundle ships it; the Patwa page translates exactly this text. */
const UNIT_EN = 'Hotspots a single VIIRS S-NPP observer would detect (nominal and high confidence, vegetation fires)';

const TEXT = withJam({
  en: {
    h_what: 'What the calendar shows',
    p_what:
      'Each cell is the number of active-fire detections (hotspots) in the selected region for one month. A region’s value is the sum over the {res}° grid cells whose centre lies inside it. Months before the record starts, or with no sensor observing, are hatched so they are not mistaken for months without fires.',
    h_data: 'Data',
    p_data:
      'NASA FIRMS archives for {country}: MODIS Collection 6.1 on Terra (from {terra}) and Aqua (from {aqua}), and VIIRS 375 m on S-NPP (from {snpp}) and NOAA-20 (from {n20}). Only presumed vegetation fires count (FIRMS type 0), at nominal or high confidence (MODIS 30 or more; VIIRS “n” or “h”). Low-confidence VIIRS night detections, which include noise from the South Atlantic Anomaly over this region, stay in the downloadable records with a flag but do not enter the counts.',
    h_obs: 'When a sensor was looking',
    p_obs:
      'A day is marked not observed for a sensor when it reported nothing over the whole country while the other sensors’ detections imply it should have seen at least eight. Counts are scaled to a full month by each sensor’s observing fraction. The calendar hatches months with no observation and shows months observed without fires as zero. Cloud cover is not modelled: a cloudy month reads low for every sensor alike.',
    h_why: 'Why the raw record needs harmonizing',
    p_why:
      'VIIRS sees fires that MODIS misses: its 375 m pixels cover about a seventh of the area of a 1 km MODIS pixel, so it detects small and cool fires and splits large ones into more detections. Adding sensors together as they join the record produces steps that have nothing to do with fire activity, and anomalies computed on such a record follow the satellites rather than the fires.',
    h_harm: 'The harmonized series',
    p_harm_unit: 'Every month is expressed in one unit: {unit}.',
    p_harm_viirs:
      'From 2012, S-NPP counts are used as observed. Days when S-NPP was down but NOAA-20 was up are filled with NOAA-20’s count times the S-NPP to NOAA-20 ratio measured on days both observed{n20}.',
    p_harm_modis:
      'Before 2012, a transfer model predicts for every grid cell and month the count S-NPP would have made from what MODIS recorded. It is learned from the overlap years {train}, when both sensors were on their nominal orbits and MODIS was processed with the same product version as the years being reconstructed. Before Aqua (to June 2002) a Terra-only variant is used and evaluated separately.',
    h_unc: 'Uncertainty of model months',
    p_unc:
      'Model months carry an 80% interval measured on held-out predictions. For an estimate x the interval is [max(0, (x + 0.5)·exp(−z·s) − 0.5), (x + 0.5)·exp(z·s) − 0.5] with z = 1.2816, where s shrinks as the estimate grows (a small area gets a wide interval, a province a narrow one) and is interpolated linearly in log10(x) from the table below. The 0.5 offset matches how the errors were measured and lets the interval reach zero for small regions. Terra-only months use their own table when the bundle provides one. Observed months have no interval. Annual intervals add the monthly bounds, which treats the months’ errors as fully correlated and is deliberately conservative.',
    h_anom: 'Anomalies',
    p_anom:
      'For each calendar month the baseline is that month’s values over {first}–{last}. A month’s anomaly is a robust z score on the log scale, so it measures how unusual a month is against the same month in other years.',
    p_classes:
      'Classes: z ≥ 2 far above normal; 1 ≤ z < 2 above normal; −1 ≤ z < 1 normal; z < −1 below normal. A month is classed unusual only if it also differs from that calendar month’s median count by at least {excess} hotspots, so one hotspot where there are usually none does not read as an extreme month. Percent of median divides a month’s count by the baseline median for that calendar month; its colours follow the same 5-hotspot rule.',
    h_season: 'Fire season',
    p_season:
      'The fire season is the shortest run of consecutive calendar months, wrapping from December to January, that holds at least 80% of a typical year’s hotspots. The typical year is the median count of each calendar month over the baseline years.',
    h_limits: 'Limits',
    p_limits:
      'FIRMS counts fire pixels, not fires or burned area: a large fire seen on many days counts many times. Clouds and thick smoke hide fires from every sensor. The transfer is learned from the overlap years, so places whose fire regime changed since are reconstructed with the relation of those years.',
    h_val: 'Validation',
    h_metrics: 'Held-out accuracy',
    variant: 'Sensors used',
    level: 'Scale',
    h_national: 'National monthly totals, observed and predicted for held-out years',
    h_annual: 'National annual totals',
    h_ratio_year: 'VIIRS S-NPP hotspots per MODIS hotspot, by year',
    h_ratio_prov: 'VIIRS S-NPP hotspots per MODIS hotspot, by province',
    p_ratio_prov:
      'The ratio differs between regions because fire size and type differ: small agricultural and wetland burns raise it. A single national ratio would bias regional series, which is why the model uses location and season. Provinces with at least {n} MODIS hotspots in 2012 to 2017.',
    h_cov: 'Interval coverage',
    p_cov: 'Share of held-out months whose observed S-NPP count fell inside the 80% interval, by test.',
    h_gain: 'What the transfer model relies on',
    p_gain: 'Gain of each input in the gradient-boosted model, as a share of the total.',
    h_out: 'Sensor outages found in the record',
    p_n20: 'NOAA-20 detects {r} hotspots for every S-NPP hotspot on days both observed.',
    h_sources: 'Sources',
    chosen: 'chosen',
    method: 'Method',
    n: 'n',
    syntheticValidation: 'These validation values are synthetic placeholders and will be replaced by the real evaluation.',
    noValidation: 'The validation results are not in this bundle yet.',
    observed: 'Observed VIIRS S-NPP',
    ratio: 'Ratio',
    uncPoints: 'Estimate x',
    uncS: 'Spread s',
    uncTerra: 'Spread s, Terra only',
    uncInterval: '80% interval for x',
    none: 'none',
  },
  es: {
    h_what: 'Qué muestra el calendario',
    p_what:
      'Cada celda es la cantidad de detecciones de fuego activo (focos de calor) en la región seleccionada durante un mes. El valor de una región es la suma de las celdas de {res}° cuyo centro cae dentro de ella. Los meses anteriores al inicio del registro, o sin ningún sensor observando, aparecen rayados para no confundirlos con meses sin fuego.',
    h_data: 'Datos',
    p_data:
      'Archivos de NASA FIRMS para {country}: MODIS Colección 6.1 en Terra (desde {terra}) y Aqua (desde {aqua}), y VIIRS 375 m en S-NPP (desde {snpp}) y NOAA-20 (desde {n20}). Solo cuentan los presuntos fuegos de vegetación (tipo 0 de FIRMS) con confianza nominal o alta (MODIS 30 o más; VIIRS “n” o “h”). Las detecciones nocturnas VIIRS de baja confianza, que incluyen ruido de la Anomalía del Atlántico Sur sobre esta región, quedan en los registros descargables con una marca pero no entran en los conteos.',
    h_obs: 'Cuándo observaba cada sensor',
    p_obs:
      'Un día se marca como sin observación para un sensor cuando no informó nada sobre todo el país mientras las detecciones de los otros sensores indican que debería haber visto al menos ocho. Los conteos se escalan a un mes completo según la fracción de días observados de cada sensor. El calendario raya los meses sin observación y muestra como cero los meses observados sin fuego. La nubosidad no se modela: un mes nublado se ve bajo en todos los sensores por igual.',
    h_why: 'Por qué hay que armonizar el registro original',
    p_why:
      'VIIRS ve fuegos que MODIS no detecta: sus píxeles de 375 m cubren cerca de un séptimo de la superficie de un píxel MODIS de 1 km, así que detecta fuegos chicos y de baja temperatura y divide los grandes en más detecciones. Sumar los sensores a medida que se incorporan genera saltos que no tienen relación con la actividad de fuego, y las anomalías calculadas sobre ese registro siguen a los satélites y no a los fuegos.',
    h_harm: 'La serie armonizada',
    p_harm_unit: 'Todos los meses se expresan en una sola unidad: {unit}.',
    p_harm_viirs:
      'Desde 2012 se usan los conteos observados de S-NPP. Los días en que S-NPP no observó pero NOAA-20 sí se completan con el conteo de NOAA-20 multiplicado por la relación S-NPP/NOAA-20 medida en los días en que ambos observaron{n20}.',
    p_harm_modis:
      'Antes de 2012, un modelo de transferencia predice para cada celda y mes el conteo que habría hecho S-NPP a partir de lo que registró MODIS. Se aprende de los años de superposición {train}, cuando ambos sensores estaban en sus órbitas nominales y MODIS se procesaba con la misma versión de producto que los años reconstruidos. Antes de Aqua (hasta junio de 2002) se usa una variante solo con Terra, evaluada por separado.',
    h_unc: 'Incertidumbre de los meses modelados',
    p_unc:
      'Los meses modelados tienen un intervalo del 80% medido sobre predicciones en años excluidos. Para una estimación x el intervalo es [máx(0, (x + 0,5)·exp(−z·s) − 0,5), (x + 0,5)·exp(z·s) − 0,5] con z = 1,2816, donde s disminuye a medida que crece la estimación (un área chica tiene un intervalo amplio y una provincia uno angosto) y se interpola linealmente en log10(x) a partir de la tabla. El desplazamiento de 0,5 coincide con cómo se midieron los errores y permite que el intervalo llegue a cero en regiones chicas. Los meses solo con Terra usan su propia tabla cuando el paquete la incluye. Los meses observados no tienen intervalo. Los intervalos anuales suman los límites mensuales, lo que supone errores totalmente correlacionados y es deliberadamente conservador.',
    h_anom: 'Anomalías',
    p_anom:
      'Para cada mes del calendario, la referencia son los valores de ese mes en {first}–{last}. La anomalía de un mes es un puntaje z robusto en escala logarítmica, que mide qué tan inusual es un mes frente al mismo mes en otros años.',
    p_classes:
      'Clases: z ≥ 2 muy por encima de lo normal; 1 ≤ z < 2 por encima de lo normal; −1 ≤ z < 1 normal; z < −1 por debajo de lo normal. Un mes se clasifica como inusual solo si además difiere de la mediana de ese mes en al menos {excess} focos, para que un único foco donde normalmente no hay ninguno no aparezca como un mes extremo. El porcentaje de la mediana divide el conteo del mes por la mediana de referencia de ese mes; sus colores siguen la misma regla de 5 focos.',
    h_season: 'Temporada de fuego',
    p_season:
      'La temporada de fuego es la secuencia más corta de meses consecutivos, pasando de diciembre a enero, que concentra al menos el 80% de los focos de un año típico. El año típico es la mediana de cada mes en los años de referencia.',
    h_limits: 'Límites',
    p_limits:
      'FIRMS cuenta píxeles con fuego, no incendios ni área quemada: un incendio grande visto muchos días cuenta muchas veces. Las nubes y el humo espeso ocultan el fuego a todos los sensores. La transferencia se aprende en los años de superposición, así que los lugares cuyo régimen de fuego cambió desde entonces se reconstruyen con la relación de esos años.',
    h_val: 'Validación',
    h_metrics: 'Precisión en datos excluidos',
    variant: 'Sensores usados',
    level: 'Escala',
    h_national: 'Totales mensuales nacionales, observados y predichos en años excluidos',
    h_annual: 'Totales anuales nacionales',
    h_ratio_year: 'Focos VIIRS S-NPP por foco MODIS, por año',
    h_ratio_prov: 'Focos VIIRS S-NPP por foco MODIS, por provincia',
    p_ratio_prov:
      'La relación varía entre regiones porque cambian el tamaño y el tipo de fuego: las quemas agrícolas y de humedales, chicas, la aumentan. Una única relación nacional sesgaría las series regionales; por eso el modelo usa la ubicación y la estación. Provincias con al menos {n} focos MODIS en 2012 a 2017.',
    h_cov: 'Cobertura del intervalo',
    p_cov: 'Proporción de meses excluidos cuyo conteo observado de S-NPP cayó dentro del intervalo del 80%, por prueba.',
    h_gain: 'En qué se apoya el modelo de transferencia',
    p_gain: 'Ganancia de cada variable en el modelo de árboles, como proporción del total.',
    h_out: 'Interrupciones de sensores detectadas en el registro',
    p_n20: 'NOAA-20 detecta {r} focos por cada foco de S-NPP en los días en que ambos observaron.',
    h_sources: 'Fuentes',
    chosen: 'elegido',
    method: 'Método',
    n: 'n',
    syntheticValidation: 'Estos valores de validación son sintéticos y se reemplazarán por la evaluación real.',
    noValidation: 'Los resultados de validación todavía no están en este paquete.',
    observed: 'VIIRS S-NPP observado',
    ratio: 'Relación',
    uncPoints: 'Estimación x',
    uncS: 'Dispersión s',
    uncTerra: 'Dispersión s, solo Terra',
    uncInterval: 'Intervalo del 80% para x',
    none: 'ninguna',
  },
}, TEXT_JAM);

const METRIC_ORDER = ['log_rmse', 'bias_pct', 'spearman', 'season_r', 'peak_match', 'anomaly_agreement'];
const LOWER_IS_BETTER: Record<string, boolean> = { log_rmse: true, bias_pct: true };
const METRIC_LABEL = withJam({
  en: {
    log_rmse: 'Log error',
    bias_pct: 'Bias %',
    spearman: 'Rank corr.',
    season_r: 'Season shape',
    peak_match: 'Peak month',
    anomaly_agreement: 'Anomaly class',
  },
  es: {
    log_rmse: 'Error log',
    bias_pct: 'Sesgo %',
    spearman: 'Corr. de rangos',
    season_r: 'Forma de la temporada',
    peak_match: 'Mes pico',
    anomaly_agreement: 'Clase de anomalía',
  },
}, METRIC_LABEL_JAM);
const FEATURE_LABEL = withJam({
  en: {
    t: 'Terra hotspots in the cell',
    a: 'Aqua hotspots in the cell',
    t3: 'Terra hotspots, 3 x 3 cells around',
    a3: 'Aqua hotspots, 3 x 3 cells around',
    t7: 'Terra hotspots, 7 x 7 cells around',
    a7: 'Aqua hotspots, 7 x 7 cells around',
    frp_mean: 'Mean fire radiative power',
    small_frac: 'Share of small detections',
    night_frac: 'Share of night detections',
    moy: 'Month of the year',
    lat: 'Latitude',
    lon: 'Longitude',
    clim: 'Usual MODIS count of the cell',
    clim_moy: 'Usual MODIS count of the cell in that month',
    clim_t: 'Usual Terra count of the cell',
    r_c: 'VIIRS-to-MODIS ratio of the cell',
    bg_c: 'VIIRS hotspots of the cell with no MODIS nearby',
    avail_t: 'Days Terra observed',
    avail_a: 'Days Aqua observed',
  },
  es: {
    t: 'Focos Terra en la celda',
    a: 'Focos Aqua en la celda',
    t3: 'Focos Terra, 3 x 3 celdas alrededor',
    a3: 'Focos Aqua, 3 x 3 celdas alrededor',
    t7: 'Focos Terra, 7 x 7 celdas alrededor',
    a7: 'Focos Aqua, 7 x 7 celdas alrededor',
    frp_mean: 'Potencia radiativa media del fuego',
    small_frac: 'Proporción de detecciones chicas',
    night_frac: 'Proporción de detecciones nocturnas',
    moy: 'Mes del año',
    lat: 'Latitud',
    lon: 'Longitud',
    clim: 'Conteo MODIS habitual de la celda',
    clim_moy: 'Conteo MODIS habitual de la celda en ese mes',
    clim_t: 'Conteo Terra habitual de la celda',
    r_c: 'Relación VIIRS/MODIS de la celda',
    bg_c: 'Focos VIIRS de la celda sin MODIS cerca',
    avail_t: 'Días que observó Terra',
    avail_a: 'Días que observó Aqua',
  },
}, FEATURE_LABEL_JAM);
/** Spanish for the validation texts the bundle ships in English; bundle fields named *_es win. */
const METHOD_ES: Record<string, { label: string; description: string }> = {
  none: {
    label: 'Sin armonización',
    description: 'Conteos de MODIS Terra más Aqua tal como están. Es lo que muestra antes de 2012 un empalme directo de los dos registros.',
  },
  ratio: { label: 'Relación nacional', description: 'Una relación VIIRS/MODIS para todo el país, multiplicada por el conteo de MODIS.' },
  ratio_local: {
    label: 'Relación local',
    description:
      'Una relación VIIRS/MODIS para cada celda, acercada a la de su bloque de 1 grado y luego a la nacional cuando la celda tiene pocas detecciones.',
  },
  gbm: {
    label: 'Modelo de transferencia',
    description:
      'Árboles de gradiente que predicen el conteo de S-NPP de cada celda y mes a partir de los conteos MODIS, la potencia radiativa del fuego, la proporción de detecciones chicas y nocturnas, las celdas vecinas, la estación, la posición y el comportamiento VIIRS/MODIS pasado de la celda. Puede predecir fuegos chicos que solo ve VIIRS.',
  },
  blend: {
    label: 'Combinación',
    description:
      'El promedio del modelo de transferencia y la relación local, con pesos iguales fijados de antemano. Los dos se equivocan en lugares distintos, por lo que su promedio es más estable.',
  },
};
const TEST_ES: Record<string, { label: string; description: string }> = {
  loyo: { label: 'Dejar un año fuera', description: '2012 a 2017, seis particiones.' },
  backcast: { label: 'Retroproyección', description: 'Entrenar con 2015 a 2017, predecir 2012 a 2014.' },
  loro: { label: 'Dejar una región fuera', description: 'Cinco particiones: Noroeste, Noreste, Cuyo, Pampeana, Patagonia.' },
  forward: { label: 'Hacia adelante', description: 'Entrenar con 2012 a 2017, predecir 2018 a 2021 (nueva versión de MODIS).' },
};
const PROTOCOL_ES = [
  'VIIRS S-NPP y MODIS observaron la Argentina a la vez desde 2012. En esos años de superposición se conoce el conteo real de S-NPP, así que cada método de armonización puede evaluarse ocultando VIIRS y prediciéndolo solo a partir de MODIS, que es exactamente lo que el método debe hacer para 2000 a 2011.',
  'Los modelos se entrenan con 2012 a 2017: ambos sensores estaban en sus órbitas nominales y la versión del producto MODIS coincide con la usada para los años que se reconstruyen. La versión de MODIS y su marcado de fuentes estáticas cambian en 2018, por lo que los años posteriores se usan solo como prueba hacia adelante.',
  'Cuatro pruebas. Dejar un año fuera: entrenar con cinco de los seis años de superposición y predecir el sexto. Retroproyección: entrenar con 2015 a 2017 y predecir 2012 a 2014, lo más parecido a reconstruir los años anteriores. Dejar una región fuera: entrenar sin una de las cinco macrorregiones de la Argentina y predecirla. Hacia adelante: entrenar con 2012 a 2017 y predecir 2018 a 2021, a través del cambio de versión de MODIS.',
  'Cada puntaje se calcula sobre predicciones de datos que el método nunca vio. Los conteos se comparan a cuatro escalas: celdas de 0,1 grado, bloques de 1 grado, provincias y todo el país, por mes.',
];
const SENSOR_IDS = new Set(['modis_terra', 'modis_aqua', 'viirs_snpp', 'viirs_noaa20']);
/** Provinces with fewer MODIS hotspots in the training years give unstable ratios. */
const MIN_PROVINCE_MODIS = 500;
const METRIC_DEF_ES: Record<string, string> = {
  log_rmse:
    'Error típico en escala logarítmica: la raíz del error cuadrático medio de log(1 + estimado) menos log(1 + real). 0,10 equivale a un error de alrededor del 10%.',
  bias_pct: 'Total estimado menos total real, como porcentaje del real. Negativo significa que el método cuenta de menos.',
  spearman: 'Correlación de rangos entre los conteos estimados y reales en todas las combinaciones de región y mes.',
  season_r:
    'En cada región y año, la correlación de rangos de los doce valores mensuales: ¿reproduce el método la forma de la temporada de fuego?',
  peak_match: 'Proporción de región-años en que el método elige el mismo mes pico que VIIRS.',
  anomaly_agreement:
    'Proporción de región-meses que reciben la misma clase de anomalía (debajo, normal, encima, muy por encima) en la serie estimada y en la real.',
};
const VARIANT_LABEL = withJam({
  en: { terra_aqua: 'MODIS Terra and Aqua', terra_only: 'MODIS Terra only' },
  es: { terra_aqua: 'MODIS Terra y Aqua', terra_only: 'Solo MODIS Terra' },
}, VARIANT_LABEL_JAM);
const LEVEL_LABEL = withJam({
  en: { 'cell-month': 'Grid cell', 'block-month': '1° block', 'province-month': 'Province', 'national-month': 'Country' },
  es: { 'cell-month': 'Celda', 'block-month': 'Bloque de 1°', 'province-month': 'Provincia', 'national-month': 'País' },
}, LEVEL_LABEL_JAM);

function monthText(label: string | undefined, i18n: I18n): string {
  if (!label) return '–';
  const { year, month } = parseYm(label);
  return i18n.monthYear(year, month);
}

export function Methods({ model }: { model: Model }) {
  const i18n = useI18n();
  const { t, fmt, lang } = i18n;
  const tx = TEXT[lang];
  const { manifest, bundle } = model;
  const [val, setVal] = useState<Validation | null | undefined>(undefined);
  useEffect(() => {
    loadValidation(bundle).then(setVal);
  }, [bundle]);

  const b = manifest.baseline;
  const first = (id: string) => monthText(manifest.series.find((s) => s.id === id)?.first, i18n);
  const h = manifest.harmonization;
  const n20 = h?.noaa20_per_snpp ?? (typeof val?.noaa20_per_snpp === 'number' ? (val.noaa20_per_snpp as number) : undefined);
  const unc = manifest.uncertainty;
  const terraPts = unc.points_terra_only;

  return (
    <article className="card" style={{ gap: 18 }} aria-labelledby="methods-title">
      <h1 id="methods-title" style={{ fontSize: '1.4rem' }}>
        {t('methodsTitle')}
      </h1>
      <div className="prose">
        <h2>{tx.h_what}</h2>
        <p>{fill(tx.p_what, { res: String(manifest.grid.res) })}</p>
        <h2>{tx.h_data}</h2>
        <p>
          {fill(tx.p_data, {
            country: manifest.country,
            terra: first('modis_terra'),
            aqua: first('modis_aqua'),
            snpp: first('viirs_snpp'),
            n20: first('viirs_noaa20'),
          })}
        </p>
        <h2>{tx.h_obs}</h2>
        <p>{tx.p_obs}</p>
        <h2>{tx.h_why}</h2>
        <p>{tx.p_why}</p>
        <h2>{tx.h_harm}</h2>
        {h?.unit && <p>{fill(tx.p_harm_unit, { unit: lang === 'jam' && h.unit === UNIT_EN ? INLINE_JAM.unit : h.unit })}</p>}
        <p>{fill(tx.p_harm_viirs, { n20: n20 ? ` (${fill(tx.p_n20, { r: fmt(n20, 2) }).replace(/\.$/, '')})` : '' })}</p>
        <p>{fill(tx.p_harm_modis, { train: h?.train_years ? `${h.train_years[0]}–${h.train_years[1]}` : '2012–2017' })}</p>
        <h2>{tx.h_unc}</h2>
        <p>{tx.p_unc}</p>
        <div className="table-scroll" style={{ maxHeight: 'none' }}>
          <table className="data" style={{ maxWidth: 520 }}>
            <thead>
              <tr>
                <th className="n">{tx.uncPoints}</th>
                <th className="n">{tx.uncS}</th>
                <th className="n">{tx.uncInterval}</th>
                {terraPts?.length ? <th className="n">{tx.uncTerra}</th> : null}
              </tr>
            </thead>
            <tbody>
              {unc.points.map(([x, s], i) => (
                <tr key={x}>
                  <td className="n">{fmt(x)}</td>
                  <td className="n">{fmt(s, 2)}</td>
                  <td className="n">
                    {fmt(Math.max(0, (x + 0.5) * Math.exp(-unc.z80 * s) - 0.5), x < 10 ? 1 : 0)} – {fmt((x + 0.5) * Math.exp(unc.z80 * s) - 0.5, x < 10 ? 1 : 0)}
                  </td>
                  {terraPts?.length ? <td className="n">{terraPts[i] && terraPts[i][0] === x ? fmt(terraPts[i][1], 2) : '–'}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2>{tx.h_anom}</h2>
        <p>{fill(tx.p_anom, { first: String(b.first_year), last: String(b.last_year) })}</p>
        <code className="formula">z = (log(1 + x) − median_c) / max(1.4826 · MAD_c, 0.3)</code>
        <p>{fill(tx.p_classes, { excess: '5' })}</p>
        <h2>{tx.h_season}</h2>
        <p>{tx.p_season}</p>
        <h2>{tx.h_limits}</h2>
        <p>{tx.p_limits}</p>
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ fontSize: '1.2rem' }}>{tx.h_val}</h2>
        {val === undefined && <p className="muted">{t('loading')}</p>}
        {val === null && <p className="muted">{tx.noValidation}</p>}
        {val && <ValidationView v={val} tx={tx} synthetic={bundle.synthetic || Boolean(val.synthetic)} manifest={manifest} />}
      </section>

      <section className="prose">
        <h2>{tx.h_sources}</h2>
        <ul>
          {manifest.sources.map((s) => (
            <li key={s.name}>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
              ) : (
                s.name
              )}
              {s.doi && (
                <>
                  {' '}
                  · DOI{' '}
                  <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer">
                    {s.doi}
                  </a>
                </>
              )}
            </li>
          ))}
          {!manifest.sources.some((s) => /natural earth/i.test(s.name)) && <li>{lang === 'jam' ? INLINE_JAM.naturalEarth : t('sourceNaturalEarth')}</li>}
          <li>{t('creditsImagery')} {t('appImageryLayers')}</li>
          <li>
            {t('creditsTerrain')} SRTMGL1 v3 DOI{' '}
            <a href="https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003" target="_blank" rel="noreferrer">
              10.5067/MEaSUREs/SRTM/SRTMGL1.003
            </a>
          </li>
          <li>© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles</li>
        </ul>
      </section>
    </article>
  );
}

function Seg({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (v: string) => void }) {
  const id = useId();
  if (options.length < 2) return null;
  return (
    <div className="field">
      <span className="label" id={id}>
        {label}
      </span>
      <div className="seg" role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ValidationView({ v, tx, synthetic, manifest }: { v: Validation; tx: Record<string, string>; synthetic: boolean; manifest: Manifest }) {
  const i18n = useI18n();
  const { fmt, monthYear, lang } = i18n;
  const es = lang === 'es';
  // Spanish from the bundle or this file, Patwa from Methods.jam.ts, English otherwise
  const loc = (spanish: string | undefined, patwa: string | undefined) => (es ? spanish : lang === 'jam' ? patwa : undefined);
  const methodOf = (id: string) => {
    const m = v.methods?.find((q) => q.id === id);
    return {
      label: loc(m?.label_es ?? METHOD_ES[id]?.label, METHOD_JAM[id]?.label) ?? m?.label ?? id,
      description: loc(m?.description_es ?? METHOD_ES[id]?.description, METHOD_JAM[id]?.description) ?? m?.description,
    };
  };
  const testOf = (id: string) => {
    const q = v.tests?.find((x) => x.id === id);
    return {
      label: loc(q?.label_es ?? TEST_ES[id]?.label, TEST_JAM[id]?.label) ?? q?.label ?? id,
      description: loc(q?.description_es ?? TEST_ES[id]?.description, TEST_JAM[id]?.description) ?? q?.description,
    };
  };
  const methodLabel = (id: string) => methodOf(id).label;
  // Built-in Spanish protocol only while the English one has the same four paragraphs it translates.
  const protocol = es
    ? (v.protocol_es ?? (v.protocol?.length === PROTOCOL_ES.length ? PROTOCOL_ES : v.protocol))
    : lang === 'jam' && v.protocol?.length === PROTOCOL_JAM.length
      ? PROTOCOL_JAM
      : v.protocol;
  const metrics = v.metrics ?? [];

  const variants = useMemo(() => [...new Set(metrics.map((m) => String(m.variant ?? '')))], [metrics]);
  const levels = useMemo(() => [...new Set(metrics.map((m) => String(m.level ?? '')))], [metrics]);
  const [variant, setVariant] = useState<string>(() => (variants.includes('terra_aqua') ? 'terra_aqua' : variants[0] ?? ''));
  const [level, setLevel] = useState<string>(() => (levels.includes('province-month') ? 'province-month' : levels[0] ?? ''));

  const shown = metrics.filter((m) => String(m.variant ?? '') === variant && String(m.level ?? '') === level);
  const byTest = useMemo(() => {
    const out = new Map<string, typeof shown>();
    for (const m of shown) {
      if (!out.has(m.test)) out.set(m.test, []);
      out.get(m.test)!.push(m);
    }
    const order = (v.tests ?? []).map((q) => q.id);
    return [...out.entries()].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - ((order.indexOf(b[0]) + 99) % 99));
  }, [shown, v.tests]);
  const metricCols = useMemo(() => {
    const present = new Set<string>();
    for (const m of shown) for (const k of Object.keys(m)) if (typeof m[k] === 'number' && k !== 'n') present.add(k);
    return [...METRIC_ORDER.filter((k) => present.has(k)), ...[...present].filter((k) => !METRIC_ORDER.includes(k))];
  }, [shown]);

  const ns = v.national_series;
  const nationalLines: LineSpec[] = [];
  // Colour follows the method, never its position, so no two methods share a colour.
  const METHOD_COLOR: Record<string, string> = {
    none: 'var(--c-aqua)',
    ratio: 'var(--c-terra)',
    ratio_local: 'var(--c-naive)',
    gbm: 'var(--c-snpp)',
    blend: 'var(--c-n20)',
  };
  if (ns?.viirs_snpp) nationalLines.push({ id: 'obs', label: tx.observed, values: ns.viirs_snpp, color: 'var(--c-harm)', width: 2.5 });
  Object.entries(ns?.predicted ?? {}).forEach(([k, arr]) =>
    nationalLines.push({
      id: k,
      label: methodLabel(k),
      values: arr,
      color: METHOD_COLOR[k] ?? 'var(--ink-2)',
      width: k === v.chosen_method ? 2.25 : 1.75,
      dash: k === v.chosen_method ? undefined : '5 3',
    }),
  );
  const nsTicks = (ns?.months ?? [])
    .map((lab, i) => ({ i, lab }))
    .filter(({ lab }) => lab.endsWith('-01') && Number(lab.slice(0, 4)) % 2 === 0)
    .map(({ i, lab }) => ({ i, label: lab.slice(0, 4) }));

  const an = v.annual_national;
  const annualLines: LineSpec[] = [];
  if (an?.naive_merge) annualLines.push({ id: 'naive', label: i18n.t('s_naive'), values: an.naive_merge, ...SERIES_STYLE.naive });
  if (an?.modis_only) annualLines.push({ id: 'modis', label: 'MODIS Terra + Aqua', values: an.modis_only, color: 'var(--c-aqua)', width: 1.75, dash: '4 3' });
  if (an?.viirs_snpp) {
    const start = Number((manifest.series.find((q) => q.id === 'viirs_snpp')?.first ?? '2012-01').slice(0, 4));
    const vals = an.viirs_snpp.map((x, j) => (an.years[j] < start ? Number.NaN : x));
    annualLines.push({ id: 'snpp', label: i18n.t('s_viirs_snpp'), values: vals, ...SERIES_STYLE.viirs_snpp });
  }
  if (an?.harmonized)
    annualLines.push({
      id: 'harm',
      label: i18n.t('s_harmonized'),
      values: an.harmonized,
      ...SERIES_STYLE.harmonized,
      band: an.harmonized_lo && an.harmonized_hi ? { lo: an.harmonized_lo, hi: an.harmonized_hi, label: i18n.t('cmpBand') } : undefined,
    });

  const ry = v.ratio_by_year;
  const rp = [...(v.ratio_by_province ?? [])]
    .filter((r) => typeof r.n_modis !== 'number' || r.n_modis >= MIN_PROVINCE_MODIS)
    .sort((a, b) => b.viirs_per_modis - a.viirs_per_modis);
  const rpMax = Math.max(1, ...rp.map((r) => r.viirs_per_modis));

  const unc = v.uncertainty as { coverage80?: unknown } | undefined;
  const coverage = unc?.coverage80;
  const coverageRows: [string, number][] =
    typeof coverage === 'number'
      ? [['', coverage]]
      : coverage && typeof coverage === 'object'
        ? Object.entries(coverage as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number')
        : [];

  const gainRaw = v.feature_gain;
  const gains: [string, number][] =
    gainRaw && typeof gainRaw === 'object' && !Array.isArray(gainRaw)
      ? Object.entries(gainRaw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number')
      : [];
  gains.sort((a, b) => b[1] - a[1]);
  const gainTotal = gains.reduce((s, g) => s + g[1], 0);
  const gainTop = gains.slice(0, 12);

  const outages = v.outages && typeof v.outages === 'object' ? (v.outages as Record<string, [string, string][]>) : null;
  const testLabel = (id: string) => testOf(id).label;

  return (
    <>
      {synthetic && (
        <p className="notice" style={{ margin: 0 }}>
          {tx.syntheticValidation}
        </p>
      )}
      {protocol?.length ? (
        <div className="prose">
          {protocol.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : null}
      {v.methods?.length ? (
        <ul className="prose small" style={{ paddingLeft: 18 }}>
          {v.methods.map((m) => (
            <li key={m.id}>
              <strong>{methodOf(m.id).label}</strong>
              {m.id === v.chosen_method ? ` (${tx.chosen})` : ''}
              {methodOf(m.id).description ? `: ${methodOf(m.id).description}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {byTest.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card-head">
            <h3>{tx.h_metrics}</h3>
            <div className="row" style={{ gap: 12 }}>
              <Seg label={tx.variant} value={variant} onChange={setVariant} options={variants.map((id) => ({ id, label: VARIANT_LABEL[lang][id] ?? id }))} />
              <Seg label={tx.level} value={level} onChange={setLevel} options={levels.map((id) => ({ id, label: LEVEL_LABEL[lang][id] ?? id }))} />
            </div>
          </div>
          {byTest.map(([testId, rows]) => {
            const test = testOf(testId);
            const best: Record<string, number> = {};
            for (const c of metricCols) {
              const vals = rows.map((r) => r[c]).filter((x): x is number => typeof x === 'number');
              if (!vals.length) continue;
              best[c] = LOWER_IS_BETTER[c] ? Math.min(...vals.map((x) => Math.abs(x))) : Math.max(...vals);
            }
            return (
              <div key={testId} className="table-scroll" style={{ maxHeight: 'none' }}>
                <p className="small" style={{ marginBottom: 4 }}>
                  <strong>{test.label}</strong>
                  {test.description ? `. ${test.description}` : ''}
                </p>
                <table className="data">
                  <thead>
                    <tr>
                      <th>{tx.method}</th>
                      {metricCols.map((c) => (
                        <th className="n" key={c} title={loc(METRIC_DEF_ES[c], METRIC_DEF_JAM[c]) ?? v.metric_defs?.[c]}>
                          {METRIC_LABEL[lang][c] ?? c}
                        </th>
                      ))}
                      <th className="n">{tx.n}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.method}>
                        <td>
                          {methodLabel(r.method)}
                          {r.method === v.chosen_method ? ` (${tx.chosen})` : ''}
                        </td>
                        {metricCols.map((c) => {
                          const x = r[c];
                          const isBest = typeof x === 'number' && (LOWER_IS_BETTER[c] ? Math.abs(x) === best[c] : x === best[c]);
                          return (
                            <td key={c} className={`n ${isBest ? 'metric-best' : ''}`}>
                              {typeof x === 'number' ? fmt(x, c === 'bias_pct' ? 1 : 2) : '–'}
                            </td>
                          );
                        })}
                        <td className="n">{typeof r.n === 'number' ? fmt(r.n) : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {v.metric_defs && (
            <dl className="small" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px' }}>
              {Object.entries(v.metric_defs).map(([k, d]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt style={{ fontWeight: 600 }}>{METRIC_LABEL[lang][k] ?? k}</dt>
                  <dd style={{ margin: 0, color: 'var(--ink-2)' }}>{loc(METRIC_DEF_ES[k], METRIC_DEF_JAM[k]) ?? d}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
      <div className="grid-2">
        {nationalLines.length > 1 && ns && (
          <div className="card" style={{ boxShadow: 'none' }}>
            <h3>{tx.h_national}</h3>
            <SeriesLegend lines={nationalLines} />
            <LineChart
              n={ns.months.length}
              xLabel={(i) => {
                const { year, month } = parseYm(ns.months[i]);
                return monthYear(year, month);
              }}
              xTicks={nsTicks}
              lines={nationalLines}
              height={260}
              ariaLabel={tx.h_national}
              formatValue={(x) => fmt(x)}
              formatTick={(x) => i18n.fmtCompact(x)}
              directLabels={false}
            />
          </div>
        )}
        {annualLines.length > 0 && an && (
          <div className="card" style={{ boxShadow: 'none' }}>
            <h3>{tx.h_annual}</h3>
            <SeriesLegend lines={annualLines} />
            <LineChart
              n={an.years.length}
              xLabel={(i) => String(an.years[i])}
              xTicks={an.years.map((y, i) => ({ i, label: String(y) })).filter((q) => Number(q.label) % 4 === 0)}
              lines={annualLines}
              height={260}
              ariaLabel={tx.h_annual}
              formatValue={(x) => fmt(x)}
              formatTick={(x) => i18n.fmtCompact(x)}
              directLabels={false}
            />
          </div>
        )}
        {ry && ry.years.length > 0 && (
          <div className="card" style={{ boxShadow: 'none' }}>
            <h3>{tx.h_ratio_year}</h3>
            <LineChart
              n={ry.years.length}
              xLabel={(i) => String(ry.years[i])}
              xTicks={ry.years.map((y, i) => ({ i, label: String(y) })).filter((q) => Number(q.label) % 2 === 0)}
              lines={[{ id: 'ratio', label: tx.ratio, values: ry.viirs_per_modis, color: 'var(--c-snpp)', width: 2.25, dots: true }]}
              height={220}
              ariaLabel={tx.h_ratio_year}
              formatValue={(x) => fmt(x, 2)}
              formatTick={(x) => fmt(x, 1)}
              directLabels={false}
            />
          </div>
        )}
        {rp.length > 0 && (
          <div className="card" style={{ boxShadow: 'none' }}>
            <h3>{tx.h_ratio_prov}</h3>
            <p className="help small">{tx.p_ratio_prov.replace('{n}', fmt(MIN_PROVINCE_MODIS))}</p>
            <div className="bars" role="list">
              {rp.map((r) => (
                <div className="b" role="listitem" key={r.province}>
                  <span>{r.name}</span>
                  <span className="track" aria-hidden="true">
                    <span className="fill" style={{ width: `${(100 * r.viirs_per_modis) / rpMax}%` }} />
                  </span>
                  <span className="num" style={{ textAlign: 'right' }}>
                    {fmt(r.viirs_per_modis, 1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {gainTop.length > 0 && gainTotal > 0 && (
          <div className="card" style={{ boxShadow: 'none' }}>
            <h3>{tx.h_gain}</h3>
            <p className="help small">{tx.p_gain}</p>
            <div className="bars" role="list">
              {gainTop.map(([name, g]) => (
                <div className="b" role="listitem" key={name}>
                  <span title={name}>{FEATURE_LABEL[lang][name] ?? name}</span>
                  <span className="track" aria-hidden="true">
                    <span className="fill" style={{ width: `${(100 * g) / gainTop[0][1]}%`, background: 'var(--ink-2)' }} />
                  </span>
                  <span className="num" style={{ textAlign: 'right' }}>
                    {fmt((100 * g) / gainTotal, 0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {(coverageRows.length > 0 || outages) && (
          <div className="card" style={{ boxShadow: 'none' }}>
            {coverageRows.length > 0 && (
              <>
                <h3>{tx.h_cov}</h3>
                <p className="help small">{tx.p_cov}</p>
                <table className="data" style={{ maxWidth: 420 }}>
                  <tbody>
                    {coverageRows.map(([k, x]) => (
                      <tr key={k}>
                        <td>{k ? testLabel(k) : '80%'}</td>
                        <td className="n">{fmt(100 * (x > 1 ? x / 100 : x), 0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {outages && (
              <>
                <h3 style={{ marginTop: coverageRows.length ? 10 : 0 }}>{tx.h_out}</h3>
                <table className="data">
                  <tbody>
                    {Object.entries(outages).map(([sensor, runs]) => (
                      <tr key={sensor}>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{SENSOR_IDS.has(sensor) ? i18n.t(`s_${sensor}` as Key) : sensor}</td>
                        <td className="small">
                          {Array.isArray(runs) && runs.length
                            ? runs
                                .slice(0, 12)
                                .map((r) => (r[0] === r[1] ? r[0] : `${r[0]} – ${r[1]}`))
                                .join(', ') + (runs.length > 12 ? ` (+${runs.length - 12})` : '')
                            : tx.none}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
