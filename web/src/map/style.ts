// The map's own style. The base is NASA imagery from GIBS (Blue Marble, shaded relief, or Black
// Marble night lights) or a plain relief in the Space Apps blues; under it all runs one terrain
// model (Terrain Tiles: SRTM, GMTED2010 and ETOPO1) that gives the 3D relief and the hillshade.
// Reference labels come from OpenMapTiles and stay quiet so the hotspot data reads first. Focos's
// own layers (the flat hotspot image, provinces, the selected area, the drawing draft) sit between.
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { Lang } from '../i18n.tsx';

export type BaseMap = 'imagery' | 'relief' | 'night' | 'plain';
export const BASE_MAPS: BaseMap[] = ['imagery', 'relief', 'night', 'plain'];

export const LAND = '#0c1d4a';
export const WATER = '#04102b';
const INK = '#e4eaf8';
const HALO = '#07173f';

const gibs = (layer: string, ext: 'jpeg' | 'png') =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.${ext}`;
export const TERRAIN_TILES = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const GIBS_CREDIT = 'Imagery: NASA GIBS';
const TERRAIN_CREDIT = 'Terrain: SRTM, GMTED2010 (USGS), ETOPO1 (NOAA)';

/**
 * Label text in the reading language, falling back to the local name. The islands follow the UN
 * form in English, "Falkland Islands (Malvinas)", and "Islas Malvinas" in Spanish.
 */
const labelField = (lang: 'en' | 'es') => [
  'case',
  ['in', 'Falkland', ['coalesce', ['get', 'name:en'], ['get', 'name'], '']],
  lang === 'es' ? 'Islas Malvinas' : 'Falkland Islands (Malvinas)',
  ['coalesce', ['get', `name:${lang}`], ['get', `name_${lang}`], ['get', 'name:latin'], ['get', 'name']],
];

/** Map data carries English and Spanish names; Patwa readers see the English ones. */
export const nameField = (lang: Lang) => labelField(lang === 'jam' ? 'en' : lang);

/** Ids of the layers each base map shows; everything else in the base group is hidden. */
export const BASE_LAYERS: Record<BaseMap, string[]> = {
  imagery: ['base-imagery', 'hillshade'],
  relief: ['base-relief'],
  night: ['base-night'],
  plain: ['plain-relief', 'plain-water', 'hillshade'],
};
const ALL_BASE_LAYERS = ['base-imagery', 'base-relief', 'base-night', 'plain-relief', 'plain-water', 'hillshade'];

/** The first label layer: data layers (deck.gl columns included) go below it. */
export const FIRST_LABEL = 'label-ocean';

const vis = (on: boolean) => ({ visibility: on ? ('visible' as const) : ('none' as const) });

export function focosStyle(opts: { base: BaseMap; lang: Lang; density: { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] } }): StyleSpecification {
  const { base, lang, density } = opts;
  const shown = new Set(BASE_LAYERS[base]);
  const on = (id: string) => vis(shown.has(id));
  const imagery = { 'raster-fade-duration': 150, 'raster-resampling': 'linear' as const };
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': base === 'plain' ? LAND : '#06102e' } },
    // Bundled Blue Marble keeps Earth opaque from the opening frame, even offline.
    { id: 'earth-base', type: 'raster', source: 'earth-base', paint: { 'raster-fade-duration': 0, 'raster-saturation': -0.12, 'raster-brightness-max': 0.86, 'raster-contrast': 0.06 } },
    {
      id: 'base-imagery',
      type: 'raster',
      source: 'gibs-imagery',
      layout: on('base-imagery'),
      // slightly muted, so the hotspot colours stay the brightest thing on the map
      paint: { ...imagery, 'raster-saturation': -0.12, 'raster-brightness-max': 0.86, 'raster-contrast': 0.06 },
    },
    { id: 'base-relief', type: 'raster', source: 'gibs-relief', layout: on('base-relief'), paint: { ...imagery, 'raster-saturation': -0.2, 'raster-brightness-max': 0.82 } },
    { id: 'base-night', type: 'raster', source: 'gibs-night', layout: on('base-night'), paint: { ...imagery } },
    {
      id: 'plain-relief',
      type: 'color-relief',
      source: 'dem-shade',
      layout: on('plain-relief'),
      paint: {
        'color-relief-color': [
          'interpolate',
          ['linear'],
          ['elevation'],
          0,
          LAND,
          400,
          '#112a63',
          1500,
          '#1d3a7a',
          3000,
          '#34558f',
          5000,
          '#6d86b8',
          6500,
          '#a9b9dc',
        ],
      },
    },
    {
      id: 'plain-water',
      type: 'fill',
      source: 'omt',
      'source-layer': 'water',
      layout: on('plain-water'),
      paint: { 'fill-color': WATER },
    },
    {
      id: 'hillshade',
      minzoom: 6,
      type: 'hillshade',
      source: 'dem-shade',
      layout: on('hillshade'),
      paint: {
        'hillshade-method': 'igor',
        'hillshade-exaggeration': base === 'plain' ? 0.55 : 0.32,
        'hillshade-shadow-color': '#020a24',
        'hillshade-highlight-color': base === 'plain' ? 'rgba(200, 215, 255, 0.35)' : 'rgba(255, 250, 235, 0.25)',
        'hillshade-illumination-anchor': 'map',
        'hillshade-illumination-direction': 315,
      },
    },
    {
      id: 'density',
      type: 'raster',
      source: 'density',
      paint: { 'raster-resampling': 'nearest', 'raster-opacity': 0.94, 'raster-fade-duration': 0 },
    },
    {
      id: 'country-lines',
      type: 'line',
      source: 'omt',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': 'rgba(228, 234, 248, 0.45)', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 7, 1.2] },
    },
    { id: 'prov-fill', type: 'fill', source: 'provinces', paint: { 'fill-color': '#000000', 'fill-opacity': 0 } },
    {
      id: 'prov-line',
      type: 'line',
      source: 'provinces',
      paint: { 'line-color': 'rgba(206, 218, 245, 0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.3] },
    },
    { id: 'region-halo', type: 'line', source: 'region', paint: { 'line-color': HALO, 'line-width': 6, 'line-opacity': 0.85 } },
    { id: 'region-line', type: 'line', source: 'region', paint: { 'line-color': '#ffffff', 'line-width': 2.5 } },
    { id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': '#eafe07', 'fill-opacity': 0.08 } },
    { id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#eafe07', 'line-width': 2, 'line-dasharray': [2, 1.5] } },
    {
      id: 'label-ocean',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'water_name',
      filter: ['all', ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false], ['match', ['get', 'class'], ['ocean', 'sea'], true, false]],
      layout: {
        'text-field': nameField(lang) as never,
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 6, 13],
        'text-letter-spacing': 0.12,
        'text-max-width': 8,
      },
      paint: { 'text-color': 'rgba(174, 196, 238, 0.7)', 'text-halo-color': HALO, 'text-halo-width': 1 },
    },
    {
      id: 'label-country',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'place',
      // Argentina itself is named by the panel; its label would sit among the columns
      filter: ['all', ['==', ['get', 'class'], 'country'], ['!=', ['get', 'iso_a2'], 'AR']],
      layout: {
        'text-field': nameField(lang) as never,
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 6, 12],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.14,
        'text-max-width': 7,
      },
      paint: { 'text-color': 'rgba(228, 234, 248, 0.62)', 'text-halo-color': HALO, 'text-halo-width': 1.1 },
    },
    {
      id: 'label-province',
      type: 'symbol',
      source: 'provinces',
      minzoom: 5,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 8, 13],
        'text-letter-spacing': 0.06,
        'text-max-width': 8,
      },
      paint: { 'text-color': 'rgba(228, 234, 248, 0.72)', 'text-halo-color': HALO, 'text-halo-width': 1.2 },
    },
    {
      id: 'label-city',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'place',
      minzoom: 4,
      filter: [
        'all',
        ['match', ['get', 'class'], ['city', 'town'], true, false],
        ['<=', ['coalesce', ['get', 'rank'], 99], ['step', ['zoom'], 3, 6, 6, 8, 10]],
      ],
      layout: {
        'text-field': nameField(lang) as never,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 9, 13],
        'text-anchor': 'top',
        'text-offset': [0, 0.3],
        'text-max-width': 8,
      },
      paint: { 'text-color': INK, 'text-halo-color': HALO, 'text-halo-width': 1.3, 'text-opacity': 0.82 },
    },
  ];
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      'earth-base': { type: 'raster', tiles: [`${import.meta.env.BASE_URL}earth-base/{z}/{x}/{y}.jpg`], tileSize: 256, maxzoom: 2, attribution: GIBS_CREDIT },
      'gibs-imagery': { type: 'raster', tiles: [gibs('BlueMarble_NextGeneration', 'jpeg')], tileSize: 256, maxzoom: 8, attribution: GIBS_CREDIT },
      'gibs-relief': { type: 'raster', tiles: [gibs('BlueMarble_ShadedRelief_Bathymetry', 'jpeg')], tileSize: 256, maxzoom: 8, attribution: GIBS_CREDIT },
      'gibs-night': { type: 'raster', tiles: [gibs('VIIRS_Black_Marble', 'png')], tileSize: 256, maxzoom: 8, attribution: GIBS_CREDIT },
      dem: { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12, attribution: TERRAIN_CREDIT },
      'dem-shade': { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12 },
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      density: { type: 'image', url: density.url, coordinates: density.coordinates },
      provinces: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      region: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      draft: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers,
  };
}

/** Show one base map: its layers on, the other base layers off. */
export function applyBase(set: (id: string, visible: boolean) => void, base: BaseMap): void {
  const shown = new Set(BASE_LAYERS[base]);
  for (const id of ALL_BASE_LAYERS) set(id, shown.has(id));
}

/** Atmosphere for the globe and the horizon of tilted views: a thin blue limb, dark space beyond. */
export const SKY = {
  'sky-color': '#0b2a6b',
  'horizon-color': '#4f9be8',
  'fog-color': '#0b2a6b',
  'sky-horizon-blend': 0.55,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.85,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 0.9, 8, 0.25],
} as const;
