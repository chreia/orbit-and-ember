import type {FirePoint} from './fireFeed.ts';
export function moveOnEarth(lon:number,lat:number,bearing:number,forward:number,right:number):[number,number]{
  const b=bearing*Math.PI/180;
  const north=forward*Math.cos(b)-right*Math.sin(b),east=forward*Math.sin(b)+right*Math.cos(b);
  return [((lon+east/(111320*Math.max(.08,Math.cos(lat*Math.PI/180)))+540)%360)-180,Math.max(-80,Math.min(80,lat+north/111320))];
}
export function replayPoints(points:FirePoint[],date:string,trails:boolean){
  const end=Date.parse(date+'T23:59:59Z');
  return points.filter(p=>trails?p.timestamp<=end:p.date===date);
}
// Spatial separation prevents a teleport menu filled with repeat overpasses of one place.
export function hotspotDestinations(points:FirePoint[],limit=6):FirePoint[]{
  const result:FirePoint[]=[];
  for(const p of [...points].sort((a,b)=>(b.frp??0)-(a.frp??0))){
    if(result.every(q=>Math.hypot((q.lon-p.lon)*Math.cos(p.lat*Math.PI/180),q.lat-p.lat)>.07))result.push(p);
    if(result.length===limit)break;
  }
  return result;
}

export function travelSpeed(zoom:number,ground:boolean,multiplier:number,boost:boolean){
  const base=ground?800:Math.max(1200,Math.min(1500000,1200*2**(13-zoom)));
  return base*multiplier*(boost?5:1);
}

// Nearest observation on a sphere, including selections across the date line.
export function nearestHotspot(points:FirePoint[],lon:number,lat:number):FirePoint|null{
 let best:FirePoint|null=null,score=-Infinity;
 const rad=Math.PI/180;
 for(const p of points){const next=Math.sin(lat*rad)*Math.sin(p.lat*rad)+Math.cos(lat*rad)*Math.cos(p.lat*rad)*Math.cos((p.lon-lon)*rad);if(next>score){best=p;score=next;}}
 return best;
}
