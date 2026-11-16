import type {FirePoint} from './fireFeed.ts';
/** Same half-open cells and confidence/time filter as the globe aggregation. */
export function observationsInCell(points:FirePoint[], cell:{lon:number;lat:number}, start:number, end:number) {
 return points.filter(p => p.timestamp >= start && p.timestamp < end && ['n','h','nominal','high'].includes(p.confidence.toLowerCase()) && Math.min(719,Math.floor((p.lon+180)/.5)) === Math.round((cell.lon+180)/.5-.5) && Math.min(339,Math.floor((p.lat+85)/.5)) === Math.round((cell.lat+85)/.5-.5)).sort((a,b)=>b.timestamp-a.timestamp || (b.frp??0)-(a.frp??0));
}
