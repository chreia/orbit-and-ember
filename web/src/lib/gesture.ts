// Decides whether a map click is a real click or the tail of a drag gesture.
// Browsers fire `click` after a drag that starts and ends on the same element, so a rectangle drawn
// on the map would otherwise be followed by a click that selects whatever lies under the pointer.

export const CLICK_TOLERANCE_PX = 4;

export interface ClickGuard {
  down: { x: number; y: number } | null;
  suppress: boolean;
}

export function newClickGuard(): ClickGuard {
  return { down: null, suppress: false };
}

/** Call on every pointer press on the map. */
export function guardDown(g: ClickGuard, p: { x: number; y: number }): void {
  g.down = { x: p.x, y: p.y };
  g.suppress = false;
}

/** Call when a gesture has produced its own result (for example a finished rectangle). */
export function guardConsumed(g: ClickGuard): void {
  g.suppress = true;
}

/** True when the click should act: not right after a consumed gesture, and not the end of a drag. */
export function acceptClick(g: ClickGuard, p: { x: number; y: number }): boolean {
  if (g.suppress) {
    g.suppress = false;
    return false;
  }
  if (g.down && Math.hypot(p.x - g.down.x, p.y - g.down.y) > CLICK_TOLERANCE_PX) return false;
  return true;
}
