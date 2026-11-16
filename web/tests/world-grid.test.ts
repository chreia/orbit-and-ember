import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateWorld } from '../server/worldGrid.mjs';

test('global cells count nominal and high detections without moving them to Argentina', () => {
  const time = Date.parse('2026-11-15T00:00:00Z');
  const result = aggregateWorld([
    { lon: -120.1, lat: 39.1, timestamp: time, confidence: 'nominal' },
    { lon: -120.2, lat: 39.2, timestamp: time + 1000, confidence: 'high' },
    { lon: 20.1, lat: -10.1, timestamp: time, confidence: 'nominal' },
    { lon: 20.1, lat: -10.1, timestamp: time, confidence: 'low' },
  ], '2026-11-15T01:00:00Z');
  assert.equal(result.detections, 3);
  assert.equal(result.cells.length, 2);
  assert.equal(result.cells.find((cell: { lon: number }) => cell.lon < 0)?.count, 2);
  assert.equal(result.cells.find((cell: { lon: number }) => cell.lon > 0)?.count, 1);
  assert.equal(result.hourlyDetections.reduce((sum: number, value: number) => sum + value, 0), result.detections);
  assert.equal(result.cells[0].hours.length, 24);
});
