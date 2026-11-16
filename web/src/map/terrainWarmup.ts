/** Small, bounded destination warmup; browser HTTP cache is shared with map tile requests. */
export function destinationTiles(lon:number,lat:number):string[]{
 const urls:string[]=[];
 for(const [kind,z,radius] of [['dem',11,1],['image',12,1],['image',14,0]] as const){
  const n=2**z,clamped=Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180;
  const x=Math.floor((lon+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(clamped))/Math.PI)/2*n);
  for(let dx=-radius;dx<=radius;dx++)for(let dy=-radius;dy<=radius;dy++){
   const tx=((x+dx)%n+n)%n,ty=y+dy;if(ty<0||ty>=n)continue;
   urls.push(kind==='dem'?`https://tiles.mapterhorn.com/${z}/${tx}/${ty}.webp`:`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`);
  }
 }
 return urls;
}
export function createTerrainWarmup(){
 const seen=new Set<string>();let queue:string[]=[];let running=0,stopped=false;
 const pump=()=>{while(!stopped&&running<4&&queue.length){const url=queue.shift()!;seen.add(url);running++;
  const img=new Image();img.crossOrigin='anonymous';let done=false;
  const finish=()=>{if(done)return;done=true;clearTimeout(timer);running--;pump();};
  const timer=setTimeout(finish,7000);img.onload=finish;img.onerror=finish;img.src=url;
 }};
 return {warm(lon:number,lat:number){if(stopped)return;queue=[];for(const url of destinationTiles(lon,lat)){if(!seen.has(url)){queue.push(url);}}if(seen.size>200)seen.clear();pump();},dispose(){stopped=true;queue=[];}};
}
