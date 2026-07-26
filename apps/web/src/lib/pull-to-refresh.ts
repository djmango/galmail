/** iOS WKWebView often reports fractional scrollTop after rubber-band. */
export const PULL_SCROLL_TOP_SLOP = 2;
export const PULL_TRIGGER_PX = 64;
export const PULL_MAX_PX = 96;
export const PULL_AXIS_LOCK_PX = 8;

export function canBeginPull(scrollTop: number): boolean {
  return scrollTop <= PULL_SCROLL_TOP_SLOP;
}

export function pullDistanceFromDelta(deltaY: number): number {
  if (deltaY <= 0) return 0;
  // Slight resistance so the indicator doesn't slam open.
  return Math.min(PULL_MAX_PX, deltaY * 0.55);
}

export function shouldTriggerRefresh(distance: number): boolean {
  return distance >= PULL_TRIGGER_PX;
}

export type PullAxis = "undecided" | "x" | "y";

export function resolvePullAxis(
  dx: number,
  dy: number,
  current: PullAxis,
): PullAxis {
  if (current !== "undecided") return current;
  if (Math.abs(dx) < PULL_AXIS_LOCK_PX && Math.abs(dy) < PULL_AXIS_LOCK_PX) {
    return "undecided";
  }
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}
