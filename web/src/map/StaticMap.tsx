// The map for browsers without WebGL 2: the same per-cell values drawn flat on a canvas, with the
// provinces and the selected area, and the same click-to-select and readout as the full map.
import { useEffect, useMemo, useRef, useState } from 'react';
import { findCell } from '../bundle/table.ts';
import type { BBox, GeoFeature } from '../lib/region.ts';
import { cellIdAt, provinceRegion, regionBBox, regionOutline } from '../lib/region.ts';
import { useI18n } from '../i18n.tsx';
import { useModel } from '../model.ts';
import { useUi } from '../store.ts';
import { densityImage } from './density.ts';
import { LAND } from './style.ts';
import { useCellValues } from './useCellValues.ts';

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;
const RAD = Math.PI / 180;

interface View {
  x0: number; // left edge in radians of longitude
  y0: number; // top edge in mercator units
  k: number; // pixels per unit
}

function fit(b: BBox, w: number, h: number, pad: number): View {
  const xw = (b[2] - b[0]) * RAD;
  const yn = mercY(b[3]);
  const ys = mercY(b[1]);
  const k = Math.min((w - 2 * pad) / Math.max(1e-6, xw), (h - 2 * pad) / Math.max(1e-6, yn - ys));
  return { x0: b[0] * RAD - (w / k - xw) / 2, y0: yn + (h / k - (yn - ys)) / 2, k };
}
const toPx = (v: View, lon: number, lat: number): [number, number] => [(lon * RAD - v.x0) * v.k, (v.y0 - mercY(lat)) * v.k];
const toLngLat = (v: View, x: number, y: number): [number, number] => [(x / v.k + v.x0) / RAD, invMercY(v.y0 - y / v.k)];

function tracePolygon(ctx: CanvasRenderingContext2D, v: View, f: GeoFeature) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => {
        const [x, y] = toPx(v, lon, lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
  }
}

export default function StaticMap() {
  // the worldwide view has no plain fallback for its live globe; the Argentina record does
  const world = useUi((s) => s.view === 'explore');
  return world ? <WorldNote /> : <ArgentinaMap />;
}

function WorldNote() {
  const { t } = useI18n();
  return (
    <div className="map static-map static-world" data-3d={false} data-mode="static" data-ready="true">
      <div className="static-world-card overlay-card">
        <p>{t('staticWorld')}</p>
        <button type="button" className="btn small" onClick={() => useUi.getState().set({ view: 'history' })}>
          {t('navArgentina')}
        </button>
      </div>
    </div>
  );
}

function ArgentinaMap() {
  const { t } = useI18n();
  const { manifest, table, boundaries } = useModel();
  const region = useUi((s) => s.region);
  const showBorders = useUi((s) => s.showBorders);
  const { values, scale, inRegion, nothing } = useCellValues();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const bbox = useMemo(() => regionBBox(region, manifest, boundaries), [region, manifest, boundaries]);
  const outline = useMemo(() => regionOutline(region, boundaries), [region, boundaries]);
  const view = useMemo(() => (size.w ? fit(bbox, size.w, size.h, Math.min(48, size.w * 0.06)) : null), [bbox, size]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (nothing) {
      setImg(null);
      return;
    }
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = densityImage(values, inRegion, table, manifest.grid, scale);
  }, [values, inRegion, table, manifest.grid, scale, nothing]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !view) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = LAND;
    ctx.fillRect(0, 0, size.w, size.h);
    if (boundaries) {
      ctx.beginPath();
      for (const f of boundaries.features) tracePolygon(ctx, view, f);
      ctx.fillStyle = '#10235a';
      ctx.fill('evenodd');
    }
    const g = manifest.grid;
    if (img) {
      const [x0, y0] = toPx(view, g.lon0, g.lat0 + g.ny * g.res);
      const [x1, y1] = toPx(view, g.lon0 + g.nx * g.res, g.lat0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    }
    if (boundaries && showBorders) {
      ctx.beginPath();
      for (const f of boundaries.features) tracePolygon(ctx, view, f);
      ctx.strokeStyle = 'rgba(206, 218, 245, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    if (outline) {
      ctx.beginPath();
      tracePolygon(ctx, view, outline);
      ctx.strokeStyle = '#07173f';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }, [view, size, img, boundaries, outline, showBorders, manifest.grid]);

  const at = (e: React.MouseEvent) => {
    if (!view || !canvas.current) return null;
    const r = canvas.current.getBoundingClientRect();
    return toLngLat(view, e.clientX - r.left, e.clientY - r.top);
  };
  const cellAt = (lon: number, lat: number) => {
    const id = cellIdAt(lon, lat, manifest.grid);
    return { id, i: id >= 0 ? findCell(table, id) : -1 };
  };

  return (
    <div className="map static-map" ref={box} data-3d={false} data-mode="static" data-ready={Boolean(view)}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={t('mapLabel')}
        onClick={(e) => {
          const p = at(e);
          if (!p) return;
          const { i } = cellAt(p[0], p[1]);
          const prov = i >= 0 ? table.cellProvince[i] : 255;
          if (prov !== 255 && manifest.provinces.some((q) => q.id === prov)) useUi.getState().set({ region: provinceRegion(prov, manifest) });
        }}
        onMouseMove={(e) => {
          const p = at(e);
          if (!p) return;
          const { id, i } = cellAt(p[0], p[1]);
          useUi.getState().set({ readout: { lon: p[0], lat: p[1], cell: i, cellId: i >= 0 ? table.cellId[i] : id } });
        }}
        onMouseLeave={() => useUi.getState().set({ readout: null })}
      />
      <p className="map-note static-note">{t('staticNote')}</p>
    </div>
  );
}
