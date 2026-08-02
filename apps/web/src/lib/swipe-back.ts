export const SWIPE_BACK_EDGE_PX = 28;
/** Fraction of screen width from the left where swipe-back may begin. */
export const SWIPE_BACK_EDGE_RATIO = 0.33;
export const SWIPE_BACK_TRIGGER_PX = 72;
export const SWIPE_BACK_AXIS_LOCK_PX = 10;

export function canBeginSwipeBack(clientX: number, width: number): boolean {
  if (width <= 0) return clientX <= SWIPE_BACK_EDGE_PX;
  return clientX <= Math.max(SWIPE_BACK_EDGE_PX, width * SWIPE_BACK_EDGE_RATIO);
}

export function swipeBackProgress(dx: number, width: number): number {
  if (dx <= 0 || width <= 0) return 0;
  return Math.min(1, dx / Math.max(SWIPE_BACK_TRIGGER_PX, width * 0.3));
}

export function shouldCompleteSwipeBack(dx: number, vx = 0): boolean {
  return dx >= SWIPE_BACK_TRIGGER_PX || (dx > 40 && vx > 0.4);
}
