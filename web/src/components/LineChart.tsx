// Small dependency-free SVG line chart: thin lines, optional interval bands, crosshair tooltip
// listing every series, keyboard stepping, and direct labels at the line ends.
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useWidth } from '../hooks.ts';
import { LineKey, useTooltip } from './Tooltip.tsx';

export interface LineSpec {
  id: string;
  label: string;
  values: ArrayLike<number>;
  color: string;
  width?: number;
  dash?: string;
  dots?: boolean;
  /** shaded interval drawn under the line */
  band?: { lo: ArrayLike<number>; hi: ArrayLike<number>; label?: string };
  /** hide from direct labels (still in legend and tooltip) */
  noDirect?: boolean;
}

export interface LineChartProps {
  n: number;
  xLabel: (i: number) => string;
  xTicks: { i: number; label: string }[];
  lines: LineSpec[];
  log?: boolean;
  height?: number;
  annotations?: { i: number; label: string }[];
  ariaLabel: string;
  formatValue: (v: number) => string;
  formatTick?: (v: number) => string;
  directLabels?: boolean;
  tipExtra?: (i: number) => ReactNode;
  /** x positions are band centres (for 12-month profiles) */
  bandX?: boolean;
}

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function LineChart(props: LineChartProps) {
  const { n, xLabel, xTicks, lines, log = false, height = 300, annotations = [], ariaLabel, formatValue, directLabels = true, tipExtra, bandX = false } = props;
  const formatTick = props.formatTick ?? formatValue;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const tip = useTooltip();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverI, setHoverI] = useState<number | null>(null);

  const narrow = width < 520;
  const margin = { top: annotations.length ? 22 : 10, right: directLabels && !narrow ? 104 : 14, bottom: 26, left: 50 };
  const plotW = Math.max(10, width - margin.left - margin.right);
  const plotH = Math.max(10, height - margin.top - margin.bottom);

  const { yMin, yMax, ticks } = useMemo(() => {
    let max = 0;
    let minPos = Infinity;
    for (const l of lines) {
      const arrs = [l.values, l.band?.hi, l.band?.lo].filter(Boolean) as ArrayLike<number>[];
      for (const a of arrs) {
        for (let i = 0; i < a.length; i++) {
          const v = a[i];
          if (!Number.isFinite(v)) continue;
          if (v > max) max = v;
          if (v > 0 && v < minPos) minPos = v;
        }
      }
    }
    if (!(max > 0)) max = 1;
    if (log) {
      const lo = 10 ** Math.floor(Math.log10(Number.isFinite(minPos) ? Math.max(minPos, 0.1) : 1));
      const hi = 10 ** Math.ceil(Math.log10(max * 1.05));
      const t: number[] = [];
      const decades = Math.round(Math.log10(hi / lo));
      for (let v = lo; v <= hi * 1.0001; v *= 10) {
        t.push(v);
        if (decades <= 2) {
          if (v * 2 < hi) t.push(v * 2);
          if (v * 5 < hi) t.push(v * 5);
        }
      }
      return { yMin: lo, yMax: hi, ticks: t.sort((a, b) => a - b) };
    }
    const step = niceStep(max, 5);
    const top = Math.ceil((max * 1.04) / step) * step;
    const t: number[] = [];
    for (let v = 0; v <= top + step / 2; v += step) t.push(v);
    return { yMin: 0, yMax: top, ticks: t };
  }, [lines, log]);

  const x = (i: number) => (bandX ? margin.left + ((i + 0.5) / n) * plotW : margin.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW));
  const y = (v: number) => {
    if (log) {
      const vv = Math.max(v, yMin);
      return margin.top + plotH - ((Math.log10(vv) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * plotH;
    }
    return margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  };
  const valid = (v: number) => Number.isFinite(v) && (!log || v > 0);

  const pathOf = (vals: ArrayLike<number>) => {
    let d = '';
    let pen = false;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (!valid(v)) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const bandOf = (lo: ArrayLike<number>, hi: ArrayLike<number>) => {
    // one polygon per contiguous run where both bounds are valid and differ somewhere
    let d = '';
    let i = 0;
    while (i < hi.length) {
      while (i < hi.length && !(valid(hi[i]) && valid(lo[i]))) i++;
      const start = i;
      while (i < hi.length && valid(hi[i]) && valid(lo[i])) i++;
      const end = i - 1;
      if (end < start) continue;
      let widthAny = false;
      for (let k = start; k <= end; k++) if (hi[k] - lo[k] > 1e-9) widthAny = true;
      if (!widthAny) continue;
      d += `M${x(start).toFixed(1)},${y(hi[start]).toFixed(1)}`;
      for (let k = start + 1; k <= end; k++) d += `L${x(k).toFixed(1)},${y(hi[k]).toFixed(1)}`;
      for (let k = end; k >= start; k--) d += `L${x(k).toFixed(1)},${y(lo[k]).toFixed(1)}`;
      d += 'Z';
    }
    return d;
  };

  // direct labels at each line's last valid point, pushed apart vertically
  const labels = useMemo(() => {
    if (!directLabels || narrow || width === 0) return [];
    const items = lines
      .filter((l) => !l.noDirect)
      .map((l) => {
        let last = -1;
        for (let i = l.values.length - 1; i >= 0; i--) {
          if (valid(l.values[i])) {
            last = i;
            break;
          }
        }
        return last < 0 ? null : { id: l.id, label: l.label, y: y(l.values[last]), x: x(last), color: l.color };
      })
      .filter(Boolean) as { id: string; label: string; y: number; x: number; color: string }[];
    items.sort((a, b) => a.y - b.y);
    const gap = 13;
    for (let k = 1; k < items.length; k++) if (items[k].y - items[k - 1].y < gap) items[k].y = items[k - 1].y + gap;
    const overflow = items.length ? items[items.length - 1].y - (margin.top + plotH) : 0;
    if (overflow > 0) for (const it of items) it.y -= overflow;
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, width, height, log, yMax, yMin, directLabels, narrow]);

  const tipContent = (i: number): ReactNode => (
    <div>
      <div className="tt-title">{xLabel(i)}</div>
      {lines.map((l) => {
        const v = l.values[i];
        return (
          <div className="tt-row" key={l.id}>
            <span className="tt-key">
              <LineKey color={l.color} dash={l.dash} />
              {l.label}
            </span>
            <span className="v">{Number.isFinite(v) ? formatValue(v) : '–'}</span>
          </div>
        );
      })}
      {lines
        .filter((l) => l.band && l.band.hi[i] - l.band.lo[i] > 1e-9)
        .map((l) => (
          <div className="tt-note" key={`${l.id}-band`}>
            {l.band?.label ?? '80%'}: {formatValue(l.band!.lo[i])} – {formatValue(l.band!.hi[i])}
          </div>
        ))}
      {tipExtra?.(i)}
    </div>
  );

  const indexAt = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const px = clientX - rect.left;
    const f = bandX ? (px - margin.left) / plotW * n - 0.5 : ((px - margin.left) / plotW) * (n - 1);
    return Math.max(0, Math.min(n - 1, Math.round(f)));
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const i = indexAt(e.clientX);
    if (i === null) return;
    setHoverI(i);
    tip.show({ x: e.clientX, y: e.clientY, content: tipContent(i) });
  };
  const onLeave = () => {
    setHoverI(null);
    tip.hide();
  };
  const onPointerLeave = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'touch') onLeave();
  };
  const showAt = (i: number) => {
    setHoverI(i);
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = rect.left + x(i);
    tip.show({ x: 0, y: 0, anchor: new DOMRect(px - 1, rect.top + margin.top, 2, plotH), content: tipContent(i) });
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const cur = hoverI ?? n - 1;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') return onLeave();
    if (next !== null) {
      e.preventDefault();
      showAt(next);
    }
  };

  return (
    <div className="chart" ref={wrapRef}>
      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={onPointerLeave}
          onFocus={() => showAt(hoverI ?? n - 1)}
          onBlur={onLeave}
          onKeyDown={onKey}
        >
          <g className="grid">
            {ticks.map((v) => (
              <line key={v} x1={margin.left} x2={margin.left + plotW} y1={y(v)} y2={y(v)} />
            ))}
          </g>
          <g className="axis">
            {ticks.map((v) => (
              <text key={v} x={margin.left - 6} y={y(v) + 3.5} textAnchor="end">
                {formatTick(v)}
              </text>
            ))}
            <line x1={margin.left} x2={margin.left + plotW} y1={margin.top + plotH} y2={margin.top + plotH} />
            {xTicks.map((tk) => (
              <text key={tk.i} x={x(tk.i)} y={margin.top + plotH + 17} textAnchor="middle">
                {tk.label}
              </text>
            ))}
          </g>
          <g className="annot">
            {annotations.map((a) => (
              <g key={a.i}>
                <line x1={x(a.i)} x2={x(a.i)} y1={margin.top - 4} y2={margin.top + plotH} />
                <text x={x(a.i) + 4} y={margin.top - 8}>
                  {a.label}
                </text>
              </g>
            ))}
          </g>
          {lines.map(
            (l) =>
              l.band && (
                <path key={`${l.id}-band`} d={bandOf(l.band.lo, l.band.hi)} style={{ fill: 'var(--band)' }} stroke="none" />
              ),
          )}
          {lines.map((l) => (
            <path
              key={l.id}
              d={pathOf(l.values)}
              fill="none"
              style={{ stroke: l.color }}
              strokeWidth={l.width ?? 2}
              strokeDasharray={l.dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {lines
            .filter((l) => l.dots)
            .map((l) => (
              <g key={`${l.id}-dots`}>
                {Array.from({ length: l.values.length }, (_, i) =>
                  valid(l.values[i]) ? (
                    <circle key={i} cx={x(i)} cy={y(l.values[i])} r={3.5} style={{ fill: l.color, stroke: 'var(--surface)' }} strokeWidth={1.5} />
                  ) : null,
                )}
              </g>
            ))}
          {labels.map((lb) => (
            <text key={lb.id} className="direct" x={margin.left + plotW + 8} y={lb.y + 4}>
              {lb.label}
            </text>
          ))}
          {hoverI !== null && (
            <g>
              <line className="xhair" x1={x(hoverI)} x2={x(hoverI)} y1={margin.top} y2={margin.top + plotH} />
              {lines.map((l) =>
                valid(l.values[hoverI]) ? (
                  <circle key={l.id} cx={x(hoverI)} cy={y(l.values[hoverI])} r={4} style={{ fill: l.color, stroke: 'var(--surface)' }} strokeWidth={2} />
                ) : null,
              )}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

export function SeriesLegend({ lines, extra }: { lines: LineSpec[]; extra?: ReactNode }) {
  return (
    <div className="series-legend">
      {lines.map((l) => (
        <span className="key" key={l.id}>
          <LineKey color={l.color} dash={l.dash} width={l.width ?? 2} />
          {l.label}
        </span>
      ))}
      {extra}
    </div>
  );
}
