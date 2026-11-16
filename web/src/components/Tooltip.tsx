// One floating tooltip for the whole app. Charts call show() with a position and content.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
  /** anchor rectangle for keyboard focus; the tooltip sits beside it */
  anchor?: DOMRect;
}

interface TipApi {
  show: (s: TipState) => void;
  hide: () => void;
}

const TipContext = createContext<TipApi>({ show: () => {}, hide: () => {} });
export const useTooltip = () => useContext(TipContext);

/** Pointer-leave handler that keeps touch tooltips open (touch fires leave right after the tap). */
export const leaveUnlessTouch = (hide: () => void) => (e: { pointerType: string }) => {
  if (e.pointerType !== 'touch') hide();
};

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const lastShow = useRef(0);
  const api = useRef<TipApi>({
    show: (s) => {
      lastShow.current = performance.now();
      setTip(s);
    },
    hide: () => setTip(null),
  });
  // Touch: tooltips stay up after a tap (there is no hover) and close on the next tap elsewhere or a scroll.
  useEffect(() => {
    const onDown = () => {
      if (performance.now() - lastShow.current > 120) setTip(null);
    };
    const onScroll = () => setTip(null);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, []);
  return (
    <TipContext.Provider value={api.current}>
      {children}
      {tip && <Floating tip={tip} />}
    </TipContext.Provider>
  );
}

function Floating({ tip }: { tip: TipState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;
    let left: number;
    let top: number;
    if (tip.anchor) {
      const a = tip.anchor;
      left = a.right + pad;
      if (left + w > vw - 8) left = a.left - w - pad;
      top = a.top + a.height / 2 - h / 2;
    } else {
      left = tip.x + pad;
      if (left + w > vw - 8) left = tip.x - w - pad;
      top = tip.y + pad;
      if (top + h > vh - 8) top = tip.y - h - pad;
    }
    left = Math.max(8, Math.min(vw - w - 8, left));
    top = Math.max(8, Math.min(vh - h - 8, top));
    setPos({ left, top });
  }, [tip]);
  return (
    <div ref={ref} className="tooltip" role="tooltip" style={{ left: pos.left, top: pos.top }}>
      {tip.content}
    </div>
  );
}

/** Short line key used in tooltips and legends. */
export function LineKey({ color, dash, width = 2.5 }: { color: string; dash?: string; width?: number }) {
  return (
    <svg width="18" height="8" aria-hidden="true">
      <line x1="1" x2="17" y1="4" y2="4" style={{ stroke: color }} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}
