// Render the calendar to a PNG with title, legend and credits.
import type { MonthAxis } from '../lib/months.ts';
import { indexOf, yearOf } from '../lib/months.ts';
import type { Baseline, Observability } from '../lib/analytics.ts';
import { annualTotals } from '../lib/analytics.ts';
import type { CountScale, Theme } from '../lib/color.ts';
import { inkOn, PCT_BREAKS, PCT_COLORS, Z_COLORS, ZERO } from '../lib/color.ts';
import type { CalMode } from '../state.ts';
import type { I18n } from '../i18n.tsx';
import { cellLook, seriesScale } from './Calendar.tsx';

export interface PngInput {
  axis: MonthAxis;
  values: Float64Array;
  obs: Observability;
  base: Baseline;
  mode: CalMode;
  theme: Theme;
  showValues: boolean;
  scale?: CountScale;
  title: string;
  subtitle: string;
  credit: string;
  i18n: I18n;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function calendarPng(p: PngInput): Promise<Blob> {
  const { axis, values, obs, base, mode, theme, showValues, i18n } = p;
  const surface = cssVar('--surface', theme === 'dark' ? '#1a1a19' : '#fcfcfb');
  const ink = cssVar('--ink', theme === 'dark' ? '#f0efec' : '#161614');
  const ink2 = cssVar('--ink-2', '#52514e');
  const hatch = cssVar('--hatch', '#b9b7ae');
  const hatchBg = cssVar('--hatch-bg', '#f3f2ee');
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  const y0 = yearOf(axis, 0);
  const y1 = yearOf(axis, axis.n - 1);
  const nYears = y1 - y0 + 1;
  const pad = 28;
  const labelW = 46;
  const cw = 50;
  const ch = 22;
  const gap = 2;
  const totalW = 92;
  const headerH = 74;
  const colHeadH = 20;
  const legendH = 64;
  const footH = 30;
  const W = pad * 2 + labelW + 12 * (cw + gap) + totalW;
  const H = pad + headerH + colHeadH + (nYears + 1) * (ch + gap) + 8 + legendH + footH + pad / 2;
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas is not available'));
  ctx.scale(dpr, dpr);
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, W, H);

  // hatch pattern for months without observations
  const pc = document.createElement('canvas');
  pc.width = 6;
  pc.height = 6;
  const pctx = pc.getContext('2d')!;
  pctx.fillStyle = hatchBg;
  pctx.fillRect(0, 0, 6, 6);
  pctx.strokeStyle = hatch;
  pctx.lineWidth = 1.5;
  pctx.beginPath();
  pctx.moveTo(-1, 7);
  pctx.lineTo(7, -1);
  pctx.moveTo(5, 7);
  pctx.lineTo(7, 5);
  pctx.moveTo(-1, 1);
  pctx.lineTo(1, -1);
  pctx.stroke();
  const hatchPattern = ctx.createPattern(pc, 'repeat');

