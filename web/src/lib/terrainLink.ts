import type {FirePoint} from './fireFeed.ts';
export interface TerrainSelection {point:FirePoint; points:FirePoint[]; historical:boolean; returnUrl:string}
export function openObservation(point:FirePoint,points:FirePoint[],historical:boolean){
 const context:TerrainSelection={point,points:points.filter(p=>Math.abs(p.lat-point.lat)<3&&Math.abs(p.lon-point.lon)<3),historical,returnUrl:location.href};
 const key=`focos-observation-${Date.now()}`;
 sessionStorage.setItem(key,JSON.stringify(context));
 const url=new URL(location.href);url.search=new URLSearchParams({terrain:'1',observation:key,lon:String(point.lon),lat:String(point.lat),zoom:'13'}).toString();location.assign(url);
}
export function readObservation():TerrainSelection|null{
 try {const key=new URLSearchParams(location.search).get('observation');if(!key)return null;const data=JSON.parse(sessionStorage.getItem(key)??'null');return data&&Array.isArray(data.points)&&Number.isFinite(data.point?.lon)&&Number.isFinite(data.point?.lat)?data:null;}catch{return null;}
}
