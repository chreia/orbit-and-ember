import test from 'node:test';
import assert from 'node:assert/strict';
import {destinationTiles} from '../src/map/terrainWarmup.ts';
test('warmup is bounded, unique and wraps correctly at poles and date line',()=>{
 for(const [lon,lat] of [[-71.38,-36.86],[180,85],[-180,-85],[0,0]]){
  const urls=destinationTiles(lon,lat);assert.ok(urls.length<=19);assert.equal(new Set(urls).size,urls.length);
  for(const url of urls){const parts=new URL(url).pathname.split('/').slice(-3).map(x=>Number(x.replace('.webp','')));const [z,a,b]=parts;assert.ok(a>=0&&a<2**z);assert.ok(b>=0&&b<2**z);}
 }
});