  ctx.fillStyle = ink;
  ctx.font = `700 18px ${font}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(p.title, pad, pad + 18);
  ctx.font = `400 13px ${font}`;
  ctx.fillStyle = ink2;
  ctx.fillText(p.subtitle, pad, pad + 40);

  const scale = p.scale ?? seriesScale(values, obs, theme);
  const fmt1 = (x: number) => i18n.fmt(x, 1);
  const top = pad + headerH;
  const x0 = pad + labelW;

  ctx.font = `600 11px ${font}`;
  ctx.fillStyle = ink2;
  ctx.textAlign = 'center';
  for (let c = 1; c <= 12; c++) ctx.fillText(i18n.monthShort(c), x0 + (c - 1) * (cw + gap) + cw / 2, top + 13);
  ctx.textAlign = 'left';
  ctx.fillText(i18n.t('yearTotal'), x0 + 12 * (cw + gap) + 6, top + 13);

  const annual = annualTotals(values, axis, obs);
  const maxAnnual = Math.max(1, ...annual.map((a) => a.total));
  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };

  for (let r = 0; r < nYears; r++) {
    const y = y0 + r;
    const yy = top + colHeadH + r * (ch + gap);
    ctx.font = `500 11px ${font}`;
    ctx.fillStyle = ink2;
    ctx.textAlign = 'right';
    ctx.fillText(String(y), x0 - 8, yy + 15);
    for (let c = 1; c <= 12; c++) {
      const m = indexOf(axis, y, c);
      const lk = cellLook(m, { axis, values, obs, base, mode, theme, showValues }, scale, i18n.fmtCompact, fmt1);
      const xx = x0 + (c - 1) * (cw + gap);
      roundRect(xx, yy, cw, ch, 3);
      if (lk.kind === 'value' || lk.kind === 'nobase') {
        ctx.fillStyle = lk.fill;
        ctx.fill();
        if (lk.kind === 'nobase') {
          ctx.save();
          ctx.setLineDash([1, 2]);
          ctx.strokeStyle = ink2;
          ctx.lineWidth = 1;
          ctx.strokeRect(xx + 3.5, yy + 3.5, cw - 7, ch - 7);
          ctx.restore();
        }
        if (lk.partial) {
          ctx.save();
          ctx.setLineDash([3, 2]);
          ctx.strokeStyle = inkOn(lk.fill);
          ctx.lineWidth = 1.2;
          ctx.strokeRect(xx + 2.5, yy + 2.5, cw - 5, ch - 5);
          ctx.restore();
        }
        if (lk.text) {
          ctx.fillStyle = inkOn(lk.fill);
          ctx.font = `600 11px ${font}`;
          ctx.textAlign = 'center';
          ctx.fillText(lk.text, xx + cw / 2, yy + 15);
        }
      } else if (hatchPattern) {
        ctx.fillStyle = hatchPattern;
        ctx.fill();
      }
    }
    const a = annual.find((q) => q.year === y);
    if (a && a.months > 0) {
      const xx = x0 + 12 * (cw + gap) + 6;
      const w = Math.max(1, ((totalW - 12) * a.total) / maxAnnual);
      ctx.fillStyle = ink2;
      ctx.globalAlpha = a.complete ? 0.6 : 0.25;
      ctx.fillRect(xx, yy + ch - 4, w, 3);
      ctx.globalAlpha = 1;
      ctx.font = `500 11px ${font}`;
      ctx.textAlign = 'left';
      ctx.fillText(i18n.fmtCompact(a.total) + (a.complete ? '' : '*'), xx, yy + 13);
    }
  }
  // median row
  const my = top + colHeadH + nYears * (ch + gap) + 6;
  ctx.font = `600 11px ${font}`;
  ctx.fillStyle = ink2;
  ctx.textAlign = 'right';
  ctx.fillText(i18n.t('medianRow'), x0 - 8, my + 15);
  for (let c = 1; c <= 12; c++) {
    const v = base.months[c - 1].median;
    const xx = x0 + (c - 1) * (cw + gap);
    roundRect(xx, my, cw, ch, 3);
    if (Number.isFinite(v)) {
      const fill = scale.color(v);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.fillStyle = inkOn(fill);
      ctx.textAlign = 'center';
      ctx.fillText(i18n.fmtCompact(v), xx + cw / 2, my + 15);
    } else if (hatchPattern) {
      ctx.fillStyle = hatchPattern;
      ctx.fill();
    }
  }

  // legend
  const ly = my + ch + 22;
  ctx.textAlign = 'left';
  ctx.font = `600 11px ${font}`;
  ctx.fillStyle = ink2;
  let colors: string[];
  let labels: string[];
  let title: string;
  if (mode === 'counts') {
    colors = scale.colors;
    labels = colors.map((_, i) => (i === 0 ? `<${i18n.fmt(scale.breaks[0])}` : `${i18n.fmt(scale.breaks[i - 1])}+`));
    title = i18n.t('legendCounts');
  } else if (mode === 'anomaly') {
    colors = Z_COLORS[theme];
    labels = ['< -2', '-2 / -1', '-1 / 1', '1 / 2', '≥ 2'];
    title = i18n.t('legendAnomaly', { first: base.first, last: base.last });
  } else {
    colors = PCT_COLORS[theme];
    labels = colors.map((_, i) => (i === 0 ? `<${PCT_BREAKS[0]}%` : `${PCT_BREAKS[i - 1]}%+`));
    title = i18n.t('legendPct', { first: base.first, last: base.last });
  }
  ctx.fillText(title, pad, ly);
  const sw = 44;
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(pad + i * (sw + 2), ly + 6, sw, 10);
    ctx.fillStyle = ink2;
    ctx.font = `400 10px ${font}`;
    ctx.fillText(labels[i], pad + i * (sw + 2), ly + 29);
  });
  let lx = pad + colors.length * (sw + 2) + 18;
  if (mode === 'counts') {
    ctx.fillStyle = ZERO[theme];
    ctx.fillRect(lx, ly + 6, 18, 10);
    ctx.fillStyle = ink2;
    ctx.fillText(i18n.t('legendZero'), lx + 22, ly + 15);
    lx += 26 + ctx.measureText(i18n.t('legendZero')).width + 14;
  }
  if (hatchPattern) {
    ctx.fillStyle = hatchPattern;
    ctx.fillRect(lx, ly + 6, 18, 10);
  }
  ctx.fillStyle = ink2;
  ctx.fillText(i18n.t('legendNotObserved'), lx + 22, ly + 15);

  ctx.font = `400 10.5px ${font}`;
  ctx.fillStyle = ink2;
  ctx.fillText(p.credit, pad, H - pad / 2 - 6);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}
