import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { haptic } from "../lib/haptics";
import {
  resistSwipeOffset,
  resolveSwipeAction,
  SWIPE_FAR_PX,
  SWIPE_NEAR_PX,
  swipeActionDismisses,
  swipeActionLabel,
  swipeActionTone,
  type SwipeActionSettings,
  type SwipeMailAction,
} from "../lib/swipe-actions";
import { Icons } from "./Icons";

function actionIcon(action: SwipeMailAction) {
  switch (action) {
    case "archive":
      return <Icons.archive />;
    case "trash":
      return <Icons.trash />;
    case "spam":
      return <Icons.warning />;
    case "star":
      return <Icons.star />;
    case "mark_read":
      return <Icons.mailOpen />;
    case "mark_unread":
      return <Icons.mail />;
    default:
      return null;
  }
}

function thresholdBand(offset: number): "none" | "near" | "far" {
  const abs = Math.abs(offset);
  if (abs >= SWIPE_FAR_PX) return "far";
  if (abs >= SWIPE_NEAR_PX) return "near";
  return "none";
}

const EXIT_MS = 240;
const SNAP_MS = 220;
const SNAP_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function SwipeableThreadRow(props: {
  enabled: boolean;
  settings: SwipeActionSettings;
  onAction: (action: SwipeMailAction) => void;
  children: ReactNode;
}) {
  const [exiting, setExiting] = useState(false);
  // Preview labels are React state, but opacity / transform stay imperative so
  // re-renders never reset mid-gesture styles back to the resting frame.
  const [revealAction, setRevealAction] = useState<SwipeMailAction | null>(
    null,
  );
  const [revealSide, setRevealSide] = useState<"left" | "right">("left");
  const [atFar, setAtFar] = useState(false);

  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const leftRevealRef = useRef<HTMLDivElement>(null);
  const rightRevealRef = useRef<HTMLDivElement>(null);

  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<"undecided" | "x" | "y">("undecided");
  const pointerId = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const rawDxRef = useRef(0);
  const bandRef = useRef<"none" | "near" | "far">("none");
  const actionRef = useRef<SwipeMailAction | null>(null);
  const sideRef = useRef<"left" | "right">("left");
  const farRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingDx = useRef(0);
  const lockedRef = useRef(false);
  const snapTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (snapTimerRef.current != null) window.clearTimeout(snapTimerRef.current);
      if (exitTimerRef.current != null) window.clearTimeout(exitTimerRef.current);
    };
  }, []);

  if (!props.enabled) {
    return <>{props.children}</>;
  }

  const setDraggingClass = (on: boolean) => {
    rowRef.current?.classList.toggle("is-dragging", on);
  };

  const paintOffset = (next: number, withTransition: string | null) => {
    offsetRef.current = next;
    const content = contentRef.current;
    if (content) {
      content.style.transform = `translate3d(${next}px, 0, 0)`;
      content.style.transition = withTransition ?? "none";
    }

    const abs = Math.abs(next);
    const progress = Math.min(1, abs / SWIPE_FAR_PX);
    const side: "left" | "right" = next >= 0 ? "left" : "right";
    const leftEl = leftRevealRef.current;
    const rightEl = rightRevealRef.current;
    const revealTransition =
      withTransition != null
        ? `opacity ${SNAP_MS}ms ${SNAP_EASE}`
        : "none";
    if (leftEl) {
      leftEl.style.transition = revealTransition;
      leftEl.style.opacity =
        side === "left" && next > 0 ? String(Math.max(0.35, progress)) : "0";
      leftEl.dataset.far =
        side === "left" && abs >= SWIPE_FAR_PX ? "true" : "false";
    }
    if (rightEl) {
      rightEl.style.transition = revealTransition;
      rightEl.style.opacity =
        side === "right" && next < 0 ? String(Math.max(0.35, progress)) : "0";
      rightEl.dataset.far =
        side === "right" && abs >= SWIPE_FAR_PX ? "true" : "false";
    }

    const action = resolveSwipeAction(rawDxRef.current || next, props.settings);
    const far = Math.abs(rawDxRef.current || next) >= SWIPE_FAR_PX;
    if (action !== actionRef.current) {
      actionRef.current = action;
      setRevealAction(action && action !== "none" ? action : null);
    }
    if (side !== sideRef.current) {
      sideRef.current = side;
      setRevealSide(side);
    }
    if (far !== farRef.current) {
      farRef.current = far;
      setAtFar(far);
    }

    const band = thresholdBand(rawDxRef.current || next);
    if (band !== bandRef.current) {
      bandRef.current = band;
      if (band === "near") haptic("selection");
      if (band === "far") haptic("impact-light");
    }
  };

  const flushMove = () => {
    rafRef.current = null;
    if (lockedRef.current || axis.current !== "x") return;
    rawDxRef.current = pendingDx.current;
    paintOffset(resistSwipeOffset(pendingDx.current), null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || lockedRef.current || exiting) return;
    if (snapTimerRef.current != null) {
      window.clearTimeout(snapTimerRef.current);
      snapTimerRef.current = null;
    }
    pointerId.current = event.pointerId;
    startX.current = event.clientX;
    startY.current = event.clientY;
    axis.current = "undecided";
    bandRef.current = "none";
    actionRef.current = null;
    pendingDx.current = 0;
    rawDxRef.current = 0;
    setDraggingClass(true);
    setRevealAction(null);
    const content = contentRef.current;
    if (content) content.style.transition = "none";
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId || lockedRef.current) return;
    const dx = event.clientX - startX.current;
    const dy = event.clientY - startY.current;
    if (axis.current === "undecided") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis.current === "y") {
        setDraggingClass(false);
        return;
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture can fail if the pointer already ended.
      }
      event.currentTarget.style.touchAction = "none";
    }
    if (axis.current !== "x") return;
    event.preventDefault();
    pendingDx.current = dx;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(flushMove);
    }
  };

  const completeAction = (action: SwipeMailAction) => {
    haptic(
      action === "trash" || action === "spam" ? "warning" : "impact-medium",
    );
    props.onAction(action);
  };

  const clearInlineMotion = () => {
    const content = contentRef.current;
    if (content) {
      content.style.transition = "";
      content.style.transform = "";
    }
    for (const el of [leftRevealRef.current, rightRevealRef.current]) {
      if (!el) continue;
      el.style.transition = "";
      el.style.opacity = "0";
      el.dataset.far = "false";
    }
  };

  const snapBack = (then?: () => void) => {
    // Drop is-dragging synchronously so CSS cannot kill the snap transition.
    setDraggingClass(false);
    paintOffset(0, `transform ${SNAP_MS}ms ${SNAP_EASE}`);
    snapTimerRef.current = window.setTimeout(() => {
      snapTimerRef.current = null;
      clearInlineMotion();
      then?.();
      lockedRef.current = false;
      setRevealAction(null);
      actionRef.current = null;
      bandRef.current = "none";
      rawDxRef.current = 0;
    }, SNAP_MS);
  };

  const dismissOut = (action: SwipeMailAction) => {
    const row = rowRef.current;
    const content = contentRef.current;
    if (!row || !content) {
      completeAction(action);
      return;
    }
    lockedRef.current = true;
    setDraggingClass(false);
    setExiting(true);
    const width = row.offsetWidth || window.innerWidth;
    const dir = (rawDxRef.current || offsetRef.current) >= 0 ? 1 : -1;
    const startHeight = row.offsetHeight;
    row.style.height = `${startHeight}px`;
    row.style.overflow = "hidden";
    row.style.transition = `height ${EXIT_MS}ms ${SNAP_EASE}, opacity ${EXIT_MS}ms ease`;
    content.style.transition = `transform ${EXIT_MS}ms ${SNAP_EASE}`;
    content.style.transform = `translate3d(${dir * (width + 40)}px, 0, 0)`;
    const reveal = dir > 0 ? leftRevealRef.current : rightRevealRef.current;
    if (reveal) {
      reveal.style.transition = "none";
      reveal.style.opacity = "1";
    }
    // Keep the opposite reveal hidden without React resetting styles.
    const other = dir > 0 ? rightRevealRef.current : leftRevealRef.current;
    if (other) other.style.opacity = "0";
    requestAnimationFrame(() => {
      row.style.height = "0px";
      row.style.opacity = "0";
    });
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      completeAction(action);
    }, EXIT_MS);
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    event.currentTarget.style.touchAction = "";
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (axis.current === "x") {
        rawDxRef.current = pendingDx.current;
        paintOffset(resistSwipeOffset(pendingDx.current), null);
      }
    }
    if (lockedRef.current || exiting) return;

    // Resolve from raw finger travel so rubber-banding is visual-only.
    const action =
      axis.current === "x"
        ? resolveSwipeAction(rawDxRef.current, props.settings)
        : null;
    axis.current = "undecided";

    if (action && action !== "none") {
      if (swipeActionDismisses(action)) {
        dismissOut(action);
      } else {
        lockedRef.current = true;
        snapBack(() => completeAction(action));
      }
      return;
    }

    snapBack();
  };

  const leftPreview =
    revealSide === "left"
      ? (revealAction ??
        (atFar ? props.settings.rightFar : props.settings.rightNear))
      : props.settings.rightNear;
  const rightPreview =
    revealSide === "right"
      ? (revealAction ??
        (atFar ? props.settings.leftFar : props.settings.leftNear))
      : props.settings.leftNear;

  return (
    <div
      ref={rowRef}
      className={`swipe-row${exiting ? " is-exiting" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <div
        ref={leftRevealRef}
        className={`swipe-reveal swipe-reveal-left tone-${swipeActionTone(leftPreview)}${
          revealSide === "left" && revealAction ? " is-active" : ""
        }`}
        aria-hidden
      >
        <span className="swipe-reveal-icon">{actionIcon(leftPreview)}</span>
        <span className="swipe-reveal-label">
          {swipeActionLabel(leftPreview)}
        </span>
      </div>
      <div
        ref={rightRevealRef}
        className={`swipe-reveal swipe-reveal-right tone-${swipeActionTone(rightPreview)}${
          revealSide === "right" && revealAction ? " is-active" : ""
        }`}
        aria-hidden
      >
        <span className="swipe-reveal-icon">{actionIcon(rightPreview)}</span>
        <span className="swipe-reveal-label">
          {swipeActionLabel(rightPreview)}
        </span>
      </div>
      <div ref={contentRef} className="swipe-row-content">
        {props.children}
      </div>
    </div>
  );
}
