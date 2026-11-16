import {useEffect,useRef,useState} from 'react';
import type {FirePoint} from '../lib/fireFeed.ts';
import type {Map} from 'maplibre-gl';
import {moveOnEarth,travelSpeed} from '../lib/terrainExperience.ts';
export type TravelMode='orbit'|'flight'|'ground';
/** label: the canvas's accessible name, already in the reader's language. */
export function useTerrainNavigation(map:React.RefObject<Map|null>,ready:boolean,mode:TravelMode,speedMultiplier:number,flat:boolean,target:FirePoint|null,label:string){
  const keys=useRef(new Set<string>());
  const clearance=useRef(180);
  const [telemetry,setTelemetry]=useState({lon:0,lat:0,bearing:0,clearance:180});
  const hold=(key:string,down:boolean)=>{if(down)keys.current.add(key);else keys.current.delete(key);};
  useEffect(()=>{const m=map.current;if(m&&ready)m.getCanvas().setAttribute('aria-label',label);},[map,ready,label]);
  useEffect(()=>{
    const m=map.current;if(!m||!ready)return;
    const canvas=m.getCanvas();canvas.tabIndex=0;
    keys.current.clear();m.stop();
    m.setCenterClampedToGround(true);
    m.dragPan.enable();m.dragRotate.enable();m.scrollZoom.enable();m.touchZoomRotate.enable();m.keyboard.disable();
    m.jumpTo({pitch:flat?0:mode==='ground'?65:mode==='flight'?60:m.getZoom()<5?0:60,zoom:mode==='ground'?13:mode==='flight'?12:m.getZoom(),elevation:m.queryTerrainElevation(m.getCenter())??0});
    const accepted=new Set(['w','a','s','d','q','e','arrowup','arrowdown','arrowleft','arrowright','shift']);
    const down=(e:KeyboardEvent)=>{if(document.activeElement!==canvas||!accepted.has(e.key.toLowerCase()))return;e.preventDefault();hold(e.key.toLowerCase(),true);};
    const up=(e:KeyboardEvent)=>hold(e.key.toLowerCase(),false);
    const clear=()=>keys.current.clear();
    const focus=()=>canvas.focus({preventScroll:true});
    const pointerDown=()=>focus();
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',clear);
    canvas.addEventListener('blur',clear);canvas.addEventListener('pointerdown',pointerDown);
    let frame=0,previous=performance.now(),lastHud=0;
    const tick=(time:number)=>{
      const dt=Math.min(.05,(time-previous)/1000);previous=time;
      const k=keys.current,axis=(a:string,b:string)=>Number(k.has(a))-Number(k.has(b));
      if(k.size){
        const c=m.getCenter(),speed=travelSpeed(m.getZoom(),mode==='ground',speedMultiplier,k.has('shift'))*dt;
        m.jumpTo({center:moveOnEarth(c.lng,c.lat,m.getBearing(),axis('w','s')*speed,axis('d','a')*speed),bearing:m.getBearing()+axis('arrowright','arrowleft')*45*dt,pitch:flat?0:Math.max(0,Math.min(85,m.getPitch()+axis('arrowup','arrowdown')*25*dt)),zoom:Math.max(0,Math.min(19,m.getZoom()+axis('q','e')*dt))});
      }
      if(time-lastHud>300){lastHud=time;const c=m.getCenter();const next={lon:c.lng,lat:c.lat,bearing:m.getBearing(),clearance:clearance.current};setTelemetry(old=>Object.keys(next).every(key=>old[key as keyof typeof old]===next[key as keyof typeof next])?old:next);}
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);clear();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear);canvas.removeEventListener('blur',clear);canvas.removeEventListener('pointerdown',pointerDown);};
  },[ready,mode,map,speedMultiplier,flat,target]);
  return {hold,telemetry};
}
