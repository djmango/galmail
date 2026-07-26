export type SwipeMailAction =
  | "archive"
  | "trash"
  | "spam"
  | "star"
  | "mark_read"
  | "mark_unread"
  | "none";

export type SwipeSlot =
  | "rightNear"
  | "rightFar"
  | "leftNear"
  | "leftFar";

export type SwipeActionSettings = Record<SwipeSlot, SwipeMailAction>;

export const DEFAULT_SWIPE_ACTIONS: SwipeActionSettings = {
  rightNear: "archive",
  rightFar: "star",
  leftNear: "trash",
  leftFar: "spam",
};

export const SWIPE_ACTION_OPTIONS: {
  id: SwipeMailAction;
  label: string;
}[] = [
  { id: "archive", label: "Archive" },
  { id: "trash", label: "Delete" },
  { id: "spam", label: "Spam" },
  { id: "star", label: "Star" },
  { id: "mark_read", label: "Mark read" },
  { id: "mark_unread", label: "Mark unread" },
  { id: "none", label: "None" },
];

export const SWIPE_SLOT_LABELS: Record<SwipeSlot, string> = {
  rightNear: "Swipe right",
  rightFar: "Swipe right (far)",
  leftNear: "Swipe left",
  leftFar: "Swipe left (far)",
};

const STORAGE_KEY = "galmail.swipeActions";

const VALID = new Set<SwipeMailAction>(
  SWIPE_ACTION_OPTIONS.map((option) => option.id),
);

function isSwipeAction(value: unknown): value is SwipeMailAction {
  return typeof value === "string" && VALID.has(value as SwipeMailAction);
}

/** Load persisted swipe gesture bindings. */
export function loadPersistedSwipeActions(): SwipeActionSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SWIPE_ACTIONS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SWIPE_ACTIONS };
    const parsed = JSON.parse(raw) as Partial<SwipeActionSettings>;
    return {
      rightNear: isSwipeAction(parsed.rightNear)
        ? parsed.rightNear
        : DEFAULT_SWIPE_ACTIONS.rightNear,
      rightFar: isSwipeAction(parsed.rightFar)
        ? parsed.rightFar
        : DEFAULT_SWIPE_ACTIONS.rightFar,
      leftNear: isSwipeAction(parsed.leftNear)
        ? parsed.leftNear
        : DEFAULT_SWIPE_ACTIONS.leftNear,
      leftFar: isSwipeAction(parsed.leftFar)
        ? parsed.leftFar
        : DEFAULT_SWIPE_ACTIONS.leftFar,
    };
  } catch {
    return { ...DEFAULT_SWIPE_ACTIONS };
  }
}

/** Persist swipe gesture bindings. */
export function persistSwipeActions(settings: SwipeActionSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function swipeActionLabel(action: SwipeMailAction): string {
  return (
    SWIPE_ACTION_OPTIONS.find((option) => option.id === action)?.label ??
    action
  );
}

/** Near / far thresholds in CSS pixels. */
export const SWIPE_NEAR_PX = 72;
export const SWIPE_FAR_PX = 144;

export function resolveSwipeAction(
  dx: number,
  settings: SwipeActionSettings,
): SwipeMailAction | null {
  const abs = Math.abs(dx);
  if (abs < SWIPE_NEAR_PX) return null;
  if (dx > 0) {
    return abs >= SWIPE_FAR_PX ? settings.rightFar : settings.rightNear;
  }
  return abs >= SWIPE_FAR_PX ? settings.leftFar : settings.leftNear;
}

export function swipeActionTone(
  action: SwipeMailAction,
): "archive" | "danger" | "star" | "neutral" {
  switch (action) {
    case "archive":
    case "mark_read":
      return "archive";
    case "trash":
    case "spam":
      return "danger";
    case "star":
      return "star";
    default:
      return "neutral";
  }
}
