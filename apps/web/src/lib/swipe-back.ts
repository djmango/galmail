export const SWIPE_BACK_EDGE_PX = 28;
export const SWIPE_BACK_TRIGGER_PX = 88;
export const SWIPE_BACK_AXIS_LOCK_PX = 10;

export function canBeginSwipeBack(clientX: number, width: number): boolean {
  if (width <= 0) return clientX <= SWIPE_BACK_EDGE_PX;
  return clientX <= Math.min(SWIPE_BACK_EDGE_PX, width * 0.18);
}

export function swipeBackProgress(dx: number, width: number): number {
  if (dx <= 0 || width <= 0) return 0;
  return Math.min(1, dx / Math.max(SWIPE_BACK_TRIGGER_PX, width * 0.35));
}

export function shouldCompleteSwipeBack(dx: number, vx = 0): boolean {
  return dx >= SWIPE_BACK_TRIGGER_PX || (dx > 48 && vx > 0.45);
}
