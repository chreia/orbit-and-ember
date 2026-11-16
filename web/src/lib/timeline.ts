// Month scrubber arithmetic. The period is a window [m0, m1] that moves as a whole: dragging the
// scrubber or playing keeps its length, so a one-month window steps month by month and a 12-month
// window slides through the record. A window as long as the record has nowhere to move, so it
// becomes a single month.
export type Range = [number, number];

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function windowLength(range: Range): number {
  return range[1] - range[0] + 1;
}

/** The window of the same length that ends at month m, kept inside [0, n - 1]. */
export function windowEndingAt(range: Range, m: number, n: number): Range {
  const len = windowLength(range);
  if (len >= n) {
    const e = clamp(Math.round(m), 0, n - 1);
    return [e, e];
  }
  const end = clamp(Math.round(m), len - 1, n - 1);
  return [end - len + 1, end];
}

/** A window of `len` months ending where the current one ends (or as late as it fits). */
export function windowOfLength(range: Range, len: number, n: number): Range {
  const l = clamp(Math.round(len), 1, n);
  const end = clamp(range[1], l - 1, n - 1);
  return [end - l + 1, end];
}

/** Where play starts: a full-record window becomes its first month; a window at the end rewinds. */
export function playStart(range: Range, n: number): Range {
  const len = windowLength(range);
  if (len >= n) return [0, 0];
  if (range[1] >= n - 1) return [0, len - 1];
  return range;
}

/** The next window while playing, or null at the end of the record. */
export function playNext(range: Range, n: number): Range | null {
  if (range[1] >= n - 1) return null;
  return [range[0] + 1, range[1] + 1];
}

/** Keyboard steps on the scrubber, in months. */
export function scrubKeyStep(key: string): number | 'home' | 'end' | null {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return -1;
    case 'ArrowRight':
    case 'ArrowUp':
      return 1;
    case 'PageDown':
      return -12;
    case 'PageUp':
      return 12;
    case 'Home':
      return 'home';
    case 'End':
      return 'end';
    default:
      return null;
  }
}

/** Contiguous runs of months that share a key (for drawing the observed and model bands). */
export function runs<T>(n: number, keyOf: (m: number) => T): { key: T; m0: number; m1: number }[] {
  const out: { key: T; m0: number; m1: number }[] = [];
  for (let m = 0; m < n; m++) {
    const k = keyOf(m);
    const last = out[out.length - 1];
    if (last && last.key === k && last.m1 === m - 1) last.m1 = m;
    else out.push({ key: k, m0: m, m1: m });
  }
  return out;
}
