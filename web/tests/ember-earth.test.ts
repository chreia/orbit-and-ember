import assert from 'node:assert/strict';
import { test } from 'node:test';
import { earthReport, resolveEarthArea, wantsAnomaly, wantsEarthSelection, type EarthAtlas } from '../src/global/emberEarth.ts';

const months = Array.from({ length: 288 }, (_, i) => i % 12 === 7 ? 20_000 : 2_000);
months[23 * 12 + 7] = 80_000;
const atlas: EarthAtlas = {
  history: { sourceUrl: '', world: months, countries: {
    USA: { name: 'United States', months },
    ZAF: { name: 'South Africa', months },
    BRA: { name: 'Brazil', months },
  } },
  bounds: { USA: [-125, 24, -66, 49], ZAF: [16, -35, 33, -22], BRA: [-74, -34, -34, 6] },
};

test('Ember resolves country aliases and specific places before broader regions', () => {
  assert.equal(resolveEarthArea('Show me the US', atlas)?.code, 'USA');
  assert.equal(resolveEarthArea('What looks unusual in South Africa?', atlas)?.name, 'South Africa');
  assert.equal(resolveEarthArea('Take me to the Amazon rainforest', atlas)?.name, 'Amazon Basin');
  assert.equal(resolveEarthArea('Focus on California', atlas)?.historyCode, 'USA');
  assert.equal(resolveEarthArea('Show the whole world', atlas)?.code, 'world');
  assert.equal(wantsEarthSelection('Explain the globe'), false);
  assert.equal(wantsEarthSelection('outline argentina'), true);
  assert.equal(wantsEarthSelection('outline new york'), true);
  assert.equal(resolveEarthArea('outline new york', atlas)?.name, 'New York');
  assert.equal(resolveEarthArea('highlight NYC', atlas)?.name, 'New York City');
  assert.equal(resolveEarthArea('outline Atlantis', atlas), null);
  assert.equal(resolveEarthArea('outline Monaco', atlas)?.name, 'Monaco');
  assert.equal(resolveEarthArea('outline the Vatican', atlas)?.name, 'Vatican City');
  assert.equal(resolveEarthArea('outline Marshall Islands', atlas)?.name, 'Marshall Islands');
  assert.equal(resolveEarthArea('outlne brazill please', atlas)?.name, 'Brazil');
  assert.equal(resolveEarthArea('take me to californa', atlas)?.name, 'California');
  assert.equal(resolveEarthArea('argentinia', { ...atlas, history: { ...atlas.history, countries: { ARG: { name: 'Argentina', months } } }, bounds: { ARG: [-74,-55,-53,-21] } })?.name, 'Argentina');
  assert.equal(resolveEarthArea('outline new yrok', atlas)?.name, 'New York');
  assert.equal(resolveEarthArea('explain globe', atlas), null);
});

test('Ember separates current cells from the historical country baseline', () => {
  const area = resolveEarthArea('Show California anomalies', atlas)!;
  const report = earthReport(area, atlas, [
    { lon: -120, lat: 38, count: 7 },
    { lon: -117, lat: 34, count: 3 },
    { lon: -80, lat: 40, count: 90 },
  ]);
  assert.equal(report.detections, 10);
  assert.equal(report.activeCells, 2);
  assert.equal(report.historicalName, 'United States');
  assert.equal(report.peakMonths[0], 7);
  assert.equal(report.unusual?.month, 7);
  assert.equal(report.unusual?.multiple, 4);
  assert.equal(wantsAnomaly('Tell me about anomalies in California'), true);
  assert.equal(wantsEarthSelection('Tell me about anomalies in California'), true);
});

test('Ember identifies below-usual historical months without calling live detections an anomaly', () => {
  const lower = [...months];
  lower[23 * 12 + 2] = 100;
  const localAtlas: EarthAtlas = { ...atlas, history: { ...atlas.history, countries: {
    ...atlas.history.countries, BRA: { name: 'Brazil', months: lower },
  } } };
  const area = resolveEarthArea('Show anomalies in Brazil', localAtlas)!;
  const report = earthReport(area, localAtlas, [{ lon: -60, lat: -10, count: 4 }]);
  assert.equal(report.unusual?.direction, 'below');
  assert.equal(report.unusual?.month, 2);
  assert.equal(report.detections, 4);
});
