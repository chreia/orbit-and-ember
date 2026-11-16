import test from 'node:test';
import assert from 'node:assert/strict';
import {observationsInCell} from '../src/lib/globeSelection.ts';
import {aggregateWorld} from '../server/worldGrid.mjs';
import type {FirePoint} from '../src/lib/fireFeed.ts';
test('bar selection resolves exactly the grid observations, including boundaries and replay cutoff',()=>{
 const start=Date.parse('2026-11-14T12:00Z');
 const points=[[-120,39,1,'n'],[-119.5,39,1,'n'],[-119.8,39.1,2,'h'],[-119.8,39.1,1,'l'],[180,85,1,'h']].map(([lon,lat,h,confidence])=>({lon,lat,timestamp:start+Number(h)*3600000,confidence,frp:1}) as FirePoint);
 const grid=aggregateWorld(points,'2026-11-15T12:00Z');
 for(const cell of grid.cells) assert.equal(observationsInCell(points,cell,start,start+86400000).length,cell.count);
 assert.equal(observationsInCell(points,{lon:-119.75,lat:39.25},start,start+2*3600000).length,1);
 assert.equal(observationsInCell(points,{lon:10.25,lat:10.25},start,start+86400000).length,0);
});
