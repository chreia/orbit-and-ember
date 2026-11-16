// Small robust-statistics helpers. Inputs are plain number arrays; NaN values are ignored.

function clean(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

/** Quantile with linear interpolation between order statistics (type 7). */
export function quantile(values: ArrayLike<number>, q: number): number {
  const s = clean(values);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function median(values: ArrayLike<number>): number {
  return quantile(values, 0.5);
}

/** Median absolute deviation from the median (unscaled). */
export function mad(values: ArrayLike<number>): number {
  const s = clean(values);
  if (s.length === 0) return NaN;
  const med = median(s);
  return median(s.map((v) => Math.abs(v - med)));
}

export function sum(values: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i];
  return s;
}
